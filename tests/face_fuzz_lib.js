"use strict";
/**
 * Generic v8ui face harness: load any face script in a node vm sandbox with a recording mgraphics and minimal Max stubs, then
 * fire seeded random event sequences at it. Generalises tests/paint_bounds_lib.js (which stays the recorder / region checker).
 *
 *   const face = loadFace(scriptText | [files], { width, height, globals, bufferMode, seed });
 *   face.handlers                      -> names of hooks the script defines (paint, onclick, ..., set_<x>, any other message)
 *   const res  = fuzz(face, { seed, steps, canvasTol });
 *   res = { failures: [{kind, msg}], notes: [...], counts: {...} }
 *
 * Failure kinds: exception | timeout (a handler ran > 2 s) | nonfinite (NaN / inf / > 1e5 coordinate, NaN in an outlet message) |
 * absurd-param (|v| > 1e9 in a param-looking outlet message) | canvas (a filled / stroked shape or text leaves the canvas by more
 * than canvasTol px; reported with a de-duplicated signature) | open-path (path never filled / stroked at end of paint).
 * Mocks (all in `makeSandbox`): outlet / post / error / messnamed / notifyclients, Task (queued, flushed by the fuzzer), Global
 * (one persistent object per name), LiveAPI (id 0 / empty answers), Buffer (zeros | random | extreme data), Dict, File, max.getcolor,
 * patcher (getnamed / newdefault / connect / ... stubs), box (Maxobj stub), mgraphics (recorder + permissive Proxy).
 */
const vm = require("vm");
const fs = require("fs");
const { makeRecorder, checkRecording } = require("./paint_bounds_lib.js");

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A Proxy object whose every missing method is a harmless no-op returning another such object (for Maxobj-like stubs). */
function lenient(base, rng) {
    return new Proxy(base, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k === "symbol" || k === "then" || k === "toJSON") return undefined;
            return function () { return lenient({}, rng); };
        },
        set(t, k, v) { t[k] = v; return true; }
    });
}

