#!/usr/bin/env node
/** Sweep 2 red tests for Multiband Split (see sweep/mbsplit.md). */
"use strict";
const assert = require("assert");
const { create } = require("./mbsplit_sandbox.js");
const failures = [];
function check(n, fn) { try { fn(); console.log("PASS " + n); } catch (e) { failures.push(n); console.log("FAIL " + n + ": " + e.message); } }
const uiMsgs = (u, key) => u.e0.filter((m) => m[0] === key);

// MB-01: a crossover write that the face clamps (F1 20 kHz with F2/F3 already at their limits) must be echoed back
// to the live.numbox (ui_f1), otherwise the parameter shows/stores 20000 while the DSP and face use 14142 Hz.
check("MB-01 clamped F1 write is echoed to the numbox", function () {
    const u = create("");
    u.set_f3(20000); u.set_f2(16817.928305074292);
    u.e0.length = 0;
    u.set_f1(20000);
    assert.ok(u.curF1 < 20000, "face clamps F1 (got " + u.curF1 + ")");
    assert.ok(uiMsgs(u, "ui_f1").length > 0, "no ui_f1 emitted: numbox keeps 20000 while model is " + u.curF1.toFixed(1));
});
check("MB-01b clamped F3 write (20 Hz at the bottom of the stack) is echoed", function () {
    const u = create("");
    u.set_f1(20); u.set_f2(23.78414230005442);
    u.e0.length = 0;
    u.set_f3(20);
    assert.ok(u.curF3 > 20);
    assert.ok(uiMsgs(u, "ui_f3").length > 0, "no ui_f3 emitted: numbox keeps 20 Hz while model is " + u.curF3.toFixed(2));
});
if (failures.length) { console.error(failures.length + " failing"); process.exit(1); }
console.log("All sweep2 tests passed.");
