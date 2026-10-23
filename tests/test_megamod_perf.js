/**
 * Mega Modulator UI cost and idle behaviour (Node, the mock `mgraphics`): `node tests/test_megamod_perf.js`
 *
 *   1. paint cost: ms per paint() of the strips view (16 modulators of every type, with 3 expanded), the LST inspector (a selected modulator with
 *      mappings), the Options view, with sane budgets (JS time only: the mock drawing calls do nothing, so this is the script's own cost) and an
 *      allocation-free `paint` for static geometry (the layout / text-measure caches)
 *   2. idle repaint suppression: the 30 fps telemetry poll must not request a repaint while nothing visible changes (no running modulator, a held
 *      value, the Options view, the unselected modulators of the LST view); it must while a visible modulator moves, an animation (armed LRN pulse,
 *      a note pill) runs, and for a short linger after the last change (the scrolling follower trace)
 *   3. the poll rate drops to the idle interval and returns on activity; faces / widths are not recomputed by a poll
 *   4. buffer writes: a cfg slot / table / route cell whose value did not change is not written again
 * Budgets are generous multiples of what the final code measures (CI noise), so a regression of an order of magnitude fails.
 */
const assert = require("assert");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "src", "megamod_config.js"));
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); passed++; };
const report = (s) => console.log("  " + s);

function makeEnv() {
    const log = { outlets: [], notify: 0, redraws: 0, draws: 0, pokes: 0, tasks: [] };
    const mg = { size: [588, 161], init() {}, redraw() { log.redraws++; }, relative_coords: 0, autofill: 0 };
    for (const f of ["set_line_width", "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse", "stroke", "select_font_face", "set_font_size", "save", "restore", "translate", "rotate", "set_source_rgba", "rectangle", "rectangle_rounded", "fill", "show_text"]) mg[f] = () => {};
    mg.fill = () => { log.draws++; };
    mg.text_measure = (t) => [String(t).length * 4, 8];
    const box = { rect: [4, 4, 588, 161], getattr: () => box.rect, setattr: (k, ...v) => { box.rect = v; } };
    const store = {};
    class Buffer {
        constructor(name) { this.name = name; if (!store[name]) store[name] = { data: new Float64Array(Math.max(C.CURVE_SAMPS, C.ICURVE_SAMPS, 20000)), pokes: 0 }; this.s = store[name]; }
        peek(ch, off, n) { if (n === 1) return this.s.data[off]; return Array.from(this.s.data.subarray(off, off + n)); }
        poke(ch, off, arr) { log.pokes++; this.s.pokes++; for (let i = 0; i < arr.length; i++) this.s.data[off + i] = arr[i]; }
        framecount() { return this.s.data.length; }
    }
    class Task {
        constructor(fn) { this.fn = fn; this.interval = 0; this.repeating = false; log.tasks.push(this); }
        repeat() { this.repeating = true; }
        schedule(ms) { this.sched = ms; }
        cancel() { this.sched = undefined; }
    }
    const patcher = { getnamed: () => null, bringtofront() {}, newdefault() { throw new Error("no scripting in this test"); } };
    const ctx = { mgraphics: mg, console, box, patcher, Buffer, Task, outlet: (...a) => log.outlets.push(a), notifyclients: () => { log.notify++; }, post() {}, arrayfromargs: (a) => Array.prototype.slice.call(a), inlets: 1, outlets: 2 };
    vm.createContext(ctx);
    const code = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script())"], { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(code, ctx, { filename: "megamod_ui.js" });
    vm.runInContext("mmdRouterMsg = function () {}; MM.dspSetState(true);", ctx);
    const run = (c) => vm.runInContext(c, ctx);
    ctx.setnames("n_cfg", "n_mseg", "n_steps", "n_scope", "n_curve", "n_route", "n_int", "n_icurve");
    ctx.init_lom();
    new Buffer("n_scope");
    const scope = store["n_scope"].data;
    return { ctx, log, run, store, scope };
}
const TYPES = [C.MOD_LFO, C.MOD_LFO, C.MOD_ENV, C.MOD_RANDOM, C.MOD_STEPS, C.MOD_MSEG, C.MOD_ADSR, C.MOD_XY, C.MOD_BTN, C.MOD_LFO, C.MOD_RANDOM, C.MOD_STEPS, C.MOD_MSEG, C.MOD_ENV, C.MOD_LFO, C.MOD_ADSR];

