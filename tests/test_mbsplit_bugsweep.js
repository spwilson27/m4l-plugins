#!/usr/bin/env node
/**
 * Bugsweep RED tests for devices/Multiband Split.amxd.
 *
 * Defect (UI / undo discipline / AGENTS.md): the bottom-right link-status
 * badge toggle in onclick flips showLinkStatus (a field in snapshotState /
 * getvalueof / setvalueof) and calls notifyclients() with no pushUndoState().
 * Every other state-changing gesture (volume, AUTO, band pills, crossovers,
 * band regions) pushes undo once at gesture start.
 *
 * These tests FAIL on the current tree and must pass once the defect is fixed.
 * No production code is changed by this file.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UI_PATH = path.join(ROOT, "src", "mbsplit_ui.js");
const uiSource = fs.readFileSync(UI_PATH, "utf8");

const failures = [];
function check(name, fn) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (err) {
        failures.push(name + ": " + err.message);
        console.log("FAIL " + name + ": " + err.message);
    }
}

function extractFunction(source, name) {
    const start = source.indexOf("function " + name + "(");
    assert.ok(start >= 0, "could not find function " + name + " in mbsplit_ui.js");
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error("unterminated function " + name);
}

check("showLinkStatus is part of persisted Live state (snapshotState + getvalueof)", function () {
    const snap = extractFunction(uiSource, "snapshotState");
    assert.ok(/showLinkStatus\s*:/.test(snap), "snapshotState must include showLinkStatus");
    const getv = extractFunction(uiSource, "getvalueof");
    assert.ok(/showLinkStatus/.test(getv), "getvalueof must serialize showLinkStatus");
});

check("link-badge toggle pushes undo before notifyclients (defect: showLinkStatus flip notifies with no pushUndoState)", function () {
    const onclick = extractFunction(uiSource, "onclick");
    const badgeIdx = onclick.indexOf("getLinkBadgeRect");
    assert.ok(badgeIdx >= 0, "onclick must hit-test getLinkBadgeRect");
    const after = onclick.slice(badgeIdx);
    const toggleIdx = after.indexOf("showLinkStatus = !showLinkStatus");
    assert.ok(toggleIdx >= 0, "link-badge branch must toggle showLinkStatus");
    // Window covering the toggle through notifyclients/return of that branch.
    const window = after.slice(Math.max(0, toggleIdx - 120), toggleIdx + 220);
    assert.ok(/notifyclients\s*\(/.test(window), "link-badge toggle must notifyclients");
    assert.ok(
        /pushUndoState\s*\(/.test(window),
        "link-badge toggle notifies Live of a persisted state change (showLinkStatus in snapshotState/getvalueof) without pushUndoState — AGENTS.md: pushUndoState once at gesture start, notifyclients on completion"
    );
});

if (failures.length) {
    console.error("\n" + failures.length + " bugsweep red test(s) failing:");
    for (const f of failures) console.error(" - " + f);
    process.exit(1);
}
console.log("\nAll bugsweep tests passed.");
