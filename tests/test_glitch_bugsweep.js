#!/usr/bin/env node
"use strict";
/**
 * Pass-1 RED suite for Glitch bugsweep (bugsweep/glitch).
 * Expected to FAIL on current src until Pass 3 fixes.
 * Pure Node — no Max/Live / VM lock.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function makeUi(extra) {
    const sent = [];
    const pokes = [];
    const calls = { notify: 0 };
    const drawLog = [];
    const gm = {
        size: [486, 169],
        init() {},
        redraw() {},
        text_measure(t) { return [String(t).length * 6, 8]; },
    };
    for (const fn of [
        "set_source_rgba", "set_line_width", "rectangle", "rectangle_rounded",
        "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse",
        "fill", "fill_preserve", "stroke", "select_font_face", "set_font_size",
        "show_text", "save", "restore", "translate", "rotate",
    ]) {
        gm[fn] = (...a) => {
            drawLog.push(fn + ":" + a.map((x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x)).join(","));
        };
    }
    const sandbox = {
        mgraphics: gm,
        outlet: (...a) => sent.push(a.slice(1)),
        notifyclients: () => { calls.notify++; },
        Buffer: function () {
            this.poke = (ch, off, arr) => pokes.push(arr.slice());
            this.peek = () => 0;
        },
        post() {},
        Date, Math, JSON, console,
    };
    const code =
        fs.readFileSync(path.join(ROOT, "src", "glitch_config.js"), "utf8") +
        "\n" +
        fs.readFileSync(path.join(ROOT, "src", "glitch_ui.js"), "utf8") +
        (extra || "");
    const ctx = vm.createContext(sandbox);
    vm.runInContext(code, ctx);
    const run = (src) => {
        const v = vm.runInContext(src, ctx);
        return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
    };
    return { run, sent, pokes, calls, ctx, drawLog, params: () => sent.filter((m) => m[0] === "param") };
}

let passed = 0;
function ok(name, fn) {
    try {
        fn();
        passed++;
        console.log("ok -", name);
    } catch (e) {
        console.error("FAIL", name);
        throw e;
    }
}

// ---------------------------------------------------------------------------------------------
// Bug: chaos(v) mutates saved state but never notifyclients
// glitch_ui.js:369 — message setter updates gState.chaos (part of getvalueof blob) and
// sendParam, but skips done(). Drag endDrag and ondblclick act_chaos both call done();
// save/clearslot message actions also call done(). Without notifyclients, Live may never
// re-ask getvalueof; a later setvalueof + syncParamsOut can restore a stale chaos onto live.*.
// ---------------------------------------------------------------------------------------------
ok("chaos(v) message calls notifyclients so the Set can persist the state blob", () => {
    const u = makeUi();
    u.run("setbuffer('---glitchslots', '---glitchscope'); device_ready()");
    const notify0 = u.calls.notify;
    u.run("chaos(75)");
    assert.ok(Math.abs(u.run("gState.chaos") - 0.75) < 1e-9, "chaos(v) updates gState.chaos");
    const blob = u.run("getvalueof()");
    assert.ok(Array.isArray(blob) && blob.length >= 2, "getvalueof returns [ver, json]");
    const parsed = typeof blob[1] === "string" ? JSON.parse(blob[1]) : blob[1];
    assert.ok(Math.abs(parsed.chaos - 0.75) < 1e-9, "blob JSON includes the new chaos");
    assert.strictEqual(
        u.calls.notify,
        notify0 + 1,
        "notifyclients after chaos(v); without it Live never re-asks getvalueof and setvalueof+syncParamsOut can push a stale chaos back onto live.*"
    );
});

console.log(`glitch bugsweep RED: ${passed} checks (expected FAIL on current code until Pass 3)`);