function fill16(e) {
    for (let i = 0; i < 16; i++) e.run(`MM.addModulator(${TYPES[i]})`);
    ok(e.run("MM.state.mods.filter(function (m) { return m; }).length") === 16, "16 modulators");
}
// telemetry: slot s -> [out, phase, u, aux] at 4 s (the engine's scope layout), `t` seconds
function animate(e, t) {
    for (let s = 0; s < 16; s++) {
        const ph = (t * (0.5 + s * 0.13)) % 1;
        e.scope[4 * s] = Math.sin(ph * 6.28) * 0.5; e.scope[4 * s + 1] = ph; e.scope[4 * s + 2] = 0.5 + 0.5 * Math.sin(ph * 6.28); e.scope[4 * s + 3] = Math.floor(t * 3) % 8;
    }
    e.scope[C.SCOPE_FRAME] = Math.floor(t * 1000);
}
function still(e) { for (let s = 0; s < 64; s++) e.scope[s] = 0; }

// ---------------------------------------------------------------- 1. paint cost
function timePaint(e, label, budgetMs, n = 200) {
    for (let i = 0; i < 20; i++) e.ctx.paint(); // warm up
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) e.ctx.paint();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
    report(`paint ${label}: ${ms.toFixed(3)} ms (budget ${budgetMs} ms)`);
    ok(ms < budgetMs, `${label}: ${ms.toFixed(3)} ms per paint exceeds the ${budgetMs} ms budget`);
    return ms;
}
{
    const e = makeEnv();
    fill16(e);
    animate(e, 0.4);
    e.run("MM.readTelemetry()");
    const strips = timePaint(e, "strips, 16 modulators collapsed", 6);
    e.run("ubSetExpanded(0); ubSetExpanded(2); ubSetExpanded(4)");
    timePaint(e, "strips, 3 expanded", 8);
    e.run("ubSetExpanded(-1)");
    // LST inspector with internal self-mappings on the selected modulator
    for (let k = 0; k < 6; k++) e.run(`MM.addSelfMapping(0, ${6 + k % 3 + 6 * (1 + (k % 4))})`);
    e.run("MM.setUI({ pb: true, sel: 0 })");
    timePaint(e, "LST inspector", 8);
    e.run("MM.setUI({ pb: false, opt: true })");
    timePaint(e, "Options view", 3);
    e.run("MM.setUI({ opt: false })");
    ok(strips > 0, "measured");
}

// ---------------------------------------------------------------- 2. idle repaint suppression
{
    const e = makeEnv();
    fill16(e);
    for (let i = 0; i < 16; i++) e.run(`MM.setParam(${i}, 'enabled', 0)`); // every modulator off: nothing moves
    still(e);
    const poll = () => e.run("MM._test.pollTelemetry()");
    for (let i = 0; i < 3; i++) poll(); // settle (the first reads differ from the empty initial state)
    e.log.redraws = 0;
    for (let i = 0; i < 60; i++) poll();
    eq(e.log.redraws, 0, "idle (all modulators off, nothing changes): 60 polls request 0 repaints (2 s at 30 fps)");

    // one modulator runs: every poll repaints
    e.run("MM.setParam(1, 'enabled', 1)");
    e.log.redraws = 0;
    let t = 0;
    for (let i = 0; i < 30; i++) { t += 0.033; animate(e, t); poll(); }
    ok(e.log.redraws >= 30, `a moving modulator repaints every poll (${e.log.redraws} / 30)`);

    // it stops: a short linger (the follower trace scrolls out), then silence
    still(e);
    e.log.redraws = 0;
    for (let i = 0; i < 400; i++) poll();
    ok(e.log.redraws > 0 && e.log.redraws <= 230, `after the last change the repaints stop after the trace has scrolled out (${e.log.redraws} of 400)`);
    e.log.redraws = 0;
    for (let i = 0; i < 40; i++) poll();
    eq(e.log.redraws, 0, "...and stay at 0");

    // the Options view shows nothing live: a running modulator does not repaint it
    e.run("MM.setUI({ opt: true })");
    for (let i = 0; i < 3; i++) { t += 0.033; animate(e, t); poll(); }
    e.log.redraws = 0;
    for (let i = 0; i < 30; i++) { t += 0.033; animate(e, t); poll(); }
    eq(e.log.redraws, 0, "Options view: a running modulator requests no repaint");
    e.run("MM.setUI({ opt: false })");

    // the LST inspector shows the selected modulator only: another one moving does not repaint, the selected one does
    e.run("MM.setParam(0, 'enabled', 1); MM.setUI({ pb: true, sel: 0 })");
    still(e); for (let i = 0; i < 300; i++) poll();
    e.log.redraws = 0;
    for (let i = 0; i < 30; i++) { t += 0.033; e.scope[C.SCOPE_FRAME] = (e.scope[C.SCOPE_FRAME] || 0) + 1; e.scope[4 * 5 + 1] = (t * 3) % 1; e.scope[4 * 5] = Math.sin(t); poll(); }
    eq(e.log.redraws, 0, "LST: the unselected modulator 5 moving requests no repaint");
    e.log.redraws = 0;
    for (let i = 0; i < 30; i++) { t += 0.033; e.scope[C.SCOPE_FRAME] = (e.scope[C.SCOPE_FRAME] || 0) + 1; e.scope[1] = (t * 3) % 1; e.scope[0] = Math.sin(t); poll(); }
    ok(e.log.redraws >= 30, "LST: the selected modulator moving repaints every poll");
    e.run("MM.setUI({ pb: false })");

    // animations: the armed learn pulse repaints (ubPulse) even when nothing else moves
    still(e); for (let i = 0; i < 300; i++) poll();
    e.run("MM.armLearn(1, false, 0)");
    e.log.redraws = 0;
    for (let i = 0; i < 30; i++) poll();
    ok(e.log.redraws >= 30, `an armed LRN pulses (${e.log.redraws} / 30 polls repainted)`);
    e.run("MM.disarmLearn()");
    for (let i = 0; i < 5; i++) poll();
    e.log.redraws = 0;
    for (let i = 0; i < 30; i++) poll();
    eq(e.log.redraws, 0, "...and stops when disarmed");
}

