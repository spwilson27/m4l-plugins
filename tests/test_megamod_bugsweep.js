#!/usr/bin/env node
/**
 * Mega Modulator bugsweep pass 1: red tests for the bugs found by the pass 1 hunt (see BUGS.md at the repo root).
 * Every BUGn check FAILS on the pre-bugsweep code for the reason stated in BUGS.md; the sanity checks around
 * them pass. This file only documents the bugs: nothing in src/ is fixed here.
 */
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;
function ok(c, m) { if (c) { passed++; } else { failed++; console.log("FAIL: " + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

const C = require(path.join(ROOT, "src", "megamod_config.js"));

// ---------------------------------------------------------- BUG 1: sanitizeMod drops a boolean false enabled flag
// src/megamod_config.js sanitizeMod computes enabled as (m.enabled === 0 ? 0 : 1). A modulator whose saved state
// carries JSON false for enabled (hand-written or externally generated preset states do; the device itself
// writes 0/1) comes back ENABLED after normalizeState. sanitizeMapping in the same file treats false as
// disabled (m.enabled === 0 || m.enabled === false), so the two sanitizers disagree about the same field.
eq(C.sanitizeMapping({ id: 1, mod: 0, enabled: false, target: {} }, 11).enabled, 0, "sanity: sanitizeMapping treats enabled false as disabled");
eq(C.sanitizeMod({ type: 1, enabled: false, p: {} }, 0).enabled, 0, "BUG1: sanitizeMod treats enabled false as disabled");
eq(C.sanitizeMod({ type: 1, enabled: 0, p: {} }, 0).enabled, 0, "sanity: sanitizeMod treats enabled 0 as disabled");
eq(C.sanitizeMod({ type: 1, enabled: 1, p: {} }, 0).enabled, 1, "sanity: sanitizeMod treats enabled 1 as enabled");
{
    const raw = C.defaultState();
    raw.mods[0] = { type: 1, enabled: false, name: "LFO 1", hue: 0.5, p: {} };
    eq(C.normalizeState(raw).mods[0].enabled, 0, "BUG1: normalizeState keeps a boolean-false modulator disabled");
}

// ---------------------------------------------------------- BUG 2: mouse wheel over a strip knob turns it backwards
// The wheel convention of this file, pinned by tests/test_megamod_ui.js: onwheel dy=-1 (wheel up) RAISES the
// value (the Options rate dial steps up, the Smooth bar rises, the Depth pill grows) and the mapping list
// scrolls forward. The strip-knob branch of onwheel in src/megamod_ui.js adds (dy > 0 ? 1 : -1) * 0.03, the
// opposite sign, so wheel up over a knob lowers it while wheel up over every other control raises it.
function makeEnv() {
    const log = { outlets: [], notify: 0, draws: 0, texts: [], boxSet: [] };
    const mg = { size: [486, 161], init() {}, redraw() {}, relative_coords: 0, autofill: 0 };
    for (const f of ["set_line_width", "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse", "stroke", "select_font_face", "set_font_size", "save", "restore", "translate", "rotate"]) mg[f] = () => {};
    let rect = null;
    mg.set_source_rgba = () => {};
    mg.rectangle = (x, y, w, h) => { rect = [x, y, w, h]; };
    mg.rectangle_rounded = (x, y, w, h) => { rect = [x, y, w, h]; };
    mg.fill = () => { log.draws++; };
    mg.show_text = (t) => { log.texts.push(String(t)); };
    mg.text_measure = (t) => [String(t).length * 4, 8];
    const box = { rect: [4, 4, 486, 161], getattr: (k) => box.rect, setattr: (k, ...v) => { box.rect = v; log.boxSet.push(v); } };
    const live = {};
    const patcher = { bringtofront: () => {}, getnamed: (n) => {
        if (n === "obj-viz") return box;
        if (!((/^ap_\d+$/.test(n) && Number(n.slice(3)) < 96) || (/^at_\d+$/.test(n) && Number(n.slice(3)) < 96) || (/^ad_\d+$/.test(n) && Number(n.slice(3)) < 64) || n === "ap_marker")) return null;
        if (!live[n]) live[n] = { name: n, attrs: {}, setLog: [], messages: [], value: 0, setattr(k, ...v) { this.attrs[k] = v.length === 1 ? v[0] : v; this.setLog.push([k, ...v]); }, getattr(k) { return this.attrs[k]; }, getvalueof() { return this.value; },
            message(t, v) { this.messages.push([t, v]); this.value = v; const m = /^(ap|ad|at)_(\d+)$/.exec(n); if (!m) ctx.autom(v); else if (m[1] === "ap") ctx.autop(Number(m[2]), v); else if (m[1] === "at") ctx.autot(Number(m[2]), v); else ctx.autod(Number(m[2]), v); } };
        return live[n];
    } };
    const ctx = { mgraphics: mg, console, box, patcher, outlet: (...a) => log.outlets.push(a), notifyclients: () => { log.notify++; }, post() {}, arrayfromargs: (a) => Array.prototype.slice.call(a), inlets: 1, outlets: 2 };
    vm.createContext(ctx);
    const code = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, \"scripts\"); import megamod_common as m; sys.stdout.write(m.ui_script())"], { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(code, ctx, { filename: "megamod_ui.js" });
    vm.runInContext("mmdRouterMsg = function (k, v) { outlet(0, k, v); }; MM.dspSetState(true);", ctx);
    return { ctx, log, live, run: (c) => vm.runInContext(c, ctx) };
}
{
    const E = makeEnv();
    const run = E.run;
    run("ubAddType(MOD_LFO)");
    eq(run("MM.modCount()"), 1, "setup: one LFO");
    const kc = run("(() => { const k = ubStripRects(ubStrips().list[0]).knobs.filter((q) => q.spec.key === \"depth\")[0]; const h = k.hit; return [h[0] + h[2] / 2, h[1] + h[3] / 2]; })()");
    run("MM.setParam(0, \"depth\", 0.5)");
    eq(run("MM.state.mods[0].p.depth"), 0.5, "setup: depth at 0.5");
    E.ctx.onwheel(kc[0], kc[1], 0, -1);
    const up = run("MM.state.mods[0].p.depth");
    ok(up > 0.5, "BUG2: wheel up over a strip knob raises its value, like every other control (got " + up + ")");
    E.ctx.onwheel(kc[0], kc[1], 0, 1);
    const down = run("MM.state.mods[0].p.depth");
    ok(down < up, "BUG2: wheel down over a strip knob lowers its value (got " + down + ")");
}

console.log("bugsweep: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