function makeSandbox(rec, opts, state) {
    const W = opts.width, H = opts.height;
    const rng = state.rng;
    const COLORS = {};
    const getcolor = (name) => {
        if (!COLORS[name]) COLORS[name] = [0.2 + (name.length % 5) * 0.12, 0.3, 0.4 + (name.length % 3) * 0.2, 1];
        return COLORS[name];
    };
    const mg = new Proxy(rec.mgraphics, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k === "symbol") return undefined;
            state.unknownMg[k] = (state.unknownMg[k] || 0) + 1;
            return function () {};
        },
        set(t, k, v) { t[k] = v; return true; }
    });
    function BufferMock(name) {
        // zeros = a gen that has not started yet; unit = normalised telemetry in 0..1; signed = -1..1 audio-like; extreme = spikes.
        // Telemetry slots are not typed, so "signed" can put a negative number in a sample-rate slot: it is not a default mode.
        const mode = opts.bufferMode || "zeros";
        const val = (i) => (mode === "zeros" ? 0 : mode === "unit" ? rng() : mode === "extreme" ? ((i * 2654435761 >>> 0) % 7 === 0 ? 1e4 : 1) : rng() * 2 - 1);
        this.name = name;
        this.peek = (ch, idx, count) => (count === undefined ? val(idx) : Array.from({ length: Math.min(count, 1 << 20) }, (_, i) => val(idx + i)));
        this.poke = () => {};
        this.send = () => {};
        this.framecount = () => 4096; this.length = () => 85.3; this.channelcount = () => 2; this.samplerate = () => 48000;
        this.duration = () => 85; this.setnamed = () => {}; this.clear = () => {}; this.name = name;
    }
    const globals = {};
    function GlobalMock(name) { if (!globals[name]) globals[name] = {}; return globals[name]; }
    function LiveAPIMock(cb, path) {
        if (typeof cb === "string") path = cb;
        this.path = path || ""; this.id = "0"; this.unquotedpath = this.path; this.type = ""; this.mode = 0; this.children = [];
        this.get = () => [0]; this.set = () => {}; this.call = () => 0; this.getcount = () => 0; this.goto = () => 0; this.getstring = () => "";
        this.property = ""; this.info = ""; this.proptype = "";
    }
    function TaskMock(fn, ctx, ...a) {
        const t = this;
        t.interval = 100; t.running = false; t.repeats = 0; t.fn = fn; t.args = a; t.ctx = ctx; t.arguments = a;
        t.repeat = (n) => { t.running = true; t.repeats = n === undefined ? 1e9 : n; state.tasks.add(t); };
        t.schedule = () => { t.running = true; t.repeats = 1; state.tasks.add(t); };
        t.execute = () => { t.running = true; t.repeats = 1; state.tasks.add(t); };
        t.cancel = () => { t.running = false; state.tasks.delete(t); };
        t.freepeer = () => { t.cancel(); };
    }
    function DictMock() { const d = {}; const o = { get: (k) => d[k], set: (k, v) => { d[k] = v; }, contains: (k) => k in d, getkeys: () => Object.keys(d), clear: () => { for (const k in d) delete d[k]; }, stringify: () => JSON.stringify(d), parse: (s) => { try { Object.assign(d, JSON.parse(s)); } catch (e) { /* ignore */ } }, name: "" }; return o; }
    function FileMock() { this.isopen = false; this.eof = 0; this.position = 0; this.filesize = 0; this.writeline = () => {}; this.readline = () => ""; this.close = () => {}; this.writestring = () => {}; this.readstring = () => ""; this.open = () => {}; }
    const patcherBase = { name: "mock", filepath: "", wind: lenient({ visible: 1 }, rng), getnamed: (n) => (state.named[n] = state.named[n] || lenient({ varname: n, hidden: 0, presentation_rect: [0, 0, 10, 10], rect: [0, 0, 10, 10], getattr() { return 0; }, getboxattr() { return 0; }, message() {}, setattr() {} }, rng)), newdefault: () => lenient({}, rng), connect() {}, disconnect() {}, remove() {}, bringtofront() {}, sendtoback() {}, apply() {}, hiddenconnect() {}, script() {}, getlogicalnamed() { return null; }, count: 0 };
    const patcher = lenient(patcherBase, rng);
    const boxMock = lenient({ rect: [0, 0, W, H], presentation_rect: [0, 0, W, H], varname: opts.varname || "", id: opts.id || "obj-viz", getattr: () => 0, setattr() {}, patcher, message() {}, hidden: 0, size: [W, H] }, rng);
    const base = {
        mgraphics: mg, console: { log() {}, error() {}, warn() {} }, Math, JSON, Array, Object, String, Number, Boolean, Date, RegExp, Error, Map, Set, WeakMap, Symbol, Promise, isFinite, isNaN, parseInt, parseFloat,
        Float32Array, Float64Array, Int32Array, Uint8Array, Int16Array, Uint32Array, ArrayBuffer, DataView,
        arrayfromargs(a, b) { if (b === undefined) return typeof a === "object" && a && a.length !== undefined ? Array.from(a) : [a]; return [a].concat(Array.from(b)); },
        inlets: 1, outlets: opts.outlets || 8, jsarguments: [], messagename: "", box: boxMock, patcher,
        outlet(i, ...a) { state.outletMsgs.push([i, ...a]); }, post() {}, error() {}, notifyclients() {}, messnamed() {}, declareattribute() {}, setinletassist() {}, setoutletassist() {},
        Task: TaskMock, Buffer: BufferMock, Global: GlobalMock, LiveAPI: LiveAPIMock, Dict: DictMock, File: FileMock, Folder: function () { this.end = true; this.next = () => {}; this.close = () => {}; },
        max: { getcolor, version: 900, os: "macosx", frontpatcher: patcher, launchbrowser() {}, MAX_VERSION: 9 },
        Max: { getcolor },
        outlettype: [], autowatch: 0, bang() {}, setTimeout: undefined, // Max's v8 has no setTimeout in a v8ui; scripts must use Task
    };
    // Date.now is the one clock scripts read; keep it advancing so time based throttles (30 ms redraw guards ...) behave
    base.Date = class extends Date { static now() { return state.clock; } constructor(...a) { if (a.length) super(...a); else super(state.clock); } };
    return Object.assign(base, opts.globals || {});
}

function loadFace(source, opts) {
    opts = Object.assign({ width: 200, height: 100, seed: 1 }, opts || {});
    const text = Array.isArray(source) ? source.map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : f)).join("\n\n") : source;
    const rec = makeRecorder(opts.width, opts.height, { transform: true });
    const state = { rng: mulberry32(opts.seed), tasks: new Set(), outletMsgs: [], unknownMg: {}, named: {}, clock: 1.7e12 };
    const sandbox = makeSandbox(rec, opts, state);
    vm.createContext(sandbox);
    const before = new Set(Object.keys(sandbox));
    const face = { rec, state, sandbox, opts, loadError: null, handlers: [] };
    try {
        vm.runInContext(text, sandbox, { filename: opts.filename || "face.js", timeout: 5000 });
    } catch (e) { face.loadError = e; return face; }
    face.handlers = Object.keys(sandbox).filter((k) => !before.has(k) && typeof sandbox[k] === "function");
    // Max-provided hooks defined with `var x = function` or on sandbox directly are covered by the filter above.
    return face;
}