// ---------------------------------------------------------------- 3. poll interval
{
    const e = makeEnv();
    fill16(e);
    for (let i = 0; i < 16; i++) e.run(`MM.setParam(${i}, 'enabled', 0)`);
    still(e);
    const tel = e.log.tasks.find((q) => q.repeating && q.interval <= 100);
    ok(!!tel, "the telemetry task exists");
    ok(tel.interval === 33, `starts at 33 ms (${tel && tel.interval})`);
    for (let i = 0; i < 80; i++) e.run("MM._test.pollTelemetry()");
    ok(tel.interval >= 66, `slows down when nothing changes (${tel.interval} ms)`);
    e.run("MM.setParam(1, 'enabled', 1)");
    ok(tel.interval === 33, "a model change returns it to 33 ms");
    for (let i = 0; i < 80; i++) e.run("MM._test.pollTelemetry()");
    ok(tel.interval >= 66, "idle again");
    animate(e, 1.0); e.run("MM._test.pollTelemetry()");
    ok(tel.interval === 33, "a telemetry change returns it to 33 ms");
}

// ---------------------------------------------------------------- 4. buffer writes
{
    const e = makeEnv();
    fill16(e);
    e.run("MM.flushEngineForTest && MM.flushEngineForTest()");
    const n0 = e.log.pokes;
    e.run("MM.setParam(1, 'rate', MM.state.mods[1].p.rate)"); // same value
    eq(e.log.pokes, n0, "setting a control to its current value writes nothing");
    e.run("MM.setParam(1, 'rate', 3.5)");
    ok(e.log.pokes > n0, "a real change writes the cfg slot");
    const n1 = e.log.pokes;
    e.run("MM.setParam(1, 'rate', 3.5)");
    eq(e.log.pokes, n1, "the same value again writes nothing");
}

// ---------------------------------------------------------------- 5. state saves (notifyclients) are throttled during a drag
{
    const e = makeEnv();
    fill16(e);
    e.run("MM.commit()");
    e.log.notify = 0;
    for (let i = 0; i < 200; i++) e.run(`MM.setParam(1, 'rate', ${1 + i * 0.01})`);
    eq(e.log.notify, 0, "200 drag steps save nothing (the commit is a 400 ms trailing debounce that every change restarts)");
    const pend = e.log.tasks.find((q) => q.sched === 400);
    ok(!!pend, "one trailing commit is pending");
    e.run("MM.commit()");
    eq(e.log.notify, 1, "...and it saves once");
}

console.log(`megamod perf tests passed (${passed} checks)`);
