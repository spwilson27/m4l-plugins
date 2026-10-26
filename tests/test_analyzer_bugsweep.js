"use strict";

/**
 * Bugsweep red tests for Analyzer.
 * Prefer source-level contract checks (Node-only; no Max/Live).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UI = fs.readFileSync(path.join(ROOT, "src/analyzer_ui.js"), "utf8");

let passed = 0;
let failed = 0;

function ok(cond, msg) {
    if (cond) {
        passed++;
        console.log("ok - " + msg);
    } else {
        failed++;
        console.log("not ok - " + msg);
    }
}

function sliceFn(src, name) {
    const re = new RegExp("function\\s+" + name + "\\s*\\(");
    const start = src.search(re);
    if (start < 0) return "";
    const rest = src.slice(start);
    const m = rest.slice(1).search(/\nfunction\s+/);
    return m < 0 ? rest : rest.slice(0, m + 1);
}

// Real bug: state-mutating gestures never push undo (AGENTS.md undo discipline).
// Blob fields mask/order/specType/scopeMode/scopeTime/trigger/f1..f3 change via
// onclick / ondrag-end / ondblclick with notifyclients only — no pushUndoState.
ok(/function\s+pushUndoState\s*\(/.test(UI), "analyzer_ui defines pushUndoState");

const onclick = sliceFn(UI, "onclick");
const ondrag = sliceFn(UI, "ondrag");
const ondblclick = sliceFn(UI, "ondblclick");
const anClick = sliceFn(UI, "anClick");
const anEndDrag = sliceFn(UI, "anEndDrag");

ok(onclick.length > 0, "onclick present");
ok(ondrag.length > 0, "ondrag present");
ok(ondblclick.length > 0, "ondblclick present");

ok(
    onclick.includes("pushUndoState(") || anClick.includes("pushUndoState("),
    "mutating click path pushes undo once at gesture start"
);
ok(
    /anDrag\s*=/.test(onclick) && onclick.includes("pushUndoState("),
    "rail/xover drag begin in onclick pushes undo before tracking anDrag"
);
ok(!ondrag.includes("pushUndoState("), "ondrag must not push undo every frame");
ok(ondblclick.includes("pushUndoState("), "ondblclick pushes undo before xover reset");

// Completion still uses notifyclients (not a substitute for undo push).
ok(anEndDrag.includes("notifyclients(") || onclick.includes("notifyclients("), "notifyclients still used on completion paths");

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
