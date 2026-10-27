"use strict";
// The engine's deferred-DSP and Split Mode machinery (src/deviate_dsp.js + src/deviate_engine.js) against a mocked Max: the gen~ shell for the
// Spectral stage is created with the main gen, hot-loaded (setattr gen) the first time Split Mode becomes Spectral, and the latency attribute and the
// gen's dvsplit change together only after the stage's alive counter has moved. Back to Envelope is immediate. A stage that never starts leaves the
// device in Envelope mode.
//   node tests/test_deviate_engine.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cfg = require("../src/deviate_config.js");

let fails = 0, checks = 0;
function ok(cond, msg) {
    checks++;
    if (!cond) { fails++; console.log("FAIL: " + msg); }
}

const src = (n) => fs.readFileSync(path.join(__dirname, "..", "src", n), "utf8");

function makeEngine() {
    const log = [];                       // everything the engine did, in order
    const out = [];                       // outlet messages
    const files = {};
    const tasks = [];
    const globals = {};
    let now = 0;
    const bufs = {};
    const getBuf = (name) => (bufs[name] || (bufs[name] = new Float64Array(2000)));
    class Task {
        constructor(fn) { this.fn = fn; this.at = null; }
        schedule(ms) { this.at = now + ms; if (!tasks.includes(this)) tasks.push(this); }
        cancel() { this.at = null; }
        repeat() { this.at = now + (this.interval || 0); if (!tasks.includes(this)) tasks.push(this); }
    }
    class Buffer {
        constructor(name) { this.name = name; }
        peek(ch, idx, n) { const b = getBuf(this.name); return n === 1 || n === undefined ? b[idx] : Array.from(b.slice(idx, idx + n)); }
        poke(ch, idx, arr) { const b = getBuf(this.name); (Array.isArray(arr) ? arr : [arr]).forEach((v, i) => { b[idx + i] = v; }); }
        framecount() { return getBuf(this.name).length; }
    }
    class File {
        constructor(p, mode) { this.p = p; this.mode = mode; this.isopen = true; this.eof = 0; this.buf = ""; if (mode === "read" && !(p in files)) this.isopen = false; else if (mode === "read") this.eof = files[p].length; }
        writestring(s) { this.buf += s; }
        close() { if (this.mode === "write") { files[this.p] = this.buf; log.push("write " + this.p); } }
    }
    class Global {
        constructor(name) { return globals[name] || (globals[name] = {}); }
    }
    const named = {};
    const mkObj = (name, cls) => {
        const o = { name, cls, attrs: {}, setattr(k, v) { this.attrs[k] = v; log.push(`setattr ${this.name || this.cls} ${k} ${String(v).slice(-40)}`); }, getattr(k) { return this.attrs[k]; } };
        Object.defineProperty(o, "varname", { set(v) { this.name = v; named[v] = o; } });
        return o;
    };
    const patcher = {
        getnamed(n) { return named[n] || null; },
        newdefault(x, y, cls, ...args) { const o = mkObj("", cls); o.args = args; log.push(`new ${cls} ${args.join(" ")}`); return o; },
        connect(a, ao, b, bo) { log.push(`connect ${a.name || a.cls}:${ao} -> ${b.name || b.cls}:${bo}`); },
        remove(o) { log.push(`remove ${o.name || o.cls}`); delete named[o.name]; },
        setattr(k, v) { log.push(`patcher ${k} ${v}`); },
        getattr(k) { return k === "latency" ? 256 : 0; },
    };
    for (const n of ["dv_genin", "dv_plugin", "dv_plugout", "dv_specin"]) named[n] = mkObj(n, "obj");
    const ctx = {
        post() {}, outlet(n, ...a) { out.push([n, ...a]); log.push(`outlet ${n} ${a.join(" ")}`); }, Task, Buffer, File, Global, patcher,
        Date: { now: () => now }, Math, JSON, Object, Array, Number, String, isFinite, parseInt, Float32Array, Float64Array, Uint8Array,
        notifyclients() {}, messagename: "",
    };
    ctx.Date.now = () => now;
    ctx.global = ctx;
    vm.createContext(ctx);
    const consts = `var DV_FACE = "Stub"; var DV_ROLE = "engine"; var DV_PREFIX = "deviate"; var DV_GEN_PARAMS = {"mix": ["dvwet", 100], "seed": ["dvseed", 1]};
var DV_PANEL_THEME = []; var DV_VARNAMES = {}; var DV_SPEC_STAGE = true; var GEN_DSP_TEXT = "{main}"; var GEN_DSP_HASH = "aaaa";
var GEN_SPEC_TEXT = "{spec}"; var GEN_SPEC_HASH = "bbbb"; var GEN_SPEC_STUB = "{stub}"; var GEN_SPEC_STUB_HASH = "cccc";\n`;
    vm.runInContext(consts + src("deviate_config.js") + "\n" + src("deviate_ir.js") + "\n" + src("deviate_dsp.js") + "\n" + src("deviate_engine.js"), ctx, { filename: "engine" });
    const api = {
        ctx, log, out, files, named, globals, bufs,
        setParam(key, v) { ctx.messagename = "set_" + key; ctx.anything(v); },
        advance(ms, filter) {
            const end = now + ms;
            for (let guard = 0; guard < 10000; guard++) {
                const due = tasks.filter((t) => t.at !== null && t.at <= end && (!filter || filter(t))).sort((a, b) => a.at - b.at)[0];
                if (!due) break;
                now = Math.max(now, due.at);
                due.at = null;
                due.fn.call(ctx);
            }
            now = end;
        },
        alive(slot, v) { getBuf("---sc")[slot] = v; },
        since(mark) { return log.slice(mark); },
    };
    return api;
}

