#!/usr/bin/env node
"use strict";
/**
 * Reverb+ bug-sweep pass 1: RED tests for the bugs in BUGS.md (worktree root).
 * Each test fails because of the bug it names. Style follows tests/test_reverbplus.js:
 * the engine script is exercised in slices inside a vm with Max objects stubbed.
 * Run: node tests/test_reverbplus_bugsweep.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "src", "reverbplus_config.js"));
const ENGINE = fs.readFileSync(path.join(ROOT, "src", "reverbplus_engine.js"), "utf8");

let failures = 0;
let passes = 0;
function test(name, fn) {
    try {
        fn();
        passes++;
        console.log("PASS " + name);
    } catch (err) {
        failures++;
        console.log("FAIL " + name + ": " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n") : err));
    }
}
function grab(src, from, to) {
    const a = src.indexOf(from), b = src.indexOf(to, a);
    assert(a >= 0 && b > a, "slice marker: " + from);
    return src.slice(a, b);
}

// Engine slices: IR state, path helpers, dropfile, clear_ir, rpIrLoad, ir_loaded,
// rpIrReprocess, and rpIrWork / rpPokeChunked / rpIrPublish.
function makeEngine() {
    const code = [
        grab(ENGINE, "var rpIr = {", "function rpFileName"),
        grab(ENGINE, "function rpFileName", "function rpIrPathFromArgs"),
        grab(ENGINE, "function rpIrPathFromArgs", "var rpLastDropped"),
        grab(ENGINE, "var rpLastDropped", "var RP_DROP_DEFER_MS"),
        grab(ENGINE, "function rpIrInvalidateWork", "function rpIrLoad"),
        grab(ENGINE, "function rpIrLoad", "// buffer~ ---rpir has the file"),
        grab(ENGINE, "function ir_loaded", "function rpIrReprocessSoon"),
        grab(ENGINE, "function rpIrReprocess()", "function rpIrWork"),
        grab(ENGINE, "function rpIrWork", "// ---- test hook"),
    ].join("\n");
    const hdrPokes = [];
    const outlets = [];
    class FakeBuffer {
        poke() {}
        framecount() { return FakeBuffer.n; }
        channelcount() { return FakeBuffer.nch; }
        length() { return FakeBuffer.n * 1000 / 48000; }
        peek(ch, off, cnt) { const a = []; for (let i = 0; i < cnt; i++) a.push(0.25); return a; }
    }
    FakeBuffer.n = 0;
    FakeBuffer.nch = 1;
    const ctx = {
        RP_CONV: C.RP_CONV, RP_HDR: C.RP_HDR, RP_IR_VIEW_N: C.RP_IR_VIEW_N,
        rpIrProcess: C.rpIrProcess, rpIrCounts: C.rpIrCounts, rpIrView: C.rpIrView,
        rpPartitionSpectrum: () => {},
        rpOwnNames: { xfer: "---rpxfer", hdr: "---rphdr", scope: "---rpscope", spec: "---rpspec", ir: "---rpir", irspec: "---rpirspec", irview: "---rpirview" },
        rpRaw: {},
        Buffer: FakeBuffer,
        Task: function () { this.schedule = () => {}; this.cancel = () => {}; this.repeat = () => {}; },
        outlet: (...a) => outlets.push(a),
        post: () => {},
        rpTrace: () => {},
        rpHdrPoke: (i, v) => hdrPokes.push([i, v]),
        rpBroadcastIr: () => {},
        rpDevSr: () => 48000,
        Array, String, RegExp, Date, Math, Float32Array, Float64Array,
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return { ctx, hdrPokes, outlets, FakeBuffer };
}

const WORK = (len) => `
    rpIr.work = {
        proc: { L: new Float64Array(${len}), R: new Float64Array(${len}), len: ${len}, srMismatch: false, channels: 2 },
        counts: { nHead: 1, nTail: 0 },
        head: new Float32Array(${C.RP_CONV.NB1 * 4}), tail: new Float32Array(0),
        p: 1, q: 0, devSr: 48000, bank: 1, wrote: 0,
    };
    rpIr.workTask = { cancel: function () {}, interval: 0, repeat: function () {} };
`;

test("clear_ir during IR processing: the in-flight publish must not resurrect the cleared IR", () => {
    const { ctx, hdrPokes } = makeEngine();
    vm.runInContext(`
        rpIr.src = { chans: [new Float32Array(64), new Float32Array(64)], sr: 48000 };
        rpIr.status = "processing";
        rpIr.loaded = false;
        ${WORK(64)}
    `, ctx);
    vm.runInContext("clear_ir", ctx)();
    assert.strictEqual(vm.runInContext("rpIr.loaded", ctx), false, "setup: clear_ir unloads");
    assert.strictEqual(vm.runInContext("rpIr.status", ctx), "idle", "setup: clear_ir idles");
    // the sliced partition work finishes after the clear (its Task was already repeating)
    vm.runInContext("rpIrWork", ctx)();
    assert.strictEqual(vm.runInContext("rpIr.loaded", ctx), false,
        "completing the in-flight work after clear_ir must not mark an IR loaded again");
    assert.strictEqual(vm.runInContext("rpIr.status", ctx), "idle",
        "completing the in-flight work after clear_ir must not flip the state to error");
    assert(!hdrPokes.some(([i, v]) => i === C.RP_HDR.IR_LOADED && v === 1),
        "the gen header must never be told an IR is loaded after a clear");
});

test("dropping a new IR while the previous one is still processing: the new file must still load", () => {
    const { ctx, FakeBuffer } = makeEngine();
    vm.runInContext(`
        rpIr.src = { chans: [new Float32Array(4800)], sr: 48000 };
        rpIr.status = "processing";
        rpIr.loaded = true;
        rpLastDropped = "/a.wav";
        ${WORK(4800)}
    `, ctx);
    // user drops a different, longer IR (9600 samples, mono) while A is still being processed
    vm.runInContext("dropfile", ctx)("/b.wav");
    assert.strictEqual(vm.runInContext("rpIr.status", ctx), "loading", "setup: the drop starts a load");
    // the in-flight work for A completes first and publishes
    vm.runInContext("rpIrWork", ctx)();
    // buffer~ now finishes loading B and the engine is told
    FakeBuffer.n = 9600;
    FakeBuffer.nch = 1;
    vm.runInContext("ir_loaded", ctx)();
    assert.strictEqual(vm.runInContext("rpIr.status", ctx), "processing",
        "ir_loaded for the new file must start its processing even though stale work published in between");
    const w = vm.runInContext("rpIr.work", ctx);
    assert(w && w.proc && w.proc.len === 9600,
        "the work in flight after ir_loaded must be the new IR (9600 samples), got " + (w && w.proc ? w.proc.len : w));
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
