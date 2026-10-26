#!/usr/bin/env node
/**
 * PASS-1 RED suite for Tiny Space bugsweep.
 * These checks are expected to FAIL on current baseline until pass-3 fixes.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UI_PATH = path.join(ROOT, "src", "tinyspace_ui.js");

let checks = 0;
function ok(cond, msg) {
    checks++;
    assert.ok(cond, msg);
}

const uiSrc = fs.readFileSync(UI_PATH, "utf8");

// ---------------------------------------------------------------------------------------------
// Bug A — Max global shadowing (`var box`) crashes Live on pointer events
// Same class as Delay+: Max reads its own `box` accessor during UI events.
// ---------------------------------------------------------------------------------------------
{
    const reserved = ["box", "patcher", "max", "messagename", "inlet", "jsarguments"];
    for (const r of reserved) {
        ok(
            !new RegExp("(^|\\n)\\s*(var|let|const|function)\\s+" + r + "\\b").test(uiSrc),
            "Bug A RED: tinyspace_ui.js must not declare Max global `" + r + "` (var box crashed Live in Delay+)"
        );
        ok(
            !new RegExp("(^|[^.\\w])" + r + "\\s*=[^=]").test(uiSrc),
            "Bug A RED: tinyspace_ui.js must not assign Max global `" + r + "`"
        );
    }
}

console.log(`tinyspace bugsweep RED: ${checks} checks (expected FAIL on current code until PASS 3 fixes)`);