// the IR builder would run on its own Tasks: leave them out of these runs
const noIr = (t) => !/dvIr/.test(String(t.fn.name));

// ---- 1. the DSP comes up: main gen + Spectral shell ----
{
    const e = makeEngine();
    e.ctx.names("---sc", "---ctl", "---ir", "---spec", "---test", "---state");
    e.ctx.init_dsp();
    e.advance(100, noIr);
    const L = e.log.join("\n");
    ok(/new gen~ @gen \/tmp\/deviate_core_aaaa\.gendsp/.test(L), "the main gen~ is created from the embedded patch");
    ok(/new gen~ @gen \/tmp\/deviate_specstub_cccc\.gendsp/.test(L), "the Spectral shell is created with the stub patch");
    ok(L.includes("connect dv_specin:0 -> dv_spec:0") && L.includes("connect dv_plugin:0 -> dv_spec:0") && L.includes("connect dv_plugin:1 -> dv_spec:1"), "the shell takes the audio and its own message hub");
    ok(L.includes("connect dv_spec:0 -> dv_gen:2") && L.includes("connect dv_spec:1 -> dv_gen:3"), "the shell feeds the main gen's inlets 3 and 4");
    ok(L.includes("connect dv_genin:0 -> dv_gen:0") && L.includes("connect dv_gen:0 -> dv_plugout:0") && L.includes("connect dv_gen:1 -> dv_plugout:1"), "the main gen is wired to the hub and the output");
    ok(!/setattr dv_spec gen/.test(L), "the stage is not loaded before Spectral is asked for");
    ok(e.files["/tmp/deviate_specstub_cccc.gendsp"] === "{stub}" && e.files["/tmp/deviate_core_aaaa.gendsp"] === "{main}", "the patch files are written");
}

// ---- 2. Spectral: hot-load, wait for the alive counter, then latency + dvsplit together ----
{
    const e = makeEngine();
    e.ctx.names("---sc", "---ctl", "---ir", "---spec", "---test", "---state");
    e.ctx.init_dsp();
    e.advance(100, noIr);
    e.alive(cfg.DV_SCOPE.ALIVE, 5);          // the main gen runs
    e.advance(400, noIr);
    e.alive(cfg.DV_SCOPE.ALIVE, 6);
    e.advance(400, noIr);
    ok(e.ctx.dvDsp.ready === 1, "the DSP is ready once the alive counter moves");
    const m0 = e.log.length;
    e.setParam("split", 1);
    let L = e.since(m0).join("\n");
    ok(/setattr dv_spec gen \/tmp\/deviate_spec_bbbb\.gendsp/.test(L), "Split Mode Spectral hot-loads the stage into the shell (setattr gen)");
    ok(!/patcher latency/.test(L) && !/outlet 0 dvsplit 1/.test(L), "the latency attribute and dvsplit wait for the stage");
    e.advance(300, noIr);                    // polls: no alive movement yet
    L = e.since(m0).join("\n");
    ok(!/patcher latency/.test(L), "still waiting while the stage's alive counter does not move");
    ok(/outlet 0 specmsg scope ---sc/.test(L), "the stage's telemetry buffer is bound while it compiles");
    const m1 = e.log.length;
    e.alive(cfg.DV_SCOPE.SPEC_ALIVE, 1);
    e.advance(200, noIr);
    L = e.since(m1);
    const iLat = L.findIndex((s) => s === "patcher latency 1279"), iSplit = L.findIndex((s) => s === "outlet 0 dvsplit 1");
    ok(iLat >= 0 && iSplit >= 0 && Math.abs(iLat - iSplit) === 1, `latency 1279 and dvsplit 1 are sent in the same tick (${iLat}, ${iSplit})`);
    ok(e.ctx.dvSplitEff === 1, "the engine runs in Spectral mode");
    // back to Envelope: immediate, the stage stays loaded
    const m2 = e.log.length;
    e.setParam("split", 0);
    L = e.since(m2);
    ok(L.includes("patcher latency 256") && L.includes("outlet 0 dvsplit 0"), "Envelope again: latency 256 and dvsplit 0 at once");
    // and Spectral again: no second load
    const m3 = e.log.length;
    e.setParam("split", 1);
    L = e.since(m3).join("\n");
    ok(!/setattr dv_spec gen/.test(L) && /patcher latency 1279/.test(L) && /outlet 0 dvsplit 1/.test(L), "the stage is loaded once; the next switch to Spectral is immediate");
}

