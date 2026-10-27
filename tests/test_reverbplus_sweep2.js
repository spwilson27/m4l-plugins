#!/usr/bin/env node
"use strict";
/**
 * Reverb+ sweep2 red tests (sweep/reverbplus.md).
 * Each test fails because of the bug it names. Style follows tests/test_reverbplus.js:
 * the engine script is exercised in slices inside a vm with Max objects stubbed.
 * Run: node tests/test_reverbplus_sweep2.js
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


// RP-S2-01: an IR control moved while a new IR file is loading re-processes the OLD source (status -> "processing"),
// and the buffer~ done bang of the new file is then ignored by ir_loaded (it only accepts status "loading").
test("RP-S2-01 IR control edit during an IR load must not swallow the new file's ir_loaded", () => {
    const { ctx, FakeBuffer } = makeEngine();
    vm.runInContext(`
        rpIr.src = { chans: [new Float32Array(4800)], sr: 48000 };
        rpIr.status = "idle"; rpIr.loaded = true; rpLastDropped = "/a.wav";
    `, ctx);
    vm.runInContext("dropfile", ctx)("/b.wav");
    assert.strictEqual(vm.runInContext("rpIr.status", ctx), "loading", "setup");
    // the user nudges IR Stretch within 200 ms of the drop: the debounce task fires rpIrReprocess on the old source
    vm.runInContext("rpIrReprocess", ctx)();
    FakeBuffer.n = 9600; FakeBuffer.nch = 1;
    vm.runInContext("ir_loaded", ctx)();
    const w = vm.runInContext("rpIr.work", ctx);
    assert(w && w.proc && w.proc.len === 9600,
        "the new file (9600 samples) must be processed after its load finished, got " + (w && w.proc ? w.proc.len : w));
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