/** Call a function of the sandbox with a wall-clock timeout (catches an infinite loop). Returns {ok, error, timeout}. */
function call(face, name, args) {
    const sb = face.sandbox;
    sb.__f = sb[name]; sb.__a = args;
    try {
        vm.runInContext("__f.apply(this, __a)", sb, { timeout: 2000 });
        return { ok: true };
    } catch (e) {
        const msg = String((e && e.message) || e);
        return { ok: false, timeout: /timed out/i.test(msg), error: e, msg };
    }
}

const PARAM_VALUES = [0, 1, 0.5, -1, 100, -100, 127, 255, 1000, 0.001, 1e6, -1e6, 20, 20000, 0.25, 3, 2, 7, 12, -12, 48000];

function fuzz(face, o) {
    o = Object.assign({ seed: 1, steps: 200, canvasTol: 1.01 }, o || {});
    const { rec, state, sandbox: sb } = face;
    const W = face.opts.width, H = face.opts.height;
    const rng = mulberry32(o.seed);
    const ri = (n) => Math.floor(rng() * n);
    const pick = (a) => a[ri(a.length)];
    const fails = [], seen = new Set(), notes = [], counts = {};
    let lastEvents = [];
    const fail = (kind, msg) => { const sig = kind + ":" + msg.replace(/[-\d.]+/g, "#").slice(0, 120); if (lastEvents.length && !/^\w+\(/.test(msg)) msg += `   [after: ${lastEvents.slice(-3).join(" ; ")}]`; if (!seen.has(sig)) { seen.add(sig); fails.push({ kind, msg }); } };
    const has = (n) => typeof sb[n] === "function";
    const setNames = face.handlers.filter((n) => /^set_/.test(n));
    // other messages the patcher can really send to this v8ui (selectors found in `prepend X` / message boxes): o.messageNames.
    // Calling arbitrary helper functions with random arguments would only report mock misuse, so they are not fuzzed.
    const msgSet = new Set(o.messageNames || []);
    const others = face.handlers.filter((n) => msgSet.has(n) && !/^(paint|onclick|ondrag|ondblclick|onwheel|onkeydown|onkeyup|onidle|onidleout|onresize|bang|getvalueof|setvalueof|notifyclients)$/.test(n) && !/^set_/.test(n));
    const coord = (max) => { const r = rng(); return r < 0.08 ? 0 : r < 0.16 ? max : r < 0.2 ? -3 : r < 0.24 ? max + 3 : r < 0.27 ? -400 : r < 0.3 ? max * 5 : rng() * max; };
    const mods = () => [ri(2), ri(2), ri(2), ri(2), ri(2)];
    const bump = (n) => { counts[n] = (counts[n] || 0) + 1; };

    const run = (name, args) => {
        if (!has(name)) return;
        bump(name);
        if (name !== "paint") { lastEvents.push(`${name}(${args.map((a) => (typeof a === "number" ? +a.toFixed(1) : JSON.stringify(a))).join(",")})`); if (lastEvents.length > 6) lastEvents.shift(); }
        state.clock += 5 + ri(40);
        const before = state.outletMsgs.length;
        const r = call(face, name, args);
        if (!r.ok) fail(r.timeout ? "timeout" : "exception", `${name}(${args.map((a) => (typeof a === "number" ? +a.toFixed(2) : JSON.stringify(a))).join(", ")}): ${r.msg}${r.error && r.error.stack ? " @ " + (r.error.stack.split("\n")[1] || "").trim().slice(0, 100) : ""}`);
        for (const m of state.outletMsgs.slice(before)) {
            const nums = m.filter((x) => typeof x === "number");
            if (nums.some((x) => !isFinite(x))) fail("nonfinite", `${name}: outlet message with a non-finite number: ${JSON.stringify(m.map((x) => (typeof x === "number" && !isFinite(x) ? String(x) : x))).slice(0, 120)}`);
            else if (typeof m[1] === "string" && /^(param|set|value)/.test(m[1]) && nums.some((x) => Math.abs(x) > 1e9)) fail("absurd-param", `${name}: param message with an absurd value: ${JSON.stringify(m).slice(0, 120)}`);
        }
        if (state.outletMsgs.length > 5000) state.outletMsgs.length = 0;
    };
    const doPaint = (label) => {
        rec.begin(label);
        rec.bad.length = 0;
        run("paint", []);
        rec.end();
        for (const b of rec.bad) fail(/open/.test(b) ? "open-path" : /non-finite|absurd/.test(b) ? "nonfinite" : "path", b.replace(/^.*?: /, ""));
        const v = checkRecording(rec, { regions: [], tol: o.canvasTol });
        for (const m of v) if (/leaves the/.test(m)) fail("canvas", m.replace(/^[^:]*: /, ""));
        rec.bad.length = 0;
    };
    const flushTasks = () => {
        let n = 0;
        for (const t of [...state.tasks]) {
            if (n++ > 20) break;
            state.clock += t.interval || 30;
            const r = (() => { try { vm.runInContext("__t.fn.apply(__t.ctx || this, __t.args)", Object.assign(sb, { __t: t }), { timeout: 2000 }); return { ok: true }; } catch (e) { return { ok: false, msg: String(e.message || e) }; } })();
            if (!r.ok) fail(/timed out/.test(r.msg) ? "timeout" : "exception", `Task callback: ${r.msg}`);
            t.repeats--; if (t.repeats <= 0) { t.running = false; state.tasks.delete(t); }
        }
    };

    doPaint("initial");
    // let load-time work (Task chains scheduled by the script) settle a little before the fuzzing starts
    for (let i = 0; i < 3; i++) { flushTasks(); }
    for (let step = 0; step < o.steps; step++) {
        const r = rng();
        if (r < 0.25 && has("paint")) doPaint(`paint#${step}`);
        else if (r < 0.50) {
            // a gesture: click, a few drags, release (and sometimes a double click)
            const x = coord(W), y = coord(H), m = mods();
            const btn = rng() < 0.9 ? 1 : 0;
            run("onclick", [x, y, btn, ...m]);
            const n = ri(5);
            let dx = x, dy = y;
            for (let i = 0; i < n; i++) { dx = coord(W); dy = coord(H); run("ondrag", [dx, dy, 1, ...m]); }
            run("ondrag", [dx, dy, 0, ...m]);
            if (rng() < 0.15) run("ondblclick", [x, y, 1, ...m]);
            if (rng() < 0.3) doPaint(`after-gesture#${step}`);
        } else if (r < 0.58) run("ondblclick", [coord(W), coord(H), 1, ...mods()]);
        else if (r < 0.64) run("onwheel", [coord(W), coord(H), pick([0, 0, 1, -1, 3, -3, 0.2, 15]), pick([0, 1, -1, 2, -2, 5, -5, 0.3, 40, -40]), ...mods()]);
        else if (r < 0.70) run("onkeydown", [pick([97, 27, 8, 127, 13, 28, 29, 30, 31, -3, -5, 0, 122, 65, 32, 9]), pick(["a", "\u001b", "\b", "", "\r", "z", "A", " ", "1", "-"]), 1, ...mods()]);
        else if (r < 0.78) run(pick(["onidle", "onidleout"]), [coord(W), coord(H), 0, ...mods()]);
        else if (r < 0.86 && setNames.length) run(pick(setNames), [pick(PARAM_VALUES)]);
        else if (r < 0.90 && others.length) {
            const nm = pick(others);
            const argc = ri(4);
            run(nm, Array.from({ length: argc }, () => pick([...PARAM_VALUES, "x", "---buf", "on"])));
        } else if (r < 0.93) { run("msg_float", [pick(PARAM_VALUES)]); run("msg_int", [pick(PARAM_VALUES)]); run("bang", []); }
        else if (r < 0.95) run("onresize", [W, H]);
        else flushTasks();
        if (step % 25 === 24) { flushTasks(); }
    }
    // state round trip
    if (has("getvalueof") && has("setvalueof")) {
        bump("getvalueof");
        let v;
        const g = call(face, "getvalueof", []);
        if (!g.ok) fail("exception", `getvalueof: ${g.msg}`);
        else {
            try { v = vm.runInContext("(function(){ return getvalueof(); })()", sb, { timeout: 2000 }); } catch (e) { fail("exception", `getvalueof: ${e.message}`); }
            if (v !== undefined) {
                run("setvalueof", Array.isArray(v) ? v : [v]);
                const bad = JSON.stringify(v, (k, x) => (typeof x === "number" && !isFinite(x) ? "NaN!" : x));
                if (/NaN!/.test(bad)) fail("nonfinite", "getvalueof returned a non-finite number");
            }
        }
        // restoring garbage must not throw (older Live Sets, truncated blobs)
        for (const junk of [[], [0], [99], [1, "x"], ["a", "b"], [1, 2, 3, 4, 5]]) run("setvalueof", junk);
    }
    doPaint("final");
    return { failures: fails, notes, counts, unknownMg: state.unknownMg, handlers: face.handlers };
}

module.exports = { loadFace, fuzz, call, mulberry32, makeSandbox, lenient };