// ---- 3. Spectral asked for before the DSP is up (a Set saved in Spectral) ----
{
    const e = makeEngine();
    e.ctx.names("---sc", "---ctl", "---ir", "---spec", "---test", "---state");
    e.setParam("split", 1);
    ok(e.ctx.dvSplitEff === 0, "a Spectral request before the DSP exists changes nothing yet");
    e.ctx.init_dsp();
    e.advance(100, noIr);
    e.alive(cfg.DV_SCOPE.ALIVE, 1); e.advance(300, noIr); e.alive(cfg.DV_SCOPE.ALIVE, 2); e.advance(300, noIr);
    ok(/setattr dv_spec gen/.test(e.log.join("\n")), "when the DSP comes up the pending Spectral request loads the stage");
    e.alive(cfg.DV_SCOPE.SPEC_ALIVE, 3); e.advance(300, noIr);
    ok(e.ctx.dvSplitEff === 1 && e.log.includes("patcher latency 1279"), "and then switches");
}

// ---- 4. a stage that never starts: Envelope stays, the failure is traced; asking for Envelope while loading cancels ----
{
    const e = makeEngine();
    e.ctx.names("---sc", "---ctl", "---ir", "---spec", "---test", "---state");
    e.ctx.init_dsp();
    e.advance(100, noIr);
    e.alive(cfg.DV_SCOPE.ALIVE, 1); e.advance(300, noIr); e.alive(cfg.DV_SCOPE.ALIVE, 2); e.advance(300, noIr);
    e.setParam("split", 1);
    e.advance(7000, noIr);
    ok(e.ctx.dvSplitEff === 0 && !e.log.includes("patcher latency 1279"), "a stage that never runs leaves the device in Envelope mode");
    ok(/spec-error/.test(String((e.globals.deviate_trace || {}).text)), "the failure is in the load trace");
    const e2 = makeEngine();
    e2.ctx.names("---sc", "---ctl", "---ir", "---spec", "---test", "---state");
    e2.ctx.init_dsp();
    e2.advance(100, noIr);
    e2.alive(cfg.DV_SCOPE.ALIVE, 1); e2.advance(300, noIr); e2.alive(cfg.DV_SCOPE.ALIVE, 2); e2.advance(300, noIr);
    e2.setParam("split", 1);
    e2.advance(150, noIr);
    e2.setParam("split", 0);
    e2.alive(cfg.DV_SCOPE.SPEC_ALIVE, 1); e2.advance(300, noIr);
    ok(e2.ctx.dvSplitEff === 0 && !e2.log.includes("patcher latency 1279"), "Envelope chosen while the stage loads: it does not switch when the stage starts");
}

// ---- 5. a DSP restart removes both gens ----
{
    const e = makeEngine();
    e.ctx.names("---sc", "---ctl", "---ir", "---spec", "---test", "---state");
    e.ctx.init_dsp();
    e.advance(100, noIr);
    const m = e.log.length;
    e.ctx.dvDspRestart();
    const L = e.since(m).join("\n");
    ok(/remove dv_gen/.test(L) && /remove dv_spec/.test(L), "a restart removes the main gen and the shell together");
}

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
