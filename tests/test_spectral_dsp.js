#!/usr/bin/env node
"use strict";
/**
 * Unit tests of the deferred DSP loader (src/spectral_dsp.js) with a mocked patcher / Task / File / Global: creation order and wiring, the
 * message re-sends until the gen's alive counter moves, the settle re-send, the first-gen~ retry, the creation queue shared between instances,
 * silence until the gen is wired (inside a rack and outside one), the pill text and the restart hook.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const code = fs.readFileSync(path.join(__dirname, "..", "src", "spectral_dsp.js"), "utf8");

function makeWorld() {
    const globals = {};
    const files = {};
    const tasks = [];
    let now = 1000000;
    const w = { globals, files, tasks, get now() { return now; }, advance(ms) {
        const end = now + ms;
        for (;;) {
            const due = tasks.filter((t) => t.at !== null && t.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            now = Math.max(now, due.at);
            due.at = null;
            due.fn();
        }
        now = end;
    } };
    w.Date = { now: () => now };
    return w;
}

function makeInstance(world, id) {
    const log = [];                         // patcher operations
    const boxes = {};                       // varname -> object
    const lines = new Set();
    const aliveRef = { v: 0, running: false };
    const patcher = {
        getnamed(n) { return Object.values(boxes).find((b) => b.varname === n) || null; },
        newdefault(x, y, cls, a, b) { const o = { cls, args: [a, b], varname: "" }; log.push(["newdefault", cls, a, b]); boxes["__new" + log.length] = o; return o; },
        connect(a, ao, b, bi) { lines.add(`${a.varname || a.name}:${ao}>${b.varname || b.name}:${bi}`); log.push(["connect", a.varname || a.name, ao, b.varname || b.name, bi]); },
        disconnect(a, ao, b, bi) { lines.delete(`${a.varname || a.name}:${ao}>${b.varname || b.name}:${bi}`); log.push(["disconnect", a.varname || a.name, ao, b.varname || b.name, bi]); },
        remove(o) { log.push(["remove", o.varname]); for (const k of Object.keys(boxes)) if (boxes[k] === o) delete boxes[k]; },
    };
    for (const n of ["ss_genin", "ss_plugin", "ss_plugout"]) boxes[n] = { name: n, varname: n };
    const sent = [];
    const fileHave = world.files;
    const sandbox = {
        console, Math, JSON, String, Number, Array, Object, Date: world.Date, post() {},
        Task: function (fn) { const t = { fn, at: null }; world.tasks.push(t); this.schedule = (ms) => { t.at = world.now + ms; }; this.cancel = () => { t.at = null; }; },
        Global: function (name) { if (!world.globals[name]) world.globals[name] = {}; return world.globals[name]; },
        File: function (p, mode) {
            this.isopen = true;
            if (mode === "read") { this.eof = fileHave[p] !== undefined ? fileHave[p].length : -1; this.isopen = fileHave[p] !== undefined; this.close = () => {}; return; }
            let buf = "";
            this.writestring = (s) => { buf += s; };
            this.close = () => { fileHave[p] = buf; };
            Object.defineProperty(this, "eof", { set() {} });
        },
        patcher,
        GEN_DSP_TEXT: "{\"patcher\":{}}", GEN_DSP_HASH: "abc123", SS_PREFIX: "tt",
        ssGenAlive() { return aliveRef.v; },
        ssDevResend() { sent.push(world.now); },
        ssDevChanged() {},
    };
    sandbox.this = { patcher };
    vm.createContext(sandbox);
    // `this.patcher` at the top level of the script: run it as a function body with `this` = { patcher }
    vm.runInContext(code.replace(/^var ssHost = .*$/m, "var ssHost = patcher;"), sandbox);
    return { sb: sandbox, log, boxes, lines, aliveRef, sent, id };
}

// ---- normal load: created after the tick, wired, ready when the counter moves, re-sends in between and after
{
    const w = makeWorld();
    const I = makeInstance(w, "A");
    I.sb.ssDspSchedule("A");
    assert.strictEqual(I.sb.ssDspPill(), "DSP loading...");
    w.advance(20);
    assert.strictEqual(I.log.length, 0, "nothing is created before the GUI had its tick");
    w.advance(20);
    assert.ok(I.log.some((l) => l[0] === "newdefault" && l[1] === "gen~" && l[2] === "@gen" && /^\/tmp\/tt_core_abc123\.gendsp$/.test(l[3])), "gen~ @gen /tmp/<prefix>_core_<hash>.gendsp");
    assert.ok(w.files["/tmp/tt_core_abc123.gendsp"], "the patch text is written to the file");
    const wires = [...I.lines].sort();
    assert.deepStrictEqual(wires, ["ss_genin:0>ss_gen:0", "ss_gen:0>ss_plugout:0", "ss_gen:1>ss_plugout:1", "ss_plugin:0>ss_gen:0", "ss_plugin:1>ss_gen:1"].sort(), "hub -> gen, plugin~ -> gen -> plugout~");
    assert.strictEqual(I.sb.ssDsp.ready, 0);
    // the gen is still compiling: messages are re-sent every 150 ms
    const n0 = I.sent.length;
    w.advance(600);
    assert.ok(I.sent.length - n0 >= 3, `re-sent while loading (${I.sent.length - n0})`);
    I.aliveRef.v = 5;                      // the counter moves: ready
    w.advance(200);
    assert.strictEqual(I.sb.ssDsp.ready, 1);
    assert.strictEqual(I.sb.ssDspPill(), "");
    const n1 = I.sent.length;
    w.advance(1000);
    assert.strictEqual(I.sent.length - n1, 1, "one more re-send after the gen settled (300 ms), then none");
    // restart (late start): the gen~ is removed and created again
    I.sb.ssDspRestart();
    assert.strictEqual(I.sb.ssDsp.ready, 0);
    assert.ok(I.log.some((l) => l[0] === "remove" && l[1] === "ss_gen"));
    w.advance(100);
    assert.ok(I.log.filter((l) => l[0] === "newdefault").length === 2, "created a second time");
}

// ---- the file is written once for identical gens (a second instance finds it)
{
    const w = makeWorld();
    const A = makeInstance(w, "A");
    const B = makeInstance(w, "B");
    A.sb.ssDspSchedule("A");
    B.sb.ssDspSchedule("B");
    w.advance(60);
    const createdAt = [A, B].map((x) => x.log.filter((l) => l[0] === "newdefault").length);
    assert.deepStrictEqual(createdAt, [1, 0], "only one instance creates its gen~ at a time (the second waits for the queue)");
    A.aliveRef.v = 1;
    w.advance(600);
    A.aliveRef.v = 9;
    w.advance(200);
    assert.strictEqual(A.sb.ssDsp.ready, 1);
    w.advance(300);
    assert.strictEqual(B.log.filter((l) => l[0] === "newdefault").length, 1, "the next instance creates after the first is running");
    assert.deepStrictEqual(w.globals.spectral_split_dspq.owner === 0 || w.globals.spectral_split_dspq.owner !== undefined, true);
}

// ---- the first gen~ never joins the DSP chain: it is removed and created again (twice), then the pill says failed
{
    const w = makeWorld();
    const I = makeInstance(w, "A");
    I.sb.ssDspSchedule("A");
    w.advance(60);
    w.advance(3600);                        // first attempt: 3.5 s
    assert.strictEqual(I.log.filter((l) => l[0] === "newdefault").length, 2, "retry 1");
    assert.ok(I.log.some((l) => l[0] === "remove"));
    w.advance(6200);
    assert.strictEqual(I.log.filter((l) => l[0] === "newdefault").length, 3, "retry 2");
    w.advance(6200);
    assert.strictEqual(I.sb.ssDsp.ready, 0);
    assert.strictEqual(I.sb.ssDsp.error, "not running");
    assert.strictEqual(I.sb.ssDspPill(), "DSP failed: not running");
    assert.ok(/dsp-retry/.test(w.globals.spectral_split_trace.text) && /dsp-error/.test(w.globals.spectral_split_trace.text), "trace lines");
}

// ---- silence during deferral, inside a rack and outside one: never a direct plugin~ -> plugout~ cord
{
    const w = makeWorld();
    const I = makeInstance(w, "A");
    I.sb.ssDspDry(true);
    assert.strictEqual(I.lines.size, 0, "outside a rack stays silent during deferral");
    I.sb.ssDspSchedule("A");
    w.advance(60);
    assert.ok(!I.lines.has("ss_plugin:0>ss_plugout:0") && !I.lines.has("ss_plugin:1>ss_plugout:1"), "no dry cord after the gen is wired");
    assert.ok(I.lines.has("ss_plugin:0>ss_gen:0") && I.lines.has("ss_gen:0>ss_plugout:0"), "audio goes plugin~ -> gen -> plugout~");
    const J = makeInstance(w, "B");
    J.sb.ssDspDry(false);
    assert.strictEqual(J.lines.size, 0, "inside a rack nothing passes before the gen runs");
}
console.log("All spectral deferred-DSP tests passed");
