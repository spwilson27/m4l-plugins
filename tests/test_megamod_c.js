#!/usr/bin/env node
/**
 * Variant-specific tests for devices/Mega Modulator C.amxd (design C "List + Editor").
 * Runs src/megamod_ui_c.js (with the shared config + mapper) in a VM with a recording mgraphics mock and checks:
 * paint in every mode (list, Edit tab per modulator type, Targets, learning, inspector, popups), drawing bounds,
 * device width for 0 / 1 / 8 / 16 modulators, hit-testing (rows, tabs, range bar ends, curve cell), learn single /
 * shift calls, sorting, persistence of state.ui and editing gestures (MSEG, Steps, value bars).
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
    const log = { outlets: [], notify: 0, rects: [], texts: [], redraws: 0 };
    const mg = {
        size: [424, 161], relative_coords: 0, autofill: 0, init() {}, redraw() { log.redraws++; },
        text_measure: (t) => [String(t).length * 4.2, 8],
    };
    for (const f of ["set_source_rgba", "set_line_width", "move_to", "line_to", "curve_to", "close_path", "arc", "fill", "fill_preserve", "stroke", "select_font_face", "set_font_size", "save", "restore", "translate", "rotate", "ellipse"]) mg[f] = () => {};
    mg.rectangle = (x, y, w, h) => log.rects.push([x, y, w, h]);
    mg.rectangle_rounded = (x, y, w, h) => log.rects.push([x, y, w, h]);
    mg.show_text = (t) => log.texts.push(String(t));
    const ctx = {
        mgraphics: mg, console, inlets: 1, outlets: 2,
        outlet: (...a) => log.outlets.push(a),
        notifyclients: () => { log.notify++; },
        post: () => {},
        arrayfromargs: (a) => Array.prototype.slice.call(a),
    };
    vm.createContext(ctx);
    const code = execFileSync("python3", ["-c",
        "import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script('c'))"],
        { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(code, ctx, { filename: "megamod_ui_c.js" });
    const run = (s) => vm.runInContext(s, ctx);
    const paint = () => { log.rects = []; log.texts = []; run("paint()"); return log; };
    const widths = () => log.outlets.filter((o) => o[1] === "width").map((o) => o[2]);
    return { ctx, log, run, paint, widths };
}

// -------------------------------------------------------------- load + empty paint + widths
{
    const e = makeEnv();
    e.paint();
    eq(e.run("typeof MM"), "object", "MM exists");
    eq(e.run("uiWidth()"), 138, "0 modulators: list only");
    for (const [n, w] of [[1, 138], [8, 138], [9, 268], [16, 268]]) {
        e.run("MM.state = defaultState()");
        e.run(`for (let k = 0; k < ${n}; k++) MM.addModulator(1 + (k % 5));`);
        e.paint();
        eq(e.run("uiWidth()"), w, `${n} modulators: width`);
        eq(e.widths().slice(-1)[0], w, `${n} modulators: width requested`);
    }
    eq(e.run("MM.modCount()"), 16, "16 added");
    eq(e.run("MM.addModulator(MOD_LFO)"), -1, "17th refused");
    e.paint();
    ok(e.log.texts.some((t) => /FULL/.test(t)), "add row says FULL at 16");
    ok(!e.run("uiHits.some((h) => h.k === 'add')"), "no add hit when full");
    // editor / inspector grow the width
    e.run("MM.setUI({sel: 0, edOpen: 1})");
    eq(e.run("uiWidth()"), 268 + 294, "16 modulators + editor");
    e.run("MM.setUI({edOpen: 0, insp: 1})");
    eq(e.run("uiWidth()"), 268 + 294, "inspector uses the same area");
    e.run("MM.state = defaultState()");
    e.run("MM.addModulator(MOD_LFO); MM.setUI({sel: 0, edOpen: 0, insp: 0})");
    eq(e.run("uiWidth()"), 138, "1 modulator closed");
    e.run("MM.setUI({edOpen: 1})");
    eq(e.run("uiWidth()"), 432, "1 modulator + editor");
    eq(e.widths().slice(-1)[0], 432, "editor open requests the wider device");
    e.run("MM.setUI({edOpen: 0})");
    eq(e.widths().slice(-1)[0], 138, "editor closed shrinks again");
}

// -------------------------------------------------------------- paint in every mode, within bounds
function inBounds(log, W, H, msg) {
    for (const [x, y, w, h] of log.rects) ok(x >= -0.01 && y >= -0.01 && x + w <= W + 0.01 && y + h <= H + 0.01, `${msg}: rect ${[x, y, w, h]} inside ${W}x${H}`);
}
{
    const e = makeEnv();
    e.run("preview()");
    for (const mode of ["edit", "targets"]) {
        for (let i = 0; i < 6; i++) {
            e.run(`MM.setUI({sel: ${i}, tab: '${mode}', edOpen: 1, insp: 0})`);
            e.ctx.mgraphics.size = [e.run("uiWidth()") - 8, 161];
            const log = e.paint();
            inBounds(log, e.run("uiWidth()") - 8, 161, `mod ${i} ${mode}`);
            ok(log.texts.length > 5, `mod ${i} ${mode}: text drawn`);
            ok(e.run("uiHits.length") > 8, `mod ${i} ${mode}: hits registered`);
        }
    }
    e.run("MM.setUI({sel: 4, tab: 'edit'})");
    ok(e.paint().texts.includes("Loop"), "MSEG edit tab has the Loop toggle");
    e.run("MM.setUI({insp: 1})");
    const log = e.paint();
    inBounds(log, 424, 161, "inspector");
    ok(log.texts.includes("TARGET") && log.texts.includes("MOD"), "inspector headers");
    // popups
    e.run("uiOpenPopup('add', 20, 100, UI_ADD_TYPES.slice(), {})");
    ok(e.paint().texts.includes("Envelope"), "add popup lists types");
    e.run("uiPopup = null; uiCurveMenu(1, 100, 40)");
    ok(e.paint().texts.includes("S-Curve"), "curve popup lists curves");
    e.run("uiPopup = null");
    // learning row + missing tag
    e.run("MM.setUI({insp: 0, sel: 0, tab: 'targets'}); MM.mappingStatus = (id) => (id === 6 ? 'missing' : 'ok'); MM.armLearn(0, true)");
    const l2 = e.paint();
    ok(l2.texts.some((t) => /LEARNING/.test(t)), "LEARNING row painted while armed");
    ok(l2.texts.some((t) => /STOP LEARNING/.test(t)), "button shows stop state");
    ok(l2.texts.includes("missing"), "missing tag on a missing mapping");
    eq(e.run("MM.getUI().scrollT"), 999, "armed learn scrolls Targets to the end");
    e.run("MM.disarmLearn()");
}

{
    const e = makeEnv();
    e.run("MM.state = defaultState(); for (let k = 0; k < 16; k++) MM.addModulator(1 + (k % 5));");
    e.run("MM.setUI({sel: 12, edOpen: 1, tab: 'edit'})");
    e.ctx.mgraphics.size = [e.run("uiWidth()") - 8, 161];
    const log = e.paint();
    inBounds(log, e.run("uiWidth()") - 8, 161, "16 modulators + editor");
    eq(e.run("uiHitAt(130 + 60, 16 + 3 * 16 + 8).mod"), 11, "second column row hit");
    eq(e.run("uiHitAt(130 + 60, 16 + 4 * 16 + 8).mod"), 12, "second column row 5 -> slot 12");
}

// -------------------------------------------------------------- hit testing: rows, tabs, header
{
    const e = makeEnv();
    e.run("preview()");
    e.run("MM.setUI({sel: 0, edOpen: 0, insp: 0})");
    e.paint();
    // row hit-testing in the list
    for (let p = 0; p < 6; p++) {
        const y = 16 + p * 16 + 8;
        const h = e.run(`uiHitAt(60, ${y})`);
        eq([h.k, h.mod], ["row", p], `row ${p} hit`);
    }
    ok(e.run("uiHitAt(60, 16 + 6 * 16 + 8)") === null, "empty list area has no hit");
    eq(e.run("uiHitAt(60, 150).k"), "add", "add row hit");
    eq(e.run("uiHitAt(9, 24).k"), "dot", "colour dot hit");
    eq(e.run("uiHitAt(122, 24).k"), "arrow", "arrow hit");
    eq(e.run("uiHitAt(105, 24).k"), "count", "count hit");
    eq(e.run("uiHitAt(115, 8).k"), "insp", "inspector button hit");
    // single click selects, dblclick opens the editor, again closes it
    e.ctx.onclick(60, 16 + 2 * 16 + 8, 1, 0, 0);
    eq(e.run("MM.getUI().sel"), 2, "click selects");
    eq(e.run("!!MM.getUI().edOpen"), false, "click does not open");
    e.ctx.ondblclick(60, 16 + 2 * 16 + 8, 1, 0, 0);
    eq(e.run("MM.getUI().edOpen"), 1, "dblclick opens the editor");
    eq(e.run("uiWidth()"), 432, "editor widens the device");
    e.paint();
    e.ctx.onclick(60, 16 + 2 * 16 + 8, 1, 0, 0);
    e.ctx.ondblclick(60, 16 + 2 * 16 + 8, 1, 0, 0);
    eq(e.run("MM.getUI().edOpen"), 0, "dblclick again closes it");
    e.ctx.ondblclick(60, 16 + 1 * 16 + 8, 1, 0, 0);
    eq([e.run("MM.getUI().sel"), e.run("MM.getUI().edOpen")], [1, 1], "dblclick another row opens it for that row");
    // tabs
    e.paint();
    const t = e.run("uiTabRects(uiAreaX())");
    e.ctx.onclick(t.targets.x + 5, t.targets.y + 5, 1, 0, 0);
    eq(e.run("MM.getUI().tab"), "targets", "Targets tab click");
    e.paint();
    e.ctx.onclick(t.edit.x + 5, t.edit.y + 5, 1, 0, 0);
    eq(e.run("MM.getUI().tab"), "edit", "Edit tab click");
    e.paint();
    eq(e.run("uiHitAt(uiAreaX() + 275, 8).k"), "close", "close glyph hit");
    e.ctx.onclick(e.run("uiAreaX() + 275"), 8, 1, 0, 0);
    eq(e.run("MM.getUI().edOpen"), 0, "close glyph collapses the editor");
    // inspector toggle
    e.ctx.onclick(115, 8, 1, 0, 0);
    eq(e.run("MM.getUI().insp"), 1, "inspector toggles on");
    e.ctx.onclick(115, 8, 1, 0, 0);
    eq(e.run("MM.getUI().insp"), 0, "inspector toggles off");
    // persistence through save / load
    e.run("MM.setUI({sel: 3, edOpen: 1, tab: 'targets', insp: 1, sort: 'target', sortDir: -1, scrollT: 2, scrollI: 3})");
    const saved = e.run("MM.save()");
    const e2 = makeEnv();
    e2.ctx.setvalueof(saved);
    eq(["sel", "edOpen", "tab", "insp", "sort", "sortDir", "scrollT", "scrollI"].map((k) => e2.run(`MM.getUI().${k}`)), [3, 1, "targets", 1, "target", -1, 2, 3], "state.ui round trip");
}

// -------------------------------------------------------------- learn: single / shift
{
    const e = makeEnv();
    e.run("preview()");
    e.run("MM.setUI({sel: 0, edOpen: 0, insp: 0})");
    e.paint();
    e.run("globalThis.calls = []; MM.armLearn = (i, m) => { calls.push(['arm', i, m]); MM.learn = {armed: true, mod: i, multi: m}; }; MM.disarmLearn = () => { calls.push(['dis']); MM.learn = {armed: false, mod: -1, multi: false}; };");
    e.ctx.onclick(122, 16 + 2 * 16 + 8, 1, 0, 0);
    eq(e.run("calls.slice()"), [["arm", 2, false]], "arrow click = single-shot learn");
    e.paint();
    e.ctx.onclick(122, 16 + 2 * 16 + 8, 1, 0, 0);
    eq(e.run("calls.slice(-1)[0]"), ["dis"], "arrow click again disarms");
    e.ctx.onclick(122, 16 + 3 * 16 + 8, 1, 0, 1);
    eq(e.run("calls.slice(-1)[0]"), ["arm", 3, true], "shift-click arrow = multi-learn");
    e.run("MM.learn = {armed: false, mod: -1, multi: false}; calls.length = 0");
    // + Map button in the Targets tab
    e.run("MM.setUI({sel: 0, edOpen: 1, tab: 'targets'})");
    e.paint();
    const mh = e.run("uiHits.find((h) => h.k === 'learn')");
    e.ctx.onclick(mh.x + 20, mh.y + 6, 1, 0, 0);
    eq(e.run("calls.slice()"), [["arm", 0, false]], "+ Map click = single-shot");
    e.run("MM.learn = {armed: false, mod: -1, multi: false}");
    e.ctx.onclick(mh.x + 20, mh.y + 6, 1, 0, 1);
    eq(e.run("calls.slice(-1)[0]"), ["arm", 0, true], "+ Map shift-click = multi-learn");
    e.paint();
    e.ctx.onclick(mh.x + 20, mh.y + 6, 1, 0, 0);
    eq(e.run("calls.slice(-1)[0]"), ["dis"], "+ Map click while learning stops it");
}

// -------------------------------------------------------------- range bar, curve, delete, mode
{
    const e = makeEnv();
    e.run("preview()");
    e.run("MM.setUI({sel: 0, edOpen: 1, tab: 'targets', insp: 0})");
    e.paint();
    const rh = (id) => e.run(`uiHits.find((h) => h.k === 'range' && h.id === ${id})`);
    // bipolar mod mapping (id 1, amount 0.62): right end at centre + 0.62 * w/2
    const h1 = rh(1);
    const m1 = e.run("MM.getMapping(1)");
    const ends = e.run("uiRangeEnds(MM.getMapping(1), " + h1.rx + ", " + h1.rw + ")");
    near(ends.b, h1.rx + h1.rw / 2 + 0.62 * h1.rw / 2, 1e-6, "bipolar right end position");
    near(ends.a, h1.rx + h1.rw / 2 - 0.62 * h1.rw / 2, 1e-6, "bipolar left end position");
    // press near the LEFT end, drag to 90 % of the track -> mirrors to amount -0.8
    e.ctx.onclick(ends.a, h1.y + 8, 1, 0, 0);
    e.ctx.ondrag(h1.rx + h1.rw * 0.1, h1.y + 8, 1, 0, 0);
    near(e.run("MM.getMapping(1).amount"), 0.8, 1e-6, "dragging the left end widens symmetric range");
    e.ctx.ondrag(h1.rx + h1.rw * 0.1, h1.y + 8, 0, 0, 0);
    // right end
    e.paint();
    const e2 = e.run(`uiRangeEnds(MM.getMapping(1), ${h1.rx}, ${h1.rw})`);
    e.ctx.onclick(e2.b, h1.y + 8, 1, 0, 0);
    e.ctx.ondrag(h1.rx + h1.rw * 0.55, h1.y + 8, 1, 0, 0);
    near(e.run("MM.getMapping(1).amount"), 0.1, 1e-6, "dragging the right end narrows it");
    e.ctx.ondrag(0, 0, 0, 0, 0);
    // remote mapping (id 3: min 0.2, max 0.85): both ends independent
    const h3 = rh(3);
    const r3 = e.run(`uiRangeEnds(MM.getMapping(3), ${h3.rx}, ${h3.rw})`);
    near(r3.a, h3.rx + 0.2 * h3.rw, 1e-6, "remote min end");
    near(r3.b, h3.rx + 0.85 * h3.rw, 1e-6, "remote max end");
    e.ctx.onclick(r3.a, h3.y + 8, 1, 0, 0);
    e.ctx.ondrag(h3.rx + 0.4 * h3.rw, h3.y + 8, 1, 0, 0);
    e.ctx.ondrag(0, 0, 0, 0, 0);
    near(e.run("MM.getMapping(3).min"), 0.4, 1e-6, "remote min dragged");
    near(e.run("MM.getMapping(3).max"), 0.85, 1e-6, "remote max untouched");
    e.paint();
    e.ctx.onclick(r3.b + 2, h3.y + 8, 1, 0, 0);
    e.ctx.ondrag(h3.rx + 0.7 * h3.rw, h3.y + 8, 1, 0, 0);
    e.ctx.ondrag(0, 0, 0, 0, 0);
    near(e.run("MM.getMapping(3).max"), 0.7, 1e-6, "remote max dragged");
    // mode toggle, invert, delete, curve dropdown
    e.paint();
    let h = e.run("uiHits.find((h) => h.k === 'tmode' && h.id === 1)");
    e.ctx.onclick(h.x + 3, h.y + 5, 1, 0, 0);
    eq(e.run("MM.getMapping(1).mode"), "remote", "M/R toggle");
    h = e.run("uiHits.find((h) => h.k === 'tinv' && h.id === 2)");
    e.ctx.onclick(h.x + 3, h.y + 5, 1, 0, 0);
    eq(e.run("MM.getMapping(2).invert"), 1, "invert toggle");
    e.paint();
    h = e.run("uiHits.find((h) => h.k === 'tcurve' && h.id === 2)");
    e.ctx.onclick(h.x + 5, h.y + 5, 1, 0, 0);
    ok(e.run("uiPopup && uiPopup.kind === 'curve'"), "curve dropdown opens");
    e.paint();
    const pop = e.run("uiPopup");
    e.ctx.onclick(pop.x + 10, pop.y + 2 + 2 * 15 + 5, 1, 0, 0); // third item = Log
    eq(e.run("MM.getMapping(2).curve"), 2, "curve picked from the dropdown");
    eq(e.run("uiPopup"), null, "dropdown closes");
    e.paint();
    h = e.run("uiHits.find((h) => h.k === 'tdel' && h.id === 2)");
    e.ctx.onclick(h.x + 4, h.y + 5, 1, 0, 0);
    eq(e.run("MM.getMapping(2)"), null, "delete removes the mapping");
    eq(e.run("MM.mappingsFor(0).length"), 5, "five mappings left on mod 0");
}

// -------------------------------------------------------------- inspector: sorting, curve click / drag, scroll
{
    const e = makeEnv();
    e.run("preview()");
    e.run("MM.setUI({insp: 1, sort: 'mod', sortDir: 1})");
    e.paint();
    const ids = (k, d) => e.run(`uiSortMappings(MM.allMappings(), '${k}', ${d}).map((m) => m.id)`);
    eq(ids("mod", 1), [1, 2, 3, 4, 5, 6, 7, 8, 9], "sort by modulator asc");
    ok(ids("mod", -1)[0] === 9, "desc starts with the last modulator");
    const byT = e.run("uiSortMappings(MM.allMappings(), 'target', 1).map((m) => m.target.trackName + '/' + m.target.deviceName + '/' + m.target.paramName)");
    const sorted = byT.slice().sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
    eq(byT, sorted, "sort by target is track/device/param order");
    // header clicks
    const hs = e.run("uiHits.filter((h) => h.k === 'sort')");
    eq(hs.map((h) => h.key), ["mod", "target"], "two sortable headers");
    e.ctx.onclick(hs[1].x + 5, hs[1].y + 5, 1, 0, 0);
    eq([e.run("MM.getUI().sort"), e.run("MM.getUI().sortDir")], ["target", 1], "click header selects the key");
    e.paint();
    e.ctx.onclick(hs[1].x + 5, hs[1].y + 5, 1, 0, 0);
    eq(e.run("MM.getUI().sortDir"), -1, "click again flips the direction");
    // painted order follows the sort
    e.paint();
    const first = e.run("uiHits.filter((h) => h.k === 'itarget')[0].id");
    eq(first, e.run("uiSortMappings(MM.allMappings(), 'target', -1)[0].id"), "first row is the first of the sorted list");
    // curve: click cycles, drag adjusts amount
    e.run("MM.setUI({sort: 'mod', sortDir: 1})");
    e.paint();
    let ch = e.run("uiHits.find((h) => h.k === 'icurve' && h.id === 1)");
    const c0 = e.run("MM.getMapping(1).curve");
    e.ctx.onclick(ch.x + 5, ch.y + 5, 1, 0, 0);
    e.ctx.ondrag(ch.x + 5, ch.y + 5, 0, 0, 0);
    eq(e.run("MM.getMapping(1).curve"), (c0 + 1) % 5, "click on the curve preview cycles the curve");
    e.paint();
    const a0 = e.run("MM.getMapping(1).curveAmt");
    e.ctx.onclick(ch.x + 5, ch.y + 8, 1, 0, 0);
    e.ctx.ondrag(ch.x + 5, ch.y - 12, 1, 0, 0);
    e.ctx.ondrag(ch.x + 5, ch.y - 12, 0, 0, 0);
    ok(e.run("MM.getMapping(1).curveAmt") > a0, "dragging up increases the curve amount");
    eq(e.run("MM.getMapping(1).curve"), (c0 + 1) % 5, "a drag does not cycle the curve");
    // shift-click inverts
    e.paint();
    const inv0 = e.run("MM.getMapping(1).invert");
    e.ctx.onclick(ch.x + 5, ch.y + 5, 1, 0, 1);
    e.ctx.ondrag(ch.x + 5, ch.y + 5, 0, 0, 0);
    eq(e.run("MM.getMapping(1).invert"), inv0 ? 0 : 1, "shift-click on the curve toggles invert");
    // click modulator cell: jump to that modulator's Targets tab
    e.paint();
    const im = e.run("uiHits.find((h) => h.k === 'imod' && h.mod === 4)");
    e.ctx.onclick(im.x + 5, im.y + 5, 1, 0, 0);
    eq([e.run("MM.getUI().sel"), e.run("MM.getUI().tab"), e.run("MM.getUI().insp")], [4, "targets", 0], "mod cell opens its Targets tab");
    // many mappings: scroll + hover HUD with full target text
    e.run("MM.setUI({insp: 1, sel: 0}); for (let k = 0; k < 30; k++) MM.addMapping(0, {path: 'live_set tracks 3 devices 2 parameters ' + k, trackName: 'A very long track name', deviceName: 'Some device', paramName: 'Parameter ' + k});");
    e.paint();
    ok(e.run("uiHits.filter((h) => h.k === 'itarget').length") <= e.run("uiInspRows()"), "only visible rows are hit-testable");
    e.ctx.onwheel(300, 80, 0, -1);
    eq(e.run("MM.getUI().scrollI"), 1, "wheel scrolls the inspector");
    for (let k = 0; k < 100; k++) e.ctx.onwheel(300, 80, 0, -1);
    eq(e.run("MM.getUI().scrollI"), e.run("MM.allMappings().length - uiInspRows()"), "scroll clamps to the end");
    e.paint();
    const hr = e.run("uiHits.find((h) => h.k === 'itarget')");
    e.ctx.onidle(hr.x + 5, hr.y + 5);
    const log = e.paint();
    ok(log.texts.some((t) => t.includes("A very long track name > Some device > Parameter")), "hover HUD shows the full target path");
    const longText = log.texts.find((t) => t.includes("A very long track"));
    ok(longText.includes(">"), "HUD uses separators");
}

// -------------------------------------------------------------- editing gestures: bars, steps, MSEG
{
    const e = makeEnv();
    e.run("preview()");
    e.run("MM.setUI({sel: 0, edOpen: 1, tab: 'edit', insp: 0})");
    e.paint();
    // LFO: shape glyph + rate bar (sync -> division) + toggle
    const sh = e.run("uiHits.find((h) => h.k === 'shape' && h.shape === 4)");
    e.ctx.onclick(sh.x + 5, sh.y + 5, 1, 0, 0);
    eq(e.run("MM.state.mods[0].p.shape"), 4, "shape glyph click");
    const rb = e.run("uiHits.find((h) => h.k === 'bar' && h.rkey === 'rate')");
    eq(rb.key, "syncDiv", "rate bar is a division chooser when synced");
    e.ctx.onclick(rb.x + rb.w * 0.0 + 1, rb.y + 5, 1, 0, 0);
    eq(e.run("MM.state.mods[0].p.syncDiv"), 0, "bar press sets the lowest division");
    e.ctx.ondrag(rb.x + rb.w - 1, rb.y + 5, 1, 0, 0);
    eq(e.run("MM.state.mods[0].p.syncDiv"), 15, "bar drag sets the highest division");
    e.ctx.ondrag(0, 0, 0, 0, 0);
    e.ctx.ondblclick(rb.x + 10, rb.y + 5, 1, 0, 0);
    eq(e.run("MM.state.mods[0].p.syncDiv"), 9, "double-click resets to the default");
    e.paint();
    let tg = e.run("uiHits.find((h) => h.k === 'toggle' && h.key === 'sync')");
    e.ctx.onclick(tg.x + 5, tg.y + 5, 1, 0, 0);
    eq(e.run("MM.state.mods[0].p.sync"), 0, "Sync toggle");
    e.paint();
    const rb2 = e.run("uiHits.find((h) => h.k === 'bar' && h.rkey === 'rate')");
    eq(rb2.key, "rate", "rate bar is Hz when free");
    // Steps editor
    e.run("MM.setUI({sel: 3})");
    e.paint();
    const sp = e.run("uiHits.find((h) => h.k === 'steps')");
    const n = e.run("MM.state.mods[3].p.steps");
    e.ctx.onclick(sp.x + sp.w * (2.5 / n), sp.y + 3, 1, 0, 0); // top of step 2 -> 1.0
    near(e.run("MM.state.mods[3].stepVals[2]"), 1, 1e-9, "step painted to full height");
    e.ctx.ondrag(sp.x + sp.w * (3.5 / n), sp.y + sp.h - 3, 1, 0, 0);
    near(e.run("MM.state.mods[3].stepVals[3]"), 0, 1e-9, "drag paints the next step");
    e.ctx.ondrag(0, 0, 0, 0, 0);
    // MSEG: drag a point, bend a segment, add and delete points
    e.run("MM.setUI({sel: 4})");
    e.paint();
    const mh = e.run("uiHits.find((h) => h.k === 'mseg')");
    const pts0 = e.run("MM.state.mods[4].points");
    const sc = (p) => e.run(`uiMsegXY(${JSON.stringify(p)}, ${JSON.stringify({ x: mh.x, y: mh.y, w: mh.w, h: mh.h })})`);
    const s1 = sc(pts0[1]);
    e.ctx.onclick(s1.x, s1.y, 1, 0, 0);
    e.ctx.ondrag(s1.x, s1.y + 20, 1, 0, 0);
    e.ctx.ondrag(s1.x, s1.y + 20, 0, 0, 0);
    ok(e.run("MM.state.mods[4].points[1].y") < pts0[1].y, "dragging a point down lowers it");
    // add a point on empty space, delete it again
    const before = e.run("MM.state.mods[4].points.length");
    e.paint();
    e.ctx.ondblclick(mh.x + mh.w * 0.9, mh.y + 6, 1, 0, 0);
    eq(e.run("MM.state.mods[4].points.length"), before + 1, "double-click adds a point");
    const pts1 = e.run("MM.state.mods[4].points");
    const added = pts1.findIndex((p) => p.x > 0.85);
    ok(added > 0, "added point is in x order");
    e.paint();
    const sa = sc(pts1[added]);
    e.ctx.ondblclick(sa.x, sa.y, 1, 0, 0);
    eq(e.run("MM.state.mods[4].points.length"), before, "double-click on a point deletes it");
    // end points cannot be deleted
    e.paint();
    const sfirst = sc(e.run("MM.state.mods[4].points[0]"));
    e.ctx.ondblclick(sfirst.x, sfirst.y, 1, 0, 0);
    eq(e.run("MM.state.mods[4].points.length"), before, "end points are kept");
    // segment bend
    e.paint();
    const pts2 = e.run("MM.state.mods[4].points");
    const nx = (pts2[1].x + pts2[2].x) / 2;
    const midY = mh.y + 4 + (1 - e.run(`evalMseg(MM.state.mods[4].points, ${nx})`)) * (mh.h - 8);
    const midX = mh.x + 4 + nx * (mh.w - 8);
    const c0 = pts2[1].curve;
    e.ctx.onclick(midX, midY, 1, 0, 0);
    e.ctx.ondrag(midX, midY - 15, 1, 0, 0);
    e.ctx.ondrag(midX, midY - 15, 0, 0, 0);
    ok(e.run("MM.state.mods[4].points[1].curve") !== c0, "dragging a segment bends its curve");
    // type chip popup retypes the modulator, trash removes it
    e.paint();
    const chip = e.run("uiHits.find((h) => h.k === 'typechip')");
    e.ctx.onclick(chip.x + 5, chip.y + 5, 1, 0, 0);
    e.paint();
    const pop = e.run("uiPopup");
    e.ctx.onclick(pop.x + 10, pop.y + 2 + 1 * 15 + 5, 1, 0, 0); // Envelope
    eq(e.run("MM.state.mods[4].type"), MODT("ENV"), "type chip changes the type");
    e.paint();
    const tr = e.run("uiHits.find((h) => h.k === 'trash')");
    e.ctx.onclick(tr.x + 5, tr.y + 5, 1, 0, 0);
    eq(e.run("MM.state.mods[4]"), null, "trash removes the modulator");
    // add popup
    e.paint();
    const ar = e.run("uiHits.find((h) => h.k === 'add')");
    const nb = e.run("MM.modCount()");
    e.ctx.onclick(ar.x + 10, ar.y + 5, 1, 0, 0);
    ok(e.run("uiPopup && uiPopup.kind === 'add'"), "add opens the type picker");
    e.paint();
    const ap = e.run("uiPopup");
    e.ctx.onclick(ap.x + 10, ap.y + 2 + 4 * 15 + 5, 1, 0, 0); // MSEG
    eq(e.run("MM.modCount()"), nb + 1, "picked type is added");
    eq(e.run("MM.state.mods[MM.getUI().sel].type"), 5, "new modulator is selected");
}
function MODT(n) { return { ENV: 2 }[n]; }

console.log(`megamod C tests passed (${passed} checks)`);
