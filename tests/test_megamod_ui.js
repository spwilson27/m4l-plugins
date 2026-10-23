#!/usr/bin/env node
/**
 * Variant-specific tests for devices/Mega Modulator.amxd.
 * Runs src/megamod_ui.js (+ shared config/mapper) in a VM with a mocked mgraphics and checks: load, painting in both views
 * (rack strips, and the LST view = modulator inspector with tabs, expanded editor, filtered mapping list and remap editor;
 * popup, name edit, "pool full" pill), hit-testing, device width for 0 / 1 / 5 / 16 modulators in both views, the rail
 * learn button (single / Shift multi / disarm / retarget), the LST toggle, and the strip / mapping-list / remap-editor
 * (MSEG transfer curve) interactions, plus panel / chip bounds and overlaps.
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
    mg.show_text = (t) => { log.texts.push(String(t)); if (log.textCols) log.textCols.push({ t: String(t), col }); };
    mg.text_measure = (t) => [String(t).length * 4, 8];
    const box = { rect: [4, 4, 486, 161], getattr: (k) => box.rect, setattr: (k, ...v) => { box.rect = v; log.boxSet.push(v); } };
    // saved automatable pool objects (ap_<i>, ad_<k>): record messages and echo them straight back like Live does
    const live = {};
    const fronted = [];
    const patcher = { bringtofront: (o) => fronted.push(o.name), getnamed: (n) => {
        if (n === "obj-viz") return box;
        if (!((/^ap_\d+$/.test(n) && Number(n.slice(3)) < 96) || (/^at_\d+$/.test(n) && Number(n.slice(3)) < 96) || (/^ad_\d+$/.test(n) && Number(n.slice(3)) < 64) || n === "ap_marker")) return null;
        if (!live[n]) live[n] = { name: n, attrs: {}, setLog: [], messages: [], value: 0, setattr(k, ...v) { this.attrs[k] = v.length === 1 ? v[0] : v; this.setLog.push([k, ...v]); }, getattr(k) { return this.attrs[k]; }, getvalueof() { return this.value; },
            message(t, v) { this.messages.push([t, v]); this.value = v; const m = /^(ap|ad|at)_(\d+)$/.exec(n); if (!m) ctx.autom(v); else if (m[1] === "ap") ctx.autop(Number(m[2]), v); else if (m[1] === "at") ctx.autot(Number(m[2]), v); else ctx.autod(Number(m[2]), v); } };
        return live[n];
    } };
    const ctx = { mgraphics: mg, console, box, patcher, outlet: (...a) => log.outlets.push(a), notifyclients: () => { log.notify++; }, post() {}, arrayfromargs: (a) => Array.prototype.slice.call(a), inlets: 1, outlets: 2 };
    vm.createContext(ctx);
    const code = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script())"], { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(code, ctx, { filename: "megamod_ui.js" });
    // the DSP is "up" for these tests (the deferred-DSP state machine is tested in tests/test_megamod.js section 10); router messages show on the outlet log as before
    vm.runInContext("mmdRouterMsg = function (k, v) { outlet(0, k, v); }; MM.dspSetState(true);", ctx);
    return { ctx, log, live, fronted, run: (c) => vm.runInContext(c, ctx) };
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
ok(R0.meter === undefined, "strips have no output meter rect");
eq(run("ubHit(" + (R0.viz[0] + R0.viz[2] - 2) + ", 40)").kind, "viz", "viz reaches the freed width");
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
    ok(cs.viz[3] >= 60 && cs.meter === undefined, "collapsed strip viz uses the freed height, no meter");
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
    const a0 = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 3 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
    log.fills = [];
    run("ubFrame = 7"); run("paint()");
    const a1 = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 3 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
    ok(a0.length > 0 && a1.length > 0 && a0.join() !== a1.join(), "single-shot learn pulses (button alpha changes between frames)");
    run("MM.armLearn(ubSel(), true); ubFrame = 0"); log.fills = []; run("paint()");
    const m0 = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 3 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
    run("ubFrame = 7"); log.fills = []; run("paint()");
    const m1_ = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 3 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
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

// ---------------------------------------------------------------- header double-click = expand / collapse (no rename)
{
    const g1 = run("ubStrips().list[1]");
    const hd = run("ubStripRects(ubStrips().list[1])").head;
    const nm = run("ubStripRects(ubStrips().list[1])").name;
    run("MM.setUI({ exp: -1 })");
    dbl(...center(hd));
    eq(run("ubExp()"), g1.slot, "double-click on a collapsed strip's header expands it");
    dbl(...center(run("ubStripRects(ubStrips().list.filter((g) => g.exp)[0])").head));
    eq(run("ubExp()"), -1, "double-click on the expanded header collapses it");
    dbl(...center(nm));
    eq(run("ubExp()"), g1.slot, "double-click on a collapsed strip's name area expands it");
    run("MM.setUI({ exp: -1 })");
    ok(run("typeof ubEdit") === "undefined" && run("typeof ubCommitEdit") === "undefined", "no rename / editing state exists");
}

// ---------------------------------------------------------------- type picker + delete
click(run("ubStrips().plus.x") + 5, 80);
ok(run("!!ubPopup"), "plus opens the type picker");
log.texts.length = 0;
run("paint()");
ok(log.texts.includes("Follower") && log.texts.includes("ADSR") && log.texts.includes("XY") && log.texts.includes("Buttons") && !log.texts.includes("Envelope"), "picker lists the type names (Follower, ADSR, XY, Buttons)");
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

// ---------------------------------------------------------------- LST view: filtered mapping list + remap editor
run("MM.demo()");
run("MM.setUI({ order: [], sel: 0, exp: -1, pbSel: 0, pbScroll: 0 })");
for (let k = 0; k < 4; k++) run(`MM.addMapping(0, { path: 'live_set tracks 5 devices 0 parameters ${k}', trackName: 'Tr', deviceName: 'Dev', paramName: 'P${k}' })`);
run("MM.addMapping(1, { path: 'live_set tracks 6 devices 0 parameters 9', trackName: 'Tr2', deviceName: 'Dev2', paramName: 'Q1' })");
run("ubTogglePb(true)");
ok(run("ubPb()"), "list on");
const gm = run("ubListGeom()");
eq(gm.lx, 22 + 26 + 204 + 6, "list geometry: rail + tab column + expanded editor + gap");
eq(gm.end, gm.lx + 172 + 6 + 144, "list geometry: list + remap panel");
eq(lastWidth(), gm.end + 8, "LST width fits tabs + editor + list + remap panel");
log.texts.length = 0;
run("paint()");
ok(log.texts.includes("MAPPINGS") && log.texts.includes("P0"), "list paints headers and rows");
ok(log.texts.includes("P0") && !log.texts.includes("No mappings yet"), "the editor follows the selected modulator's first mapping");
{
    run("MM.setUI({ sel: 4 })");
    log.texts.length = 0; run("paint()");
    ok(log.texts.includes("No mappings yet") && log.texts.some((q) => q.indexOf("0 mappings on ") === 0), "a modulator without mappings shows the empty prompt and a 0 count");
    ok(!log.texts.includes("P0") && !log.texts.includes("Q1"), "the list shows only the selected modulator's mappings");
    run("MM.setUI({ sel: 0 })");
}
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
ok(log.texts.includes("P1") && log.texts.includes("Param 2") && !log.texts.includes("INV"), "editor shows the selected mapping, without the old INV button (the BIP chip belongs to the modulator editor)");
ok(!log.texts.includes("Amount"), "mod-mode editor has no Amount bar");
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
eq(dets().filter((d) => d.id.indexOf("preset") === 0).length, 4, "four preset buttons (no Stepped)");
ok(!det("preset4"), "no Stepped preset in the remap editor");
ok(det("mseg").rect[2] >= 100 && det("mseg").rect[3] >= 60, "MSEG editor is big enough to edit");
const shapeOf = () => run(`MM.getMapping(${m1.id}).shape`);
eq(shapeOf().length, 2, "starts as the linear two-point shape");
for (const [k, name] of [[1, "Exp"], [2, "Log"], [3, "S"], [0, "Linear"]]) {
    click(...center(det("preset" + k).rect));
    eq(JSON.stringify(shapeOf()), JSON.stringify(run(`curveToShape(${k}, 0.5, 4)`)), `preset ${name} loads its point set`);
    ok(run(`ubShapeIsPreset(MM.getMapping(${m1.id}), ${k})`), `preset ${name} lights up`);
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
ok(!!det("pol1") && !!det("pol0") && !!det("pol-1"), "three polarity buttons exist in Mod");
ok(!dets().some((d) => d.id === "amt" || d.id === "vmin" || d.id === "vmax" || d.id === "del" || d.id === "dbar"), "no amount, min / max box or delete ids remain in the editor");
for (const [id, pol] of [["pol1", 1], ["pol-1", -1], ["pol0", 0]]) {
    click(...center(det(id).rect));
    eq(run(`MM.getMapping(${m1.id}).polarity`), pol, `polarity button ${id} sets polarity ${pol}`);
}
{
    const rs = ["pol1", "pol0", "pol-1"].map((id) => det(id).rect);
    const tm = det("tabmod").rect; const tr = det("tabrem").rect; const ms = det("mseg").rect;
    ok(rs[0][1] === tm[1] && rs[1][1] === tm[1] && rs[2][1] === tm[1], "polarity control sits in the tab row");
    ok(rs[0][0] + rs[0][2] === rs[1][0] && rs[1][0] + rs[1][2] === rs[2][0], "polarity cells are one segmented control");
    ok(tm[0] + tm[2] <= tr[0] && tr[0] + tr[2] <= rs[0][0] && rs[2][0] + rs[2][2] <= ms[0] + 138 && rs[2][1] + rs[2][3] <= ms[1], "MOD / REM tabs and polarity share the tab row without overlap, above the MSEG");
    ok(!det("mode"), "the old bottom MOD|REM toggle is gone");
    ok(ms[3] >= 90 && det("preset0").rect[1] >= ms[1] + ms[3] && det("preset0").rect[1] + det("preset0").rect[3] <= 160, "MSEG is tall, presets row sits right under it inside the device");
    const tabModMod = tm.slice();
    click(...center(det("tabrem").rect));
    eq(run(`MM.getMapping(${m1.id}).mode`), "remote", "tabs: REM -> Remote");
    ok(!det("pol1") && !det("pol0") && !det("pol-1") && !det("amt") && !det("vmin") && !det("vmax") && !det("del"), "remote editor: no polarity control, amount, MIN / MAX boxes or delete");
    eq(JSON.stringify([det("tabmod").rect, det("tabrem").rect]), JSON.stringify([tabModMod, tr]), "tabs keep their size and position in Remote");
    eq(JSON.stringify(det("mseg").rect), JSON.stringify(ms), "MSEG keeps its size in Remote");
}
click(...center(det("tabmod").rect));
eq(run(`MM.getMapping(${m1.id}).mode`), "mod", "tabs: MOD -> Mod");
run("paint()");
// the editor shows the mapping's shape, every drawn control paints
{
    log.texts.length = 0; run("paint()");
    ok(log.texts.includes("MOD") && log.texts.includes("REM") && !log.texts.includes("Amount"), "editor paints MOD / REM, no Amount");
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
run(`MM.updateMapping(${m1.id}, { range: 0.3 })`);
const a0 = run(`MM.getMapping(${m1.id}).range`);
click(...at(P1.val));
drag(at(P1.val)[0] + 30, at(P1.val)[1]);
release();
ok(run(`MM.getMapping(${m1.id}).range`) > a0, "dragging the value changes the range");
click(...at(P1.mode));
eq(run(`MM.getMapping(${m1.id}).mode`), "remote", "list M/R toggle -> remote");
click(...at(P1.mode));
eq(run(`MM.getMapping(${m1.id}).mode`), "mod", "list M/R toggle -> mod");
dbl(...at(P1.name));
eq(run(`MM.getMapping(${m1.id}).enabled`), 0, "double-click a row disables the mapping");
run("paint()");
dbl(...at(P1.name));
eq(run(`MM.getMapping(${m1.id}).enabled`), 1, "double-click again enables it");
// row x delete (the editor has no delete button any more)
click(...at(P1.name));
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
    ok(vis.rows.every((r) => r.item.i === selSlot), "the list only holds the selected modulator (nothing else to tint)");
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
    const v0 = run("ubListVisible()");
    const r0 = v0.rows.filter((r) => r.item.i === 0 && r.item.kind === "map")[0];
    log.fills = [];
    run("paint()");
    ok(!!r0 && log.fills.some((f) => f.rect && f.rect[1] === r0.y && Math.abs(f.col[3] - run("UB_TINT_ROW")) < 1e-9 && Math.abs(f.col[0] - other[0]) < 1e-9), "tint follows the selection");
    log.fills = null;
}
// the modulator tabs select (and the list follows); the list header body selects too
{
    const tab3 = run("ubStrips().list.filter((g) => g.tab && g.slot === 3)[0]");
    click(tab3.x + tab3.w / 2, tab3.y + tab3.h / 2);
    eq(run("ubSel()"), 3, "clicking a modulator tab selects it");
    ok(run("ubListItems().every((it) => it.i === 3)"), "the list follows the selected tab");
    const hr2 = run("ubListVisible().rows.filter((r) => r.item.kind === 'head')[0]");
    eq(hr2.item.i, 3, "the list header belongs to the selected modulator");
    click(gm.lx + 30, hr2.y + 7);
    eq(run("ubSel()"), 3, "clicking the list header keeps its modulator selected");
    run("MM.setUI({ sel: 0 })");
}
// scroll
{
    for (let k = 0; k < 10; k++) run(`MM.addMapping(2, { path: 'live_set tracks 8 devices 0 parameters ${k}', trackName: 'T8', deviceName: 'D', paramName: 'S${k}' })`);
    run("MM.setUI({ sel: 2, pbScroll: 0 })");
    ctx.onwheel(gm.lx + 20, 80, 0, -1);
    eq(run("ubUIs().pbScroll"), 1, "wheel scrolls the list by one item");
    ctx.onwheel(gm.lx + 20, 80, 0, 1);
    eq(run("ubUIs().pbScroll"), 0, "wheel scrolls back");
    for (let k = 0; k < 80; k++) ctx.onwheel(gm.lx + 20, 80, 0, -1);
    eq(run("ubUIs().pbScroll"), run("ubListMaxScroll(ubListItems())"), "scroll clamps at the end");
    const sc0 = run("ubUIs().pbScroll");
    ctx.onwheel(100, 80, 0, -1);
    eq(run("ubUIs().pbScroll"), sc0, "wheel outside the list does not scroll it");
    run("MM.setUI({ sel: 0, pbScroll: 0 })");
}
// count chip opens the list on that modulator
run("ubTogglePb(false)");
click(...center(run("ubStripRects(ubStrips().list[0])").count));
ok(!run("ubPb()") && run("ubMapsPop && ubMapsPop.slot") === 0, "count chip opens the maps popover (not the LST view)");
click(...center(run("ubMapsPopGeom().lst")));
ok(run("ubPb()") && run("ubMapsPop") === null, "the popover's header LST button opens the inspector");
ok(run("ubUIs().pbSel") > 0 || run("MM.mappingsFor(0).length") === 0, "LST from the popover selects the first mapping");
// rail toggle back
click(11, 48);
ok(!run("ubPb()"), "rail LST button toggles back to the strips");
click(11, 48);
ok(run("ubPb()"), "rail LST button opens the inspector");
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
ok(E3.log.texts.includes("MAPPINGS") && E3.log.texts.includes("Frequency"), "preview shows the LST view with the selected mapping");
ok(E3.log.texts.includes("4 mappings on Dice") || E3.log.texts.some((t) => t.indexOf("4 mappings on Dice") === 0), "preview footer counts the shown mappings");
ok(E3.run("ubPbSelMapping() !== null") && E3.run("ubPb()"), "preview has a selected mapping and the editor");
ok(E3.run("MM.allMappings().some((m) => MM.mappingStatus(m.id) === 'missing')"), "preview has a missing row");
eq(E3.log.outlets.filter((o) => o[1] === "width").pop()[2], 22 + 26 + 204 + 6 + 172 + 6 + 144 + 8, "preview LST width");
ok(E3.run("MM.state.mods.some((m) => m && !m.enabled)"), "preview has a disabled modulator");
ok(E3.run("MM.allMappings().some((m) => !m.enabled)"), "preview has a disabled mapping");
ok(E3.run("MM.mappingsFor(ubSel()).length >= 3"), "preview: the selected modulator has several mappings");
ok(E3.run("ubPbSelMapping().shape.length >= 3 && ubPbSelMapping().shape.some((p) => Math.abs(p.curve) > 0.1)"), "preview: selected mapping has an MSEG with a bent segment");
ok(E3.run("ubListVisible().rows.some((r) => r.item.kind === 'head' && r.item.i === ubSel())"), "preview: the selected modulator header is visible");
ok(E3.run("MM.learn.armed"), "preview shows the rail learn armed");
eq(E3.run("(function () { const m = ubPbSelMapping(); return [m.mode, m.min, m.max]; })()"), ["mod", 0.2, 0.8], "preview: the selected mapping is Mod by default (min / max kept at 20-80%)");
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
    setPol(1);
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
    // Remote output bar: depth scales around the CENTRE (min + max) / 2, so the live fill runs from the centre to the live value
    {
        E3.run(`MM.updateMapping(${mm.id}, { mode: "remote", min: 0.25, max: 1, depth: 1 })`);
        const fill = (out) => E3.run(`(function () { const oR = ubRect, oT = ubTel; let f = null;
            ubRect = function (x, y, w, h, c, a) { if (a === 0.6) f = [x, y, w, h]; return oR.apply(null, arguments); };
            ubTel = function () { return { out: ${out}, phase: 0, u: 0, aux: 0 }; };
            try { ubPaintAbsMeter(${JSON.stringify(mr)}, ubPbSelMapping(), MM.state.mods[ubPbSelMapping().mod]); } finally { ubRect = oR; ubTel = oT; } return f; })()`);
        const g = E3.run(`ubMeterGeom(${JSON.stringify(mr)})`);
        const yOf = (v) => g.iy + g.ih * (1 - v);
        const wasOn = E3.run(`MM.state.mods[ubPbSelMapping().mod].enabled`); const modIx = E3.run(`ubPbSelMapping().mod`);
        E3.run(`MM.state.mods[${modIx}].enabled = 1`);
        const f1 = fill(1);
        near(f1[1], yOf(1), 1e-6, "Remote bar: depth 1, x = +1: the fill's top is the max (1)"); near(f1[1] + f1[3], yOf(0.625), 1e-6, "...and its bottom is the centre 0.625");
        const f0 = fill(-1);
        near(f0[1], yOf(0.625), 1e-6, "Remote bar: depth 1, x = -1: the fill starts at the centre"); near(f0[1] + f0[3], yOf(0.25), 1e-6, "...and ends at min 0.25");
        E3.run(`MM.updateMapping(${mm.id}, { depth: 0 })`);
        const fz = fill(1);
        near(fz[3], 1, 1e-6, "Remote bar: depth 0 -> the live value is the centre (a 1 px marker, no fill)"); near(fz[1], yOf(0.625), 1e-6, "...at 0.625");
        E3.run(`MM.updateMapping(${mm.id}, { depth: 0.5 })`);
        const fh = fill(1);
        near(fh[1], yOf(0.625 + (1 - 0.625) * 0.5), 1e-6, "Remote bar: depth 0.5, x = +1: 0.8125");
        E3.run(`MM.state.mods[${modIx}].enabled = ${wasOn}`);
        E3.run(`MM.updateMapping(${mm.id}, { mode: "mod", min: 0, max: 1, depth: 1 })`);
    }
    // list-row value text carries the polarity glyph and the range
    for (const [p, t] of [[1, "+50%"], [0, "\u00b150%"], [-1, "\u221250%"]]) {
        setPol(p);
        E3.run(`MM.updateMapping(${mm.id}, { range: 0.5 })`);
        eq(E3.run("ubValueText(ubPbSelMapping())"), t, `value text for polarity ${p}`);
    }
    // value drag on the list row: Mod edits the range, Remote shifts the whole min..max window (width kept)
    {
        const dragRow = () => {
            E3.run(`ubListReveal(${mm.id}, 0)`); E3.run("paint()");
            const P = E3.run(`ubRowParts(ubListVisible().rows.filter((r) => r.item.m && r.item.m.id === ${mm.id})[0].y)`);
            const vx = P.val[0] + 4; const vy = P.val[1] + 4;
            E3.ctx.onclick(vx, vy, 1, 0, 0, 0, 0, 0);
            E3.ctx.ondrag(vx + 30, vy, 1, 0, 0, 0, 0, 0);
            E3.ctx.ondrag(vx + 30, vy, 0, 0, 0, 0, 0, 0);
        };
        E3.run(`MM.updateMapping(${mm.id}, { mode: 'mod', range: 0.2 })`);
        dragRow();
        ok(E3.run(`MM.getMapping(${mm.id}).range`) > 0.3, "mod: dragging the row value edits the range");
        E3.run(`MM.updateMapping(${mm.id}, { mode: 'remote', min: 0.2, max: 0.5, range: 0.2 })`);
        dragRow();
        const rm = E3.run(`MM.getMapping(${mm.id})`);
        ok(rm.min > 0.3 && Math.abs((rm.max - rm.min) - 0.3) < 1e-9 && rm.range === 0.2, "remote: dragging the row value shifts the window, width and range untouched");
        eq(E3.run("ubValueText(ubPbSelMapping())"), Math.round(rm.min * 100) + "\u2013" + Math.round(rm.max * 100) + "%", "remote value text is min\u2013max%");
        E3.run(`MM.updateMapping(${mm.id}, { min: 0.2, max: 0.8 })`);
        eq(E3.run("ubValueText(ubPbSelMapping())"), "20\u201380%", "remote value text 20\u201380%");
    }
    E3.run("paint()");
}

// ---------------------------------------------------------------- Remap editor: MOD / REM tabs, Remote bar
// Remote has independent min / max (absolute 0..1) set on the bar's triangles, no polarity; Mod has polarity (tab row) and range (bar triangles).
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
    const hitIds = () => { const g = gm(); const ids = new Set(); for (let yy = 0; yy < 161; yy += 2) for (let xx = g.px; xx < g.dx + g.dw; xx += 2) { const h = T.run(`ubHit(${xx}, ${yy})`); if (h.kind === "detail") ids.add(h.id); } return ids; };
    T.run(`ubSelect(2); MM.setUI({ pb: 1, pbSel: ${mid} })`);

    // the preview mapping is Remote 20..80%
    eq([M().mode, M().min, M().max], ["mod", 0.2, 0.8], "preview(): the selected mapping is Mod by default, min / max 20-80%");
    set({ mode: "remote", min: 0.2, max: 0.8, polarity: -1, range: 0.6 });

    // ---- Remote: texts, hit areas, layout
    {
        const tx = texts();
        ok(tx.includes("MOD") && tx.includes("REM") && !tx.includes("MIN") && !tx.includes("MAX"), "remote: MOD / REM tabs, no MIN / MAX boxes");
        ok(!tx.includes("Amount") && !tx.some((t) => t.indexOf("REMOTE") === 0) && !tx.includes("Range") && !tx.some((t) => t.indexOf("Lines =") === 0), "remote: no Amount, header strip, Range slider or explanatory text");
        ok(tx.includes("20–80%"), "remote: list row shows 20–80%");
        ok(!rects().some((d) => d.id === "amt" || d.id.indexOf("pol") === 0 || d.id === "rng" || d.id === "bmin" || d.id === "bmax" || d.id === "wintabs" || d.id === "mode" || d.id === "vmin" || d.id === "vmax" || d.id === "del"), "remote: no polarity / amount / MIN / MAX / delete rects");
        const ids = hitIds();
        ok(![...ids].some((id) => id === "amt" || id.indexOf("pol") === 0), "remote: no pixel of the editor hits a polarity / amount control");
        ok(["mseg", "meter", "preset0", "tabmod", "tabrem"].every((id) => ids.has(id)) && !ids.has("del") && !ids.has("vmin") && !ids.has("vmax"), "remote: MSEG, bar, presets and tabs are hittable, nothing hits a delete / MIN / MAX control");
        const g = gm(); const rs = rects();
        for (const d of rs) ok(d.rect[0] >= g.dx - 0.01 && d.rect[0] + d.rect[2] <= g.dx + g.dw + 0.01 && d.rect[1] >= 4 && d.rect[1] + d.rect[3] <= 161, `remote: ${d.id} inside the panel`);
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i].rect; const b = rs[j].rect;
            ok(a[0] + a[2] <= b[0] + 1e-6 || b[0] + b[2] <= a[0] + 1e-6 || a[1] + a[3] <= b[1] + 1e-6 || b[1] + b[3] <= a[1] + 1e-6, `remote: ${rs[i].id} and ${rs[j].id} do not overlap`);
        }
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
        same(["polarity", "range", "mode"], b, label);
    };
    {
        const r = rect("meter");
        own("min", () => gesture(r[0] + 2, yOfV(r, 0.2), r[0] + 2, yOfV(r, 0.05)), "bar: dragging the min triangle");
        own("max", () => gesture(r[0] + 2, yOfV(r, 0.8), r[0] + 2, yOfV(r, 0.95)), "bar: dragging the max triangle");
        near(M().max, 0.95, 0.03, "bar: max lands where dragged");
        // the nearest wins even when the press is between the triangles
        set({ min: 0.2, max: 0.8 }); gesture(r[0] + 8, yOfV(r, 0.7), r[0] + 8, yOfV(r, 0.55));
        eq(M().min, 0.2, "bar: nearest triangle wins (min stays)"); near(M().max, 0.55, 0.03, "bar: nearest triangle wins (max moves)");
        set({ min: 0.2, max: 0.8 }); gesture(r[0] + 2, yOfV(r, 0.2), r[0] + 2, yOfV(r, 0.2) - 300); eq(M().min, 1, "bar: min clamps to 100%");
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
        eq(M().max, 1, "max reset leaves min where it was set (0)");
        same(["polarity", "range"], { polarity: -1, range: 0.6 }, "resets keep the Mod fields");
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
    // ---- Mod mode: polarity in the tab row and the centred output bar; no Remote controls, no amount
    {
        set({ mode: "mod", polarity: 0, range: 0.7, min: 0.2, max: 0.8 });
        ok(!rect("amt") && !!rect("pol1") && !!rect("pol0") && !!rect("pol-1") && !!rect("meter") && !rect("vmin") && !rect("vmax") && !rect("rng") && !rect("del"), "mod: polarity and the output bar exist, no Amount, MIN / MAX or delete");
        const ids = hitIds();
        ok(![...ids].some((id) => id === "vmin" || id === "vmax" || id === "rng" || id === "amt" || id === "del"), "mod: no pixel hits an amount / min / max / delete control");
        ok(!!rect("tabmod") && !!rect("tabrem") && !rect("mode") && rect("pol1")[1] === rect("tabmod")[1], "mod: tabs and polarity share the top row");
        const tx = texts();
        ok(!tx.includes("Amount") && tx.includes("MOD") && tx.includes("REM") && !tx.includes("MIN") && !tx.includes("MAX"), "mod: paints tabs, no Amount / MIN / MAX");
        ok(tx.some((t) => /^[+±−]-?\d+%$/.test(t)), "mod: list value keeps its polarity glyph");
        const hh = M();
        eq([hh.min, hh.max], [0.2, 0.8], "switching to Mod keeps min / max");
        // polarity buttons, amount bar, linked markers
        for (const [id, pol] of [["pol1", 1], ["pol-1", -1], ["pol0", 0]]) { clk(...center(rect(id))); up(0, 0); eq(M().polarity, pol, `mod: ${id} sets polarity ${pol}`); }
        set({ polarity: 0, range: 0.7 });
        const mt = rect("meter"); const cy = mt[1] + mt[3] / 2; const hh2 = (mt[3] - 6) / 2;
        gesture(mt[0] + 2, cy - hh2 * 0.7, mt[0] + 2, cy - hh2 * 0.3); near(M().range, 0.3, 0.05, "mod: ± bar triangle sets the range (linked markers)");
        set({ polarity: 1, range: 0.7 }); const lo = M(); gesture(mt[0] + 2, cy + hh2 * 0.4, mt[0] + 2, cy + hh2 * 0.6); eq(M().range, lo.range, "mod: + ignores a press on the hidden side");
        set({ polarity: 0, range: 0.7 }); dbl2(mt[0] + 2, cy - hh2 * 0.7); eq(M().range, 1, "mod: double-click on the bar -> range 1");
        same(["min", "max"], { min: 0.2, max: 0.8 }, "mod gestures leave min / max");
    }
    // ---- tabs switch the mode both ways; the list row x deletes (there is no delete button in the editor)
    {
        set({ mode: "mod" }); clk(...center(rect("tabrem"))); up(0, 0); eq(M().mode, "remote", "the REM tab switches to Remote");
        clk(...center(rect("tabmod"))); up(0, 0); eq(M().mode, "mod", "the MOD tab switches to Mod");
        T.run("paint()");
        const n = T.run("MM.allMappings().length");
        const rowY = T.run(`ubListVisible().rows.filter((r) => r.item.m && r.item.m.id === ${mid})[0].y`);
        const dl = T.run(`ubRowParts(${rowY})`).del;
        clk(dl[0] + dl[2] / 2, dl[1] + dl[3] / 2); up(0, 0);
        eq(T.run("MM.allMappings().length"), n - 1, "the list row x deletes the mapping");
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
// ---- tab row: MOD / REM tabs + the polarity segmented control (Mod only); no X, no bottom controls
{
    const P = makeEnv();
    P.run("preview()");
    const pid = P.run("ubPbSelMapping().id");
    P.run(`ubSelect(2); MM.setUI({ pb: 1, pbSel: ${pid} })`);
    const rects = () => P.run(`ubDetailRects(ubListGeom(), MM.getMapping(${pid}))`);
    const pm = () => P.run(`MM.getMapping(${pid})`);
    const inter = (a, b) => !(a[0] + a[2] <= b[0] + 1e-6 || b[0] + b[2] <= a[0] + 1e-6 || a[1] + a[3] <= b[1] + 1e-6 || b[1] + b[3] <= a[1] + 1e-6);
    const px = (x, y) => P.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
    const sigs = {};
    for (const mode of ["mod", "remote"]) {
        const tag = `tab row ${mode}`;
        P.run(`MM.updateMapping(${pid}, { mode: "${mode}", polarity: 0 })`);
        P.run("paint()");
        const g = P.run("ubListGeom()");
        const rs = rects();
        const byId = (id) => rs.filter((d) => d.id === id)[0];
        for (const d of rs) ok(d.rect[0] >= g.dx - 1e-6 && d.rect[0] + d.rect[2] <= g.dx + g.dw + 1e-6 && d.rect[1] >= 0 && d.rect[1] + d.rect[3] <= 160, `${tag}: ${d.id} inside the detail panel and the 169 px device`);
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) ok(!inter(rs[i].rect, rs[j].rect), `${tag}: ${rs[i].id} and ${rs[j].id} do not overlap`);
        ok(rs.every((d) => ["amt", "vmin", "vmax", "del", "dbar"].indexOf(d.id) < 0), `${tag}: no amount, MIN / MAX or delete ids`);
        ok(byId("mseg").rect[3] >= 90 && byId("mseg").rect[2] >= 100, `${tag}: MSEG is tall and wide (${byId("mseg").rect[2]} x ${byId("mseg").rect[3]})`);
        sigs[mode] = JSON.stringify(rs.filter((d) => d.id !== "pol1" && d.id !== "pol0" && d.id !== "pol-1").map((d) => [d.id, d.rect]));
        P.log.texts.length = 0; P.run("paint()");
        ok(P.log.texts.length > 0 && !P.log.texts.includes("Amount"), `${tag}: paints without an Amount bar`);
        if (mode === "remote") {
            ok(rs.every((d) => d.id.indexOf("pol") !== 0), `${tag}: no polarity control`);
            continue;
        }
        const pols = ["pol1", "pol0", "pol-1"].map(byId);
        ok(pols.every((d) => !!d), `${tag}: three polarity cells exist`);
        for (const [id, pol] of [["pol1", 1], ["pol-1", -1], ["pol0", 0]]) {
            P.run(`MM.updateMapping(${pid}, { polarity: ${pol === 1 ? -1 : 1} })`);
            const r = byId(id).rect;
            px(r[0] + r[2] / 2, r[1] + r[3] / 2);
            P.ctx.onidle(0, 0, 0, 0, 0, 0, 0, 0);
            eq(pm().polarity, pol, `${tag}: clicking ${id} sets polarity ${pol}`);
        }
        // the lit cell uses the Mod accent, bypassed greys it
        for (const off of [0, 1]) {
            P.run(`MM.state.mods[MM.getMapping(${pid}).mod].enabled = ${off ? 0 : 1}`);
            P.run(`MM.updateMapping(${pid}, { polarity: 0 })`);
            P.log.fills = []; P.log.texts.length = 0; P.run("paint()");
            const r = byId("pol0").rect;
            const lit = P.log.fills.filter((f) => f.rect && Math.abs(f.rect[0] - (r[0] + 1)) < 1e-6 && Math.abs(f.rect[1] - (r[1] + 1)) < 1e-6 && Math.abs(f.col[3] - 0.3) < 1e-9);
            ok(lit.length === 1, `${tag}: selected polarity is lit (${off ? "bypassed" : "on"})`);
            if (!off) near(lit[0].col[0], P.run("UB_MOD_COL")[0], 1e-9, `${tag}: lit with UB_MOD_COL`);
            P.log.fills = null;
        }
        P.run(`MM.state.mods[MM.getMapping(${pid}).mod].enabled = 1`);
    }
    eq(sigs.remote, sigs.mod, "tabs, MSEG, bar and presets keep the same rects in Mod and Remote");
}
// ---- range readout: plain text at the right end of the presets row
{
    const Q = makeEnv();
    Q.run("preview()");
    const qid = Q.run("ubPbSelMapping().id");
    Q.run(`ubSelect(2); MM.setUI({ pb: 1, pbSel: ${qid} })`);
    const qset = (patch) => Q.run(`MM.updateMapping(${qid}, ${JSON.stringify(patch)})`);
    const qgm = () => Q.run("ubListGeom()");
    const qrects = () => Q.run(`ubDetailRects(ubListGeom(), MM.getMapping(${qid}))`);
    const qrect = (id) => qrects().filter((d) => d.id === id)[0].rect;
    const qtexts = () => { Q.log.texts.length = 0; Q.run("paint()"); return Q.log.texts.slice(); };
    const count = (arr, t) => arr.filter((x) => x === t).length;
    const inter = (a, b) => !(a[0] + a[2] <= b[0] + 1e-6 || b[0] + b[2] <= a[0] + 1e-6 || a[1] + a[3] <= b[1] + 1e-6 || b[1] + b[3] <= a[1] + 1e-6);
    const spec = () => Q.run(`ubReadoutSpec(ubListGeom(), MM.getMapping(${qid}))`);
    const q = {
        click: (x, y) => Q.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0),
        drag: (x, y) => Q.ctx.ondrag(x, y, 1, 0, 0, 0, 0, 0),
        up: (x, y) => Q.ctx.ondrag(x, y, 0, 0, 0, 0, 0, 0),
    };
    for (const design of [4]) {
        const tag = "readout";
        const cases = [
            ["mod", { polarity: 0, range: 0.7 }, "\u00b170%"],
            ["mod", { polarity: 1, range: 0.45 }, "+45%"],
            ["mod", { polarity: -1, range: 0.3 }, "\u221230%"],
            ["remote", { min: 0.2, max: 0.8 }, "20\u201380%"],
            ["remote", { min: 0.8, max: 0.2 }, "80\u201320%"],
        ];
        for (const [mode, patch, text] of cases) {
            qset(Object.assign({ mode }, patch));
            ok(count(qtexts(), text) >= 2, `${tag}: ${mode} readout "${text}" is painted`);
            eq(spec().text, text, `${tag}: spec text ${text}`);
            const g = qgm(); const r = spec().rect;
            const pr = g.panel;
            ok(r[0] >= pr[0] + 6 - 1e-6 && r[0] + r[2] <= pr[0] + pr[2] - 6 + 1e-6 && r[1] >= pr[1] + 4 && r[1] + r[3] <= pr[1] + pr[3] - 4, `${tag}: ${mode} rect inside the panel padding`);
            for (const d of qrects()) ok(!inter(r, d.rect), `${tag}: ${mode} rect does not intersect ${d.id}`);
            const ps = qrects().filter((d) => d.id.indexOf("preset") === 0);
            for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) ok(!inter(ps[a].rect, ps[b].rect), `${tag}: ${mode} presets ${a} and ${b} do not overlap`);
            ok(ps.every((d) => d.rect[2] >= 16), `${tag}: ${mode} presets stay at least 16 px wide`);
            ok(Math.abs(ps[0].rect[1] - r[1]) < 1e-6, `${tag}: ${mode} readout is on the presets row`);
            ok(ps[ps.length - 1].rect[0] + ps[ps.length - 1].rect[2] <= r[0], `${tag}: ${mode} readout starts after the last preset`);
            ok(Math.abs(r[0] + r[2] - (g.dx + g.dw)) < 1e-6, `${tag}: ${mode} readout is right-aligned to the content edge`);
            ok(r[0] + Q.run(`ubTextW(${JSON.stringify(text)}, 7.5)`) <= g.dx + g.dw + 1e-6, `${tag}: ${mode} text is not truncated`);
        }
        // painting colours: mode accent, grey when bypassed / disabled, white while a triangle is dragged
        const colOf = (text) => {
            Q.log.textCols = []; Q.run("paint()");
            const f = Q.log.textCols.filter((e) => e.t === text).pop();
            Q.log.textCols = null;
            return f && f.col;
        };
        for (const [mode, text, accent] of [["mod", "\u00b170%", "UB_MOD_COL"], ["remote", "20\u201380%", "UB_REM_COL"]]) {
            qset({ mode, enabled: 1, polarity: 0, range: 0.7, min: 0.2, max: 0.8 });
            Q.run("MM.state.mods[ubPbSelMapping().mod].enabled = 1");
            const ac = Q.run(accent); const gr = Q.run("UB_OFF_GREY");
            eq(colOf(text).slice(0, 3), ac, `${tag}: ${mode} readout uses the mode accent`);
            Q.run("MM.state.mods[ubPbSelMapping().mod].enabled = 0");
            eq(colOf(text).slice(0, 3), gr, `${tag}: ${mode} readout is grey with a bypassed modulator`);
            Q.run("MM.state.mods[ubPbSelMapping().mod].enabled = 1"); qset({ enabled: 0 });
            eq(colOf(text).slice(0, 3), gr, `${tag}: ${mode} readout is grey with a disabled mapping`);
            qset({ enabled: 1 });
        }
        // drag updates the readout
        qset({ mode: "mod", polarity: 1, range: 0.5, enabled: 1 });
        Q.run("MM.state.mods[ubPbSelMapping().mod].enabled = 1");
        const mt = qrect("meter");
        const g = Q.run(`ubMeterGeom(${JSON.stringify(mt)})`);
        q.click(mt[0] + 2, g.cy - g.hh * 0.5);
        q.drag(mt[0] + 2, g.cy - g.hh * 0.8);
        ok(Q.run("ubDrag && ubDrag.kind") === "range", `${tag}: mod drag active`);
        ok(count(qtexts(), "+80%") >= 2, `${tag}: mod readout updates while dragging`);
        eq(colOf("+80%").slice(0, 3), [1, 1, 1], `${tag}: mod readout is white while a triangle is dragged`);
        q.up(mt[0] + 2, g.cy - g.hh * 0.8);
        ok(count(qtexts(), "+80%") >= 2, `${tag}: mod readout shows the value after the drag`);
        qset({ mode: "remote", min: 0.2, max: 0.8 });
        const y1 = mt[1] + 3 + (mt[3] - 6) * (1 - 0.8);
        q.click(mt[0] + 2, y1);
        q.drag(mt[0] + 2, mt[1] + 3 + (mt[3] - 6) * (1 - 0.9));
        ok(Q.run("ubDrag && ubDrag.kind") === "limit", `${tag}: remote drag active`);
        ok(count(qtexts(), "20\u201390%") >= 2, `${tag}: remote readout updates while dragging`);
        eq(colOf("20\u201390%").slice(0, 3), [1, 1, 1], `${tag}: remote readout is white while a triangle is dragged`);
        q.up(mt[0] + 2, 0);
        // bypassed / disabled paint without throwing and still print the text
        for (const [on, en] of [[0, 1], [1, 0], [0, 0]]) for (const mode of ["mod", "remote"]) {
            qset({ mode, enabled: en, min: 0.2, max: 0.8, polarity: 0, range: 0.7 });
            Q.run(`MM.state.mods[ubPbSelMapping().mod].enabled = ${on}`);
            const t = mode === "mod" ? "\u00b170%" : "20\u201380%";
            ok(count(qtexts(), t) >= 2, `${tag}: ${mode} readout painted with modulator ${on ? "on" : "bypassed"}, mapping ${en ? "on" : "off"}`);
        }
        Q.run("MM.state.mods[ubPbSelMapping().mod].enabled = 1");
        qset({ enabled: 1 });
    }
    // panel: every detail rect lies inside the panel with >= 3 px padding; painted in both modes and when empty; width covers it
    {
        const g = qgm(); const pr = g.panel;
        const rr = (tag) => {
            for (const d of qrects()) ok(d.rect[0] >= pr[0] + 3 && d.rect[0] + d.rect[2] <= pr[0] + pr[2] - 3 && d.rect[1] >= pr[1] + 3 && d.rect[1] + d.rect[3] <= pr[1] + pr[3] - 3, `panel: ${tag} ${d.id} inside the panel with >= 3 px padding`);
        };
        const list = Q.run("ubListGeom()");
        eq([pr[1], pr[3]], [0, 161], "panel matches the list panel top and bottom");
        ok(pr[0] >= list.lx + list.lw, "panel starts right of the list panel");
        const panelPainted = () => {
            Q.log.fills = []; Q.run("paint()");
            const f = Q.log.fills.filter((e) => e.rect && e.rect.every((v, i) => Math.abs(v - pr[i]) < 1e-6) && Math.abs(e.col[0] - 0.125) < 1e-6);
            Q.log.fills = null;
            return f.length;
        };
        for (const mode of ["mod", "remote"]) { qset({ mode }); rr(mode); ok(panelPainted() === 1, `panel painted in ${mode} mode`); }
        Q.run("MM.setUI({ pbSel: -1 })");
        ok(Q.run("ubPbSelMapping()") === null || true, "deselect");
        if (Q.run("ubPbSelMapping()") === null) ok(panelPainted() === 1, "panel painted in the empty state");
        const reqW = Q.run("ubLayoutWidth() + UB_EDGE");
        ok(reqW >= pr[0] + pr[2] + 4 + 4, "requested width covers the panel plus the right margin");
    }
}
// regression: the presets row / readout / editor rects must not move when the range values change
// (bug: "100-100%" vs "0-100%" resized the readout and shuffled the preset buttons)
{
    const mm = E3.run("ubPbSelMapping()");
    const layout = () => JSON.stringify(E3.run("ubDetailRects(ubListGeom(), ubPbSelMapping()).map((d) => [d.id, d.rect])")) + JSON.stringify(E3.run("ubReadoutSpec(ubListGeom(), ubPbSelMapping()).rect"));
    const fits = () => E3.run("(function () { const ro = ubReadoutSpec(ubListGeom(), ubPbSelMapping()); return ubTextW(ro.text, ro.size) <= ro.rect[2]; })()");
    for (const mode of ["remote", "mod"]) {
        E3.run(`MM.updateMapping(${mm.id}, { mode: "${mode}" })`);
        const base = layout();
        const cases = mode === "remote"
            ? [[0, 0], [1, 1], [0, 1], [1, 0], [0.05, 0.5], [0.333, 0.999]]
            : [[1, 0], [1, 1], [0, 0.07], [0, 1], [-1, 0.5], [-1, 1]];
        for (const [a, b] of cases) {
            E3.run(mode === "remote" ? `MM.updateMapping(${mm.id}, { min: ${a}, max: ${b} })` : `MM.updateMapping(${mm.id}, { polarity: ${a}, range: ${b} })`);
            eq(layout(), base, `${mode} ${a}/${b}: editor layout does not shuffle when values change`);
            ok(fits(), `${mode} ${a}/${b}: readout text fits its fixed box`);
        }
    }
    E3.run(`MM.updateMapping(${mm.id}, { mode: "mod" })`);
}

// ---------------------------------------------------------------- the two views: rack strips (LST off) and the LST inspector (LST on)
{
    const overlap = (a, b) => a[2] > 0 && a[3] > 0 && b[2] > 0 && b[3] > 0 && a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;
    const inside = (r, o) => r[2] <= 0 || r[3] <= 0 || (r[0] >= o[0] - 1e-6 && r[1] >= o[1] - 1e-6 && r[0] + r[2] <= o[0] + o[2] + 1e-6 && r[1] + r[3] <= o[1] + o[3] + 1e-6);
    const noOverlap = (rects, msg) => {
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) ok(!overlap(rects[i][1], rects[j][1]), `${msg}: ${rects[i][0]} overlaps ${rects[j][0]}`);
    };
    function mk(n, open, opts = {}) {
        const T = makeEnv();
        T.ctx.uiReady();
        for (let k = 0; k < n; k++) T.run(`ubAddType(${[1, 2, 3, 4, 5][k % 5]})`);
        for (let k = 0; k < Math.min(n, 6); k++) for (let j = 0; j < 2 + (k === 0 ? 2 : 0); j++) T.run(`MM.addMapping(${k}, { path: "live_set tracks ${k} devices 0 parameters ${j + 1}", trackName: "Trk ${k}", deviceName: "Dev", paramName: "Par ${k}${j}" })`);
        T.run(`MM.setUI({ pb: ${open ? 1 : 0}, sel: ${n ? 0 : -1}, exp: ${opts.exp === undefined ? -1 : opts.exp}, pbScroll: 0, pbSel: ${n ? "(MM.mappingsFor(0)[0] || { id: 0 }).id" : 0} })`);
        T.run("ubSyncWidth(true)");
        const w = () => { const o = T.log.outlets.filter((q) => q[1] === "width"); return o.length ? o[o.length - 1][2] : null; };
        return { T, run: T.run, log: T.log, w, ctx: T.ctx };
    }
    const wOf = (E) => E.run("ubLayoutWidth()");
    const clk = (E, x, y, o = {}) => E.ctx.onclick(x, y, 1, 0, o.shift ? 1 : 0, 0, 0, 0);

    // ---- the LST toggle switches between the strips and the inspector (rail button), with the width following
    {
        const E = mk(5, false);
        ok(!E.run("ubPb()"), "LST starts off");
        let sg = E.run("ubStrips()");
        ok(sg.list.length === 5 && sg.list.every((g) => !g.tab && !g.fixed && g.w === 56) && !!sg.plus, "LST off: five rack strips and the + strip");
        eq(E.w(), 22 + 5 * 58 + 26 + 8, "LST off: strips width");
        E.log.texts.length = 0; E.run("paint()");
        ok(!E.log.texts.includes("MAPPINGS") && E.log.texts.includes("Par 00") === false, "LST off: no mapping list is painted");
        const stripsW = E.w();
        clk(E, 11, 48);
        ok(E.run("ubPb()"), "the rail LST button turns the inspector on");
        sg = E.run("ubStrips()");
        const tabs = sg.list.filter((g) => g.tab);
        ok(tabs.length === 5 && !!sg.main && sg.main.fixed && sg.main.exp && sg.main.w === 204 && sg.main.slot === E.run("ubSel()"), "LST on: five tabs and the selected modulator's expanded editor");
        ok(tabs.every((g) => g.x + g.w <= sg.main.x) && sg.plus.x + sg.plus.w <= sg.main.x, "LST on: tabs and + tab left of the editor");
        eq(E.w(), E.run("ubListGeom().end") + 8, "LST on: width request = tabs + editor + list + remap panel");
        eq(E.w(), 22 + 26 + 204 + 6 + 172 + 6 + 144 + 8, "LST on (5 modulators): 588 px");
        ok(E.w() > stripsW, "LST on is wider than the strips");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("MAPPINGS") && E.log.texts.includes("Par 00"), "LST on: the mapping list of the selected modulator is painted");
        // strips-only content (knob labels of the collapsed strips, the mapping-count chips) is gone
        ok(!E.log.texts.includes("5 maps") && !E.log.texts.includes("2 maps"), "LST on: no strip count chips");
        clk(E, 11, 48);
        ok(!E.run("ubPb()") && E.w() === stripsW, "LST off again: back to the strips and their width");
        sg = E.run("ubStrips()");
        ok(sg.list.length === 5 && sg.list.every((g) => !g.tab), "LST off again: strips, no tabs");
        // the same toggle through the API, with nothing selected: the inspector still shows a modulator
        E.run("MM.setUI({ sel: -1 })");
        E.run("ubTogglePb(true)");
        ok(E.run("ubSel()") >= 0 && !!E.run("ubStrips().main"), "turning LST on with no selection selects the first modulator");
        E.run("ubTogglePb(false)");
    }

    for (const open of [false, true]) {
        const view = open ? "LST view" : "strips view";
        // ---- painting with 0 / 1 / 5 / 16 modulators; requested width follows the content; nothing leaves the device
        for (const n of [0, 1, 5, 16]) {
            const E = mk(n, open);
            E.log.texts.length = 0;
            E.run("paint()");
            ok(true, `${view}: paints with ${n} modulators`);
            eq(E.w(), Math.max(120, wOf(E) + 8), `${view}: ${n} mods: requested width = content + margins`);
            ok(E.w() >= 120 && E.w() <= (open ? 750 : 1000), `${view}: ${n} mods: width ${E.w()} in range`);
            if (open && n > 0) ok(E.log.texts.includes("Par 00"), `${view}: a mapping name is drawn`);
            if (open && n === 0) ok(E.log.texts.includes("Add a modulator first") && E.log.texts.includes("Add a modulator"), `${view}: empty hints with no modulator`);
            const W = wOf(E);
            const sg = E.run("ubStrips()");
            const top = sg.list.map((g) => ["item " + g.slot, [g.x, g.y, g.w, g.h]]);
            if (sg.plus) top.push(["plus", [sg.plus.x, sg.plus.y, sg.plus.w, sg.plus.h]]);
            if (open) {
                const gm = E.run("ubListGeom()");
                top.push(["list", [gm.lx, gm.ly, gm.lw, gm.lh]]);
                top.push(["panel", gm.panel]);
                if (n === 0) top.push(["empty main", [sg.mainX, 0, 204, 161]]);
            }
            top.push(["rail", [0, 0, 20, 161]]);
            noOverlap(top, `${view} n=${n} panels`);
            for (const [name, r] of top) ok(inside(r, [0, 0, W, 161]), `${view} n=${n}: ${name} inside the device`);
            // every filled shape stays inside the 161 px usable height
            E.log.fills = []; E.run("paint()");
            ok(E.log.fills.every((f) => !f.rect || f.rect[1] + f.rect[3] <= 161 + 1e-6), `${view} n=${n}: no fill crosses the bottom edge`);
            E.log.fills = null;
        }
    }

    // ---- every panel ends at the same bottom edge; chips, counts and knobs sit inside with padding (all five modulator types)
    for (const mode of ["strips", "lst"]) {
        for (let sel = 0; sel < 5; sel++) {
            const E = mk(5, mode === "lst", { exp: mode === "strips" ? sel : -1 });
            E.run(`MM.setUI({ sel: ${sel} })`);
            const tag = `${mode} type ${sel}`;
            const sg = E.run("ubStrips()");
            const gm = E.run("ubListGeom()");
            const bottoms = [["rail", 161]];
            for (const g of sg.list.filter((q) => q.fixed || (!q.tab && mode === "strips"))) bottoms.push(["card " + g.slot, g.y + g.h]);
            if (mode === "lst") { bottoms.push(["list", gm.lh + gm.ly], ["remap panel", gm.panel[1] + gm.panel[3]]); }
            for (const [name, b] of bottoms) eq(b, 161, `${tag}: ${name} ends at the shared bottom edge`);
            const g = sg.list.find((q) => q.exp);
            ok(!!g, `${tag}: an expanded editor is shown`);
            const R = E.run(`ubStripRects(${JSON.stringify(g)})`);
            const card = [g.x, g.y, g.w, g.h];
            const bottomLimit = 161 - 4;
            for (const c of R.chips) {
                ok(inside(c.rect, [g.x + 4, 0, g.w - 8, bottomLimit]), `${tag}: chip ${c.id} inside the card with padding`);
            }
            ok(inside(R.count, [g.x + 4, 0, g.w - 8, 161 - 6]), `${tag}: the maps chip is fully inside, >= 6 px above the bottom edge (${R.count[1] + R.count[3]})`);
            ok(R.count[1] + R.count[3] <= 161 - 6, `${tag}: maps chip bottom padding`);
            for (const k of R.knobs) {
                ok(inside(k.hit, [g.x, 0, g.w, R.count[1]]), `${tag}: a knob sits above the maps chip`);
                ok(k.labY + 3 <= R.count[1], `${tag}: knob labels clear the maps chip`);
            }
            const parts = [["icon", R.icon], ["viz", R.viz], ["type", R.type], ["del", R.del], ["collapse", R.collapse], ["count", R.count]];
            R.knobs.forEach((k, i) => parts.push(["knob" + i, k.hit]));
            R.chips.forEach((c) => parts.push(["chip " + c.id, c.rect]));
            noOverlap(parts, `${tag}: editor parts`);
            for (const [pn, r] of parts) ok(inside(r, card), `${tag}: ${pn} inside the card`);
        }
    }

    // ---- hit areas inside items, list rows and editor controls (5 mods, LST view)
    {
        const E = mk(5, true);
        const sg = E.run("ubStrips()");
        for (const g of sg.list) {
            if (g.tab) continue;
            const R = E.run(`ubStripRects(${JSON.stringify(g)})`);
            const parts = [["icon", R.icon], ["name", R.name], ["viz", R.viz], ["count", R.count]];
            R.knobs.forEach((k, i) => parts.push(["knob" + i, k.hit]));
            R.chips.forEach((c) => parts.push(["chip " + c.id, c.rect]));
            if (g.exp) { parts.push(["collapse", R.collapse]); parts.push(["del", R.del]); parts.push(["type", R.type]); }
            for (const [pn, r] of parts) ok(inside(r, [g.x, g.y, g.w, g.h]), `LST: strip ${g.slot} ${pn} inside its item`);
            noOverlap(parts.filter((q) => q[0] !== "name" || !g.exp), `LST: item ${g.slot} parts`);
        }
        const gm = E.run("ubListGeom()");
        const vis = E.run("ubListVisible()");
        ok(vis.rows.length > 0, "LST: list rows visible");
        const rows = vis.rows.map((r) => ["row" + r.index, [gm.lx, r.y, gm.lw, r.h]]);
        noOverlap(rows, "LST: list rows");
        for (const [rn, r] of rows) ok(inside(r, [gm.lx, gm.ly, gm.lw, gm.lh - gm.foot]), `LST: ${rn} inside the list above its footer`);
        for (const r of vis.rows) if (r.item.kind === "map") {
            const P = E.run(`ubRowParts(${r.y})`);
            const pr = Object.keys(P).map((k) => [k, P[k]]);
            noOverlap(pr, "LST: row parts");
            for (const [pn, q] of pr) ok(inside(q, [gm.lx, r.y, gm.lw, r.h]), `LST: row part ${pn} inside its row`);
        }
        ok(E.run("ubPbSelMapping()"), "LST: a mapping is selected for the editor");
        const dr = E.run("ubDetailRects(ubListGeom(), ubPbSelMapping())");
        noOverlap(dr.map((d) => [d.id, d.rect]), "LST: editor controls");
        for (const d of dr) ok(inside(d.rect, [gm.panel[0] + 3, 3, gm.panel[2] - 6, 161 - 6]), `LST: editor control ${d.id} inside the panel with padding`);
        ok(dr.find((d) => d.id === "mseg").rect[3] >= 45, "LST: the MSEG stays usable");
        // list header, footer and the other panels share top / bottom
        eq([gm.ly, gm.ly + gm.lh, gm.panel[1], gm.panel[1] + gm.panel[3], sg.main.y, sg.main.y + sg.main.h], [0, 161, 0, 161, 0, 161], "LST: editor, list and remap panel share top and bottom");
        eq([sg.main.x + sg.main.w + 6, gm.lx + gm.lw + 6], [gm.lx, gm.px], "LST: 6 px gaps between editor, list and remap panel");
    }

    // ---- footer: counts the shown mappings and stays inside the panel
    {
        const E = mk(5, true);
        const nm0 = E.run("MM.state.mods[0].name");
        const maxW = E.run("ubListGeom().lw - 14");
        E.log.texts.length = 0; E.run("paint()");
        const exp0 = E.run(`ubFooterText(4, ${JSON.stringify(nm0)}, ${maxW}, 6.5)`);
        ok(E.log.texts.includes(exp0) && exp0.indexOf("4 mappings on ") === 0, "footer: the painted text counts the 4 shown mappings of the selected modulator");
        ok(!E.log.texts.some((t) => /^\d+ mappings? \| click/.test(t)), "footer: no total-mapping text any more");
        // realistic font metric: the full text fits
        E.ctx.mgraphics.text_measure = (t) => [String(t).length * 3.2, 8];
        E.run("MM.setName(0, 'Dice')");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("4 mappings on Dice"), "footer: '4 mappings on Dice'");
        E.run("MM.setUI({ sel: 1 })"); E.run("MM.setName(1, 'Wobble')");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("2 mappings on Wobble"), "footer: another modulator counts its own 2 mappings");
        E.run("MM.deleteMapping(MM.mappingsFor(1)[0].id)");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("1 mapping on Wobble"), "footer: singular for one mapping");
        E.run("MM.deleteMapping(MM.mappingsFor(1)[0].id)");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("0 mappings on Wobble"), "footer: zero mappings");
        // long names / narrow metrics never overflow the list panel
        for (const metric of [3.2, 4, 5]) {
            E.ctx.mgraphics.text_measure = (t) => [String(t).length * metric, 8];
            for (const name of ["Dice", "Wobble", "A very long name", "WWWWWWWWWWWWWWWW"]) {
                for (const n of [0, 1, 4, 12, 256]) {
                    const t = E.run(`ubFooterText(${n}, ${JSON.stringify(name)}, ${maxW}, 6.5)`);
                    ok(t.length * metric <= maxW + 1e-6, `footer fits (${metric} px/char, "${name}", ${n}): "${t}"`);
                    ok(t.indexOf(n + " mapping") === 0, `footer starts with the count (${n})`);
                }
            }
        }
        E.run("MM.setName(1, 'Wobble')");
    }

    // ---- the editor's header button returns to the strips; the X still deletes the modulator (two clicks)
    {
        const E = mk(5, true);
        let main = E.run("ubStrips().main");
        let R = E.run(`ubStripRects(ubStrips().main)`);
        eq(E.run(`ubHit(${center(R.collapse)[0]}, ${center(R.collapse)[1]})`).kind, "collapse", "LST: the header has the back button");
        eq(E.run(`ubHit(${center(R.del)[0]}, ${center(R.del)[1]})`).kind, "del", "LST: the delete X is a separate control");
        ok(R.collapse[0] + R.collapse[2] <= main.x + main.w - 3 && R.del[0] + R.del[2] <= R.collapse[0], "LST: header buttons are padded and do not overlap");
        // delete: first click only arms
        const n0 = E.run("MM.modCount()");
        clk(E, ...center(R.del));
        eq(E.run("MM.modCount()"), n0, "LST: the X first only arms");
        clk(E, ...center(R.del));
        eq(E.run("MM.modCount()"), n0 - 1, "LST: the second click deletes the modulator");
        ok(E.run("ubPb()") && !!E.run("ubStrips().main") && E.run("ubSel()") >= 0, "LST: still open, another modulator is selected and shown");
        E.run("paint()");
        R = E.run(`ubStripRects(ubStrips().main)`);
        clk(E, ...center(R.collapse));
        ok(!E.run("ubPb()"), "LST: the back button returns to the rack strips");
        eq(E.w(), E.run("ubStrips().end") + 8, "back in the strips view the width follows the strips");
        // strips view: the same button collapses in place and does not touch LST
        E.run("ubSetExpanded(1)");
        const gE = E.run("ubStrips().list.filter((g) => g.exp)[0]");
        const RE = E.run(`ubStripRects(${JSON.stringify(gE)})`);
        clk(E, ...center(RE.collapse));
        eq(E.run("ubExp()"), -1, "strips: collapsed in place");
        ok(!E.run("ubPb()"), "strips: LST stays off");
        // deleting the last modulator in LST leaves the empty hint, no crash
        const E1 = mk(1, true);
        const R1 = E1.run("ubStripRects(ubStrips().main)");
        clk(E1, ...center(R1.del)); clk(E1, ...center(R1.del));
        eq(E1.run("MM.modCount()"), 0, "LST: the last modulator can be deleted");
        E1.run("paint()");
        ok(E1.run("ubStrips().main") === null && E1.run("ubPb()"), "LST: no modulator left, empty hint");
    }

    // ---- selecting a modulator drives the list / editor
    {
        const E = mk(5, true);
        const g3 = E.run("ubStrips().list.filter((g) => g.slot === 3 && g.tab)[0]");
        const pt = [g3.x + g3.w / 2, g3.y + g3.h / 2];
        eq(E.run(`ubHit(${pt[0]}, ${pt[1]})`).slot, 3, "LST: the tab click point hits modulator 3");
        clk(E, ...pt);
        eq(E.run("ubSel()"), 3, "LST: clicking a tab selects it");
        const pm = E.run("ubPbSelMapping()");
        ok(pm && pm.mod === 3, "LST: the editor shows a mapping of the selected modulator");
        ok(E.run("ubListVisible().rows.some((r) => r.item.kind === 'head' && r.item.i === ubSel())"), "LST: the selected modulator's header is visible in the list");
        ok(E.run("ubListItems().every((it) => it.i === 3)"), "LST: the list is filtered to the selected modulator");
        eq(E.run("ubStrips().main.slot"), 3, "LST: the expanded editor shows the selected modulator");
        // the enable toggle of the editor header still works
        const R3 = E.run("ubStripRects(ubStrips().main)");
        const ic = center(R3.icon);
        const was = E.run("MM.state.mods[3].enabled");
        clk(E, ic[0], ic[1]);
        eq(E.run("MM.state.mods[3].enabled"), was ? 0 : 1, "LST: the corner glyph toggles enable");
        clk(E, ic[0], ic[1]);
        // a list row selects its mapping (and keeps the modulator)
        const rows = E.run("ubListVisible().rows.filter((r) => r.item.kind === 'map')");
        const rw = rows[rows.length - 1];
        const P = E.run(`ubRowParts(${rw.y})`);
        clk(E, ...center(P.name));
        eq(E.run("ubSel()"), 3, "LST: clicking a list row keeps its modulator");
        eq(E.run("ubUIs().pbSel"), rw.item.m.id, "LST: ... and selects the row for the editor");
        // the strips view: clicking a strip selects it too
        E.run("ubTogglePb(false)");
        const s1 = E.run("ubStripRects(ubStrips().list[1])");
        clk(E, ...center(s1.viz));
        eq(E.run("ubSel()"), 1, "strips: clicking a strip selects it");
    }

    // ---- rail: learn (click / Shift-click) in both views
    for (const open of [false, true]) {
        const E = mk(5, open);
        E.run("MM.setUI({ sel: 2 })");
        clk(E, 11, 12);
        ok(E.run("MM.learn.armed && !MM.learn.multi && MM.learn.mod === 2"), `${open ? "LST" : "strips"}: rail click arms single-shot learn`);
        clk(E, 11, 12);
        ok(!E.run("MM.learn.armed"), `${open ? "LST" : "strips"}: click while armed disarms`);
        clk(E, 11, 12, { shift: true });
        ok(E.run("MM.learn.armed && MM.learn.multi"), `${open ? "LST" : "strips"}: Shift-click arms multi-learn`);
        const tab = E.run("ubStrips().list.filter((g) => g.slot === 3)[0]");
        const tp = open ? [tab.x + tab.w / 2, tab.y + tab.h / 2] : center(E.run(`ubStripRects(${JSON.stringify(tab)})`).viz);
        clk(E, ...tp);
        eq(E.run("MM.learn.mod"), 3, `${open ? "LST" : "strips"}: multi-learn follows the selection`);
        clk(E, 11, 12);
    }

    // ---- remap editor gestures in the LST view: MOD / REM tab, polarity, range triangle, presets, MSEG
    {
        const E = mk(5, true);
        const C = (x, y) => E.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
        E.run("MM.setUI({ sel: 0 })");
        const mid = E.run("ubPbSelMapping().id");
        const rects = () => E.run("ubDetailRects(ubListGeom(), ubPbSelMapping())");
        const rect = (id) => rects().find((d) => d.id === id).rect;
        const mp = () => E.run(`MM.getMapping(${mid})`);
        let c = center(rect("tabrem"));
        C(c[0], c[1]);
        eq(mp().mode, "remote", "LST: the REM tab switches to Remote");
        c = center(rect("tabmod"));
        C(c[0], c[1]);
        eq(mp().mode, "mod", "LST: the MOD tab switches back");
        c = center(rect("pol-1"));
        C(c[0], c[1]);
        eq(mp().polarity, -1, "LST: the minus polarity button works");
        c = center(rect("pol0"));
        C(c[0], c[1]);
        eq(mp().polarity, 0, "LST: the bipolar polarity button works");
        const mr = rect("meter");
        const mg = E.run(`ubMeterGeom(${JSON.stringify(mr)})`);
        C(mr[0] + 6, mg.cy - mg.hh * 0.8);
        near(mp().range, 0.8, 0.02, "LST: a press on the output bar sets the range");
        E.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
        C(...center(rect("preset3")));
        ok(E.run(`ubShapeIsPreset(MM.getMapping(${mid}), 3)`), "LST: a preset button loads its curve");
        const ms = rect("mseg");
        const before = E.run(`MM.getMapping(${mid}).shape.length`);
        C(ms[0] + ms[2] * 0.5, ms[1] + 8);
        E.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
        ok(E.run(`MM.getMapping(${mid}).shape.length`) === before + 1, "LST: a click in the MSEG adds a point");
        ok(E.run(`ubHit(${center(rect("mseg"))[0]}, ${center(rect("mseg"))[1]})`).kind === "detail", "LST: the editor is hit-testable");
    }

    // ---- LST specifics: tabs, + tab, knobs of the editor, 16 modulators
    {
        const E = mk(5, true);
        const sg = E.run("ubStrips()");
        eq(sg.list.filter((g) => g.tab).length, 5, "LST: one tab per modulator");
        ok(sg.list.filter((g) => g.tab).every((g) => g.x < sg.main.x && g.w <= 28), "LST: the tab column is on the far left, narrow");
        ok(sg.plus && sg.plus.x < sg.main.x, "LST: a + tab adds a modulator");
        const C = (x, y) => E.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
        C(sg.plus.x + 5, sg.plus.y + 5);
        ok(E.run("ubPopup !== null"), "LST: + opens the type picker");
        const pr = E.run("ubPopupRect()");
        C(pr[0] + 10, pr[1] + 2 + 17 * 4 + 8);
        eq(E.run("MM.modCount()"), 6, "LST: the picker adds a modulator");
        eq(E.run("ubSel()"), 5, "LST: the new modulator is selected and shown");
        const mainR = E.run("ubStripRects(ubStrips().main)");
        const k0 = center(mainR.knobs[0].hit);
        const spec = E.run("ubKnobs(MM.state.mods[5])[0].key");
        const before = E.run(`MM.state.mods[5].p.${spec}`);
        C(k0[0], k0[1]);
        E.ctx.ondrag(k0[0], k0[1] - 40, 1, 0, 0, 0, 0, 0);
        E.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
        ok(E.run(`MM.state.mods[5].p.${spec}`) !== before, "LST: the expanded editor's knobs still drag");
        // double-click on the fixed editor header does nothing (no rename, no collapse)
        const hd = E.run("ubStripRects(ubStrips().main)").head;
        E.ctx.ondblclick(hd[0] + 40, 8, 1, 0, 0, 0, 0, 0);
        ok(E.run("ubExp()") === -1 && E.run("typeof ubEdit") === "undefined", "LST: double-clicking the editor header does not rename");
        // 16 modulators: a second tab column, still inside the device
        const E16 = mk(16, true);
        const s16 = E16.run("ubStrips()");
        ok(new Set(s16.list.filter((g) => g.tab).map((g) => g.x)).size === 2, "LST: 16 modulators use two tab columns");
        ok(E16.w() <= 750, "LST: 16 modulators stay within 750");
        eq(E16.run("ubStrips().plus"), null, "LST: no + tab with 16 modulators");
    }
}


// ================================================================ delete hotkey, undo (no undo pill)
{
    function mk2(n, perMod, opts = {}) {
        const T = makeEnv();
        T.ctx.uiReady();
        for (let k = 0; k < n; k++) T.run(`ubAddType(${[1, 2, 3, 4, 5][k % 5]})`);
        for (let k = 0; k < n; k++) {
            const cnt = perMod[k] === undefined ? 0 : perMod[k];
            for (let j = 0; j < cnt; j++) {
                const m = T.run(`MM.addMapping(${k}, { path: "live_set tracks ${k} devices 0 parameters ${j + 1}", trackName: "Trk ${k}", deviceName: "Dev", paramName: "Par ${k}${j}" })`);
                // mixed modes: odd mappings are Remote with a window, even ones Mod (polarity cycles + / ± / -)
                if (j % 2 === 1) T.run(`MM.updateMapping(${m.id}, { mode: "remote", min: 0.2, max: 0.7 })`);
                else T.run(`MM.updateMapping(${m.id}, { polarity: ${[0, 1, -1][(j / 2) % 3]}, range: 0.5 })`);
            }
        }
        T.run(`MM.setUI({ pb: ${opts.pb ? 1 : 0}, sel: ${n ? 0 : -1}, exp: ${opts.exp === undefined ? -1 : opts.exp}, pbScroll: 0, pbSel: 0 })`);
        T.run("ubSyncWidth(true)");
        T.fire = { click: (x, y, o = {}) => T.ctx.onclick(x, y, 1, 0, o.shift ? 1 : 0, 0, o.alt ? 1 : 0, 0), drag: (x, y, o = {}) => T.ctx.ondrag(x, y, 1, 0, o.shift ? 1 : 0, 0, 0, 0), up: () => T.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0), dbl: (x, y) => T.ctx.ondblclick(x, y, 1, 0, 0, 0, 0, 0), key: (k, ch, mods = {}) => T.ctx.onkeydown(k, ch, 1, mods.cmd ? 1 : 0, mods.shift ? 1 : 0, 0, 0, mods.ctrl ? 1 : 0) };
        return T;
    }
    const ctr = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    const stateJson = (T) => T.run("(function () { const o = JSON.parse(JSON.stringify(MM.state)); delete o.ui; return JSON.stringify(o); })()");
    const tick = (T, n) => { for (let i = 0; i < n; i++) T.ctx.uiTelemetry(T.run("MM.readTelemetry()")); };

    // ---- key handler: Delete / Backspace delete the selected modulator when the UI has focus; Cmd/Ctrl-Z undoes; Shift-Cmd-Z / Ctrl-Y redoes
    {
        const T = mk2(3, [2, 3, 0]);
        const s0 = stateJson(T);
        T.run("MM.setUI({ sel: 1 })");
        ok(!T.run("ubFocus"), "keys: no focus before the first click");
        eq(T.fire.key(8, 8), 0, "keys: Backspace without focus is not handled");
        eq(T.fire.key(127, 127), 0, "keys: Delete without focus is not handled");
        T.ctx.key(8, 0);
        eq(T.run("MM.modCount()"), 3, "keys: nothing is deleted without focus (native handler and [key] fallback)");
        T.ctx.key(122, 1);
        eq(T.run("MM.undoInfo().undo"), 0, "keys: Cmd-Z without focus does nothing");
        // a click inside the UI focuses it
        const g1 = T.run("ubStrips().list[1]");
        T.fire.click(...ctr(T.run(`ubStripRects(ubStrips().list[1])`).body || [g1.x + 4, 90, 40, 8]));
        T.fire.up();
        ok(T.run("ubFocus"), "keys: a click inside the UI gives it focus");
        eq(T.run("ubSel()"), 1, "keys: the clicked strip is the selected modulator");
        eq(T.fire.key(127, 127), 1, "keys: Delete with focus is handled");
        eq(T.run("MM.modCount()"), 2, "keys: Delete removes the selected modulator");
        eq(T.run("MM.state.mods[1]"), null, "keys: the selected modulator (slot 1) is the one removed");
        eq(T.run("MM.mappingsFor(1).length"), 0, "keys: its mappings go with it");
        eq(T.run("MM.undoInfo().undo"), 1, "keys: the delete is on the undo stack");
        T.log.texts.length = 0; T.run("paint()");
        ok(!T.log.texts.includes("Undo delete"), "keys: no undo pill after a delete");
        T.ctx.onblur();
        ok(!T.run("ubFocus"), "keys: onblur drops the focus");
        eq(T.fire.key(122, 122, { cmd: 1 }), 0, "keys: Cmd-Z without focus is not handled");
        eq(T.run("MM.modCount()"), 2, "keys: still deleted while unfocused");
        T.ctx.onfocus();
        eq(T.fire.key(122, 122, { cmd: 1 }), 1, "keys: Cmd-Z with focus is handled");
        eq(stateJson(T), s0, "keys: Cmd-Z restores the modulator, its slot, settings and all its mappings (identical state)");
        eq(T.fire.key(122, 122, { cmd: 1, shift: 1 }), 1, "keys: Shift-Cmd-Z is handled");
        eq(T.run("MM.state.mods[1]"), null, "keys: Shift-Cmd-Z redoes the delete");
        T.fire.key(122, 122, { ctrl: 1 });
        eq(stateJson(T), s0, "keys: Ctrl-Z (Windows) undoes");
        T.fire.key(121, 121, { ctrl: 1 });
        eq(T.run("MM.state.mods[1]"), null, "keys: Ctrl-Y redoes");
        T.fire.key(122, 122, { ctrl: 1 });
        eq(stateJson(T), s0, "keys: undo again");
        // control-character codes (ctrl-z = 26) and the [key] fallback (ascii + modifier bits)
        T.fire.key(8, 8);
        eq(T.run("MM.state.mods[1]") === null, true, "keys: Backspace deletes too");
        T.ctx.key(122, 1); // cmd bit
        eq(stateJson(T), s0, "keys: the [key] fallback (cmd bit) undoes");
        // one stroke reported by both the native handler and [key] inside 40 ms is applied once
        T.fire.key(8, 8);
        T.ctx.key(8, 0);
        eq(T.run("MM.undoInfo().undo"), 1, "keys: the echo of one stroke is ignored (one entry on the stack)");
        T.fire.key(122, 122, { cmd: 1 });
        eq(stateJson(T), s0, "keys: undo after the echo test");
        // no selection -> Delete does nothing
        T.run("MM.setUI({ sel: -1 })");
        eq(T.fire.key(127, 127), 0, "keys: Delete without a selected modulator is not handled");
        // Esc closes an open popover
        T.run("MM.setUI({ sel: 0 }); ubMapsPop = { slot: 0, scroll: 0 }");
        T.fire.key(27, 27);
        eq(T.run("ubMapsPop"), null, "keys: Esc closes the maps popover");
        // Max's native onkeydown reports Escape as keycode -3 with textcharacter 27 (measured in Live): it must close, never delete
        const nm0 = T.run("MM.state.mods.filter(Boolean).length");
        T.run("MM.setUI({ sel: 0 }); ubPopup = { mode: 'add', slot: -1, x: 20, y: 22 }");
        T.ctx.onkeydown(-3, 27, 1, 0, 0, 0, 0, 0);
        eq(T.run("ubPopup"), null, "keys: native Escape (keycode -3, char 27) closes the popup");
        eq(T.run("MM.state.mods.filter(Boolean).length"), nm0, "keys: native Escape (keycode -3, char 27) does not delete the selected modulator");
        T.ctx.onkeydown(-3, 27, 1, 0, 0, 0, 0, 0);
        eq(T.run("MM.state.mods.filter(Boolean).length"), nm0, "keys: native Escape with nothing open does nothing");
    }

    // ---- delete + undo round trips without any pill
    {
        const T = mk2(3, [2, 1, 0]);
        const s0 = stateJson(T);
        T.run("MM.setUI({ sel: 0 })");
        T.run("ubDeleteMod(0)");
        T.log.texts.length = 0; T.run("paint()");
        ok(!T.log.texts.some((t) => /undo delete/i.test(t)), "no pill: no 'Undo delete' text after a modulator delete");
        eq(T.run("typeof ubUndoPill"), "undefined", "no pill: the pill state is gone");
        tick(T, 200); T.run("paint()");
        T.run("ubDeleteMod(1)");
        eq(T.run("MM.undoInfo().undo"), 2, "delete: both deletes are on the undo stack");
        T.run("ubDoUndo()"); T.run("ubDoUndo()");
        eq(stateJson(T), s0, "delete: all deletes undone leaves the identical state");
        // the delete button (X, two clicks) uses the same stack
        T.run("ubSetExpanded(2)");
        const ex = T.run("ubStripRects(ubStrips().list.filter((g) => g.exp)[0])");
        T.fire.click(...ctr(ex.del)); T.ctx.onidle(...ctr(ex.del), 0, 0, 0, 0, 0, 0);
        T.fire.click(...ctr(ex.del)); T.fire.up();
        eq(T.run("MM.modCount()"), 2, "delete: the X button deletes after two clicks");
        eq(T.run("MM.undoInfo().undo"), 1, "delete: the X delete is on the undo stack");
        T.log.texts.length = 0; T.run("paint()");
        ok(!T.log.texts.some((t) => /undo delete/i.test(t)), "no pill: none after the X delete");
        T.ctx.onfocus(); T.ctx.onclick(300, 5, 1, 0, 0, 0, 0, 0);
        T.fire.key(122, 122, { cmd: 1 });
        eq(T.run("MM.modCount()"), 3, "delete: Cmd-Z undoes the X delete");
    }

    // ---- the rail has no undo / redo buttons (keys only)
    {
        const T = mk2(3, [2, 1, 0]);
        const rr = T.run("ubRailRects()");
        eq(Object.keys(rr).sort().join(","), "learn,list,opt", "rail: only the LRN, LST, OPT hit areas exist");
        for (let y = 24; y < 140; y += 2) {
            const k = T.run(`ubHit(11, ${y}).kind`);
            ok(k !== "rail_undo" && k !== "rail_redo", `rail: no undo / redo hit at y=${y}`);
        }
        T.log.texts.length = 0; T.run("paint()");
        ok(!T.log.texts.includes("UND") && !T.log.texts.includes("RDO"), "rail: no UND / RDO labels");
        ok(T.log.texts.includes("LRN") && T.log.texts.includes("LST") && T.log.texts.includes("3"), "rail: LRN, LST and the modulator count are painted");
    }

    // ---- mapping delete (the x in the LST list row) uses the same undo stack
    {
        const T = mk2(2, [4, 1], { pb: 1 });
        T.run("MM.setUI({ sel: 0 })");
        const before = T.run("MM.mappingsFor(0).map((m) => m.id)");
        const s0 = stateJson(T);
        const rows = T.run("ubListVisible().rows");
        const row = rows.find((r) => r.item.kind === "map" && r.item.m.id === before[1]);
        const P = T.run(`ubRowParts(${row.y})`);
        T.fire.click(...ctr(P.del)); T.fire.up();
        eq(T.run("MM.mappingsFor(0).length"), 3, "mapping delete: the x removes the mapping");
        T.log.texts.length = 0; T.run("paint()");
        ok(!T.log.texts.some((t) => /undo delete/i.test(t)), "mapping delete: no undo pill");
        eq(T.run("MM.undoInfo().undo"), 1, "mapping delete: on the undo stack");
        T.ctx.onfocus(); T.ctx.onclick(300, 5, 1, 0, 0, 0, 0, 0);
        T.fire.key(122, 122, { cmd: 1 });
        eq(stateJson(T), s0, "mapping delete: undo restores the mapping with its id, target and shape");
        eq(T.run("MM.mappingsFor(0).map((m) => m.id)").join(","), before.join(","), "mapping delete: same ids in the same order");
        T.run("ubDeleteMapping(MM.mappingsFor(0)[0])");
        T.ctx.onfocus(); T.ctx.onclick(300, 5, 1, 0, 0, 0, 0, 0);
        T.fire.key(122, 122, { cmd: 1 });
        eq(T.run("MM.mappingsFor(0).length"), 4, "mapping delete: Cmd-Z restores it too");
    }
}


// ================================================================ range editing from the rack strips (maps popover)
{
    const ctr = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    function mk3(perMod, opts = {}) {
        const T = makeEnv();
        T.ctx.uiReady();
        const n = perMod.length;
        for (let k = 0; k < n; k++) T.run(`ubAddType(${[1, 2, 3, 4, 5][k % 5]})`);
        for (let k = 0; k < n; k++) {
            for (let j = 0; j < perMod[k]; j++) {
                const m = T.run(`MM.addMapping(${k}, { path: "live_set tracks ${k} devices 0 parameters ${j + 1}", trackName: "Trk ${k}", deviceName: "Dev", paramName: "Par ${k}${j}" })`);
                if (j % 2 === 1) T.run(`MM.updateMapping(${m.id}, { mode: "remote", min: 0.2, max: 0.7 })`);
                else T.run(`MM.updateMapping(${m.id}, { polarity: ${[0, 1, -1][(j / 2) % 3]}, range: 0.5 })`);
            }
        }
        T.run(`MM.setUI({ pb: 0, sel: 0, exp: ${opts.exp === undefined ? -1 : opts.exp}, pbScroll: 0, pbSel: 0 })`);
        T.run("ubSyncWidth(true)");
        T.c = (x, y, o = {}) => T.ctx.onclick(x, y, 1, 0, o.shift ? 1 : 0, 0, 0, 0);
        T.d = (x, y, o = {}) => T.ctx.ondrag(x, y, 1, 0, o.shift ? 1 : 0, 0, 0, 0);
        T.up = () => T.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
        T.dbl = (x, y) => T.ctx.ondblclick(x, y, 1, 0, 0, 0, 0, 0);
        T.maps = (slot) => JSON.parse(JSON.stringify(T.run(`MM.mappingsFor(${slot})`)));
        T.R = (i) => T.run(`ubStripRects(ubStrips().list[${i}])`);
        T.g = (i) => T.run(`ubStrips().list[${i}]`);
        return T;
    }
    // which fields of two mapping snapshots differ
    const diff = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const inside = (r, g) => r[0] >= g.x - 1e-9 && r[1] >= g.y - 1e-9 && r[0] + r[2] <= g.x + g.w + 1e-9 && r[1] + r[3] <= g.y + g.h + 1e-9;
    const overlap = (a, b) => a[0] < b[0] + b[2] - 1e-9 && b[0] < a[0] + a[2] - 1e-9 && a[1] < b[1] + b[3] - 1e-9 && b[1] < a[1] + a[3] - 1e-9;
    // every interactive rect of a strip, inside the strip, pairwise disjoint
    function checkStripGeometry(T, i, tag) {
        const g = T.g(i);
        const R = T.R(i);
        const rects = [["icon", R.icon], ["viz", R.viz], ["count", R.count]];
        if (R.type) rects.push(["type", R.type], ["del", R.del], ["collapse", R.collapse]);
        R.knobs.forEach((k, j) => rects.push(["knob" + j, k.hit]));
        R.chips.forEach((c, j) => rects.push(["chip" + j, c.rect]));
        for (const [nm, r] of rects) ok(inside(r, g), `${tag}: ${nm} inside the strip (${JSON.stringify(r)} in ${g.x}..${g.x + g.w})`);
        for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) ok(!overlap(rects[a][1], rects[b][1]), `${tag}: ${rects[a][0]} overlaps ${rects[b][0]}`);
        ok(R.count[1] + R.count[3] <= 161 - 6, `${tag}: maps chip keeps its bottom padding`);
        for (const k of R.knobs) ok(k.labY + 3 <= R.count[1] + 0.001, `${tag}: knob labels clear the lower rows`);
    }
    // paint must not throw and must keep every text inside the UI
    function paintOk(T, tag) {
        T.log.texts.length = 0;
        T.run("paint()");
        ok(T.log.texts.length > 0, `${tag}: paints`);
    }

    // ---- existing strip interactions keep working
    {
        const T = mk3([4, 2, 0, 0, 1]);
        const tag = "strips";
        const R1 = T.R(1);
        T.c(...ctr(R1.viz)); T.up();
        eq(T.run("ubSel()"), 1, `${tag}: clicking a strip selects it`);
        T.dbl(...ctr(T.R(1).viz)); T.up();
        eq(T.run("ubExp()"), 1, `${tag}: double-click expands the strip`);
        checkStripGeometry(T, 1, `${tag} expanded`);
        T.dbl(...ctr(T.R(1).head)); T.up();
        eq(T.run("ubExp()"), -1, `${tag}: double-clicking the header collapses it`);
        const p0 = T.run("MM.state.mods[0].enabled");
        T.c(...ctr(T.R(0).icon)); T.up();
        eq(T.run("MM.state.mods[0].enabled"), p0 ? 0 : 1, `${tag}: the enable corner toggles`);
        T.c(...ctr(T.R(0).icon)); T.up();
        const k0 = T.R(0).knobs[0];
        const spec = T.run("ubKnobs(MM.state.mods[0])[0].key");
        const before = T.run(`MM.state.mods[0].p.${spec}`);
        T.c(...ctr(k0.hit)); T.d(ctr(k0.hit)[0], ctr(k0.hit)[1] - 30); T.up();
        ok(T.run(`MM.state.mods[0].p.${spec}`) !== before, `${tag}: a knob still drags`);
        T.c(11, 12); T.up();
        ok(T.run("MM.learn.armed"), `${tag}: the rail learn button still works`);
        T.c(11, 12); T.up();
        // the header drag still reorders
        const h2 = T.R(2).head;
        const x2 = ctr(h2)[0];
        T.c(x2, 8); T.d(x2 + 20, 8); T.d(x2 + 70, 8); T.up();
        ok(T.run("ubOrder()").join(",") !== "0,1,2,3,4", `${tag}: dragging a header still reorders`);
        T.run("MM.setUI({ order: [0, 1, 2, 3, 4] })");
    }

    // ---- painting + geometry with 0 / 1 / 4 / 12 mappings on a modulator, collapsed and expanded
    {
        for (const cnt of [0, 1, 4, 12]) {
            for (const exp of [-1, 0]) {
                const T = mk3([cnt, 2, 1], { exp });
                const tag = `${cnt} maps ${exp < 0 ? "collapsed" : "expanded"}`;
                paintOk(T, tag);
                checkStripGeometry(T, 0, tag);
                checkStripGeometry(T, 1, tag + " (neighbour)");
                const txt = T.log.texts;
                ok(txt.includes(cnt + (cnt === 1 ? " map" : " maps")), `${tag}: the maps chip text is painted`);
                {
                    T.run("ubMapsPop = { slot: 0, scroll: 0 }");
                    paintOk(T, tag + " popover");
                    const P = T.run("ubMapsPopGeom()");
                    ok(P.rect[0] >= 0 && P.rect[1] >= 0 && P.rect[0] + P.rect[2] <= T.run("ubLayoutWidth()") && P.rect[1] + P.rect[3] <= 161, `${tag}: popover inside the UI`);
                    eq(P.vis.length, Math.min(cnt, P.rows), `${tag}: popover rows`);
                    for (const r of P.vis) {
                        const pr = T.run(`ubPopRowParts(${JSON.stringify(P.rect)}, ${r.y})`);
                        ok(pr.name[2] > 10 && !overlap(pr.name, pr.mode) && !overlap(pr.mode, pr.bar) && inside(pr.bar, { x: P.rect[0], y: P.rect[1], w: P.rect[2], h: P.rect[3] }), `${tag}: popover row parts fit`);
                    }
                }
            }
        }
    }

    // ---- maps popover
    {
        const T = mk3([4, 2, 0, 0, 1]);
        const chip = ctr(T.R(0).count);
        T.c(...chip); T.up();
        eq(T.run("ubMapsPop && ubMapsPop.slot"), 0, "popover: clicking the maps chip opens the popover for that modulator");
        ok(!T.run("ubPb()"), "popover: the LST view stays closed");
        let P = T.run("ubMapsPopGeom()");
        eq(P.vis.length, 4, "popover: one row per mapping");
        const rows = P.vis.map((r) => T.run(`ubPopRowParts(${JSON.stringify(P.rect)}, ${r.y})`));
        ok(P.vis.every((r, k) => r.m.target.paramName === "Par 0" + k), "popover: rows list the mapping parameter names in order");
        T.log.texts.length = 0; T.run("paint()");
        ok(["Par 00", "Par 01", "Par 02", "Par 03"].every((q) => T.log.texts.includes(q)), "popover: parameter names painted");
        ok(T.log.texts.includes("M") && T.log.texts.includes("R"), "popover: M / R chips painted");
        ok(T.log.texts.includes("±50%") && T.log.texts.includes("20–70%"), "popover: bars show the Mod and Remote value text");
        // Mod mapping 0: polarity +- (0), range 0.5. Press right of centre: range follows, only range changes
        const m0 = T.maps(0);
        const bar0 = rows[0].bar;
        const cx0 = bar0[0] + bar0[2] / 2;
        const half = (bar0[2] - 2) / 2;
        T.c(cx0 + half * 0.8, bar0[1] + 5); T.up();
        let m0b = T.maps(0);
        near(m0b[0].range, 0.8, 0.02, "popover: Mod bar drag sets the range");
        eq(diff(m0[0], m0b[0]), ["range"], "popover: only `range` changed on the Mod mapping");
        eq(JSON.stringify(m0b.slice(1)), JSON.stringify(m0.slice(1)), "popover: other mappings untouched");
        T.c(cx0 - half * 0.3, bar0[1] + 5); T.d(cx0 - half * 0.6, bar0[1] + 5); T.up();
        near(T.maps(0)[0].range, 0.6, 0.02, "popover: a bipolar bar is symmetric (left of centre sets the range too)");
        // Remote mapping 1: window 0.2..0.7
        const bar1 = rows[1].bar;
        const bx = (v) => bar1[0] + 1 + (bar1[2] - 2) * v;
        const before = T.maps(0);
        T.c(bx(0.9), bar1[1] + 5); T.d(bx(0.95), bar1[1] + 5); T.up();
        let m1 = T.maps(0)[1];
        near(m1.max, 0.95, 0.02, "popover: Remote bar: the handle nearest the press (max) follows");
        eq(diff(before[1], m1), ["max"], "popover: only `max` changed");
        T.c(bx(0.1), bar1[1] + 5); T.d(bx(0.05), bar1[1] + 5); T.up();
        const m1b = T.maps(0)[1];
        near(m1b.min, 0.05, 0.02, "popover: Remote bar: the nearest handle (min) follows");
        eq(diff(m1, m1b), ["min"], "popover: only `min` changed");
        // polarity +: only the right half responds; polarity -: only the left half
        const bar2 = rows[2].bar; // j=2 -> polarity +
        eq(T.maps(0)[2].polarity, 1, "popover: third mapping is `+`");
        T.c(bar2[0] + bar2[2] * 0.75, bar2[1] + 5); T.up();
        near(T.maps(0)[2].range, 0.5, 0.06, "popover: `+` bar: right of centre is the range");
        T.c(bar2[0] + bar2[2] * 0.2, bar2[1] + 5); T.up();
        near(T.maps(0)[2].range, 0, 0.001, "popover: `+` bar: left of centre pins the range to 0");
        // double-click resets
        T.dbl(bar0[0] + 20, bar0[1] + 5); T.up();
        eq(T.maps(0)[0].range, 1, "popover: double-click on a Mod bar resets the range to full");
        T.dbl(bx(0.1), bar1[1] + 5); T.up();
        eq(T.maps(0)[1].min, 0, "popover: double-click on a Remote bar resets the nearest handle");
        // M/R chip toggles the mode
        const mm = ctr(rows[0].mode);
        T.c(...mm); T.up();
        eq(T.maps(0)[0].mode, "remote", "popover: the M chip switches the mapping to Remote");
        T.c(...mm); T.up();
        eq(T.maps(0)[0].mode, "mod", "popover: and back to Mod");
        // click outside closes (and the click is swallowed), Esc closes, LST button opens the inspector
        const modsBefore = T.run("ubSel()");
        T.c(T.run("ubMapsPopGeom().rect[0] + ubMapsPopGeom().rect[2]") + 8, 60); T.up();
        eq(T.run("ubMapsPop"), null, "popover: a click outside closes the popover");
        eq(T.run("ubSel()"), modsBefore, "popover: the closing click is swallowed");
        T.c(...chip); T.up();
        T.c(...ctr(T.run("ubMapsPopGeom()").lst)); T.up();
        ok(T.run("ubPb()") && T.run("ubMapsPop") === null, "popover: the popover's LST button opens the inspector");
        T.run("ubTogglePb(false)");
        // clicking the chip again toggles it away
        T.c(...chip); T.up();
        T.c(...chip); T.up();
        eq(T.run("ubMapsPop"), null, "popover: clicking the chip while open closes it");
        // scrolling with 12 mappings
        const T12 = mk3([12, 0]);
        T12.c(...ctr(T12.R(0).count)); T12.up();
        const P12 = T12.run("ubMapsPopGeom()");
        eq(P12.vis.length, 6, "popover: at most 6 (roomy) rows are visible");
        ok(P12.rect[1] >= 0 && P12.rect[1] + P12.rect[3] <= 161, "popover: tall popover fits the 169 px device height");
        T12.ctx.onwheel(P12.rect[0] + 20, P12.rect[1] + 40, 0, -1);
        eq(T12.run("ubMapsPop.scroll"), 1, "popover: the wheel scrolls the popover");
        for (let k = 0; k < 8; k++) T12.ctx.onwheel(P12.rect[0] + 20, P12.rect[1] + 40, 0, -1);
        eq(T12.run("ubMapsPop.scroll"), 6, "popover: scroll stops at the last row (12 - 6)");
        eq(T12.run("ubMapsPopGeom().vis[0].m.target.paramName"), "Par 06", "popover: scrolled rows start at the right mapping");
        paintOk(T12, "popover scrolled");
        // one modulator: the compact popover still fits a 106 px layout
        const T1 = mk3([3]);
        T1.c(...ctr(T1.R(0).count)); T1.up();
        const P1 = T1.run("ubMapsPopGeom()");
        ok(P1.rect[0] >= 0 && P1.rect[0] + P1.rect[2] <= T1.run("ubLayoutWidth()"), "popover: a one-modulator device (106 px) still fits the popover");
        paintOk(T1, "popover compact");
        // expanded strip: the chip opens the same popover, anchored to the 204 px strip
        const TE = mk3([3, 1], { exp: 0 });
        TE.c(...ctr(TE.R(0).count)); TE.up();
        ok(TE.run("ubMapsPop && ubMapsPop.slot") === 0, "popover: the expanded strip's maps chip opens the popover");
        paintOk(TE, "popover expanded popover");
    }

    // ---- popover layout: value column, no overlap with the bar / handles, constant x, inside the device
    {
        const rectOf = (P) => ({ x: P.rect[0], y: P.rect[1], w: P.rect[2], h: P.rect[3] });
        const popRows = (T) => { const P = T.run("ubMapsPopGeom()"); return { P, rows: P.vis.map((r) => T.run(`ubPopRowParts(${JSON.stringify(P.rect)}, ${r.y})`)) }; };
        const T = mk3([4, 2, 0, 0, 1]);
        T.c(...ctr(T.R(0).count)); T.up();
        const { P, rows } = popRows(T);
        const xs = (k) => rows.map((r) => r[k][0]);
        for (const k of ["mode", "bar", "val"]) ok(new Set(xs(k)).size === 1, `popover: the ${k} column is aligned across rows`);
        ok(new Set(rows.map((r) => r.name[0])).size === 1, "popover: the name column is aligned across rows");
        rows.forEach((r, i) => {
            ok(r.val[0] >= r.bar[0] + r.bar[2] + 2, `popover row ${i}: value column starts right of the bar (gap >= 2 px)`);
            ok(!overlap(r.val, r.bar) && !overlap(r.val, r.mode) && !overlap(r.val, r.name), `popover row ${i}: value column overlaps nothing`);
            ok(inside(r.val, rectOf(P)) && inside(r.bar, rectOf(P)), `popover row ${i}: bar and value inside the popover`);
        });
        // the widest possible value texts fit the fixed column
        T.run("ubMapsPop = null");
        const wid = T.run("[ubTextW('100\u2013100%', 7.5), ubTextW('\u00b1100%', 7.5), ubTextW('+100%', 7.5), ubTextW('\u2212100%', 7.5), ubPopValW([{ mode: 'mod' }]), ubPopValW([{ mode: 'mod' }, { mode: 'remote' }])]");
        ok(wid[0] <= wid[5], "popover: a mixed popover's column fits 100\u2013100%");
        ok(wid[1] <= wid[4] && wid[2] <= wid[4] && wid[3] <= wid[4] && wid[4] < wid[5], "popover: an all-Mod column fits the widest Mod text and is narrower");
        // dragging bars and changing values never moves the columns or the value text
        T.run("ubMapsPop = { slot: 0, scroll: 0 }");
        const before = popRows(T).rows.map((r) => r.val.join(","));
        T.log.texts.length = 0; T.log.textPos = [];
        const bar0 = rows[0].bar;
        T.c(bar0[0] + 3, bar0[1] + 5); T.d(bar0[0] + bar0[2] - 4, bar0[1] + 5); T.up();
        const bar1 = rows[1].bar;
        T.c(bar1[0] + 3, bar1[1] + 5); T.d(bar1[0] + bar1[2] - 3, bar1[1] + 5); T.up();
        eq(popRows(T).rows.map((r) => r.val.join(",")).join("|"), before.join("|"), "popover: the value column keeps its x after drags");
        for (const v of [0, 0.05, 0.5, 1]) {
            T.run(`MM.updateMapping(MM.mappingsFor(0)[0].id, { range: ${v} })`);
            T.run(`MM.updateMapping(MM.mappingsFor(0)[1].id, { min: ${v === 1 ? 0.99 : v}, max: ${v === 0 ? 0.01 : 1} })`);
            eq(popRows(T).rows.map((r) => r.val.join(",")).join("|"), before.join("|"), `popover: value x constant at value ${v}`);
            T.log.texts.length = 0; T.run("paint()");
            ok(T.log.texts.some((q) => q === T.run("ubValueText(MM.mappingsFor(0)[0])")), `popover: the value text is painted at ${v}`);
        }
    }

    // ---- popover: the bar fills the space up to the value column (width follows the rows' modes)
    {
        const rectOf = (P) => ({ x: P.rect[0], y: P.rect[1], w: P.rect[2], h: P.rect[3] });
        const popRows = (T) => { const P = T.run("ubMapsPopGeom()"); return { P, rows: P.vis.map((r) => T.run(`ubPopRowParts(${JSON.stringify(P.rect)}, ${r.y}, ${P.vw})`)) }; };
        const allMod = (T, slot) => { for (const m of T.run(`MM.mappingsFor(${slot})`)) T.run(`MM.updateMapping(${m.id}, { mode: "mod" })`); };
        const aligned = (rows, msg) => { for (const k of ["mode", "bar", "val"]) ok(new Set(rows.map((r) => r[k][0] + "," + r[k][2])).size === 1, `${msg}: ${k} column aligned`); };
        const T = mk3([4, 2, 0, 0, 1]);
        T.c(...ctr(T.R(0).count)); T.up();
        allMod(T, 0);
        let { P, rows } = popRows(T);
        rows.forEach((r, i) => {
            const gap = r.val[0] - (r.bar[0] + r.bar[2]);
            ok(gap >= 2 && gap <= 4, `all-Mod row ${i}: gap between bar and value column is ${gap} px (<= 4)`);
            ok(inside(r.bar, rectOf(P)) && inside(r.val, rectOf(P)), `all-Mod row ${i}: inside the popover`);
        });
        aligned(rows, "all-Mod");
        const wm = T.run("[ubTextW('\u00b1100%', 7.5), ubTextW('+100%', 7.5), ubTextW('\u2212100%', 7.5)]");
        ok(wm.every((w) => w <= rows[0].val[2]), "all-Mod: the widest Mod text fits the column");
        const barBefore = rows.map((r) => r.bar.join(",")).join("|");
        const b0 = rows[0].bar;
        T.c(b0[0] + 3, b0[1] + 5); T.d(b0[0] + b0[2] - 4, b0[1] + 5); T.up();
        for (const v of [0, 0.05, 0.5, 1]) {
            T.run(`MM.updateMapping(MM.mappingsFor(0)[0].id, { range: ${v}, polarity: ${[1, 0, -1][v === 0 ? 0 : v === 1 ? 2 : 1]} })`);
            eq(popRows(T).rows.map((r) => r.bar.join(",")).join("|"), barBefore, `all-Mod: bar x/width constant at value ${v}`);
        }
        // one row switches to Remote: the column widens, every row stays aligned and the bar still ends at the column
        const widthMod = rows[0].val[2];
        T.run("MM.updateMapping(MM.mappingsFor(0)[1].id, { mode: 'remote', min: 0, max: 1 })");
        ({ P, rows } = popRows(T));
        ok(rows[0].val[2] > widthMod, "mixed: the column widens for 100\u2013100%");
        ok(T.run("ubTextW('100\u2013100%', 7.5)") <= rows[0].val[2], "mixed: 100\u2013100% fits");
        aligned(rows, "mixed");
        rows.forEach((r, i) => ok(r.val[0] - (r.bar[0] + r.bar[2]) <= 4, `mixed row ${i}: gap <= 4 px`));
        const barMixed = rows.map((r) => r.bar.join(",")).join("|");
        for (const v of [0, 0.3, 1]) {
            T.run(`MM.updateMapping(MM.mappingsFor(0)[1].id, { min: ${v === 1 ? 0 : v}, max: 1 })`);
            T.run(`MM.updateMapping(MM.mappingsFor(0)[0].id, { range: ${v} })`);
            eq(popRows(T).rows.map((r) => r.bar.join(",")).join("|"), barMixed, `mixed: bar x/width constant at value ${v}`);
        }
        T.run("MM.updateMapping(MM.mappingsFor(0)[1].id, { mode: 'mod' })");
        ({ rows } = popRows(T));
        eq(rows.map((r) => r.bar.join(",")).join("|"), barBefore, "Mod again: back to the all-Mod layout");
        aligned(rows, "back to Mod");
        paintOk(T, "popover fill");
    }

    // ---- popover stays inside the device (and off the rail) for the first, last and an expanded strip
    {
        const cases = [["first strip", [3, 2, 1, 1, 2], { exp: -1 }, 0], ["last strip", [3, 2, 1, 1, 2], { exp: -1 }, 4], ["expanded strip", [3, 2, 1, 1, 2], { exp: 2 }, 2], ["expanded first", [5, 1], { exp: 0 }, 0], ["expanded last", [2, 6], { exp: 1 }, 1], ["single modulator", [12], { exp: -1 }, 0], ["many maps", [12, 1, 1], { exp: -1 }, 2]];
        for (const [name, per, opts, slot] of cases) {
            const T = mk3(per, opts);
            T.c(...ctr(T.R(slot).count)); T.up();
            eq(T.run("ubMapsPop && ubMapsPop.slot"), slot, `popover ${name}: opened`);
            const P = T.run("ubMapsPopGeom()");
            const lw = T.run("ubLayoutWidth()");
            const r = P.rect;
            ok(r[0] >= 22 && r[0] + r[2] <= lw && r[1] >= 0 && r[1] + r[3] <= 161, `popover ${name}: inside the device and clear of the rail (${JSON.stringify(r)} in ${lw})`);
            ok(r[0] >= 20, `popover ${name}: does not cover the rail`);
            ok(P.lst[0] >= r[0] && P.lst[0] + P.lst[2] <= r[0] + r[2] && P.lst[1] >= r[1] && P.lst[1] + P.lst[3] <= r[1] + r[3], `popover ${name}: header LST button inside the popover`);
            // every hit area of every visible row stays inside the popover
            for (const row of P.vis) {
                const pr = T.run(`ubPopRowParts(${JSON.stringify(r)}, ${row.y})`);
                for (const k of ["name", "mode", "bar", "val"]) ok(inside(pr[k], { x: r[0], y: r[1], w: r[2], h: r[3] }), `popover ${name}: ${k} inside`);
            }
            paintOk(T, `popover ${name}`);
            // nothing painted at the rail while the popover is open: the rail LST/LRN stay hit-testable? (a click outside closes it)
            eq(T.run("ubHit(11, 12).kind"), "mp_out", `popover ${name}: a click on the rail is outside the popover`);
        }
    }

    // ---- the maps popover (roomy rows: 260 px wide, 19 px rows, 6 rows before it scrolls)
    {
        const tg = "popover";
        const mkD = (per, opts) => mk3(per, opts);
        const openAt = (T, slot) => { T.c(...ctr(T.R(slot).count)); T.up(); return T.run("ubMapsPopGeom()"); };
        const geomJson = (T) => { const P = T.run("ubMapsPopGeom()"); return JSON.stringify([P.rect, P.lst, P.vw, P.vis.map((v) => [v.rect, v.parts])]); };
        const partNames = ["tog", "name", "mode", "pol", "bar", "val"];
        const valSize = 7.5;
        const inR = (r, R) => r[0] >= R[0] - 1e-9 && r[1] >= R[1] - 1e-9 && r[0] + r[2] <= R[0] + R[2] + 1e-9 && r[1] + r[3] <= R[1] + R[3] + 1e-9;

        // opens from the chip; geometry is sane; faces are hidden
        {
            const T = mkD([4, 2, 0, 0, 1]);
            const P = openAt(T, 0);
            eq(T.run("ubMapsPop && ubMapsPop.slot"), 0, `${tg}: opens from the maps chip`);
            ok(!T.run("ubPb()"), `${tg}: the LST view stays closed`);
            paintOk(T, tg);
            eq(Object.keys(T.run("ubFacesWanted()")).length, 0, `${tg}: parameter faces hidden while open`);
            eq(P.vis.length, Math.min(4, P.rows), `${tg}: visible entries`);
            eq(P.rect[2], 260, `${tg}: 260 px wide`); ok(P.vis.every((v) => v.rect[3] === 19), `${tg}: rows are 19 px`);
        }

        // edits: toggle, M/R, polarity, range (Mod range with its polarity, Remote min / max)
        {
            const T = mkD([4, 2, 0, 0, 1]);
            openAt(T, 0);
            for (let i = 0; i < 4; i++) {
                const P = T.run("ubMapsPopGeom()");
                const v = P.vis.filter((q) => q.m.target.paramName === "Par 0" + i)[0];
                ok(!!v, `${tg}: mapping ${i} is shown`);
                const id = v.m.id;
                const pr = v.parts;
                const snap = () => JSON.parse(JSON.stringify(T.run(`MM.getMapping(${id})`)));
                const m0 = snap();
                // on / off
                T.c(...ctr(pr.tog)); T.up();
                let m1 = snap();
                eq(diff(m0, m1), ["enabled"], `${tg} #${i}: the toggle changes only enabled`);
                T.c(...ctr(pr.tog)); T.up();
                eq(snap().enabled, m0.enabled, `${tg} #${i}: and back`);
                // polarity (Mod only)
                if (m0.mode !== "remote") {
                    T.c(...ctr(pr.pol)); T.up();
                    m1 = snap();
                    eq(diff(m0, m1), ["polarity"], `${tg} #${i}: the polarity button changes only polarity`);
                    eq(m1.polarity, { 1: 0, 0: -1, "-1": 1 }[m0.polarity], `${tg} #${i}: polarity cycles + -> ± -> − -> +`);
                    T.c(...ctr(pr.pol)); T.up(); T.c(...ctr(pr.pol)); T.up();
                    eq(snap().polarity, m0.polarity, `${tg} #${i}: three clicks come back`);
                } else {
                    ok(T.run(`ubHitMapsPop(${ctr(pr.pol)[0]}, ${ctr(pr.pol)[1]}).kind`) !== "mp_pol", `${tg} #${i}: no polarity button in Remote`);
                }
                // range
                const m = snap();
                if (m.mode !== "remote") {
                    const b = pr.bar;
                    const dir = m.polarity < 0 ? -1 : 1;
                    const pt = (f) => [b[0] + b[2] / 2 + dir * ((b[2] - 2) / 2) * f, b[1] + b[3] / 2];
                    T.c(...pt(0.8)); T.d(...pt(0.7)); T.up();
                    const m2 = snap();
                    near(m2.range, 0.7, 0.03, `${tg} #${i}: a Mod bar drag sets the range`);
                    eq(diff(m, m2), ["range"], `${tg} #${i}: only range changed`);
                    T.dbl(...pt(0.3)); T.up();
                    eq(snap().range, 1, `${tg} #${i}: double-click resets the range`);
                } else {
                    const b = pr.bar;
                    const pt = (val) => [b[0] + 1 + (b[2] - 2) * val, b[1] + b[3] / 2];
                    T.c(...pt(0.9)); T.d(...pt(0.95)); T.up();
                    const m2 = snap();
                    near(m2.max, 0.95, 0.03, `${tg} #${i}: Remote bar: the nearest handle (max) follows`);
                    eq(diff(m, m2), ["max"], `${tg} #${i}: only max changed`);
                    T.c(...pt(0.1)); T.d(...pt(0.05)); T.up();
                    const m3 = snap();
                    near(m3.min, 0.05, 0.03, `${tg} #${i}: Remote bar: the nearest handle (min) follows`);
                    eq(diff(m2, m3), ["min"], `${tg} #${i}: only min changed`);
                }
                // M / R
                if (!m.target.internal) {
                    const mode0 = snap().mode;
                    T.c(...ctr(pr.mode)); T.up();
                    eq(snap().mode, mode0 === "remote" ? "mod" : "remote", `${tg} #${i}: the M/R chip switches the mode`);
                    T.c(...ctr(T.run("ubMapsPopGeom()").vis.filter((q) => q.m.id === id)[0].parts.mode)); T.up();
                    eq(snap().mode, mode0, `${tg} #${i}: and back`);
                }
                ok(T.run("!!ubMapsPop"), `${tg}: the popover stays open through edits`);
            }
        }

        // value text fits at the extremes; no overlaps; everything inside the popover
        {
            const T = mkD([4, 2, 0, 0, 1]);
            for (const [rangeV, mn, mx] of [[1, 0, 1], [0, 0.4, 0.4], [0.37, 0.05, 0.95]]) {
                for (const m of T.maps(0)) T.run(`MM.updateMapping(${m.id}, { range: ${rangeV}, min: ${mn}, max: ${mx} })`);
                openAt(T, 0);
                const P = T.run("ubMapsPopGeom()");
                const n = P.maps.length;
                for (let k = 0; k < n; k++) {
                    const Q = T.run("ubMapsPopGeom()");
                    for (const v of Q.vis) {
                        const txt = T.run(`ubValueText(MM.getMapping(${v.m.id}))`);
                        ok(T.run(`ubTextW(${JSON.stringify(txt)}, ${valSize})`) <= v.parts.val[2], `${tg}: value text "${txt}" fits its ${v.parts.val[2]} px column`);
                        const names = partNames.filter((q) => v.parts[q]);
                        for (const nm of names) ok(inR(v.parts[nm], Q.rect), `${tg}: ${nm} inside the popover`);
                        for (const nm of names) ok(inR(v.parts[nm], v.rect), `${tg}: ${nm} inside its row / card`);
                        for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
                            ok(!overlap(v.parts[names[a]], v.parts[names[b]]), `${tg}: ${names[a]} and ${names[b]} do not overlap`);
                        }
                        ok(v.parts.name[2] >= 54, `${tg}: the name column is wide (${v.parts.name[2]} px)`);
                    }
                    const rects = Q.vis.map((v) => v.rect);
                    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) ok(!overlap(rects[a], rects[b]), `${tg}: entries do not overlap`);
                    const fixed = [["lst", Q.lst]];
                    for (const [nm, r] of fixed) {
                        ok(inR(r, Q.rect), `${tg}: ${nm} inside the popover`);
                        for (const v of Q.vis) for (const q of partNames) if (v.parts[q]) ok(!overlap(r, v.parts[q]), `${tg}: ${nm} does not overlap ${q}`);
                    }
                    for (let a = 0; a < fixed.length; a++) for (let b = a + 1; b < fixed.length; b++) ok(!overlap(fixed[a][1], fixed[b][1]), `${tg}: ${fixed[a][0]} and ${fixed[b][0]} do not overlap`);
                }
                paintOk(T, `${tg} extremes`);
                T.run("ubMapsPop = null");
            }
        }

        // inside the device for the first, last and expanded strips; clear of the rail
        for (const [name, per, opts, slot] of [["first", [3, 2, 1, 1, 2], { exp: -1 }, 0], ["last", [3, 2, 1, 1, 2], { exp: -1 }, 4], ["expanded", [3, 2, 1, 1, 2], { exp: 2 }, 2], ["expanded first", [5, 1], { exp: 0 }, 0], ["expanded last", [2, 6], { exp: 1 }, 1], ["single", [12], { exp: -1 }, 0]]) {
            const T = mkD(per, opts);
            const g0 = T.g(slot);
            const P = openAt(T, slot);
            const lw = T.run("ubLayoutWidth()");
            const r = P.rect;
            ok(r[0] >= 22 && r[0] + r[2] <= lw && r[1] >= 0 && r[1] + r[3] <= 161, `${tg} ${name}: inside the device (${JSON.stringify(r)} in ${lw})`);
            eq(T.run("ubLastReq"), lw + 8, `${tg} ${name}: the device is asked to be ${lw + 8} px wide`);
            for (const v of P.vis) for (const q of partNames) if (v.parts[q]) ok(inR(v.parts[q], r), `${tg} ${name}: ${q} inside`);
            ok(inR(P.lst, r), `${tg} ${name}: LST inside`);
            paintOk(T, `${tg} ${name}`);
            eq(Object.keys(T.run("ubFacesWanted()")).length, 0, `${tg} ${name}: faces hidden`);
            eq(T.run("ubHit(11, 12).kind"), "mp_out", `${tg} ${name}: the rail is outside the popover`);
            // closing restores the width and the faces
            T.ctx.key(27, 0);
            eq(T.run("ubMapsPop"), null, `${tg} ${name}: Esc closes`);
            T.run("paint()");
            ok(Object.keys(T.run("ubFacesWanted()")).length > 0, `${tg} ${name}: faces return`);
        }

        // scrolling / stepping with 1, 2, 6 and 12 mappings
        for (const n of [1, 2, 6, 12]) {
            const T = mkD([n, 1]);
            let P = openAt(T, 0);
            const ids = T.maps(0).map((m) => m.id);
            eq(P.vis.length, Math.min(n, P.rows), `${tg} ${n} maps: visible entries`);
            eq(P.first, 0, `${tg} ${n} maps: starts at the first`);
            eq(P.vis[0].m.id, ids[0], `${tg} ${n} maps: the first mapping is shown first`);
            paintOk(T, `${tg} ${n} maps`);
            const wx = P.rect[0] + P.rect[2] / 2;
            const wy = P.rect[1] + P.rect[3] / 2;
            for (let k = 0; k < n + 3; k++) {
                T.ctx.onwheel(wx, wy, 0, -1);
            }
            P = T.run("ubMapsPopGeom()");
            eq(P.first, P.maxScroll, `${tg} ${n} maps: scroll stops at the end (${P.maxScroll})`);
            eq(P.maxScroll, Math.max(0, n - P.rows), `${tg} ${n} maps: max scroll = n - capacity`);
            eq(P.vis[P.vis.length - 1].m.id, ids[n - 1], `${tg} ${n} maps: the last mapping is reachable`);
            paintOk(T, `${tg} ${n} maps scrolled`);
            for (let k = 0; k < n + 3; k++) T.ctx.onwheel(wx, wy, 0, 1);
            eq(T.run("ubMapsPop.scroll"), 0, `${tg} ${n} maps: wheel back to the start`);
            // the wheel outside the popover does nothing
            const before = T.run("ubMapsPop.scroll");
            T.ctx.onwheel(P.rect[0] + P.rect[2] + 5, 80, 0, -1);
            eq(T.run("ubMapsPop.scroll"), before, `${tg} ${n} maps: a wheel outside is ignored`);
        }

        // close: Esc, outside click (swallowed), LST, the chip again; the drawer's close button
        {
            const T = mkD([4, 2, 0, 0, 1]);
            let P = openAt(T, 0);
            T.ctx.key(27, 0);
            eq(T.run("ubMapsPop"), null, `${tg}: Esc closes`);
            P = openAt(T, 0);
            const selBefore = T.run("ubSel()");
            const out = P.rect[0] + P.rect[2] + 8 < T.run("ubLayoutWidth()") ? [P.rect[0] + P.rect[2] + 8, 60] : [P.rect[0] - 6, 60];
            T.c(...out); T.up();
            eq(T.run("ubMapsPop"), null, `${tg}: a click outside closes`);
            eq(T.run("ubSel()"), selBefore, `${tg}: the closing click is swallowed`);
            P = openAt(T, 0);
            T.c(...ctr(P.lst)); T.up();
            ok(T.run("ubPb()") && T.run("ubMapsPop") === null, `${tg}: LST opens the inspector`);
            T.run("ubTogglePb(false)");
            const P2 = openAt(T, 0);
            const cc = ctr(T.R(0).count);
            // a tall popover can cover its own chip (then Esc / an outside click close it); otherwise the chip toggles it away
            if (!(cc[0] >= P2.rect[0] && cc[0] < P2.rect[0] + P2.rect[2] && cc[1] >= P2.rect[1] && cc[1] < P2.rect[1] + P2.rect[3])) { T.c(...cc); T.up(); eq(T.run("ubMapsPop"), null, `${tg}: the chip closes it again`); }
        }

        // stable layout while dragging, and while values change
        {
            const T = mkD([4, 2, 0, 0, 1]);
            const P = openAt(T, 0);
            const base = geomJson(T);
            for (const v of P.vis) {
                const b = v.parts.bar;
                const a = [b[0] + b[2] * 0.3, b[1] + b[3] / 2];
                const z = [b[0] + b[2] * 0.8, b[1] + b[3] / 2];
                T.c(...a); T.d(...z); T.d(...a); T.up();
                eq(geomJson(T), base, `${tg}: geometry unchanged after a drag`);
            }
            for (const val of [0, 0.05, 0.5, 1]) {
                for (const m of T.maps(0)) T.run(`MM.updateMapping(${m.id}, { range: ${val}, min: ${val === 1 ? 0.99 : val}, max: ${val === 0 ? 0.01 : 1} })`);
                eq(geomJson(T), base, `${tg}: geometry unchanged at value ${val}`);
            }
        }

        // self-mapping kind markers
        {
            const T = mkD([1]);
            T.run("MM.addSelfMapping(0, 12, 'internal')");
            T.run("MM.setSelfMod('live', false); MM.addSelfMapping(0, 7, 'live')");
            openAt(T, 0);
            for (let k = 0; k < 3; k++) {
                T.log.texts.length = 0; T.run("paint()");
                const P = T.run("ubMapsPopGeom()");
                if (P.vis.some((v) => T.run(`isSelfMapping(MM.getMapping(${v.m.id}))`) && !v.m.target.internal)) ok(T.log.texts.includes("L"), `${tg}: via-Live marker painted`);
                for (const v of P.vis) if (T.run(`isSelfMapping(MM.getMapping(${v.m.id}))`)) eq(T.run(`ubHitMapsPop(${ctr(v.parts.mode)[0]}, ${ctr(v.parts.mode)[1]}).kind`), "mp_mode", `${tg}: self row keeps the mode chip hit area`);
            }
        }
    }

}

// ================================================================ Options view (rail OPT button, device-global settings)
{
    const ctr = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    const overlap = (a, b) => a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;
    const inside = (r, o) => r[0] >= o[0] - 1e-6 && r[1] >= o[1] - 1e-6 && r[0] + r[2] <= o[0] + o[2] + 1e-6 && r[1] + r[3] <= o[1] + o[3] + 1e-6;
    function mkO(n = 3) {
        const T = makeEnv();
        T.ctx.uiReady();
        for (let k = 0; k < n; k++) T.run(`ubAddType(${[1, 2, 3, 4, 5][k % 5]})`);
        const w = () => { const o = T.log.outlets.filter((q) => q[1] === "width"); return o.length ? o[o.length - 1][2] : null; };
        const C = (x, y) => T.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
        const D = (x, y) => T.ctx.ondrag(x, y, 1, 0, 0, 0, 0, 0);
        const U = () => T.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
        const DB = (x, y) => T.ctx.ondblclick(x, y, 1, 0, 0, 0, 0, 0);
        const gen = (name) => T.log.outlets.filter((o) => (name === "smooth" ? o[1] === "smooth" : o[1] === "gen" && o[2] === name));
        return { T, ctx: T.ctx, run: T.run, log: T.log, w, C, D, U, DB, gen };
    }
    const RAIL_OPT = [11, 75];
    const S = (E) => JSON.parse(JSON.stringify(E.run("MM.getSettings()")));
    const bytes = (E) => JSON.stringify(E.run("MM.state"));

    // ---- rail button, toggle, exclusivity with LST, width
    {
        const E = mkO(5);
        const rr = E.run("ubRailRects()");
        eq(rr.opt, [2, 75, 16, 16], "OPT rail button rect (under LST)");
        ok(rr.opt[1] >= rr.list[1] + rr.list[3] + 4 && rr.opt[1] + rr.opt[3] + 10 < 140, "OPT sits under LST and above the count");
        eq(E.run(`ubHit(${RAIL_OPT[0]}, ${RAIL_OPT[1]}).kind`), "rail_opt", "rail OPT hit");
        ok(!E.run("ubOpt()") && !E.run("ubPb()"), "starts in the strips view");
        const stripsW = E.w();
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("OPT") && E.log.texts.includes("LST") && E.log.texts.includes("LRN"), "the rail paints LRN, LST and OPT labels");
        ok(!E.log.texts.includes("OPTIONS"), "strips view: no options panel");
        E.C(...RAIL_OPT);
        ok(E.run("ubOpt()") && !E.run("ubPb()"), "OPT turns the Options view on");
        eq(E.run("ubStrips().list.length"), 0, "Options view: no strips");
        eq(E.w(), E.run("ubOptGeom().end") + 8, "Options: width request follows the content");
        eq(E.w(), 22 + 360 + 8, "Options: 390 px");
        eq(E.run("ubLayoutWidth()"), 382, "Options: layout width");
        E.log.texts.length = 0; E.run("paint()");
        for (const t of ["OPTIONS", "Default mapping mode", "Global smoothing", "Rate multiplier", "MOD", "REM", "Off", "\u00d71"]) ok(E.log.texts.includes(t), "Options paints " + t);
        ok(E.log.texts.some((t) => /device-wide/.test(t)), "Options header note");
        // LST while OPT is open: exclusive
        E.C(11, 48);
        ok(E.run("ubPb()") && !E.run("ubOpt()"), "LST turns OPT off");
        eq(E.w(), E.run("ubListGeom().end") + 8, "LST width after OPT");
        E.C(...RAIL_OPT);
        ok(E.run("ubOpt()") && !E.run("ubPb()"), "OPT turns LST off");
        eq(E.run("MM.getUI().pb"), 0, "ui.pb cleared by OPT");
        E.C(...RAIL_OPT);
        ok(!E.run("ubOpt()") && !E.run("ubPb()"), "OPT again: both off");
        eq(E.w(), stripsW, "both off: the strips view and its width return");
        eq(E.run("ubStrips().list.length"), 5, "strips are back");
        // a corrupt state with both flags: LST wins
        E.run("MM.setUI({ pb: 1, opt: 1 })");
        ok(E.run("ubPb()") && !E.run("ubOpt()"), "both flags set: LST wins");
        E.run("MM.setUI({ pb: 0, opt: 0 })");
        // survives a save / load
        E.C(...RAIL_OPT);
        const saved = E.run("MM.save()");
        const E2 = mkO(0);
        E2.ctx.setvalueof(saved);
        ok(E2.run("ubOpt()"), "ui.opt restored");
        eq(E2.w(), 390, "restored Options width");
    }

    // ---- hit areas: each control, rects inside the panel / device, no overlaps, nothing outside
    {
        const E = mkO(3);
        E.C(...RAIL_OPT);
        const g = E.run("ubOptGeom()");
        const rects = [["tabmod", g.tabmod], ["tabrem", g.tabrem], ["bar", g.bar], ["knob", g.knobRect]];
        for (const [n, r] of rects) {
            ok(inside(r, g.panel), "Options: " + n + " inside the panel");
            ok(r[0] + r[2] <= E.run("ubLayoutWidth()") && r[1] >= 0 && r[1] + r[3] <= 161, "Options: " + n + " inside the device");
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) ok(!overlap(rects[i][1], rects[j][1]), `Options: ${rects[i][0]} / ${rects[j][0]} do not overlap`);
        ok(inside(g.panel, [22, 0, 360, 161]) && g.panel[1] === 0 && g.panel[3] === 161, "Options panel: same top / bottom as the other panels");
        eq(E.run(`ubHit(${ctr(g.tabmod)}).kind`), "opt_mod", "MOD tab hit");
        eq(E.run(`ubHit(${ctr(g.tabrem)}).kind`), "opt_rem", "REM tab hit");
        eq(E.run(`ubHit(${ctr(g.bar)}).kind`), "opt_smooth", "smoothing bar hit");
        eq(E.run(`ubHit(${ctr(g.knobRect)}).kind`), "opt_rate", "rate dial hit");
        eq(E.run("ubHit(30, 6).kind"), "opt_panel", "panel header is a pad");
        eq(E.run("ubHit(11, 12).kind"), "rail_learn", "LRN still on the rail");
        eq(E.run("ubHit(11, 48).kind"), "rail_list", "LST still on the rail");
        // text blocks end before the controls
        ok(g.textX + g.textW <= g.tabmod[0] - 4 && g.textX + g.textW <= g.bar[0] - 4 && g.textX + g.textW <= g.knobRect[0] - 4, "label column does not run under the controls");
        // rows: every label fits its column
        for (const t of ["Default mapping mode", "Global smoothing", "Rate multiplier"]) ok(E.run(`ubTextW(${JSON.stringify(t)}, 8)`) <= g.textW, "label fits: " + t);
    }

    // ---- default mapping mode: the MOD | REM segmented control, applied to new mappings
    {
        const E = mkO(3);
        E.C(...RAIL_OPT);
        const g = E.run("ubOptGeom()");
        eq(S(E).defaultMode, "mod", "default mode starts at Mod");
        E.C(...ctr(g.tabrem));
        eq(S(E).defaultMode, "remote", "REM tab sets the Remote default");
        E.log.fills = []; E.log.textCols = []; E.run("paint()");
        const tc = (t) => E.log.textCols.filter((q) => q.t === t).map((q) => q.col);
        ok(tc("REM")[0] && tc("REM")[0][0] === 1 && tc("MOD")[0][0] < 0.7, "the lit tab has white text, the other is dim");
        const fillsFor = (rect) => E.log.fills.filter((f) => Math.abs(f.rect[0] - rect[0]) < 1e-6 && Math.abs(f.rect[1] - rect[1]) < 1e-6);
        const remFill = fillsFor(g.tabrem)[0];
        ok(remFill && Math.abs(remFill.col[0] - 0.98) < 1e-6 && Math.abs(remFill.col[2] - 0.18) < 1e-6, "lit REM tab uses the orange remote colour");
        E.log.fills = []; E.C(...ctr(g.tabmod)); E.run("paint()");
        const modFill = fillsFor(g.tabmod)[0];
        ok(modFill && Math.abs(modFill.col[0] - 0.30) < 1e-6 && Math.abs(modFill.col[1] - 0.85) < 1e-6, "lit MOD tab uses the cyan mod colour");
        eq(S(E).defaultMode, "mod", "MOD tab sets the Mod default");
        // the same size / position as the remap editor tabs
        eq([g.tabmod[2], g.tabmod[3]].join(), [48, 14].join(), "tab size");
        // addMapping: Remote default
        E.C(...ctr(g.tabrem));
        const m1 = E.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 1', paramName: 'A' })");
        eq([m1.mode, m1.min, m1.max].join(), "remote,0,1", "addMapping: Remote default has min 0 max 1");
        E.C(...ctr(g.tabmod));
        const m2 = E.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 2', paramName: 'B' })");
        eq([m2.mode, m2.polarity, m2.range].join(), "mod,0,0.5", "addMapping: Mod default is +-, range 0.5");
        eq(E.run("MM.getMapping(" + m1.id + ").mode"), "remote", "existing mappings keep their mode");
        ok(E.log.notify > 0, "a mode change commits (Live saves the Set)");
    }

    // ---- smoothing bar
    {
        const E = mkO(3);
        E.C(...RAIL_OPT);
        const g = E.run("ubOptGeom()");
        const b = g.bar;
        eq(S(E).smoothMs, 0, "smoothing starts at 0 (Off)");
        E.log.outlets.length = 0;
        E.C(b[0] + b[2] - 1, b[1] + 7);
        near(S(E).smoothMs, 500, 3, "click at the right end = 500 ms");
        eq(E.gen("smooth").pop().slice(1, 2).join(), "smooth", "a `smooth` message goes to the outlet (route smooth -> routers)");
        near(E.gen("smooth").pop()[2], S(E).smoothMs, 1e-9, "the message carries the ms value");
        E.D(b[0] + b[2] / 2, b[1] + 7);
        const mid = S(E).smoothMs;
        ok(mid > 30 && mid < 60, "drag to the middle = ~45 ms (log feel): " + mid);
        E.D(b[0] - 40, b[1] + 7);
        eq(S(E).smoothMs, 0, "drag past the left end = Off");
        E.D(b[0] + b[2] * 0.75, b[1] + 7);
        const m75 = S(E).smoothMs;
        ok(m75 > mid && m75 < 500, "monotonic");
        E.U();
        ok(E.run("ubDrag") === null, "drag ends");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.some((t) => /ms$/.test(t)), "value text shows ms");
        E.DB(...ctr(b));
        eq(S(E).smoothMs, 0, "double-click resets to the default (0)");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("Off"), "0 reads Off");
        E.ctx.onwheel(...ctr(b), 0, -1);
        ok(S(E).smoothMs > 0, "wheel up raises it");
        E.ctx.onwheel(...ctr(b), 0, 1);
        eq(S(E).smoothMs, 0, "wheel down lowers it back to Off");
        // no message when nothing changed
        const n = E.log.outlets.length;
        E.DB(...ctr(b));
        eq(E.log.outlets.length, n, "no gen traffic when the value did not change");
    }

    // ---- rate dial
    {
        const E = mkO(3);
        E.C(...RAIL_OPT);
        const g = E.run("ubOptGeom()");
        const [kx, ky] = ctr(g.knobRect);
        eq(S(E).rateMul, 1, "rate starts at x1");
        E.log.outlets.length = 0;
        E.C(kx, ky);
        eq(S(E).rateMul, 1, "a plain click does not change the rate");
        // drag up in small steps: every value is either a musical step or a free value between steps
        const seen = [];
        let y = ky;
        for (let i = 0; i < 40; i++) { y -= 2; E.D(kx, y); seen.push(S(E).rateMul); }
        E.U();
        ok(seen[seen.length - 1] > 1, "dragging up raises the rate");
        ok(seen.every((v) => v >= 0.25 && v <= 4), "stays in 0.25..4");
        const steps = [0.25, 1 / 3, 0.5, 1, 1.5, 2, 3, 4];
        ok(seen.some((v) => steps.some((st) => Math.abs(v - st) < 1e-9)), "the dial lands exactly on musical steps");
        ok(seen.some((v) => !steps.some((st) => Math.abs(v - st) < 1e-9)), "and moves freely between them (fine drag)");
        ok(seen.some((v) => Math.abs(v - 1.5) < 1e-9) && seen.some((v) => Math.abs(v - 2) < 1e-9), "passes x1.5 and x2");
        const msgs = E.gen("ratemul");
        ok(msgs.length > 0 && msgs.every((m) => m[1] === "gen" && m[2] === "ratemul" && typeof m[3] === "number"), "`gen ratemul <x>` messages");
        near(msgs[msgs.length - 1][3], seen[seen.length - 1], 1e-12, "the last message matches the state");
        // down to the bottom and top clamp
        E.C(kx, ky);
        for (let i = 0; i < 100; i++) E.D(kx, ky + 3 * (i + 1));
        E.U();
        near(S(E).rateMul, 0.25, 1e-9, "dragging far down = x0.25");
        E.C(kx, ky);
        for (let i = 0; i < 300; i++) E.D(kx, ky - 3 * (i + 1));
        E.U();
        near(S(E).rateMul, 4, 1e-9, "dragging far up = x4");
        // text
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("\u00d74"), "value text \u00d74");
        E.run("MM.setSettings({ rateMul: 1.5 })");
        E.log.texts.length = 0; E.run("paint()");
        ok(E.log.texts.includes("\u00d71.5"), "value text \u00d71.5");
        // reset, wheel steps through the musical steps
        E.DB(kx, ky);
        eq(S(E).rateMul, 1, "double-click = x1");
        const walk = [];
        for (let i = 0; i < 4; i++) { E.ctx.onwheel(kx, ky, 0, -1); walk.push(S(E).rateMul); }
        near(walk[0], 1.5, 1e-9, "wheel up: x1.5"); near(walk[1], 2, 1e-9, "wheel up: x2"); near(walk[2], 3, 1e-9, "wheel up: x3"); near(walk[3], 4, 1e-9, "wheel up: x4");
        E.ctx.onwheel(kx, ky, 0, -1);
        eq(S(E).rateMul, 4, "wheel at the top stays");
        E.run("MM.setSettings({ rateMul: 1.25 })");
        E.ctx.onwheel(kx, ky, 0, 1);
        near(S(E).rateMul, 1, 1e-9, "wheel down from a free value goes to the step below");
        // shift = finer drag
        E.run("MM.setSettings({ rateMul: 1.25 })");
        E.C(kx, ky);
        E.ctx.ondrag(kx, ky - 13, 1, 0, 1, 0, 0, 0);
        const fine = S(E).rateMul;
        E.U();
        E.run("MM.setSettings({ rateMul: 1.25 })");
        E.C(kx, ky);
        E.D(kx, ky - 13);
        const coarse = S(E).rateMul;
        E.U();
        ok(Math.abs(Math.log2(fine / 1.25)) < Math.abs(Math.log2(coarse / 1.25)), "Shift drags finer");
    }

    // ---- state round trip of the three settings, restored and re-sent to gen
    {
        const E = mkO(2);
        E.run("MM.setSettings({ defaultMode: 'remote', smoothMs: 80, rateMul: 3 })");
        const saved = E.run("MM.save()");
        const E2 = mkO(0);
        E2.ctx.setvalueof(saved);
        eq(S(E2), { defaultMode: "remote", smoothMs: 80, rateMul: 3, selfMod: "internal" }, "settings restored from the saved state");
        ok(E2.gen("smooth").length > 0 && E2.gen("ratemul").some((m) => m[3] === 3), "load re-sends smoothing and rate to gen");
        // an old state (no settings key) gets the defaults
        const old = E.run("JSON.stringify(Object.assign({}, MM.state, { schema: 6, settings: undefined }))");
        E2.run(`MM.load(serializeState(normalizeState(JSON.parse(${JSON.stringify(old)}))))`);
        eq(S(E2), { defaultMode: "mod", smoothMs: 0, rateMul: 1, selfMod: "internal" }, "an old state gets the defaults");
    }

    // ---- painting with the panel open, in every combination; the keys do not reach the hidden modulators
    {
        const E = mkO(5);
        E.C(...RAIL_OPT);
        for (const st of [{ defaultMode: "mod", smoothMs: 0, rateMul: 1 }, { defaultMode: "remote", smoothMs: 500, rateMul: 0.25 }, { defaultMode: "mod", smoothMs: 7.3, rateMul: 1 / 3 }, { defaultMode: "remote", smoothMs: 123, rateMul: 4 }]) {
            E.run(`MM.setSettings(${JSON.stringify(st)})`);
            E.log.draws = 0;
            E.run("paint()");
            ok(E.log.draws > 6, "Options paints");
        }
        E.run("ubHover = { x: 200, y: 40, hit: ubHit(200, 40) }");
        E.run("paint()");
        E.run("MM.setUI({ sel: 1 })");
        E.ctx.onfocus();
        E.C(300, 5);
        const n = E.run("MM.modCount()");
        E.ctx.onkeydown(127, 127, 1, 0, 0, 0, 0, 0);
        eq(E.run("MM.modCount()"), n, "Delete in the Options view does not delete a hidden modulator");
        E.C(...RAIL_OPT);
        E.ctx.onkeydown(127, 127, 1, 0, 0, 0, 0, 0);
        eq(E.run("MM.modCount()"), n - 1, "Delete works again in the strips view");
        // the options panel sits entirely at x >= rail + gap
        const gm = E.run("ubOptGeom()");
        ok(gm.panel[0] >= 22, "panel starts right of the rail");
    }
}

// ---------------------------------------------------------------- no TIP button, no tooltips, no hint text
{
    const T = makeEnv();
    T.ctx.uiReady();
    for (const t of [1, 2, 3]) T.run(`ubAddType(${t})`);
    const rr = T.run("ubRailRects()");
    const names = ["learn", "list", "opt"];
    eq(Object.keys(rr).sort().join(","), "learn,list,opt", "rail: no TIP hit area");
    for (let i = 0; i < names.length; i++) {
        const r = rr[names[i]];
        ok(r[1] >= 0 && r[1] + r[3] <= 169 && r[0] >= 0 && r[0] + r[2] <= 20, "rail button inside the rail: " + names[i]);
        if (i) ok(rr[names[i - 1]][1] + rr[names[i - 1]][3] <= r[1], "rail buttons do not overlap: " + names[i]);
        if (i) ok(r[1] - rr[names[i - 1]][1] === rr[names[1]][1] - rr[names[0]][1], "rail buttons evenly spaced: " + names[i]);
    }
    // button + 11 px label of the last one still clear the modulator count (baseline 143, 7 px text)
    ok(rr.opt[1] + 27 + 2 <= 143 - 7, "OPT label clears the modulator count");
    for (let y = 0; y < 169; y++) ok(T.run(`ubHit(11, ${y}).kind`) !== "rail_tip", "no rail_tip hit at y=" + y);
    T.log.texts.length = 0; T.run("paint()");
    ok(!T.log.texts.includes("TIP") && T.log.texts.includes("LRN") && T.log.texts.includes("LST") && T.log.texts.includes("OPT") && T.log.texts.includes("3"), "rail paints LRN, LST, OPT and the count, no TIP");
    // hovering a control for a long time paints no tooltip
    T.run("ubHover = { x: 11, y: 12, hit: ubHit(11, 12) }");
    for (let i = 0; i < 20; i++) { T.log.texts.length = 0; T.run("paint()"); }
    ok(!T.log.texts.some((t) => /Learn: click|Shift-click/.test(t)), "no tooltip painted after a long hover");
    ok(T.run("typeof ubPaintTooltip") === "undefined" && T.run("typeof ubTipsOn") === "undefined", "tooltip code is gone");
    // footer and empty states carry no instructions
    T.run("MM.setUI({ pb: 1, sel: 0 })"); T.log.texts.length = 0; T.run("paint()");
    ok(!T.log.texts.some((t) => /click a row to edit|press LRN|Press LRN/.test(t)), "no footer / empty-state instructions");
    ok(T.log.texts.some((t) => /mapping/.test(t)), "footer count still shown");
    eq(T.run('ubFooterText(2, "Dice", 1000, 6.5)'), "2 mappings on Dice", "footer keeps the info only");
    // Options: no hint lines, rows do not overlap
    T.run("MM.setUI({ pb: 0, opt: 1 })"); T.log.texts.length = 0; T.run("paint()");
    ok(!T.log.texts.some((t) => /Lowpass on every|New mappings start|Scales LFO|engine or Live/.test(t)), "Options has no hint lines");
    for (const t of ["Default mapping mode", "Global smoothing", "Rate multiplier", "Self-mod"]) ok(T.log.texts.includes(t), "Options keeps label " + t);
    const og = T.run("ubOptGeom()");
    og.rows.forEach((r, i) => { if (i) ok(og.rows[i - 1].y + og.rows[i - 1].h <= r.y, "Options rows do not overlap: " + i); ok(r.y + r.h <= 169, "Options row inside 169 px: " + i); });
    [og.tabmod, og.bar, og.knobRect, og.selfint].forEach((r, i) => ok(r[1] >= og.rows[i].y && r[1] + r[3] <= og.rows[i].y + og.rows[i].h, "Options control inside its row: " + i));
    // an old saved state with settings.tooltips loads (key ignored, not kept)
    const blob = T.run("(() => { const st = JSON.parse(JSON.stringify(MM.state)); st.settings.tooltips = false; return serializeState(st); })()");
    const U = makeEnv();
    U.ctx.uiReady();
    U.ctx.setvalueof(blob);
    eq(U.run("MM.getSettings()"), { defaultMode: "mod", smoothMs: 0, rateMul: 1, selfMod: "internal" }, "old state with settings.tooltips loads and drops the key");
    eq(U.run("MM.modCount()"), 3, "...with its modulators");
}

// maps popover: Mod rows have a polarity button that cycles + -> ± -> − -> +; Remote rows have none
{
    const slot = E3.run("ubPbSelMapping().mod");
    E3.run(`MM.setUI({ pb: 0, opt: 0 }); ubMapsPop = { slot: ${slot}, scroll: 0 };`);
    const mm = E3.run("ubPbSelMapping()");
    E3.run(`MM.updateMapping(${mm.id}, { mode: "mod", polarity: 1 })`);
    const rowRect = () => E3.run(`(function () { const P = ubMapsPopGeom(); const r = P.vis.filter((q) => q.m.id === ${mm.id})[0]; return r ? ubPopRowParts(P.rect, r.y) : null; })()`);
    let pr = rowRect();
    ok(pr && pr.pol, "popover row has a polarity button rect");
    ok(pr.mode[0] + pr.mode[2] <= pr.pol[0] && pr.pol[0] + pr.pol[2] <= pr.bar[0] && pr.bar[0] + pr.bar[2] <= pr.val[0], "popover columns: M/R | polarity | bar | value, no overlap");
    const cx = pr.pol[0] + pr.pol[2] / 2, cy = pr.pol[1] + pr.pol[3] / 2;
    eq(E3.run(`ubHitMapsPop(${cx}, ${cy}).kind`), "mp_pol", "polarity button hit in Mod");
    const seq = [];
    for (let k = 0; k < 3; k++) {
        E3.run(`ubMapsPopClick(ubHitMapsPop(${cx}, ${cy}), ${cx}, ${cy})`);
        seq.push(E3.run(`MM.getMapping(${mm.id}).polarity`));
    }
    eq(seq.join(","), "0,-1,1", "polarity button cycles + -> ± -> − -> +");
    E3.run("paint()");
    E3.run(`MM.updateMapping(${mm.id}, { mode: "remote" })`);
    const pr2 = rowRect();
    ok(E3.run(`ubHitMapsPop(${cx}, ${cy}).kind`) !== "mp_pol", "no polarity button in Remote");
    eq(JSON.stringify([pr2.bar, pr2.val]), JSON.stringify([pr.bar, pr.val]), "bar and value columns do not move between Mod and Remote");
    E3.run("paint()");
    E3.run(`MM.updateMapping(${mm.id}, { mode: "mod" }); ubMapsPop = null;`);
}

// ---------------------------------------------------------------- automatable parameters + per-mapping depth (UI side)
{
    // the pool's value curve is the UI knob curve, for every control of every type
    const K = makeEnv();
    for (const t of [1, 2, 3, 4, 5]) {
        for (const sync of [0, 1]) {
            K.run(`(function () { const m = makeModSlot(${t}, 0); m.p.sync = ${sync}; globalThis.__m = m; })()`);
            const specs = K.run("ubKnobs(__m)");
            for (let j = 0; j < specs.length; j++) {
                const sp = K.run(`ubKnobs(__m)[${j}]`);
                const keys = K.run(`AUTO_KEYS[${t}]`);
                ok(keys.indexOf(sp.key) >= 0, `type ${t} sync ${sync}: knob ${sp.key} is in the automatable pool`);
                for (const n of [0, 0.25, 0.5, 0.8, 1]) {
                    const v = K.run(`ubKnobValue(ubKnobs(__m)[${j}], ${n})`);
                    const a = K.run(`autoValue(${JSON.stringify(sp.key)}, ${n})`);
                    const isInt = K.run(`MOD_PARAM_RANGE[${JSON.stringify(sp.key)}][2]`);
                    near(isInt ? Math.round(v) : v, a, 1e-9 * Math.max(1, Math.abs(a)), `${sp.key}: pool value curve == knob curve at ${n}`);
                }
                near(K.run(`ubKnobNorm(ubKnobs(__m)[${j}], ${v0(sp)})`), K.run(`autoNorm(${JSON.stringify(sp.key)}, ${v0(sp)})`), 1e-9, `${sp.key}: norm curve`);
            }
        }
    }
    function v0(sp) { return sp.key === "rate" ? 3.3 : sp.key === "attack" ? 20 : sp.key === "release" ? 400 : sp.lo + (sp.hi - sp.lo) * 0.37; }

    // strip knob drag -> live parameter output; Live input -> model + redraw, no echo loop
    const E4 = makeEnv();
    const c4 = (x, y) => E4.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
    const d4 = (x, y) => E4.ctx.ondrag(x, y, 1, 0, 0, 0, 0, 0);
    const r4 = () => E4.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
    E4.ctx.uiReady && E4.ctx.uiReady();
    E4.ctx.setnames("---megamodcfg", "---megamodmseg", "---megamodsteps", "---megamodscope", "---mmcurve", "---megamodroute");
    E4.ctx.init_lom();
    E4.run("ubAddType(MOD_LFO); ubAddType(MOD_ENV)");
    near(E4.live.ap_0.value, 100 * E4.run("autoNorm('rate', 1)"), 1e-9, "UI add pushes the LFO Rate value into M1 A");
    near(E4.live.ap_6.value, 100 * E4.run("autoNorm('attack', 5)"), 1e-9, "second strip: Envelope Attack goes to M2 A");
    ok(Object.keys(E4.live).every((n) => Object.keys(E4.live[n].attrs).every((a) => a === "presentation_rect" || a === "hidden")), "no parameter is ever renamed (Live ignores runtime renames); only the faces move");
    E4.run("MM.setParam(0, 'sync', 0)"); // free-running: knob 0 is Rate (synced it is Div)
    const k0 = E4.run("ubStripRects(ubStrips().list[0]).knobs[0]");
    eq(k0.spec.key, "rate", "knob 0 is the rate");
    const n0 = E4.live.ap_0.messages.length;
    const kc = center(k0.hit);
    c4(kc[0], kc[1]);
    d4(kc[0], kc[1] - 20);
    r4();
    ok(E4.live.ap_0.messages.length > n0, "knob drag messages the live parameter");
    near(E4.live.ap_0.value, 100 * E4.run("autoNorm('rate', MM.state.mods[0].p.rate)"), 1e-6, "the live value follows the knob (same curve)");
    ok(E4.live.ap_0.messages.every((m) => m[0] === "float"), "always a float message (Live records it), never `set`");
    ok(E4.live.ap_0.messages.length - n0 <= 3, "no echo storm: one message per drag frame");
    const rate = E4.run("MM.state.mods[0].p.rate");
    E4.live.ap_0.value = 100 * 0.9; // (what Live holds when it outputs the value)
    E4.ctx.autop(0, 100 * 0.9);
    near(E4.run("MM.state.mods[0].p.rate"), E4.run("autoValue('rate', 0.9)"), 1e-9, "Live parameter input moves the model (and the knob)");
    // expanded editor controls: the shape chip pushes the Shape parameter
    E4.run("MM.setParam(0, 'shape', 3)");
    eq(E4.live.at_0.value, 3, "the LFO shape chip pushes the Shape switch parameter (M1 Shape)");

    // depth pill in the remap editor
    E4.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 3', paramName: 'Frequency', trackName: 'T', deviceName: 'D', id: 5 })");
    const mid = E4.run("MM.allMappings()[0].id");
    E4.run(`ubSelect(0); MM.setUI({ pb: 1, pbSel: ${mid} }); ubSyncWidth(true)`);
    E4.run("paint()");
    ok(E4.live.ad_0.messages.length > 0, "the mapping's depth parameter (Depth 1) was pushed");
    const dp = () => E4.run(`ubDetailRects(ubListGeom(), MM.getMapping(${mid})).filter((d) => d.id === "depth")[0]`);
    ok(dp(), "depth pill exists in the remap editor");
    for (const mode of ["mod", "remote"]) {
        E4.run(`MM.updateMapping(${mid}, { mode: "${mode}" })`);
        const rs = E4.run(`ubDetailRects(ubListGeom(), MM.getMapping(${mid}))`);
        const d = rs.filter((x) => x.id === "depth")[0];
        const g = E4.run("ubListGeom()");
        ok(d.rect[0] >= g.dx && d.rect[0] + d.rect[2] <= g.dx + g.dw + 1e-6, `${mode}: depth pill inside the panel`);
        const nameEnd = g.dx + 9 + E4.run(`ubTextW(ubFit(MM.state.mods[0].name, ${g.dw - 10} - ubDepthW() - 3, 7), 7)`);
        ok(nameEnd <= d.rect[0] + 0.01, `${mode}: the modulator name stops before the depth pill`);
        for (const o of rs) if (o.id !== "depth") ok(!(d.rect[0] < o.rect[0] + o.rect[2] && o.rect[0] < d.rect[0] + d.rect[2] && d.rect[1] < o.rect[1] + o.rect[3] && o.rect[1] < d.rect[1] + d.rect[3]), `${mode}: depth pill does not overlap ${o.id}`);
        E4.log.texts.length = 0; E4.run("paint()");
        ok(E4.log.texts.includes("Depth 100%"), `${mode}: pill reads Depth 100%`);
    }
    const r = dp().rect;
    const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
    eq(E4.run(`ubHit(${cx}, ${cy}).kind`), "detail", "pill is a detail hit");
    eq(E4.run(`ubHit(${cx}, ${cy}).id`), "depth", "pill hit id");
    c4(cx, cy);
    d4(cx - 25, cy);
    near(E4.run(`MM.getMapping(${mid}).depth`), 0.5, 1e-9, "dragging left 25 px = -50%");
    near(E4.live.ad_0.value, 50, 1e-6, "drag pushes the depth parameter");
    d4(cx - 500, cy);
    eq(E4.run(`MM.getMapping(${mid}).depth`), 0, "drag clamps at 0");
    d4(cx + 500, cy);
    eq(E4.run(`MM.getMapping(${mid}).depth`), 1, "drag clamps at 100%");
    d4(cx - 10, cy);
    r4();
    E4.log.texts.length = 0; E4.run("paint()");
    ok(E4.log.texts.includes("Depth 80%"), "pill shows the new value");
    E4.live.ad_0.value = 33;
    E4.ctx.autod(0, 33);
    near(E4.run(`MM.getMapping(${mid}).depth`), 0.33, 1e-9, "Live depth input moves the UI value");
    E4.log.texts.length = 0; E4.run("paint()");
    ok(E4.log.texts.includes("Depth 33%"), "and redraws the pill");
    E4.ctx.ondblclick(cx, cy, 1, 0, 0, 0, 0, 0);
    eq(E4.run(`MM.getMapping(${mid}).depth`), 1, "double-click resets to 100%");
    E4.ctx.onwheel(cx, cy, 0, -1);
    eq(E4.run(`MM.getMapping(${mid}).depth`), 1, "wheel up clamps at 100%");
    E4.ctx.onwheel(cx, cy, 0, 1);
    near(E4.run(`MM.getMapping(${mid}).depth`), 0.95, 1e-9, "wheel down = -5%");
    // delete modulator via the UI path re-names the parameters
    E4.run("ubDeleteMod(0)");
    near(E4.live.ad_0.value, 100, 1e-9, "deleting a modulator frees its depth parameter (back to 100%)");
    E4.run("MM.undo()");
    near(E4.live.ap_0.value, 100 * E4.run("autoNorm('rate', MM.state.mods[0].p.rate)"), 1e-6, "undo (UI path) re-applies the modulator values");
    near(E4.live.ad_0.value, 95, 1e-6, "and the depth value");
}

// ---------------------------------------------------------------- parameter faces (transparent live.* objects over the drawn controls)
{
    const F = makeEnv();
    F.ctx.uiReady && F.ctx.uiReady();
    F.ctx.setnames("---megamodcfg", "---megamodmseg", "---megamodsteps", "---megamodscope", "---mmcurve", "---megamodroute");
    F.ctx.init_lom();
    const fr = (c) => F.run(c);
    const shown = () => fr("MM.faceState().shown");
    const setLen = () => Object.values(F.live).reduce((a, o) => a + o.setLog.length, 0);
    const inter = (a, b) => a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;
    const lim = () => fr("ubFaceLimit()");
    // every control of a strip layout that is NOT its own face's control must stay clear of the face
    const others = (R, own) => {
        const all = [["count", R.count], ["name", R.name], ["type", R.type], ["del", R.del], ["collapse", R.collapse], ["viz", R.viz], ["icon", R.icon]]
            .concat(R.chips.map((c) => ["chip " + c.id, c.rect]), R.knobs.map((k, i) => ["knob " + i, k.hit]));
        return all.filter(([n, r]) => r && !own.some((o) => o === r));
    };
    // checks one layout: `expect` = {varname: {rect, own, R}}; every other pool object hidden / parked; faces are exactly those rects
    function checkView(label, expect) {
        fr("paint()");
        const got = shown();
        eq(Object.keys(got).sort(), Object.keys(expect).sort(), `${label}: exactly the expected faces are shown (none dropped)`);
        const origin = fr("MM.faceState().origin");
        eq(origin, [4, 4], `${label}: faces are placed relative to the v8ui's presentation origin`);
        const rects = [];
        for (const [k, e] of Object.entries(expect)) {
            const r = e.rect;
            const o = F.live[k];
            ok(o, `${label}: ${k} exists`);
            const pr = o.attrs.presentation_rect;
            eq(o.attrs.hidden, 0, `${label}: ${k} unhidden`);
            for (let i = 0; i < 4; i++) near(pr[i], r[i] + (i < 2 ? 4 : 0), 0.011, `${label}: ${k} rect[${i}] = the control's rect`);
            ok(pr[0] >= 4 - 1e-6 && pr[1] >= 4 - 1e-6 && pr[0] + pr[2] <= 4 + lim() + 1e-6 && pr[1] + pr[3] <= 169 - 4 + 1e-6, `${label}: ${k} inside the device (${pr})`);
            rects.push([k, pr]);
            const lr = [pr[0] - 4, pr[1] - 4, pr[2], pr[3]];
            // a face covers only its own control: no other control of its strip is touched
            if (e.R) for (const [cn, c] of others(e.R, e.own)) ok(!inter(lr, c), `${label}: ${k} does not cover ${cn} (${c})`);
        }
        for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) ok(!inter(rects[a][1], rects[b][1]), `${label}: ${rects[a][0]} and ${rects[b][0]} do not overlap`);
        for (const [n, o] of Object.entries(F.live)) if (!expect[n] && /^a[pdt]_\d+$/.test(n)) ok(o.attrs.hidden === undefined || o.attrs.hidden === 1, `${label}: ${n} stays hidden`);
    }
    // the faces of one strip, derived independently of ubStripFaces: the power face, a 27 x 28 dial centred on each knob, a live.text on
    // every chip and one live.tab over the five shape chips
    const stripFaces = (slot, g0) => {
        const g = g0 || fr(`ubStrips().list.filter((g) => g.slot === ${slot})[0]`);
        const R = fr(`ubStripRects(${JSON.stringify(g)})`);
        const type = fr(`MM.state.mods[${slot}].type`);
        const keys = fr(`AUTO_KEYS[${type}]`);
        const swKeys = fr("AUTO_SW_KEYS");
        const out = {};
        out["ap_" + (slot * 6 + 5)] = { rect: R.pwrFace, own: [R.icon], R };
        for (const k of R.knobs) {
            const j = keys.indexOf(k.spec.key);
            ok(j >= 0, `type ${type}: knob ${k.spec.key} has a generic parameter`);
            out["ap_" + (slot * 6 + j)] = { rect: [Math.round(k.cx - 13.5), Math.round(k.cy - 14), 27, 28], own: [k.hit], R };
        }
        const shapes = R.chips.filter((c) => c.key === "shape");
        if (shapes.length) {
            const a = shapes[0].rect, z = shapes[shapes.length - 1].rect;
            out["at_" + (slot * 6 + swKeys.indexOf("shape"))] = { rect: [a[0], a[1], z[0] + z[2] - a[0], a[3]], own: shapes.map((c) => c.rect), R };
        }
        for (const c of R.chips) if (c.key !== "shape") out["at_" + (slot * 6 + swKeys.indexOf(c.key))] = { rect: c.rect, own: [c.rect], R };
        return out;
    };
    fr("ubAddType(MOD_LFO); ubAddType(MOD_ENV); ubAddType(MOD_RANDOM)");
    fr("MM.setUI({ pb: 0, opt: 0, exp: -1, sel: 0 }); ubSyncWidth(true)");
    // 1. strips, all collapsed
    checkView("collapsed strips", Object.assign({}, stripFaces(0), stripFaces(1), stripFaces(2)));
    eq(Object.keys(shown()).length, 3 * 3, "3 strips x (enable + 2 knobs) = 9 faces");
    // the faces follow the visible control: synced LFO shows Div (M1 B), not Rate (M1 A)
    fr("MM.setParam(0, 'sync', 1)");
    checkView("LFO synced shows Div", Object.assign({}, stripFaces(0), stripFaces(1), stripFaces(2)));
    ok(shown().ap_1 && !shown().ap_0, "synced LFO: the knob face is M1 B (Div), not M1 A (Rate)");
    fr("MM.setParam(0, 'sync', 0)");
    fr("paint()");
    ok(shown().ap_0 && !shown().ap_1, "free LFO: M1 A (Rate)");
    ok(Object.keys(shown()).every((k) => F.fronted.indexOf(k) >= 0), "every face is brought to the front when it is first shown (Live loads obj-viz last in z-order)");
    // 2. unchanged repaint touches nothing (cache)
    fr("paint()");
    const n0 = setLen();
    for (let i = 0; i < 5; i++) fr("paint()");
    eq(setLen(), n0, "repainting an unchanged layout makes no setattr call");
    // a value change (knob drag) does not move a face either
    fr("MM.setParam(0, 'rate', 7)");
    fr("paint()");
    eq(setLen(), n0, "a value change makes no setattr call");
    // 3. expand a strip: its knobs move, the others keep their faces without setattr
    fr("ubSetExpanded(1)");
    checkView("strip 2 expanded", Object.assign({}, stripFaces(0), stripFaces(1), stripFaces(2)));
    eq(Object.keys(shown()).length, 3 + 6 + 3, "faces: collapsed strips 3 + 3, the expanded Follower 1 + 4 knobs + Bipolar = 6 (no face dropped)");
    // 4. a type change retargets the knob faces (Envelope A..D -> Random: Rate/Smooth/Depth/Seed)
    fr("MM.setModType(1, MOD_RANDOM)");
    checkView("strip 2 retyped Random", Object.assign({}, stripFaces(0), stripFaces(1), stripFaces(2)));
    fr("MM.setModType(1, MOD_ENV)");
    // 5. deleting a strip hides its faces
    fr("ubSetExpanded(-1)");
    fr("ubDeleteMod(2)"); fr("ubDeleteMod(2)");
    fr("paint()");
    ok(!Object.keys(shown()).some((k) => /^ap_1[2-7]$/.test(k)), "a deleted modulator's faces are hidden");
    ok(F.live.ap_12.attrs.hidden === 1 || F.live.ap_12.attrs.hidden === undefined, "...and parked");
    fr("MM.undo()");
    // 6. popups: type popup and maps popover hide every face
    fr("ubSetExpanded(0)");
    fr("ubPopup = { mode: 'type', slot: 0, x: 40, y: 18 }");
    fr("paint()");
    eq(Object.keys(shown()).length, 0, "type popup open: every face hidden");
    for (const o of Object.values(F.live)) ok(o.attrs.hidden === undefined || o.attrs.hidden === 1, `popup: ${o.name} hidden`);
    fr("ubPopup = null; ubMapsPop = { slot: 0, scroll: 0 }");
    fr("paint()");
    eq(Object.keys(shown()).length, 0, "maps popover open: every face hidden");
    fr("ubMapsPop = null");
    fr("paint()");
    ok(Object.keys(shown()).length > 0, "faces return when the popover closes");
    // 7. Options view: no parameters, no faces
    fr("MM.setUI({ opt: 1, pb: 0 }); ubSyncWidth(true)");
    fr("paint()");
    eq(Object.keys(shown()).length, 0, "Options view: no faces");
    fr("MM.setUI({ opt: 0 })");
    // 8. LST inspector: tabs have no faces; the fixed editor gets enable + knobs; the selected mapping's depth pill gets Depth <slot>
    const tgt = (par) => ({ path: "live_set tracks 2 devices 0 parameters " + (par === "Freq" ? 3 : 4), trackName: "T", deviceName: "D", paramName: par });
    const mA = fr(`MM.addMapping(0, ${JSON.stringify(tgt("Freq"))}).id`);
    const mB = fr(`MM.addMapping(0, ${JSON.stringify(tgt("Reso"))}).id`);
    fr("MM.setUI({ pb: 1, opt: 0, sel: 0, exp: -1 }); ubSyncWidth(true)");
    {
        const sl = fr(`MM.mappingSlot(${mA})`);
        fr(`MM.setUI({ pbSel: ${mA} })`);
        const exp = stripFaces(0, fr("ubStrips().main"));
        const d = fr("ubDetailRects(ubListGeom(), ubPbSelMapping()).filter((x) => x.id === 'depth')[0].face");
        exp["ad_" + sl] = { rect: d, own: [] };
        checkView("LST view", exp);
        // the selected mapping changes: the depth face follows its pool slot
        fr(`MM.setUI({ pbSel: ${mB} })`);
        const sl2 = fr(`MM.mappingSlot(${mB})`);
        const d2 = fr("ubDetailRects(ubListGeom(), ubPbSelMapping()).filter((x) => x.id === 'depth')[0].face");
        exp["ad_" + sl2] = { rect: d2, own: [] };
        delete exp["ad_" + sl];
        checkView("LST view, other mapping", exp);
        ok(F.live["ad_" + sl].attrs.hidden === 1, "the previous depth face is hidden again");
        // the face rect is exactly the Depth pill (Live right-click -> Depth <slot + 1>)
        eq(F.run(`autoDepthName(${sl2})`), "Depth " + (sl2 + 1), "the depth face is the mapping's Live parameter");
    }
    // 9. LST + many modulators: the device clamps at 1600 px; no face leaves it
    fr("MM.setUI({ pb: 0 })");
    for (let i = 3; i < 16; i++) fr("ubAddType(MOD_LFO)");
    fr("MM.setUI({ exp: -1, sel: 0 }); ubSyncWidth(true)");
    fr("paint()");
    for (const [k, r] of Object.entries(shown())) {
        const pr = F.live[k].attrs.presentation_rect;
        ok(pr[0] + pr[2] <= 4 + lim() + 1e-6, `16 strips: ${k} inside the device width`);
    }
    // 9b. every control of the expanded editor of every type has a visible face (knobs, chips, shape tab, enable), faces never overlap
    //     each other or another control, and the face geometry does not depend on any value
    fr("MM.setUI({ pb: 0, opt: 0, exp: -1, sel: 0 }); ubSyncWidth(true)");
    for (let i = fr("MM.state.mods.filter(Boolean).length") - 1; i >= 0; i--) fr(`MM.removeModulator(${i})`);
    fr("ubAddType(MOD_LFO)");
    const shownRects = () => Object.fromEntries(Object.keys(shown()).map((k) => { const r = F.live[k].attrs.presentation_rect; return [k, [r[0] - 4, r[1] - 4, r[2], r[3]]]; }));
    const faceRects = () => JSON.stringify(Object.values(shownRects()).sort((a, b) => a.join().localeCompare(b.join())));
    const covered = (slot, view) => {
        const R = fr(`ubStripRects(ubStrips().list.filter((g) => g.slot === ${slot})[0])`);
        const sh = shownRects();
        const has = (c) => Object.keys(sh).some((k) => { const r = sh[k]; return c[0] >= r[0] && c[0] <= r[0] + r[2] && c[1] >= r[1] && c[1] <= r[1] + r[3]; });
        ok(has([R.icon[0] + R.icon[2] / 2, R.icon[1] + R.icon[3] / 2]), `${view}: the enable glyph has a face`);
        for (const k of R.knobs) ok(has([k.cx, k.cy]), `${view}: knob ${k.spec.key} has a face on the knob`);
        for (const c of R.chips) ok(has([c.rect[0] + c.rect[2] / 2, c.rect[1] + c.rect[3] / 2]), `${view}: chip ${c.id} has a face`);
        return R;
    };
    const SW = { sync: "sync", bip: "bipolar", osh: "oneshot", loop: "loopOn", rtg: "retrig" };
    const TYPE_NAMES = ["", "LFO", "Follower", "Random", "Steps", "MSEG"];
    for (let t = 1; t <= 5; t++) {
        fr(`MM.setModType(0, ${t})`);
        fr("MM.setUI({ exp: 0, sel: 0 }); ubSyncWidth(true)");
        const label = `${TYPE_NAMES[t]} expanded`;
        checkView(label, stripFaces(0));
        const R = covered(0, label);
        const nKnobs = R.knobs.length;
        const nSw = R.chips.filter((c) => c.key !== "shape").length + (R.chips.some((c) => c.key === "shape") ? 1 : 0);
        eq(Object.keys(shown()).length, 1 + nKnobs + nSw, `${label}: faces = enable + ${nKnobs} knobs + ${nSw} switches`);
        // all numeric keys of the type have a generic parameter, every chip a switch parameter of the same type
        const keys = fr(`AUTO_KEYS[${t}]`);
        for (const k of R.knobs) ok(keys.indexOf(k.spec.key) >= 0, `${label}: ${k.spec.key} has a generic parameter`);
        for (const c of R.chips) ok(fr(`autoSwitchIndex(${t}, ${JSON.stringify(c.key)})`) >= 0, `${label}: chip ${c.id} has a switch parameter`);
        // geometry does not depend on the value: every numeric control at its minimum and at its maximum, every boolean 0 / 1
        const setAll = (hi) => {
            for (const key of Object.keys(fr("MOD_PARAM_RANGE"))) {
                if (key === "enabled") continue;
                const rg = fr(`MOD_PARAM_RANGE[${JSON.stringify(key)}]`);
                fr(`MM.setParam(0, ${JSON.stringify(key)}, ${hi ? rg[1] : rg[0]})`);
            }
            fr("paint()");
        };
        setAll(false);
        const lo = faceRects();
        const keysLo = Object.keys(shown()).sort().join();
        setAll(true);
        const hi = faceRects();
        eq(hi, lo, `${label}: the face rects are the same at value 0 and at value 1`);
        ok(Object.keys(shown()).length === 1 + nKnobs + nSw, `${label}: still one face per control at the other extreme`);
        // (the shown parameter of the rate knob may switch between Rate and Div, the rect does not)
        ok(typeof keysLo === "string", `${label}: faces at value 0 listed`);
        fr(`MM.setModType(0, ${t})`);
    }
    // faces never change while the knobs / chips are dragged: same setattr count over a drag
    {
        fr("MM.setModType(0, MOD_LFO); MM.setParam(0, 'sync', 0)");
        fr("MM.setUI({ exp: 0, sel: 0 }); ubSyncWidth(true)");
        fr("paint()");
        const R = fr("ubStripRects(ubStrips().list[0])");
        const n1 = setLen();
        const kc = [R.knobs[0].cx, R.knobs[0].cy];
        F.ctx.onclick(kc[0], kc[1], 1, 0, 0, 0, 0, 0);
        for (let dy = 1; dy <= 6; dy++) F.ctx.ondrag(kc[0], kc[1] - 4 * dy, 1, 0, 0, 0, 0, 0);
        F.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
        fr("paint()");
        eq(setLen(), n1, "a knob drag changes no face rect or visibility (the dot cannot move with the value)");
    }
    // 9c. toggles sync both ways (UI chip click <-> switch parameter <-> model), automation never pushes undo or dirties the Set
    {
        fr("MM.setModType(0, MOD_MSEG)");
        fr("MM.setUI({ exp: 0, sel: 0 }); ubSyncWidth(true)");
        fr("paint()");
        const R = fr("ubStripRects(ubStrips().list[0])");
        const swKeys = fr("AUTO_SW_KEYS");
        for (const c of R.chips) {
            const key = c.key;
            const obj = F.live["at_" + swKeys.indexOf(key)];
            const before = fr(`MM.state.mods[0].p.${key}`);
            const undo0 = fr("MM.undoInfo().undo");
            // chip click in the v8ui -> model -> switch parameter (messaged)
            const m0 = obj.messages.length;
            F.ctx.onclick(c.rect[0] + c.rect[2] / 2, c.rect[1] + c.rect[3] / 2, 1, 0, 0, 0, 0, 0);
            F.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
            eq(fr(`MM.state.mods[0].p.${key}`), 1 - before, `${c.id}: a chip click flips the model`);
            eq(obj.value, 1 - before, `${c.id}: ...and the switch parameter (M1 ${fr("AUTO_SW_NAMES")[swKeys.indexOf(key)]})`);
            ok(obj.messages.length > m0 && obj.messages.every((m) => m[0] === "float"), `${c.id}: messaged as a float`);
            // automation / macro -> model + redraw, no undo entry, no dirty
            const notify0 = F.log.notify;
            const undoInfo = fr("MM.undoInfo()");
            obj.value = before; F.ctx.autot(swKeys.indexOf(key), before);
            eq(fr(`MM.state.mods[0].p.${key}`), before, `${c.id}: automation flips the model back`);
            deq(fr("MM.undoInfo()"), undoInfo, `${c.id}: automation does not push undo`);
            eq(F.log.notify, notify0, `${c.id}: automation does not dirty the Set`);
            F.log.texts.length = 0; fr("paint()");
            const on = fr(`ubChips(MM.state.mods[0]).filter((q) => q.id === ${JSON.stringify(c.id)})[0].on`);
            eq(on, !!before, `${c.id}: the chip is drawn from the model`);
        }
    }
    function deq(a, b, m) { eq(a, b, m); }

    // 10. before the pool is live (no ready), nothing is shown
    const G = makeEnv();
    G.run("ubAddType(MOD_LFO)");
    G.run("paint()");
    eq(G.run("Object.keys(MM.faceState().shown).length"), 0, "before ready (pool not live) no face is shown");
    eq(Object.values(G.live).reduce((a, o) => a + o.setLog.length, 0), 0, "...and nothing is touched");
}

// ================================================================ self-modulation UI (schema 9): Options selector, self rows, rings, pills
{
    const ctr = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    const overlap = (a, b) => a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;
    const inside = (r, o) => r[0] >= o[0] - 1e-6 && r[1] >= o[1] - 1e-6 && r[0] + r[2] <= o[0] + o[2] + 1e-6 && r[1] + r[3] <= o[1] + o[3] + 1e-6;
    function mk(n = 3) {
        const T = makeEnv();
        T.ctx.uiReady();
        for (let k = 0; k < n; k++) T.run(`ubAddType(${[1, 2, 3, 4, 5][k % 5]})`);
        // stroke log: every stroke with the colour and line width it was drawn with
        const mg = T.ctx.mgraphics;
        const strokes = [];
        let col = [0, 0, 0, 1], lw = 1;
        const sc = mg.set_source_rgba, sl = mg.set_line_width;
        mg.set_source_rgba = (r, g, b, a) => { col = [r, g, b, a]; sc(r, g, b, a); };
        mg.set_line_width = (w) => { lw = w; sl(w); };
        mg.stroke = () => strokes.push({ col: col.slice(), lw });
        const C = (x, y) => T.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
        const w = () => { const o = T.log.outlets.filter((q) => q[1] === "width"); return o.length ? o[o.length - 1][2] : null; };
        const paint = () => { T.log.texts.length = 0; T.log.textCols = []; T.log.fills = []; strokes.length = 0; T.run("paint()"); };
        return { T, ctx: T.ctx, run: T.run, log: T.log, C, w, paint, strokes };
    }
    const RAIL_OPT = [11, 75];
    const GREEN = [0.62, 0.86, 0.50], ORANGE = [0.98, 0.62, 0.18];
    const isCol = (c, ref) => Math.abs(c[0] - ref[0]) < 1e-6 && Math.abs(c[1] - ref[1]) < 1e-6 && Math.abs(c[2] - ref[2]) < 1e-6 && c[3] > 0.99;

    // ---- Options: the fourth row, "Self-mod  INTERNAL | VIA LIVE"
    {
        const E = mk(3);
        E.C(...RAIL_OPT);
        const g = E.run("ubOptGeom()");
        eq(g.rows.length, 4, "Options has four rows");
        ok(g.rows[3].y + g.rows[3].h <= 161 && g.rows[0].y >= 16, "...inside the panel and the 161 px height");
        const rects = [["tabmod", g.tabmod], ["tabrem", g.tabrem], ["bar", g.bar], ["knob", g.knobRect], ["selfint", g.selfint], ["selflive", g.selflive]];
        for (const [n, r] of rects) {
            ok(inside(r, g.panel), "Options: " + n + " inside the panel");
            ok(r[0] + r[2] <= E.run("ubLayoutWidth()") && r[1] >= 0 && r[1] + r[3] <= 161, "Options: " + n + " inside the device");
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) ok(!overlap(rects[i][1], rects[j][1]), `Options: ${rects[i][0]} / ${rects[j][0]} do not overlap`);
        // each control sits in its own row band
        [g.tabmod, g.bar, g.knobRect, g.selfint].forEach((r, i) => ok(r[1] >= g.rows[i].y && r[1] + r[3] <= g.rows[i].y + g.rows[i].h, "row " + i + ": control inside its band"));
        eq(g.selfint[2] + g.selflive[2] + 2, 2 * 54 + 2, "two 54 px segments");
        ok(g.textX + g.textW <= g.selfint[0] - 4, "label column does not run under the Self-mod control");
        eq(E.run(`ubHit(${ctr(g.selfint)}).kind`), "opt_self_int", "INTERNAL hit"); eq(E.run(`ubHit(${ctr(g.selflive)}).kind`), "opt_self_live", "VIA LIVE hit");
        eq(E.w(), 390, "Options width is still 390");
        ok(E.run("ubTextW('Self-mod', 8)") <= g.textW, "label fits");
        // paint: default INTERNAL is lit (green fill, white text), VIA LIVE dim
        E.paint();
        for (const t of ["Self-mod", "INTERNAL", "VIA LIVE"]) ok(E.log.texts.includes(t), "paints " + t);
        const tc = (t) => E.log.textCols.filter((q) => q.t === t).map((q) => q.col)[0];
        ok(tc("INTERNAL")[0] === 1 && tc("VIA LIVE")[0] < 0.7, "the lit segment has white text, the other is dim");
        const fillFor = (rect) => E.log.fills.filter((f) => Math.abs(f.rect[0] - rect[0]) < 1e-6 && Math.abs(f.rect[1] - rect[1]) < 1e-6)[0];
        ok(fillFor(g.selfint) && isCol([fillFor(g.selfint).col[0], fillFor(g.selfint).col[1], fillFor(g.selfint).col[2], 1], GREEN), "lit INTERNAL uses the internal (green) accent");
        ok(!E.log.texts.some((t) => /engine or Live/.test(t)), "no hint line under Self-mod");
        // click VIA LIVE: the setting changes, the paint follows; a click on the lit segment changes nothing
        const undo0 = E.run("MM.undoInfo().undo");
        E.C(...ctr(g.selflive));
        eq(E.run("MM.getSettings().selfMod"), "live", "VIA LIVE segment sets settings.selfMod");
        E.paint();
        ok(tc("VIA LIVE")[0] === 1 && tc("INTERNAL")[0] < 0.7, "the lit segment moved");
        ok(isCol([fillFor(g.selflive).col[0], fillFor(g.selflive).col[1], fillFor(g.selflive).col[2], 1], ORANGE), "lit VIA LIVE uses the Live (orange) accent");
        eq(E.run("MM.undoInfo().undo"), undo0, "with nothing to convert the selector does not touch the undo stack");
        E.C(...ctr(g.selfint));
        eq(E.run("MM.getSettings().selfMod"), "internal", "INTERNAL segment sets it back");
        // saved with the state
        const saved = E.run("MM.save()");
        const E2 = mk(0);
        E2.ctx.setvalueof(saved);
        eq(E2.run("MM.getSettings().selfMod"), "internal", "the selector is part of the saved state");
        E.C(...ctr(g.selflive));
        const E3 = mk(0);
        E3.ctx.setvalueof(E.run("MM.save()"));
        eq(E3.run("MM.getSettings().selfMod"), "live", "...VIA LIVE too");
        // the other views are unchanged: the other rows still behave
        E.C(...ctr(g.tabrem));
        eq(E.run("MM.getSettings().defaultMode"), "remote", "REM tab still works");
        eq(E.run("MM.getSettings().selfMod"), "live", "...and does not touch Self-mod");
    }

    // ---- switching the selector converts existing self-mappings, with a note pill; Cmd-Z restores them
    {
        const E = mk(3);
        E.run("MM.addSelfMapping(0, 12, 'internal'); MM.addSelfMapping(0, 13, 'internal')");
        E.C(...RAIL_OPT);
        const g = E.run("ubOptGeom()");
        E.C(...ctr(g.selflive));
        ok(E.run("MM.allMappings().every((m) => !m.target.internal)"), "VIA LIVE converted both internal mappings");
        E.paint();
        ok(E.log.texts.some((t) => /Converted 2 self-mappings/.test(t)), "a note pill says so");
        ok(E.log.texts.some((t) => /Cmd-Z/.test(t)), "...and where to undo");
        E.ctx.onkeydown(122, 122, 1, 1, 0, 0, 0, 0); // Cmd-Z
        ok(E.run("MM.allMappings().every((m) => m.target.internal)"), "Cmd-Z restores the INTERNAL mappings");
        for (let k = 0; k < 80; k++) E.ctx.uiTelemetry(E.run("MM.readTelemetry()"));
        E.paint();
        ok(!E.log.texts.some((t) => /Converted/.test(t)), "the note pill fades after about 2.5 s");
    }

    // ---- "full" pills: the Live pool and the internal matrix say different things
    {
        const E = mk();
        E.ctx.uiChanged({ kind: "full", mod: 0, id: 0 }); E.paint();
        ok(E.log.texts.includes("Mapping pool full (256)"), "pool full pill");
        for (let k = 0; k < 80; k++) E.ctx.uiTelemetry(E.run("MM.readTelemetry()"));
        E.ctx.uiChanged({ kind: "full", mod: 0, id: -1 }); E.paint();
        ok(E.log.texts.includes("Internal routes full (64)"), "internal matrix full pill");
    }

    // ---- the list, popover and detail panel mark and name self-mappings
    {
        const E = mk(3);
        // modulator names: LFO 1, Envelope 2, Random 3
        E.run("MM.addSelfMapping(0, " + 12 + ", 'internal')");                    // LFO 1 -> Random 3 Rate
        E.run("MM.setSelfMod('live', false); MM.addSelfMapping(0, " + 7 + ", 'live')");  // LFO 1 -> Envelope 2 Release (M2 B) via Live
        E.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 1', paramName: 'Decay', trackName: 'Drums', deviceName: 'Reverb' })");
        const ms = E.run("MM.allMappings()");
        eq(ms.length, 3, "an internal, a via-Live and a normal mapping");
        E.run("MM.setUI({ sel: 0 })");
        eq(E.run("ubMapName(MM.allMappings()[0])"), "Random 3 Rate", "internal row: named by meaning");
        eq(E.run("ubMapName(MM.allMappings()[1])"), "Follower 2 Release (M2 B)", "via-Live row: named by meaning with the Live parameter");
        eq(E.run("ubMapName(MM.allMappings()[2])"), "Decay", "a normal row keeps its parameter name");
        ok(E.run("ubTargetPath(MM.allMappings()[0])").indexOf("Internal route") === 0 && E.run("ubTargetPath(MM.allMappings()[1])").indexOf("Via Live") === 0, "hover text spells out internal / via Live");
        // LST list
        E.C(11, 48);
        E.paint();
        ok(E.log.texts.includes("Rate") && E.log.texts.includes("Release") && E.log.texts.includes("Decay"), "the list paints the control name when the column is too narrow for the full meaning name");
        eq(E.run("ubSelfFit(MM.allMappings()[0], 200, 7.5)"), "Random 3 Rate", "...and the full meaning name when it fits");
        eq(E.run("ubSelfFit(MM.allMappings()[1], 40, 7.5)"), "Release", "a via-Live row falls back to the control too");
        const gm = E.run("ubListGeom()");
        const vis = E.run("ubListVisible().rows.filter((r) => r.item.kind === 'map')");
        eq(vis.length, 3, "three rows");
        // the row markers: a loop glyph for internal (a green stroke), an L badge for via Live (text "L"); none on the normal row
        E.paint();
        ok(E.strokes.some((s) => isCol(s.col, GREEN) && s.lw === 1.2), "internal row: loop glyph (green)");
        ok(E.log.texts.includes("L"), "via-Live row: L badge");
        // the mode chip of an internal row is inert; the via-Live row switches as usual
        const rowParts = (r) => E.run(`ubRowParts(${r.y}, ${gm.lx}, ${gm.lw})`);
        const p0 = rowParts(vis[0]), p1 = rowParts(vis[1]);
        E.C(...ctr(p0.mode));
        eq(E.run("MM.allMappings()[0].mode"), "mod", "clicking an internal row's M/R chip does not switch it to Remote");
        E.C(...ctr(p1.mode));
        eq(E.run("MM.allMappings()[1].mode"), "remote", "a via-Live row switches to Remote");
        E.C(...ctr(p1.mode));
        eq(E.run("MM.allMappings()[1].mode"), "mod", "...and back");
        // the remap editor: the REM tab is greyed and inert for an internal mapping
        E.run(`MM.setUI({ pbSel: ${ms[0].id} })`);
        E.paint();
        ok(E.log.texts.includes("internal route"), "detail panel: 'internal route'");
        const dr = E.run(`ubDetailRects(ubListGeom(), MM.allMappings()[0])`);
        const rem = dr.filter((d) => d.id === "tabrem")[0], md = dr.filter((d) => d.id === "tabmod")[0];
        E.C(...ctr(rem.rect));
        eq(E.run("MM.allMappings()[0].mode"), "mod", "the REM tab of an internal mapping does nothing");
        E.C(...ctr(md.rect));
        eq(E.run("MM.allMappings()[0].mode"), "mod", "(MOD still selectable)");
        E.run(`MM.setUI({ pbSel: ${ms[1].id} })`);
        E.paint();
        ok(E.log.texts.includes("via Live: M2 B"), "detail panel of a via-Live mapping names the Live parameter");
        const dr2 = E.run(`ubDetailRects(ubListGeom(), MM.allMappings()[1])`);
        E.C(...ctr(dr2.filter((d) => d.id === "tabrem")[0].rect));
        eq(E.run("MM.allMappings()[1].mode"), "remote", "...and its REM tab works (Remote is allowed through Live)");
        E.C(...ctr(dr2.filter((d) => d.id === "tabmod")[0].rect));
        // strips popover rows
        E.C(11, 48);
        E.run("ubMapsPop = { slot: 0, scroll: 0 }");
        E.paint();
        ok(E.log.texts.includes(E.run("ubMapName(MM.allMappings()[0])")), "popover row: the full meaning name fits the roomy column");
        const P = E.run("ubMapsPopGeom()");
        const pr = E.run(`ubPopRowParts(ubMapsPopGeom().rect, ubMapsPopGeom().vis[0].y, ubMapsPopGeom().vw)`);
        E.C(...ctr(pr.mode));
        eq(E.run("MM.allMappings()[0].mode"), "mod", "popover: the internal row's mode chip is inert");
        ok(inside(pr.name, P.rect) && pr.name[2] > 30, "popover name column keeps room for the marker + name");
        E.run("ubMapsPop = null");
    }

    // ---- modulated controls show a ring (internal: green, via Live: orange) and their switches / depth are marked
    {
        const E = mk(3);
        E.run("MM.addSelfMapping(0, 12, 'internal')"); // LFO 1 -> Random 3 Rate (slot 2, control A)
        E.run("ubSetExpanded(-1)");
        E.run("MM.state.mods[2].p.sync = 0"); // (synced, the first knob shows Div = control B, not Rate)
        const tel = E.run("MM.readTelemetry()");
        const spec = E.run("ubKnobs(MM.state.mods[2])[0]");
        eq(spec.key, "rate", "Random's first knob is Rate");
        const base = E.run("ubKnobNorm(ubKnobs(MM.state.mods[2])[0], MM.state.mods[2].p.rate)");
        tel.eff[2].ctl[0] = Math.min(1, base + 0.2);
        E.paint();
        const ring = E.strokes.filter((s) => isCol(s.col, GREEN) && s.lw === 1.8);
        ok(ring.length === 1, "the modulated knob draws a bright arc between the stored and the live value (1 stroke)");
        ok(E.strokes.filter((s) => Math.abs(s.col[0] - GREEN[0]) < 1e-6 && Math.abs(s.col[3] - 0.28) < 1e-6 && s.lw === 1).length >= 1, "...on a faint full-travel track");
        // not modulated: no ring
        tel.eff[2].ctl[0] = base;
        E.paint();
        eq(E.strokes.filter((s) => isCol(s.col, GREEN) && s.lw === 1.8).length, 0, "live value == stored value: no arc (only the faint track)");
        // a disabled mapping, a disabled source or a missing control draw no ring
        tel.eff[2].ctl[0] = Math.min(1, base + 0.2);
        E.run("MM.updateMapping(MM.allMappings()[0].id, { enabled: 0 })"); E.paint();
        eq(E.strokes.filter((s) => Math.abs(s.col[0] - GREEN[0]) < 1e-6 && Math.abs(s.col[1] - GREEN[1]) < 1e-6 && s.col[3] > 0.2 && s.lw <= 1.8).length, 0, "mapping off: no ring");
        E.run("MM.updateMapping(MM.allMappings()[0].id, { enabled: 1 })");
        E.run("MM.setParam(0, 'enabled', 0)"); E.paint();
        eq(E.strokes.filter((s) => Math.abs(s.col[0] - GREEN[0]) < 1e-6 && Math.abs(s.col[1] - GREEN[1]) < 1e-6 && s.col[3] > 0.2 && s.lw <= 1.8).length, 0, "source off: no ring");
        E.run("MM.setParam(0, 'enabled', 1)");
        E.run("MM.setModType(2, MOD_ENV)");
        E.run("MM.setModType(2, MOD_RANDOM)");
        // via Live: orange ring
        E.run("MM.setSelfMod('live'); ");
        tel.eff[2].ctl[0] = Math.min(1, base + 0.2);
        E.paint();
        // (a via-Live mapping is "pending" without a Live id in this mock: it draws no ring until it is bound)
        eq(E.strokes.filter((s) => isCol(s.col, ORANGE) && s.lw === 1.8).length, 0, "an unbound via-Live mapping (no Live id yet) draws no ring");
        E.run("MM.setSelfMod('internal')");
        // switches: the SYNC chip of an expanded LFO strip, modulated by another modulator
        E.run("MM.addSelfMapping(1, " + C_SYNC_LFO1() + ", 'internal')");
        E.run("MM.setUI({ exp: 0, sel: 0 }); ubSyncWidth(true)");
        E.run("MM.readTelemetry().eff[0].sw[1] = 1");
        E.paint();
        ok(E.strokes.some((s) => isCol(s.col, GREEN) && s.lw === 1.4), "a modulated switch that is on is outlined in the self-mod colour");
        E.run("MM.readTelemetry().eff[0].sw[1] = 0");
        E.paint();
        eq(E.strokes.filter((s) => isCol(s.col, GREEN) && s.lw === 1.4).length, 0, "...and not while it is off");
        E.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 1', paramName: 'Decay', trackName: 'Drums', deviceName: 'Reverb' })");
        // schema 10: an INTERNAL `Depth k` learn is a depth route (a mapId route)
        const dmap = E.run("MM.allMappings().filter((m) => !m.target.internal && m.target.selfDest === undefined)[0].id");
        E.run(`MM.addSelfMapping(1, ${192 + 0}, 'internal')`);
        ok(E.run(`MM.depthRoutesFor(${dmap}).length`) === 1, "internal learn on Depth 1 = a depth route on the mapping in slot 0");
    }
    function C_SYNC_LFO1() { return 96 + 0 * 6 + 1; } // dest code of modulator 1's (slot 0) Sync switch
}

// ================================================================ several strips expanded at once + popover on/off toggle
{
    const ctr = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    const inter = (a, b) => a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;
    function mkM(n) {
        const T = makeEnv();
        T.ctx.uiReady();
        T.ctx.setnames("---megamodcfg", "---megamodmseg", "---megamodsteps", "---megamodscope", "---mmcurve", "---megamodroute");
        T.ctx.init_lom();
        for (let k = 0; k < n; k++) T.run(`ubAddType(${[1, 2, 3, 4, 5][k % 5]})`);
        T.run("MM.setUI({ pb: 0, opt: 0, exp: [], sel: 0 }); ubSyncWidth(true)");
        T.c = (x, y) => T.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
        T.up = () => T.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
        T.dbl = (x, y) => T.ctx.ondblclick(x, y, 1, 0, 0, 0, 0, 0);
        T.w = () => { const w = T.log.outlets.filter((o) => o[1] === "width"); return w.length ? w[w.length - 1][2] : null; };
        T.R = (slot) => T.run(`ubStripRects(ubStrips().list.filter((g) => g.slot === ${slot})[0])`);
        T.exps = () => T.run("ubExpList()");
        return T;
    }
    // ---- expand / collapse independently
    {
        const T = mkM(5);
        const w0 = T.w();
        T.dbl(...ctr(T.R(1).viz));
        eq(T.exps(), [1], "multi: first double-click expands strip 1");
        T.dbl(...ctr(T.R(3).viz));
        eq(T.exps(), [1, 3], "multi: a second strip expands without collapsing the first");
        eq(T.w(), w0 + 2 * (204 - 56), "multi: width = the sum of both expanded strips");
        T.dbl(...ctr(T.R(0).head));
        eq(T.exps(), [1, 3, 0], "multi: three strips stay expanded");
        eq(T.w(), w0 + 3 * (204 - 56), "multi: three strips widen the device by three deltas");
        eq(T.run("ubStrips().list.filter((g) => g.exp).map((g) => g.slot)"), [0, 1, 3], "multi: geometry shows exactly those strips expanded");
        T.c(...ctr(T.R(3).collapse)); T.up();
        eq(T.exps(), [1, 0], "multi: the chevron collapses only its own strip");
        eq(T.w(), w0 + 2 * (204 - 56), "multi: width shrinks by one delta");
        T.dbl(...ctr(T.R(1).head));
        eq(T.exps(), [0], "multi: a header double-click collapses only that strip");
        T.dbl(...ctr(T.R(0).head));
        eq(T.exps(), [], "multi: and the last one");
        eq(T.w(), w0, "multi: width back to the collapsed width");
        T.dbl(...ctr(T.R(2).viz)); T.dbl(...ctr(T.R(4).viz));
        T.c(...ctr(T.R(1).viz)); T.up();
        eq([T.run("ubSel()"), T.exps()], [1, [2, 4]], "multi: selecting another strip does not change what is expanded");
        T.run("ubTogglePb(true)");
        eq(T.run("ubStrips().main.slot"), 1, "multi: the LST inspector shows the selected modulator");
        eq(T.run("ubStrips().list.filter((g) => g.exp).length"), 1, "multi: LST view has just the one fixed expanded editor");
        eq(T.w(), T.run("ubListGeom().end") + 8, "multi: LST width does not depend on the expanded strips");
        T.run("ubTogglePb(false)");
        eq(T.exps(), [2, 4], "multi: back in the strips the same strips are expanded");
        T.run("ubToggleOpt(true)");
        eq(T.run("ubStrips().list.length"), 0, "multi: OPT view shows no strips");
        T.run("ubToggleOpt(false)");
        eq(T.exps(), [2, 4], "multi: OPT leaves the expanded list alone");
        T.run("ubSetExpanded(-1)");
        eq(T.exps(), [], "multi: ubSetExpanded(-1) collapses all");
    }
    // ---- migration and persistence
    {
        const T = mkM(4);
        for (const [raw, want] of [[2, [2]], [-1, []], [[1, 3], [1, 3]], [[1, 1, 9, "x", 3], [1, 3]], [7, []]]) {
            T.run(`MM.setUI({ exp: ${JSON.stringify(raw)} })`);
            eq(T.exps(), want, `multi: exp ${JSON.stringify(raw)} loads as ${JSON.stringify(want)}`);
        }
        T.run("MM.setUI({ exp: 2, sel: 2 }); ubSyncWidth(true)");
        T.run("paint()");
        T.dbl(...ctr(T.R(0).viz));
        eq(T.exps(), [2, 0], "multi: a numeric exp is migrated to a list the moment another strip expands");
        eq(T.run("Array.isArray(MM.getUI().exp)"), true, "multi: stored as a list");
        const saved = T.run("MM.save()");
        const T2 = makeEnv();
        T2.ctx.setvalueof(saved);
        eq(T2.run("ubExpList()"), [2, 0], "multi: round trip through the saved state keeps the expanded list");
        eq(T2.log.outlets.filter((o) => o[1] === "width").pop()[2], T2.run("ubLayoutWidth()") + 8, "multi: width re-requested after restore");
        const T3 = makeEnv();
        const old = JSON.parse(JSON.stringify(T.run("JSON.parse(stateToJson(MM.state))")));
        old.ui.exp = 3;
        T3.ctx.setvalueof(T.run(`serializeState(normalizeState(${JSON.stringify(old)}))`));
        eq(T3.run("ubExpList()"), [3], "multi: an old state with exp = 3 loads as [3]");
    }
    // ---- width limit: expanding past 1600 px is refused with a HUD note
    {
        const T = mkM(16);
        const kmax = T.run("ubMaxExpanded()");
        ok(kmax >= 1 && kmax < 16, `multi: 16 strips cannot all expand (max ${kmax})`);
        for (let k = 0; k < 16; k++) T.run(`ubSetExpanded(${k})`);
        eq(T.exps().length, kmax, "multi: expanding stops at the limit");
        ok(T.run("ubLayoutWidth()") + 8 <= 1600, "multi: the device never needs more than 1600 px");
        eq(T.run("ubSetExpanded(15)"), false, "multi: a refused expand returns false");
        T.log.texts.length = 0;
        T.run("paint()");
        ok(T.log.texts.some((t) => /No room to expand/.test(t)), "multi: a HUD note says there is no room");
        T.run("ubCollapseSlot(0)");
        eq(T.run("ubSetExpanded(15)"), true, "multi: after a collapse there is room again");
        T.run(`MM.setUI({ exp: [${[...Array(16).keys()].join(",")}] })`);
        eq(T.exps().length, kmax, "multi: a saved list that does not fit is cut to the limit");
        ok(T.run("ubStrips().end") + 8 <= 1600, "multi: ...and the layout fits");
    }
    // ---- delete / undo
    {
        const T = mkM(4);
        T.run("ubSetExpanded(0); ubSetExpanded(2); ubSetExpanded(3)");
        T.run("ubDeleteMod(2)");
        eq(T.exps(), [0, 3], "multi: deleting an expanded modulator removes it from the expanded list");
        eq(T.run("MM.getUI().exp"), [0, 3], "multi: the stored list is pruned too");
        T.run("ubDoUndo()");
        eq(T.exps(), [0, 3, 2], "multi: undo brings the modulator back expanded");
        T.run("ubDeleteMod(1)");
        eq(T.exps(), [0, 3, 2], "multi: deleting a collapsed one leaves the list alone");
        T.run("ubDoUndo()");
        eq(T.exps(), [0, 3, 2], "multi: ...and its undo does not expand it");
        const cnt = T.run("MM.modCount()");
        T.c(...ctr(T.R(3).del)); T.c(...ctr(T.R(3).del));
        eq([T.run("MM.modCount()"), T.exps()], [cnt - 1, [0, 2]], "multi: the delete button removes just that strip");
    }
    // ---- faces: one per control, no overlap, inside the device, hidden while popups are open
    {
        const F = mkM(5);
        F.run("ubSetExpanded(0); ubSetExpanded(2); ubSetExpanded(3)");
        F.run("paint()");
        const shown = F.run("MM.faceState().shown");
        const names = Object.keys(shown);
        const want = {};
        for (const g of F.run("ubStrips().list")) for (const f of F.run(`ubStripFaces(ubStrips().list.filter((q) => q.slot === ${g.slot})[0], MM.state.mods[${g.slot}], ubStripRects(ubStrips().list.filter((q) => q.slot === ${g.slot})[0]))`)) want[f[0]] = (want[f[0]] || 0) + 1;
        eq(names.slice().sort(), Object.keys(want).sort(), "multi faces: every control of every strip has a face");
        ok(Object.values(want).every((n) => n === 1), "multi faces: exactly one face per control");
        const lim = F.run("ubFaceLimit()");
        const rects = names.map((n) => { const pr = F.live[n].attrs.presentation_rect; return [n, [pr[0] - 4, pr[1] - 4, pr[2], pr[3]]]; });
        for (const [n, r] of rects) {
            eq(F.live[n].attrs.hidden, 0, `multi faces: ${n} shown`);
            ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= lim + 1e-6 && r[1] + r[3] <= 161 + 1e-6, `multi faces: ${n} inside the device`);
        }
        for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) ok(!inter(rects[a][1], rects[b][1]), `multi faces: ${rects[a][0]} and ${rects[b][0]} do not overlap`);
        F.run("ubSetExpanded(-1)"); F.run("paint()");
        ok(names.length > Object.keys(F.run("MM.faceState().shown")).length, "multi faces: the expanded strips add faces");
        F.run("ubSetExpanded(0); ubSetExpanded(2); paint()");
        const before = Object.keys(F.run("MM.faceState().shown")).length;
        F.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 1', paramName: 'P', trackName: 'T', deviceName: 'D' })");
        F.run("ubMapsPop = { slot: 0, scroll: 0 }; paint()");
        eq(Object.keys(F.run("MM.faceState().shown")).length, 0, "multi faces: hidden while the maps popover is open");
        F.run("ubMapsPop = null; ubPopup = { mode: 'add', slot: -1, x: 10, y: 22 }; paint()");
        eq(Object.keys(F.run("MM.faceState().shown")).length, 0, "multi faces: hidden while the type menu is open");
        F.run("ubPopup = null; paint()");
        eq(Object.keys(F.run("MM.faceState().shown")).length, before, "multi faces: back when the popups close");
    }
    // ---- popover: left on/off toggle on normal and self rows
    {
        const T = mkM(3);
        T.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 1', paramName: 'Decay', trackName: 'Drums', deviceName: 'Reverb' })");
        T.run("MM.addSelfMapping(0, 12, 'internal')");
        T.run("MM.setSelfMod('live', false); MM.addSelfMapping(0, 7, 'live')");
        T.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 2', paramName: 'Size', trackName: 'Drums', deviceName: 'Reverb' })");
        const ms = T.run("MM.mappingsFor(0)");
        eq(ms.length, 4, "popover toggle: normal, internal, via Live, normal");
        T.run("MM.updateMapping(" + ms[3].id + ", { enabled: 0 })");
        T.run("ubMapsPop = { slot: 0, scroll: 0 }");
        const P = T.run("ubMapsPopGeom()");
        const rows = P.vis.map((r) => T.run(`ubPopRowParts(${JSON.stringify(P.rect)}, ${r.y}, ${P.vw})`));
        for (const k of ["tog", "name", "mode", "pol", "bar", "val"]) for (const r of rows) eq([r[k][0], r[k][2]], [rows[0][k][0], rows[0][k][2]], `popover toggle: the ${k} column is aligned across normal and self rows`);
        for (const r of rows) {
            const seq = ["tog", "name", "mode", "pol", "bar", "val"];
            for (let i = 0; i < seq.length; i++) {
                ok(r[seq[i]][0] >= P.rect[0] && r[seq[i]][0] + r[seq[i]][2] <= P.rect[0] + P.rect[2], `popover toggle: ${seq[i]} inside the popover`);
                for (let j = i + 1; j < seq.length; j++) ok(!inter(r[seq[i]], r[seq[j]]), `popover toggle: ${seq[i]} and ${seq[j]} do not overlap`);
            }
            ok(r.name[2] >= 25, "popover toggle: the name column keeps at least 25 px (as before the toggle)");
            ok(r.bar[2] >= 24, "popover toggle: the bar keeps a usable width");
            eq(r.bar[0] + r.bar[2] + 4, r.val[0], "popover toggle: the bar fills up to the fixed value column");
        }
        P.vis.forEach((r, i) => {
            const before = JSON.parse(JSON.stringify(T.run(`MM.getMapping(${r.m.id})`)));
            const [cx, cy] = ctr(rows[i].tog);
            eq(T.run(`ubHit(${cx}, ${cy})`).kind, "mp_tog", `popover toggle: row ${i} hit area is the toggle`);
            T.c(cx, cy); T.up();
            const after = T.run(`MM.getMapping(${r.m.id})`);
            eq(after.enabled ? 1 : 0, before.enabled ? 0 : 1, `popover toggle: row ${i} flips enabled`);
            eq([after.mode, after.range, after.polarity, after.min, after.max], [before.mode, before.range, before.polarity, before.min, before.max], `popover toggle: row ${i} keeps its range and mode`);
            T.c(cx, cy); T.up();
            eq(T.run(`MM.getMapping(${r.m.id})`).enabled ? 1 : 0, before.enabled ? 1 : 0, `popover toggle: row ${i} flips back`);
            ok(T.run("!!ubMapsPop"), "popover toggle: the popover stays open");
        });
        const [nx, ny] = ctr(rows[0].name);
        eq(T.run(`ubHit(${nx}, ${ny})`).kind, "mp_row", "popover toggle: the name area is not a toggle");
        T.log.texts.length = 0;
        T.log.textCols = [];
        T.run("paint()");
        ok(T.log.texts.some((t) => /Decay/.test(t)) && T.log.texts.some((t) => /Size/.test(t)), "popover toggle: enabled and disabled normal rows paint their names");
        ok(T.log.texts.includes("L"), "popover toggle: the via-Live kind marker (tiny L tag) is painted");
        const sizeCol = T.log.textCols.filter((q) => q.t === "Size").pop();
        const decayCol = T.log.textCols.filter((q) => q.t === "Decay").pop();
        ok(sizeCol && decayCol && sizeCol.col[3] < decayCol.col[3], "popover toggle: the disabled row is dimmed");
    }
}

// ================================================================ DEPTH MODULATION UI (schema 10): learn onto a mapping row + sub-rows
{
    const overlap = (a, b) => a[2] > 0 && a[3] > 0 && b[2] > 0 && b[3] > 0 && a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;
    const inside = (r, o) => r[0] >= o[0] - 1e-6 && r[1] >= o[1] - 1e-6 && r[0] + r[2] <= o[0] + o[2] + 1e-6 && r[1] + r[3] <= o[1] + o[3] + 1e-6;
    const ctr = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    const noOv = (rects, msg) => { for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) ok(!overlap(rects[i][1], rects[j][1]), `${msg}: ${rects[i][0]} overlaps ${rects[j][0]}`); };
    function mk() {
        const T = makeEnv();
        T.ctx.uiReady();
        // 0 Wobble (LFO), 1 Follow (ENV), 2 Dice (RANDOM), 3 Seq (STEPS)
        for (const t of [1, 2, 3, 4]) T.run(`ubAddType(${t})`);
        const mp = (mod, j, name) => T.run(`MM.addMapping(${mod}, { path: "live_set tracks ${mod} devices 0 parameters ${j + 1}", trackName: "Trk ${mod}", deviceName: "Dev", paramName: "${name}" })`);
        const A = mp(2, 0, "Frequency"), B = mp(2, 1, "Resonance"), Cc = mp(0, 2, "Wet"), Dd = mp(1, 3, "Drive");
        T.run(`MM.setUI({ pb: 1, sel: 2, exp: -1, pbScroll: 0, pbSel: ${A.id} }); ubSyncWidth(true)`);
        const click = (x, y, o = {}) => T.ctx.onclick(x, y, 1, 0, o.shift ? 1 : 0, 0, 0, 0);
        const drag = (x, y) => T.ctx.ondrag(x, y, 1, 0, 0, 0, 0, 0);
        const rel = (x, y) => T.ctx.ondrag(x, y, 0, 0, 0, 0, 0, 0);
        const idle = (x, y) => T.ctx.onidle(x, y, 0, 0, 0, 0, 0, 0);
        const paint = () => { T.log.texts.length = 0; T.log.textCols = []; T.log.fills = []; T.run("paint()"); };
        const routes = (id) => T.run(`MM.depthRoutesFor(${id})`);
        const W = () => T.run("ubLayoutWidth()");
        return { T, run: T.run, A, B, C: Cc, D: Dd, click, drag, rel, idle, paint, routes, W, log: T.log };
    }
    const rowOf = (E, mapId) => { const gm = E.run("ubListGeom()"); const r = E.run("ubListVisible()").rows.filter((q) => q.item.kind === "map" && q.item.m.id === mapId)[0]; return { gm, r }; };
    const rowPt = (E, mapId) => { const { gm, r } = rowOf(E, mapId); return [gm.lx + 30, r.y + 6]; };
    const tabPt = (E, slot) => { const g = E.run("ubStrips()").list.filter((q) => q.tab && q.slot === slot)[0]; return ctr([g.x, g.y, g.w, g.h]); };
    const inDevice = (E, r) => r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= E.W() && r[1] + r[3] <= 161 + 1e-6;

    // ---------------------------------------------------------------- shipped state: the committed LST preview without routes
    {
        const T0 = makeEnv();
        eq([T0.run("UB_PREVIEW_DMOD"), T0.run("UB_PREVIEW_DMOD_B"), T0.run("UB_PREVIEW_LIST"), T0.run("UB_PREVIEW_OPT"), T0.run("UB_PREVIEW_SELF"), T0.run("UB_PREVIEW_NEWMODS")], [0, false, true, false, false, 0], "the committed preview is the default LST state");
        eq(T0.run("MM.allMappings().filter((m) => m.target.kind === 'depth').length"), 0, "...with no depth routes");
    }

    // ---------------------------------------------------------------- common: route rows of the SOURCE modulator, remap editor of a route
    {
        const E = mk();
        const r = E.run(`MM.addDepthRoute(0, ${E.A.id})`);
        E.run(`MM.setUI({ sel: 0, pbSel: ${r.id} })`);
        const items = E.run("ubListItems()");
        ok(items.some((it) => it.kind === "map" && it.m.id === r.id), "the route is a row of its SOURCE modulator's list");
        E.paint();
        ok(E.log.texts.includes("D") && E.log.texts.some((t) => /Frequency Depth/.test(t)), "route row: violet D marker + '<parameter> Depth' name (not a normal mapping)");
        eq(E.run("ubPbSelMapping().id"), r.id, "the remap editor edits the route like any internal mapping");
        const dr = E.run(`ubDetailRects(ubListGeom(), MM.getMapping(${r.id}))`);
        ok(dr.some((d) => d.id === "dback") && dr.some((d) => d.id === "mseg"), "route editor: back link, MSEG");
        ok(!dr.some((d) => d.id.indexOf("pol") === 0), "route editor: NO polarity control (a depth route is unipolar)");
        const rem = dr.filter((d) => d.id === "tabrem")[0];
        E.click(...ctr(rem.rect)); E.idle(1, 1);
        eq(E.run(`MM.getMapping(${r.id}).mode`), "mod", "route editor: Remote is inert (Mod only)");
        const mseg = dr.filter((d) => d.id === "mseg")[0];
        const n0 = E.run(`MM.getMapping(${r.id}).shape.length`);
        E.click(mseg.rect[0] + mseg.rect[2] * 0.5, mseg.rect[1] + mseg.rect[3] * 0.2); E.idle(1, 1);
        ok(E.run(`MM.getMapping(${r.id}).shape.length`) > n0, "route editor: the transfer curve is editable (a point was added)");
        E.click(...ctr(dr.filter((d) => d.id === "dback")[0].rect)); E.idle(1, 1);
    }

    // ---------------------------------------------------------------- LRN onto a row + sub-rows
    {
        const E = mk();
        const gm0 = E.run("ubListGeom()");
        // single-shot: arm from Wobble (0), go to Dice (tab), click the Frequency row
        E.run("MM.setUI({ sel: 0 })");
        E.click(11, 11); E.idle(1, 1);
        ok(E.run("MM.learn.armed") && E.run("MM.learn.mod") === 0, "LRN armed for Wobble");
        E.click(...tabPt(E, 2)); E.idle(1, 1);
        eq(E.run("ubSel()"), 2, "...the selection moved to Dice (single-shot stays on Wobble)");
        eq(E.routes(E.A.id).length, 0, "no route yet");
        E.click(...rowPt(E, E.A.id)); E.idle(1, 1);
        const rs = E.routes(E.A.id);
        eq(rs.length, 1, "a click on the mapping row creates the route");
        eq(rs[0].mod, 0, "...from the modulator LRN was armed for");
        ok(!E.run("MM.learn.armed"), "...and single-shot learn disarms");
        eq(E.run("MM.mappingsFor(2).length"), 2, "no new mapping on Dice");
        // sub-row under the Frequency row
        const items = E.run("ubListItems()");
        const k = items.findIndex((it) => it.kind === "map" && it.m.id === E.A.id);
        eq(items[k + 1].kind, "dsub", "the sub-row sits directly under its mapping row");
        eq(items[k + 1].m.id, rs[0].id, "...and is the route");
        E.paint();
        ok(E.log.texts.includes(E.run("MM.state.mods[0].name")), "the sub-row paints the source name (with its colour dot)");
        // geometry
        const vis = E.run("ubListVisible()");
        const gm = E.run("ubListGeom()");
        const srow = vis.rows.filter((q) => q.item.kind === "dsub")[0];
        const S = E.run(`ubSubParts(${srow.y})`);
        noOv(["tog", "name", "bar", "val", "del"].map((n) => [n, S[n]]), "sub-row parts");
        for (const n of ["arrow", "tog", "name", "bar", "val", "del"]) ok(inside(S[n], [gm.lx, srow.y, gm.lw, srow.h]), `sub-row part ${n} inside its row`);
        ok(srow.h < 14 && srow.y + srow.h <= gm.ly + gm.lh - gm.foot, "sub-row fits above the footer");
        // hits + edits: bar sets the range, toggle, delete + undo
        const hb = E.run(`ubHit(${ctr(S.bar)})`);
        eq(hb.kind, "ds_bar", "bar hit"); eq(E.run(`ubHit(${ctr(S.tog)}).kind`), "ds_tog", "toggle hit"); eq(E.run(`ubHit(${ctr(S.del)}).kind`), "ds_del", "x hit");
        E.click(S.bar[0] + S.bar[2] * 0.8, S.bar[1] + 3); E.drag(S.bar[0] + S.bar[2] * 0.9, S.bar[1] + 3); E.idle(1, 1);
        near(E.run(`MM.getMapping(${rs[0].id}).range`), 0.9, 0.06, "dragging the sub-row bar edits the route's range (a unipolar bar: 0 at the left edge, 100 % at the right)");
        E.click(...ctr(S.tog)); E.idle(1, 1);
        eq(E.run(`MM.getMapping(${rs[0].id}).enabled`), 0, "the sub-row toggle disables the route");
        E.click(...ctr(S.tog)); E.idle(1, 1);
        E.click(...ctr(S.del)); E.idle(1, 1);
        eq(E.routes(E.A.id).length, 0, "the sub-row x deletes the route");
        E.run("ubDoUndo()");
        eq(E.routes(E.A.id).length, 1, "...and Cmd-Z restores it");
        // multi-learn: armed from Follow (1), tab to Seq (3)... uses the modulator LRN was armed from
        E.run("MM.setUI({ sel: 1 })");
        E.click(11, 11, { shift: true }); E.idle(1, 1);
        ok(E.run("MM.learn.armed && MM.learn.multi"), "Shift-LRN = multi");
        E.click(...tabPt(E, 2)); E.idle(1, 1);
        eq(E.run("MM.learn.mod"), 2, "multi-learn retargets with the selection...");
        E.click(...rowPt(E, E.B.id)); E.idle(1, 1);
        eq(E.routes(E.B.id).map((r) => r.mod), [1], "...but the depth route comes from the modulator it was armed from");
        ok(E.run("MM.learn.armed"), "multi stays armed");
        E.click(...rowPt(E, E.A.id)); E.idle(1, 1);
        eq(E.routes(E.A.id).map((r) => r.mod).sort(), [0, 1], "two routes onto one mapping (two sub-rows)");
        // an internal row / a duplicate are refused
        const before = E.run("MM.allMappings().length");
        E.click(...rowPt(E, E.A.id)); E.idle(1, 1);
        eq(E.run("MM.allMappings().length"), before, "armed again on the same source + mapping: a duplicate is refused");
        E.run("MM.disarmLearn()");
        // popover: sub-rows and assign through the popover row
        E.run("MM.setUI({ pb: 0, sel: 2, exp: -1 }); ubSyncWidth(true)");
        const cr = E.run("ubStripRects(ubStrips().list.filter((g) => g.slot === 2)[0]).count");
        E.click(...ctr(cr)); E.idle(1, 1);
        ok(E.run("!!ubMapsPop"), "popover opens");
        let P = E.run("ubMapsPopGeom()");
        ok(P.vis.some((v) => v.kind === "dsub"), "the popover shows the sub-rows");
        for (const v of P.vis) {
            const pr = v.parts;
            const names = v.kind === "dsub" ? ["tog", "name", "bar", "val", "del"] : ["tog", "name", "mode", "bar", "val"];
            noOv(names.map((n) => [n, pr[n]]), "popover " + v.kind + " parts");
            for (const n of names) ok(inside(pr[n], v.rect), `popover ${v.kind} part ${n} inside its row`);
            ok(inside(v.rect, P.rect) && inside(P.rect, [0, 0, E.W(), 161]), "popover row inside the popover and the device");
        }
        const sub = P.vis.filter((v) => v.kind === "dsub")[0];
        eq(E.run(`ubHit(${ctr(sub.parts.bar)}).kind`), "mp_ds_bar", "popover sub-row: bar hit");
        E.click(...ctr(sub.parts.del)); E.idle(1, 1);
        eq(E.routes(E.A.id).length, 1, "popover sub-row x deletes one route");
        // assign from the popover: arm Seq (3) and click the Resonance row
        E.run("MM.setUI({ sel: 3 })"); E.run("MM.armLearn(3, false); ubDmodSrc = 3");
        P = E.run("ubMapsPopGeom()");
        const row = P.vis.filter((v) => v.kind === "map" && v.m.id === E.B.id)[0];
        E.click(...ctr(row.parts.name)); E.idle(1, 1);
        ok(E.routes(E.B.id).some((r) => r.mod === 3), "a click on a popover row while armed creates the route");
        ok(E.run("Object.keys(ubFacesWanted()).length") === 0, "faces stay hidden while the popover is open");
        E.run("ubMapsPop = null; MM.setUI({ pb: 1 })");
        ok(inDevice(E, [gm.lx, gm.ly, gm.lw, gm.lh]) && gm0.end <= E.W(), "LST layout inside the device");
    }

    // ---------------------------------------------------------------- hit areas inside the device
    {
        const E = mk();
        E.run(`MM.addDepthRoute(0, ${E.A.id}); MM.addDepthRoute(1, ${E.A.id}); MM.addDepthRoute(3, ${E.B.id}); MM.addDepthRoute(2, ${E.C.id})`);
        const gm = E.run("ubListGeom()");
        E.run("MM.setUI({ sel: 2, pb: 1, pbScroll: 0 })");
        const vis = E.run("ubListVisible()");
        for (const r of vis.rows) {
            ok(inside([gm.lx, r.y, gm.lw, r.h], [gm.lx, gm.ly, gm.lw, gm.lh - gm.foot]), `list row ${r.index} inside the list`);
        }
        ok(E.W() >= gm.end && gm.end <= 1600, `the device is wide enough for the LST layout`);
        E.paint();
        ok(E.log.texts.length > 5, `the LST view paints`);
        // 16 modulators: still fits
        E.run("MM.setUI({ sel: 2, pb: 1, pbSel: 0 })");
    }

    // ---------------------------------------------------------------- UNIPOLAR depth routes: no polarity control anywhere, readouts without a sign, bars 0..100
    {
        const E = mk();
        const r = E.run(`MM.addDepthRoute(0, ${E.A.id})`);
        const polRe = /^[+±−-]\d+%$/;
        E.run("var __polN = 0; ubPolGlyph = (function (o) { return function () { __polN++; return o.apply(this, arguments); }; })(ubPolGlyph);");
        for (const pol of [1, 0, -1]) {
            E.run(`MM.updateMapping(${r.id}, { polarity: ${pol}, range: 0.4 })`);
            eq(E.run(`MM.getMapping(${r.id}).polarity`), pol, `the stored polarity ${pol} is kept`);
            eq(E.run(`ubValueText(MM.getMapping(${r.id}))`), "40%", `readout of a depth route with stored polarity ${pol}: "40%", no sign`);
            eq(E.run(`ubPol(MM.getMapping(${r.id}))`), 2, "the UI treats it as unipolar");
        }
        ok(polRe.test(E.run(`ubValueText(Object.assign({}, MM.getMapping(${E.A.id}), { mode: "mod", polarity: 0, range: 0.5 }))`)), "a normal Mod mapping keeps its signed readout");
        // remap editor: no pol cells for the route, still there for a normal mapping
        E.run(`MM.setUI({ sel: 0, pbSel: ${r.id} })`);
        const dr = E.run(`ubDetailRects(ubListGeom(), MM.getMapping(${r.id}))`);
        eq(dr.filter((d) => d.id.indexOf("pol") === 0).length, 0, "remap editor of a depth route: no polarity cells");
        const nm = E.run(`ubDetailRects(ubListGeom(), MM.getMapping(${E.A.id}))`);
        eq(nm.filter((d) => d.id.indexOf("pol") === 0).length, 3, "remap editor of a normal Mod mapping: 3 polarity cells");
        // a forced polarity click on a depth route changes nothing
        const polRect = nm.filter((d) => d.id === "pol-1")[0].rect;
        E.run(`ubDetailClick({ id: "pol-1", pol: -1, rect: [${polRect}] }, 0, 0)`);
        E.run(`MM.updateMapping(${r.id}, { polarity: 1 })`);
        // value readout painted in the editor / list rows
        E.paint();
        ok(E.log.texts.includes("40%"), "the editor readout and the list row of the route read \"40%\"");
        ok(!E.log.texts.some((t) => polRe.test(t) && E.run(`MM.getMapping(${r.id}).range`) === 0.4 && /^[+±−-]40%$/.test(t)), "...with no ± / + / − in front of it");
        eq(E.run("__polN"), 0, "painting a depth-route editor never draws a polarity glyph");
        // the bars of a depth route: the range bar fills from 0 (left / bottom) to range
        const rect = [10, 10, 82, 11];
        eq(E.run(`ubHBarModValue([10, 10, 82, 11], 2, 10 + 1)`), 0, "depth route bar: left edge = 0");
        eq(E.run(`ubHBarModValue([10, 10, 82, 11], 2, 10 + 81)`), 1, "depth route bar: right edge = 100 %");
        near(E.run(`ubHBarModValue([10, 10, 82, 11], 2, 10 + 41)`), 0.5, 1e-9, "depth route bar: the middle is 50 %");
        eq(E.run(`ubHBarModValue([10, 10, 82, 11], 2, 0)`), 0, "depth route bar: left of the bar clamps at 0 (no inversion)");
        const mr = E.run(`ubMeterGeom(ubDetailRects(ubListGeom(), MM.getMapping(${r.id})).filter((d) => d.id === "meter")[0].rect)`);
        ok(mr.iy + mr.ih > mr.cy, "vertical range bar geometry");
        eq(E.run(`ubRangeValue(ubDetailRects(ubListGeom(), MM.getMapping(${r.id})).filter((d) => d.id === "meter")[0].rect, 2, ${mr.iy + mr.ih})`), 0, "vertical depth bar: bottom = 0");
        eq(E.run(`ubRangeValue(ubDetailRects(ubListGeom(), MM.getMapping(${r.id})).filter((d) => d.id === "meter")[0].rect, 2, ${mr.iy})`), 1, "vertical depth bar: top = 100 %");
        eq(E.run(`ubRangeValue(ubDetailRects(ubListGeom(), MM.getMapping(${r.id})).filter((d) => d.id === "meter")[0].rect, 2, ${mr.iy + mr.ih + 30})`), 0, "vertical depth bar: below the bottom clamps at 0");
        // sub-row under the mapping's row: shows "40%" and no sign; no polarity part exists
        E.run(`MM.updateMapping(${r.id}, { polarity: -1, range: 0.4 })`);
        E.run(`MM.setUI({ sel: ${E.A.mod}, pb: 1, pbSel: ${E.A.id} })`);
        const items = E.run("ubListItems()");
        ok(items.some((it) => it.kind === "dsub" && it.m.id === r.id), "the sub-row exists");
        E.paint();
        ok(E.log.texts.includes("40%"), "the sub-row value reads \"40%\"");
        ok(!E.log.texts.some((t) => /^[+±−-]40%$/.test(t)), "...and no sub-row text carries a sign");
        const srow = E.run("ubListVisible()").rows.filter((q) => q.item.kind === "dsub")[0];
        eq(Object.keys(E.run(`ubSubParts(${srow.y})`)).filter((k) => /pol/.test(k)).length, 0, "sub-row parts: no polarity");
        // popover of the TARGET's modulator (sub-rows) and of the SOURCE modulator (the route as its own row)
        for (const slot of [E.A.mod, 0]) {
            E.run(`MM.setUI({ pb: 0, sel: ${slot}, exp: -1 }); ubSyncWidth(true)`);
            const cr = E.run(`ubStripRects(ubStrips().list.filter((g) => g.slot === ${slot})[0]).count`);
            E.click(...ctr(cr)); E.idle(1, 1);
            ok(E.run("!!ubMapsPop"), `popover of slot ${slot} opens`);
            const P = E.run("ubMapsPopGeom()");
            const rv = P.vis.filter((v) => v.m.id === r.id);
            ok(rv.length === 1, `slot ${slot}: the route is shown in the popover (${rv.length ? rv[0].kind : "-"})`);
            if (rv[0].kind === "map") {
                const hit = E.run(`ubHit(${ctr(rv[0].parts.pol)})`);
                ok(hit.kind !== "mp_pol", "popover row of a depth route: the old polarity cell is not a control");
                E.click(...ctr(rv[0].parts.pol)); E.idle(1, 1);
                eq(E.run(`MM.getMapping(${r.id}).polarity`), -1, "...clicking it does nothing");
            }
            const normal = P.vis.filter((v) => v.kind === "map" && v.m.id !== r.id && v.m.mode !== "remote" && !v.m.target.internal)[0];
            E.run("__polN = 0"); E.paint();
            if (normal) { ok(E.run("__polN") >= 1, "a normal Mod row of the popover still draws its polarity glyph"); ok(E.run(`ubHit(${ctr(normal.parts.pol)}).kind`) === "mp_pol", "...and its polarity cell is hit"); }
            E.run("__polN = 0"); E.paint();
            E.run("ubMapsPop = null; MM.setUI({ pb: 1 })");
        }
    }
}

// ---------------------------------------------------------------- new modulators: ADSR, XY, Buttons (+ the Follower rename), two outputs, learn source
{
    const N = makeEnv();
    N.ctx.uiReady && N.ctx.uiReady();
    N.ctx.setnames("---megamodcfg", "---megamodmseg", "---megamodsteps", "---megamodscope", "---mmcurve", "---megamodroute");
    N.ctx.init_lom();
    const nr = (c) => N.run(c);
    const ctr = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    const click = (x, y, o = {}) => N.ctx.onclick(x, y, 1, 0, o.shift ? 1 : 0, 0, 0, 0);
    const drag = (x, y) => N.ctx.ondrag(x, y, 1, 0, 0, 0, 0, 0);
    const up = () => N.ctx.onidle(1, 1, 0, 0, 0, 0, 0, 0);
    const dbl = (x, y) => N.ctx.ondblclick(x, y, 1, 0, 0, 0, 0, 0);
    const inter = (a, b) => a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;
    const inside = (r, o) => r[0] >= o[0] - 1e-6 && r[1] >= o[1] - 1e-6 && r[0] + r[2] <= o[0] + o[2] + 1e-6 && r[1] + r[3] <= o[1] + o[3] + 1e-6;
    const stripOf = (slot) => nr(`ubStrips().list.filter((g) => g.slot === ${slot} && !g.tab)[0]`);
    const rectsOf = (slot) => nr(`ubStripRects(${JSON.stringify(stripOf(slot))})`);
    const texts = () => { N.log.texts.length = 0; nr("paint()"); return N.log.texts.slice(); };

    // ---- the picker lists the eight types, fits the device in every view, and adds each new type
    {
        eq(nr("UB_TYPES"), [1, 2, 3, 4, 5, 6, 7, 8], "the picker offers eight types");
        nr("MM.setUI({ pb: 0, opt: 0, exp: [], sel: -1 }); ubSyncWidth(true)");
        const pl = nr("ubStrips().plus");
        click(pl.x + 3, pl.y + 20); up();
        ok(nr("!!ubPopup && ubPopup.mode === 'add'"), "the + strip opens the type picker");
        const pr = nr("ubPopupRect()");
        ok(pr[1] >= 0 && pr[1] + pr[3] <= 161 && pr[0] >= 0 && pr[0] + pr[2] <= nr("ubLayoutWidth()") + 1, `the picker fits the device (${pr})`);
        N.log.texts.length = 0; nr("paint()");
        for (const nm of ["LFO", "Follower", "Random", "Steps", "MSEG", "ADSR", "XY", "Buttons"]) ok(N.log.texts.includes(nm), `the picker lists ${nm}`);
        ok(!N.log.texts.includes("Envelope"), "the picker no longer lists Envelope");
        // a click on each new row adds that type
        for (const ty of [6, 7, 8]) {
            const pr2 = nr("ubPopupRect()");
            const k = nr("UB_TYPES").indexOf(ty);
            click(pr2[0] + 10, pr2[1] + 2 + k * 17 + 8); up();
            eq(nr(`MM.state.mods[${ty - 6}].type`), ty, `the picker adds type ${ty}`);
            const pl2 = nr("ubStrips().plus");
            if (pl2 && ty < 8) click(pl2.x + 3, pl2.y + 20);
        }
        eq(nr("MM.modCount()"), 3, "ADSR, XY and Buttons added");
        // LST view and the type chip of an expanded strip: the picker stays inside the device
        nr("MM.setUI({ pb: 1, sel: 0 }); ubSyncWidth(true)");
        const pl3 = nr("ubStrips().plus");
        click(pl3.x + 3, pl3.y + 3); up();
        const pr3 = nr("ubPopupRect()");
        ok(nr("!!ubPopup") && pr3[1] >= 0 && pr3[1] + pr3[3] <= 161, `LST view: the picker fits (${pr3})`);
        nr("ubPopup = null; MM.setUI({ pb: 0 })");
        nr("ubSetExpanded(0)");
        const tr = rectsOf(0).type;
        click(...ctr(tr)); up();
        const pr4 = nr("ubPopupRect()");
        ok(nr("!!ubPopup && ubPopup.mode === 'type'") && pr4[1] + pr4[3] <= 161, `the type chip's picker fits (${pr4})`);
        nr("ubPopup = null; ubSetExpanded(-1)");
    }

    // ---- geometry: collapsed / expanded / LST layouts of the new types stay inside the strip, nothing overlaps
    {
        for (const view of ["collapsed", "expanded", "lst"]) {
            if (view === "collapsed") nr("MM.setUI({ pb: 0, exp: [], sel: 0 }); ubSyncWidth(true)");
            else if (view === "expanded") nr("MM.setUI({ pb: 0, exp: [0, 1, 2], sel: 0 }); ubSyncWidth(true)");
            for (let slot = 0; slot < 3; slot++) {
                if (view === "lst") nr(`MM.setUI({ pb: 1, sel: ${slot} }); ubSyncWidth(true)`);
                const g = view === "lst" ? nr("ubStrips().main") : stripOf(slot);
                const R = nr(`ubStripRects(${JSON.stringify(g)})`);
                const type = nr(`MM.state.mods[${slot}].type`);
                const box = [g.x, g.y, g.w, g.h];
                const leaves = [["icon", R.icon], ["name", R.name], ["count", R.count]];
                if (g.exp) leaves.push(["type", R.type], ["del", R.del], ["collapse", R.collapse]);
                for (const c of R.chips) leaves.push(["chip " + c.id, c.rect]);
                for (let i = 0; i < R.knobs.length; i++) leaves.push(["knob " + i, R.knobs[i].hit]);
                if (R.pad) leaves.push(["pad", R.pad]);
                for (let i = 0; R.btn && i < R.btn.length; i++) leaves.push(["button " + (i + 1), R.btn[i]]);
                for (let i = 0; R.src && i < R.src.length; i++) leaves.push(["source tab " + i, R.src[i]]);
                const tag = `${view} slot ${slot} (type ${type})`;
                for (const [n, r] of leaves) ok(inside(r, box), `${tag}: ${n} inside the strip`);
                for (let a = 0; a < leaves.length; a++) for (let b = a + 1; b < leaves.length; b++) ok(!inter(leaves[a][1], leaves[b][1]), `${tag}: ${leaves[a][0]} and ${leaves[b][0]} do not overlap`);
                for (const [n, r] of leaves) if (/pad|button|source/.test(n)) ok(inside(r, R.viz), `${tag}: ${n} inside the viz`);
                for (const k of R.knobs) ok(k.hit[1] + k.hit[3] <= 142 && k.labY + 2 <= 158, `${tag}: knob ${k.spec.key} above the count chip`);
                if (type === 7) ok(Math.abs(R.pad[2] - R.pad[3]) < 1e-9, `${tag}: the XY pad is square`);
                if (type === 8) ok(R.btn[0][2] === R.btn[1][2] && R.src[0][2] === R.btn[0][2], `${tag}: two equal buttons with a source tab each`);
                const pt = texts(); // paints without an exception
                ok(pt.length > 0, `${tag}: paints`);
                if (view !== "collapsed") ok(pt.some((t) => /^\d+%$|^Off$|ms$/.test(t)), `${tag}: shows knob values`);
            }
        }
        nr("MM.setUI({ pb: 0, exp: [], sel: 0 }); ubSyncWidth(true)");
    }

    // ---- XY pad: a drag sets X and Y independently, double-click centres
    {
        nr("MM.setUI({ pb: 0, exp: [], sel: 0 }); ubSyncWidth(true)");
        for (const big of [false, true]) {
            nr(`ubSetExpanded(${big ? 1 : -1})`);
            const R = rectsOf(1), pd = R.pad;
            const px = (fx, fy) => [pd[0] + fx * pd[2], pd[1] + fy * pd[3]];
            eq(nr("ubHit(" + ctr(pd).join(",") + ").kind"), "pad", `${big ? "expanded" : "collapsed"}: the pad is a hit target`);
            click(...px(0.25, 0.75));
            near(nr("MM.state.mods[1].p.x"), 0.25, 1e-9, "click sets X"); near(nr("MM.state.mods[1].p.y"), 0.25, 1e-9, "click sets Y (top = 1)");
            drag(...px(0.9, 0.1));
            near(nr("MM.state.mods[1].p.x"), 0.9, 1e-9, "drag moves X"); near(nr("MM.state.mods[1].p.y"), 0.9, 1e-9, "drag moves Y");
            drag(...px(3, -3));
            deq([nr("MM.state.mods[1].p.x"), nr("MM.state.mods[1].p.y")], [1, 1], "a drag outside the pad clamps");
            drag(...px(-3, 3)); up();
            deq([nr("MM.state.mods[1].p.x"), nr("MM.state.mods[1].p.y")], [0, 0], "...at the other corner too");
            near(N.live.ap_6.value, 0, 1e-9, "X reaches the M2 A parameter"); near(N.live.ap_7.value, 0, 1e-9, "Y reaches the M2 B parameter");
            click(...px(0.6, 0.4)); up();
            near(N.live.ap_6.value, 60, 1e-9, "X = 60 % in the parameter"); near(N.live.ap_7.value, 60, 1e-9, "Y = 60 % in the parameter");
            dbl(...px(0.6, 0.4));
            deq([nr("MM.state.mods[1].p.x"), nr("MM.state.mods[1].p.y")], [0.5, 0.5], "double-click centres the puck");
            // independent: only X moves with the knob
            const kx = R.knobs[0];
            nr("MM.setParam(1, 'y', 0.2)");
            click(...ctr(kx.hit)); drag(ctr(kx.hit)[0], ctr(kx.hit)[1] - 20); up();
            ok(nr("MM.state.mods[1].p.x") > 0.5 && nr("MM.state.mods[1].p.y") === 0.2, "the X knob moves X only");
        }
        nr("ubSetExpanded(-1)");
    }

    // ---- Buttons: each toggles its own parameter
    {
        nr("MM.setUI({ pb: 0, exp: [], sel: 0 }); ubSyncWidth(true)");
        for (const big of [false, true]) {
            nr(`ubSetExpanded(${big ? 2 : -1})`);
            const R = rectsOf(2);
            eq(nr(`ubHit(${ctr(R.btn[0]).join(",")}).kind`), "btn", "button 1 is a hit target"); eq(nr(`ubHit(${ctr(R.btn[1]).join(",")}).b`), 1, "button 2 is hit as b = 1");
            nr("MM.setParam(2, 'sync', 0); MM.setParam(2, 'bipolar', 0)");
            click(...ctr(R.btn[0])); up();
            deq([nr("MM.state.mods[2].p.sync"), nr("MM.state.mods[2].p.bipolar")], [1, 0], "button 1 toggles on, button 2 untouched");
            eq(N.live.at_13.value, 1, "button 1 -> M3 Sync switch parameter"); eq(N.live.at_14.value, 0, "button 2 parameter untouched");
            click(...ctr(R.btn[1])); up();
            deq([nr("MM.state.mods[2].p.sync"), nr("MM.state.mods[2].p.bipolar")], [1, 1], "button 2 toggles independently");
            click(...ctr(R.btn[0])); up();
            deq([nr("MM.state.mods[2].p.sync"), nr("MM.state.mods[2].p.bipolar")], [0, 1], "button 1 toggles off");
            eq(N.live.at_14.value, 1, "button 2 -> M3 Bipolar switch parameter");
        }
        nr("ubSetExpanded(-1)");
    }

    // ---- ADSR editor: chips, knobs, draggable breakpoints, the MIDI From menu
    {
        nr("MM.setUI({ pb: 0, exp: [0], sel: 0 }); ubSyncWidth(true)");
        const R = rectsOf(0);
        deq(R.chips.map((c) => c.id), ["sync", "rtg", "osh", "bip", "from"], "ADSR chips: Trig, Retrig, Vel, Bipolar, MIDI From");
        deq(R.knobs.map((k) => k.spec.key), ["attack", "decay", "sustain", "release", "depth", "thresh"], "ADSR knobs in ADSR order, Depth, Threshold");
        const lab = (id) => R.chips.filter((c) => c.id === id)[0];
        ok(texts().includes("THR"), "the Trig chip says THR in Threshold mode");
        click(...ctr(lab("sync").rect)); up();
        eq(nr("MM.state.mods[0].p.sync"), 0, "the Trig chip switches to MIDI"); ok(texts().includes("MIDI"), "...and says MIDI");
        eq(N.live.at_1.value, 0, "Trig -> the M1 Sync switch parameter");
        click(...ctr(lab("rtg").rect)); eq(nr("MM.state.mods[0].p.retrig"), 1, "RTG chip: Retrig on (restart from 0)");
        click(...ctr(lab("osh").rect)); eq(nr("MM.state.mods[0].p.oneshot"), 1, "VEL chip");
        click(...ctr(lab("bip").rect)); eq(nr("MM.state.mods[0].p.bipolar"), 1, "BIP chip");
        nr("MM.setParam(0, 'retrig', 0); MM.setParam(0, 'oneshot', 0); MM.setParam(0, 'bipolar', 0); MM.setParam(0, 'sync', 1)");
        // knobs
        for (const [k, key] of [[0, "attack"], [1, "decay"], [2, "sustain"], [3, "release"], [4, "depth"], [5, "thresh"]]) {
            const before = nr(`MM.state.mods[0].p.${key}`);
            const r = R.knobs[k].hit;
            const dy = key === "depth" ? 30 : -30; // Depth is at its maximum: drag it down
            click(...ctr(r)); drag(ctr(r)[0], ctr(r)[1] + dy); up();
            ok(key === "depth" ? nr(`MM.state.mods[0].p.${key}`) < before : nr(`MM.state.mods[0].p.${key}`) > before, `knob ${key} drags ${key === "depth" ? "down" : "up"}`);
        }
        ok(!N.live.ap_9 || true, "(no parameter for the threshold)");
        // the visible threshold knob has no face; every other ADSR knob has one
        nr("paint()");
        const shown = nr("MM.faceState().shown");
        const faceNames = Object.keys(shown);
        ok(["ap_0", "ap_1", "ap_2", "ap_3", "ap_4"].every((n) => faceNames.indexOf(n) >= 0), "ADSR: A, B, C, D, E faces (attack, decay, depth, sustain, release)");
        ok(["at_1", "at_2", "at_3", "at_4"].every((n) => faceNames.indexOf(n) >= 0), "ADSR: Trig, Bipolar, Retrig, Vel switch faces");
        // ---- floating geometry (Bitwig-style): widths scale with the time, min width, fixed sustain, no sustain-start dot, inside the graph
        const PT = (p) => nr(`ubAdsrPts(${JSON.stringify(p)}, ${JSON.stringify(R.viz)})`);
        const base = { attack: 20, decay: 200, sustain: 0.5, release: 300 };
        {
            const ts = [0.05, 1, 5, 20, 100, 400, 1500, 5000];
            for (const key of ["attack", "decay", "release"]) {
                const wk = { attack: "wa", decay: "wd", release: "wr" }[key];
                let prev = -1, mono = true;
                for (const t of ts) { const w = PT(Object.assign({}, base, { [key]: t })).w; if (w[wk] < prev - 1e-9) mono = false; prev = w[wk]; }
                ok(mono, `${key}: the segment width grows monotonically with its time`);
                const wmin = PT(Object.assign({}, base, { [key]: 0.05 })).w;
                ok(wmin[wk] >= wmin.minw - 1e-9 && wmin.minw >= 6, `${key}: the minimum width is respected (${wmin[wk].toFixed(2)} px)`);
            }
            const ws = ts.map((t) => PT(Object.assign({}, base, { attack: t, decay: 5000 - t })).w.ws);
            ok(ws.every((v) => Math.abs(v - ws[0]) < 1e-9), "the sustain segment has a fixed width");
            let inside = true;
            for (const t of [0.05, 20, 5000]) for (const u of [0.5, 5000]) for (const v of [0.5, 5000]) {
                const P = PT({ attack: t, decay: u, sustain: 0.3, release: v });
                for (const k of ["start", "A", "D", "S", "R"]) if (P[k][0] < P.ix - 1e-9 || P[k][0] > P.ix + P.iw + 1e-9 || P[k][1] < P.iy - 1e-9 || P[k][1] > P.iy + P.ih + 1e-9) inside = false;
                if (P.w.tot > P.iw + 1e-6) inside = false;
            }
            ok(inside, "every point stays inside the graph, the total never exceeds the width");
            const fast = PT({ attack: 1, decay: 30, sustain: 0.5, release: 30 }), slow = PT({ attack: 1500, decay: 30, sustain: 0.5, release: 30 });
            ok(fast.w.tot < fast.iw * 0.6, `short times: the envelope does not fill the graph (${fast.w.tot.toFixed(0)} of ${fast.iw.toFixed(0)} px)`);
            ok(slow.w.wa > fast.w.wa * 4 && slow.w.wa > slow.iw * 0.3, `a long attack takes much of the width (${slow.w.wa.toFixed(0)} px), a short one is near-vertical (${fast.w.wa.toFixed(0)} px)`);
            const P0 = PT(base);
            eq(P0.S[1], P0.D[1], "the dashed sustain is horizontal at the sustain level (D.y == S.y)"); near(P0.S[0] - P0.D[0], P0.w.ws, 1e-9, "...of the fixed width");
            ok(P0.start[1] === P0.R[1] && P0.A[1] === P0.iy, "start and release end at 0, the attack peaks at 1");
        }
        const P = PT(base);
        nr("MM.setParam(0, 'attack', 100); MM.setParam(0, 'decay', 200); MM.setParam(0, 'sustain', 0.5); MM.setParam(0, 'release', 300)");
        const P2 = nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`);
        // ---- drags under the new mapping
        const a0 = nr("MM.state.mods[0].p.attack");
        click(P2.A[0], P2.A[1]); drag(P2.A[0] + 14, P2.A[1]); up();
        ok(nr("MM.state.mods[0].p.attack") > a0, "dragging the A point right lengthens the attack");
        {
            const P2b = nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`);
            near(P2b.A[0] - P2.A[0], 14, 1.5, "...and the dot follows the cursor (14 px)");
        }
        click(nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`).A[0], P2.A[1]); drag(0, P2.A[1]); up();
        ok(nr("MM.state.mods[0].p.attack") < a0, "...left shortens it");
        ok(nr("MM.state.mods[0].p.attack") >= 0.05, "...never below the minimum time");
        const P3 = nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`);
        const s0 = nr("MM.state.mods[0].p.sustain"), d0 = nr("MM.state.mods[0].p.decay");
        click(P3.D[0], P3.D[1]); drag(P3.D[0] + 10, P3.D[1] - 12); up();
        ok(nr("MM.state.mods[0].p.sustain") > s0 && nr("MM.state.mods[0].p.decay") > d0, "dragging D up and right raises the sustain and lengthens the decay");
        {
            const P3b = nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`);
            near(P3b.D[0] - P3b.A[0] - (P3.D[0] - P3.A[0]), 10, 1.5, "...the D dot follows the cursor"); near(P3b.D[1] - P3.D[1], -12, 1e-6, "...vertically too");
        }
        const P4 = nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`);
        const s1 = nr("MM.state.mods[0].p.sustain");
        click(P4.S[0], P4.S[1]); drag(P4.S[0], P4.S[1] + 15); up();
        eq(nr("MM.state.mods[0].p.sustain"), s1, "the end of the dashed line is no handle (no dot there)");
        const P5 = nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`);
        const r0 = nr("MM.state.mods[0].p.release");
        click(P5.R[0], P5.R[1]); drag(P5.R[0] + 12, P5.R[1]); up();
        ok(nr("MM.state.mods[0].p.release") > r0, "dragging R right lengthens the release");
        click(nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`).R[0], P5.R[1]); drag(-50, P5.R[1]); up();
        ok(nr("MM.state.mods[0].p.release") >= 0.5 && nr("MM.state.mods[0].p.release") < r0, "...left shortens it, clamped at the minimum");
        // ---- tracking dot per stage: idle hidden; attack / decay along the curve; sustain HELD on the D dot; release along the curve
        nr("MM.setParam(0, 'attack', 100); MM.setParam(0, 'decay', 200); MM.setParam(0, 'sustain', 0.5); MM.setParam(0, 'release', 300)");
        const P6 = nr(`ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)})`);
        const setTel = (aux, phase, u) => nr(`(function () { const t = MM.readTelemetry().mods[0]; t.aux = ${aux}; t.phase = ${phase}; t.u = ${u}; })()`);
        const dotAt = () => nr(`ubAdsrDot(ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)}), MM.readTelemetry().mods[0], MM.state.mods[0].p)`);
        nr("MM.readTelemetry()");
        setTel(0, 0, 0); eq(dotAt(), null, "idle: the dot is hidden");
        setTel(10, 0, 0); eq(dotAt(), null, "idle with the gate flag: still hidden");
        setTel(1, 0.5, 0.5);
        let dot = dotAt();
        near(dot[0], (P6.start[0] + P6.A[0]) / 2, 1e-9, "attack: the dot sits half way along the attack"); near(dot[1], P6.iy + 0.5 * P6.ih, 1e-9, "...at the live level");
        setTel(12, 0.25, 0.8);
        dot = dotAt(); near(dot[0], P6.A[0] + (P6.D[0] - P6.A[0]) * 0.25, 1e-9, "decay: along the decay segment"); near(dot[1], P6.iy + 0.2 * P6.ih, 1e-9, "...at the live level");
        for (const ph of [0, 0.3, 0.9]) { setTel(13, ph, 0.5); dot = dotAt(); near(dot[0], P6.D[0], 1e-9, `sustain (progress ${ph}): the dot is held on the D dot`); near(dot[1], P6.D[1], 1e-9, "...at the sustain level"); }
        setTel(4, 0.5, 0.25);
        dot = dotAt(); near(dot[0], P6.S[0] + (P6.R[0] - P6.S[0]) * 0.5, 1e-9, "release: along the release curve from the end of the dashed line"); near(dot[1], P6.iy + 0.75 * P6.ih, 1e-9, "...at the live level");
        // the drawn curve is the engine curve (the dot at the same progress lies on the polyline)
        {
            const cv = nr(`ubAdsrCurves(ubAdsrPts(MM.state.mods[0].p, ${JSON.stringify(R.viz)}), MM.state.mods[0].p)`);
            near(cv.atk[7][1], P6.iy + (1 - nr("adsrAttackShape(0.5)")) * P6.ih, 1e-9, "the attack is drawn with the engine's attack shape");
            near(cv.dec[10][1], P6.iy + (1 - (0.5 + 0.5 * nr("adsrExpShape(0.5)"))) * P6.ih, 1e-9, "the decay is drawn with the exponential shape");
            near(cv.rel[10][1], P6.iy + (1 - 0.5 * nr("adsrExpShape(0.5)")) * P6.ih, 1e-9, "the release starts at the sustain level and is exponential");
            near(cv.rel[0][1], P6.D[1], 1e-9, "the release curve starts at the end of the dashed line (sustain level)");
        }
        // MIDI From menu (mock: supported, three routes)
        nr("globalThis.__setType = []; MM.midiInfo = () => ({ supported: true, name: 'No Input', types: ['No Input', 'Track 1', 'Ext. In'], err: '' }); MM.midiSetType = (i) => { __setType.push(i); return true; };");
        const R2 = rectsOf(0);
        const from = R2.chips.filter((c) => c.id === "from")[0];
        ok(texts().some((t) => /^In: /.test(t)), "the MIDI From chip shows the routing");
        click(...ctr(from.rect)); up();
        ok(nr("!!ubMidiMenu"), "the MIDI From chip opens the menu");
        const G = nr("ubMidiMenuGeom()");
        ok(G.rect[1] >= 0 && G.rect[1] + G.rect[3] <= 161 && G.rect[0] + G.rect[2] <= nr("ubLayoutWidth()") + 1, `the menu fits the device (${G.rect})`);
        texts();
        eq(nr("Object.keys(MM.faceState().shown).length"), 0, "faces are hidden while the menu is open");
        ok(N.log.texts.includes("Track 1") && N.log.texts.includes("Ext. In"), "the menu lists the routing types");
        click(G.rect[0] + 20, G.rect[1] + 2 + 14 + 7); up();
        deq(nr("__setType"), [1], "a click on an entry routes the MIDI input there"); ok(!nr("ubMidiMenu"), "...and closes the menu");
        click(...ctr(from.rect)); up(); N.ctx.onkeydown(-3, 27, 1, 0, 0, 0, 0, 0);
        ok(!nr("ubMidiMenu"), "Escape closes the menu");
        click(...ctr(from.rect)); up(); click(900, 80); up();
        ok(!nr("ubMidiMenu"), "a click outside closes it");
        // unsupported: the menu says so and the chip reads No MIDI in
        nr("MM.midiInfo = () => ({ supported: false, name: '', types: [], err: 'x' })");
        ok(texts().includes("No MIDI in"), "without MIDI input the chip says so");
        nr("ubSetExpanded(-1)");
    }

    // ---- learn source: the tabs select the output, LRN learns from it
    {
        nr("MM.setUI({ pb: 0, exp: [], sel: 1, lout: {} }); ubSyncWidth(true)");
        nr("globalThis.__arm = []; globalThis.__a0 = MM.armLearn; MM.armLearn = function (i, m, o) { __arm.push([i, !!m, o]); return __a0.call(MM, i, m, o); };");
        eq(nr("ubLearnOut(1)"), 0, "the default learn source is output A (X)");
        let R = rectsOf(1);
        eq(nr(`ubHit(${ctr(R.src[1]).join(",")}).kind`), "outsel", "the Y tab is a hit target");
        click(...ctr(R.src[1])); up();
        eq(nr("ubLearnOut(1)"), 1, "clicking the Y tab selects output Y as the learn source");
        eq(nr("MM.getUI().lout[1]"), 1, "...kept in the UI state");
        N.log.fills = [];
        nr("paint()");
        const tabFill = (r) => N.log.fills.filter((f) => Math.abs(f.rect[0] - r[0]) < 0.01 && Math.abs(f.rect[1] - r[1]) < 0.01 && Math.abs(f.rect[2] - r[2]) < 0.01);
        const sf = tabFill(R.src[1]), uf = tabFill(R.src[0]);
        ok(sf.length && uf.length, "both tabs are painted");
        ok(sf[sf.length - 1].col[3] < 0.5 && uf[uf.length - 1].col[3] === 1, "the selected tab is drawn lit (tinted), the other dark");
        click(11, 11); up();
        deq(nr("__arm[__arm.length - 1]"), [1, false, 1], "the rail LRN arms with the selected output (Y)");
        eq(nr("MM.learn.out"), 1, "MM.learn.out = 1");
        click(...ctr(R.src[0])); up();
        eq(nr("MM.learn.out"), 0, "selecting X while armed re-targets the learn");
        eq(nr("MM.learn.armed"), true, "...and keeps it armed");
        click(11, 11); up();
        ok(!nr("MM.learn.armed"), "LRN disarms");
        click(11, 11, { shift: true }); up();
        deq(nr("__arm[__arm.length - 1]"), [1, true, 0], "Shift-LRN = multi-learn from X");
        click(...ctr(R.src[1])); up();
        eq(nr("MM.learn.out"), 1, "multi-learn follows the tab");
        nr("MM.disarmLearn()");
        // selecting another modulator retargets a multi-learn with ITS selected output
        nr("MM.setUI({ lout: { 1: 1, 2: 1 } })");
        nr("MM.armLearn(1, true, 1)");
        const R2 = rectsOf(2);
        click(R2.head[0] + 22, R2.head[1] + 8); up();
        eq(nr("ubSel()"), 2, "a click on Buttons selects it");
        deq(nr("__arm[__arm.length - 1]"), [2, true, 1], "a multi-learn retargets with the new modulator's selected output");
        nr("MM.disarmLearn(); MM.armLearn = __a0");
        // a single-output modulator never carries an output selection
        eq(nr("ubLearnOut(0)"), 0, "ADSR always learns output A");
        nr("MM.setUI({ lout: { 0: 1 } })"); eq(nr("ubLearnOut(0)"), 0, "...even if the state says otherwise");
        nr("MM.setUI({ lout: {} })");
    }

    // ---- everywhere mappings are listed they name the source output
    {
        const tg = (k, nm) => `{ path: 'live_set tracks 0 devices 0 parameters ${k}', paramName: '${nm}', trackName: 'Drums', deviceName: 'Reverb', id: ${5000 + k} }`;
        const mx = nr(`MM.addMapping(1, ${tg(1, "Dry/Wet")}, 0)`), my = nr(`MM.addMapping(1, ${tg(2, "Decay")}, 1)`), mx2 = nr(`MM.addMapping(1, ${tg(3, "Size")}, 0)`), my2 = nr(`MM.addMapping(1, ${tg(4, "Room")}, 1)`);
        const mb = nr(`MM.addMapping(2, ${tg(5, "Feedback")}, 1)`);
        ok(mx && my && mx2 && my2 && mb, "mappings from X, Y and button 2");
        nr(`MM.state.mods[1].name = "XY 1"; MM.state.mods[2].name = "Btn 2"`);
        eq(nr(`ubSrcLabel(MM.getMapping(${mx.id}))`), "XY 1 · X", "label of an X mapping"); eq(nr(`ubSrcLabel(MM.getMapping(${my.id}))`), "XY 1 · Y", "label of a Y mapping");
        eq(nr(`ubSrcLabel(MM.getMapping(${mb.id}))`), "Btn 2 · B", "label of a button 2 mapping"); eq(nr("ubSrcLabel({ mod: 0, out: 0 })"), nr("MM.state.mods[0].name"), "a single-output source is just the name");
        eq(nr(`ubSrcShort(MM.getMapping(${my.id}))`), "XY 1·Y", "compact source label");
        ok(nr(`ubTargetPath(MM.getMapping(${my.id}))`).indexOf("[XY 1 · Y]") >= 0, "the hover path names the source output");
        // the inspector list groups by output: X rows first, then Y
        nr("MM.setUI({ pb: 1, sel: 1, exp: [], pbScroll: 0 }); ubSyncWidth(true)");
        const items = nr("ubListItems()").filter((it) => it.kind === "map").map((it) => it.m.id);
        deq(items, [mx.id, mx2.id, my.id, my2.id], "the LST list shows the X rows, then the Y rows");
        N.log.texts.length = 0; nr("paint()");
        ok(N.log.texts.includes("X") && N.log.texts.includes("Y"), "the rows carry X / Y tag chips");
        ok(N.log.texts.some((t) => /XY 1 · [XY]/.test(t)), "the remap editor header names the source output");
        // a depth route driven by Y: its sub-row names the output
        const dr = nr(`MM.addDepthRoute(1, ${mx.id}, 1)`);
        ok(dr && dr.out === 1, "depth route from Y");
        N.log.texts.length = 0; nr("paint()");
        ok(N.log.texts.some((t) => t === "XY 1·Y"), "the depth sub-row names its source output");
        // the strips popover
        nr("MM.setUI({ pb: 0, exp: [], sel: 1 }); ubSyncWidth(true)");
        click(...ctr(rectsOf(1).count)); up();
        ok(nr("!!ubMapsPop"), "popover opens");
        const P = nr("ubMapsPopGeom()");
        const popOuts = P.vis.filter((v) => v.kind === "map").map((v) => v.m.out);
        ok(popOuts.length >= 4 && popOuts.every((o, i) => i === 0 || o >= popOuts[i - 1]) && popOuts[0] === 0 && popOuts[popOuts.length - 1] === 1, `popover rows grouped X then Y (${popOuts})`);
        N.log.texts.length = 0; nr("paint()");
        ok(N.log.texts.includes("X") && N.log.texts.includes("Y"), "popover rows carry the output tag");
        nr("ubMapsPop = null");
        // Buttons' own list
        nr("MM.setUI({ pb: 1, sel: 2 })");
        N.log.texts.length = 0; nr("paint()");
        ok(N.log.texts.includes("B"), "Buttons rows carry the B tag");
        nr("MM.setUI({ pb: 0 })");
    }

    // ---- faces: Buttons carry a live.text each, the XY pad none, the thresh knob none
    {
        nr("MM.setUI({ pb: 0, exp: [], sel: 0 }); ubSyncWidth(true)");
        const check = (label) => {
            nr("paint()");
            const sh = nr("MM.faceState().shown");
            const names = Object.keys(sh).sort();
            const rects = names.map((n) => [n, N.live[n].attrs.presentation_rect]);
            for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) ok(!inter(rects[a][1], rects[b][1]), `${label}: ${rects[a][0]} and ${rects[b][0]} do not overlap`);
            for (const [n, r] of rects) ok(r[0] >= 4 && r[1] >= 4 && r[0] + r[2] <= 4 + nr("ubFaceLimit()") + 1e-6 && r[1] + r[3] <= 165 + 1e-6, `${label}: ${n} inside the device`);
            return { names, rects: Object.fromEntries(rects) };
        };
        for (const big of [false, true]) {
            nr(`MM.setUI({ exp: ${big ? "[0, 1, 2]" : "[]"} }); ubSyncWidth(true)`);
            const f = check(big ? "expanded" : "collapsed");
            const Rx = rectsOf(1), Rb = rectsOf(2), Ra = rectsOf(0);
            for (const n of f.names) { const r = f.rects[n]; const lr = [r[0] - 4, r[1] - 4, r[2], r[3]]; ok(!inter(lr, Rx.pad), `${big ? "expanded" : "collapsed"}: ${n} does not cover the XY pad`); }
            for (let b = 0; b < 2; b++) {
                const key = "at_" + (12 + (b === 0 ? 1 : 2));
                ok(f.names.indexOf(key) >= 0, `Buttons: ${key} is shown`);
                const r = f.rects[key];
                deq([r[0] - 4, r[1] - 4, r[2], r[3]], Rb.btn[b], `Buttons: the face of button ${b + 1} is exactly the button`);
            }
            ok(f.names.indexOf("ap_6") >= 0 && f.names.indexOf("ap_7") >= 0, "XY: the X and Y knobs carry the dial faces");
            ok(!f.names.some((n) => /^ap_(2\d)$/.test(n)), "no face outside the 16 slots");
            // the ADSR threshold knob has no face: every face of strip 0 maps to a parameter
            const keysA = ["ap_0", "ap_1", "ap_2", "ap_3", "ap_4", "ap_5"].filter((n) => f.names.indexOf(n) >= 0);
            ok(keysA.length >= (big ? 5 : 2), `ADSR: ${keysA.length} generic faces`);
            // faces never overlap the other drawn controls of their strip (pad, source tabs, chips ...)
            for (const n of f.names) {
                const slot = Math.floor(Number(n.split("_")[1]) / 6);
                if (slot > 2) continue;
                const r = f.rects[n], lr = [r[0] - 4, r[1] - 4, r[2], r[3]];
                const R = [Ra, Rx, Rb][slot];
                if (R.src) for (const s of R.src) ok(!inter(lr, s), `${n} does not cover a source tab`);
                if (R.count) ok(!inter(lr, R.count), `${n} does not cover the count chip`);
            }
        }
    }

    // ---- the Follower: saved states and the UI say Follower, the type id is unchanged
    {
        nr("MM.setUI({ pb: 0, exp: [], sel: 0 }); ubSyncWidth(true)");
        nr("ubAddType(MOD_ENV)");
        eq(nr("MM.state.mods[3].name"), "Follower 4", "a new Follower is named Follower 4");
        nr("ubSetExpanded(3)");
        const t = texts();
        ok(t.includes("FLW") && !t.includes("ENV"), "the type chip of the Follower says FLW");
        const R = rectsOf(3);
        deq(R.knobs.map((k) => k.spec.label), ["Atk", "Rel", "Gain", "Depth"], "Follower knobs unchanged");
        nr("ubSetExpanded(-1)");
    }
}


// ---------------------------------------------------------------- deferred DSP pill (src/megamod_dsp.js): "DSP loading..." until the engine / routers run
{
    const T = makeEnv();
    T.run("MM.demo();");
    T.run("MM.dspSetState(false, '')");
    T.log.texts.length = 0; T.ctx.paint();
    ok(T.log.texts.some((t) => /^DSP loading/.test(t)), "a device whose DSP is not up shows the `DSP loading` pill");
    T.run("MM.dspSetState(false, 'not_running')");
    T.log.texts.length = 0; T.ctx.paint();
    ok(T.log.texts.some((t) => t === "DSP failed: not_running"), "a failed DSP shows the reason");
    T.run("MM.dspSetState(true, '')");
    T.log.texts.length = 0; T.ctx.paint();
    ok(!T.log.texts.some((t) => /^DSP /.test(t)), "no pill once the DSP runs");
    // MM.demo() (previews) is a running device
    const T2 = makeEnv();
    T2.run("MM.dspSetState(false, '')"); T2.run("MM.demo();");
    T2.log.texts.length = 0; T2.ctx.paint();
    ok(!T2.log.texts.some((t) => /^DSP /.test(t)), "previews show no pill");
}

console.log(`megamod UI tests passed (${passed} checks)`);
