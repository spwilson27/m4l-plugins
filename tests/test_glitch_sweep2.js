#!/usr/bin/env node
"use strict";
/**
 * sweep2(glitch) red tests. Each block is one finding of sweep/glitch.md; a block FAILS on the current code until it is fixed.
 * Pure Node (no Max / Live / VM).
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let failed = 0;
function test(id, fn) {
    try { fn(); console.log("ok   -", id); } catch (e) { failed++; console.log("FAIL -", id, "::", e.message); }
}
const assert = require("assert");

// G-01: scripts/vm_glitch.sh sources "$ROOT/scripts/vm_common.sh" (line 18) BEFORE it assigns ROOT (line 21) while `set -u` is on:
// every audio / live / sync call dies with "ROOT: parameter not set" unless the caller exported ROOT.
test("G-01 vm_glitch.sh assigns ROOT before the first use of $ROOT", () => {
    const lines = fs.readFileSync(path.join(ROOT, "scripts", "vm_glitch.sh"), "utf8").split("\n");
    const assign = lines.findIndex((l) => /^ROOT=/.test(l));
    const use = lines.findIndex((l) => /^[^#]*\$\{?ROOT\b/.test(l));
    assert.ok(assign >= 0, "ROOT is never assigned");
    assert.ok(use < 0 || assign < use, `ROOT assigned at line ${assign + 1} but first used at line ${use + 1}`);
});

// G-09: Live-side changes of the parameters that are ALSO stored in the GlitchStateData blob (Chaos, Morph X / Y, Mode, Seq Rate / Glide /
// Seq Length, arriving as set_<key> from automation, the LOM or a macro) never call notifyclients, so Live keeps an old blob; on a Set load
// setvalueof(old blob) + syncParamsOut then overwrite the restored parameter with the stale value (Live check: Chaos 80 -> clone 50).
// (The chaos(v) message was fixed in the first sweep; the parameter path was not.)
{
    const { makeUi } = require("./glitch_ui_harness.js");
    for (const [fn, v] of [["set_chaos", 80], ["set_morphx", 20], ["set_seqlen", 5], ["set_glide", 30], ["set_seqrate", 2], ["set_mode", 1]]) {
        test(`G-09 ${fn}(${v}) from Live notifies the blob`, () => {
            const u = makeUi();
            u.run("setbuffer('---glitchslots', '---glitchscope'); device_ready()");
            const n0 = u.calls.notify;
            u.run(`${fn}(${v})`);
            assert.ok(u.calls.notify > n0, "no notifyclients: Live keeps the old GlitchStateData blob");
        });
    }
}

if (failed) { console.log(`${failed} sweep2 glitch red test(s) failing`); process.exit(1); }
console.log("all sweep2 glitch tests pass");
