#!/usr/bin/env node
/**
 * Bugsweep PASS 1 RED tests for Better Shaper.
 * Run: node tests/test_shaper_bugsweep.js
 * Expected: FAIL on current production code (do not "fix" by editing src/).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.dirname(__dirname);
eval(fs.readFileSync(path.join(ROOT, "src", "mseg_edit.js"), "utf8"));

function startMapFrom(pts) {
    const start = {};
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        start[p.id] = { x: p.x, y: p.y, isFirst: i === 0, isLast: i === pts.length - 1 };
    }
    return start;
}

function clonePts(pts) {
    return pts.map((p) => ({ id: p.id, x: p.x, y: p.y }));
}

// Bug: src/mseg_edit.js:83-89 (msegMoveSelection). After pushing per-point travel
// intervals, if sweepIntervals.length >= 2 the code also pushes the bounding
// union of ALL intervals. Multi-selecting two+ interiors always hits that branch,
// so a pure vertical group move (dx=0) deletes every unselected point between the
// leftmost and rightmost selected x — contradicting the L41 comment that only
// points on a selected point's travel are removed.
{
    const pts = [
        { id: 1, x: 0, y: 0.5 },
        { id: 2, x: 0.25, y: 0.8 },
        { id: 3, x: 0.5, y: 0.2 },
        { id: 4, x: 0.75, y: 0.9 },
        { id: 5, x: 1, y: 0.5 },
    ];
    const sel = [2, 4];
    const start = startMapFrom(pts);
    // Primary stays at x=0.25; dy = 0.55 - 0.8 = -0.25 (pure vertical).
    const after = msegMoveSelection(clonePts(pts), sel, start, 2, 0.25, 0.55, 0);
    const ids = after.map((p) => p.id);
    assert.strictEqual(
        after.some((p) => p.id === 3),
        true,
        "vertical multi-select drag must not delete unselected middle point 3 " +
            `(got ids=${ids.join(",")}); src/mseg_edit.js:83-89 unions the whole selection span`
    );
    assert.strictEqual(
        after.length,
        5,
        `expected 5 points after vertical group move, got ${after.length} (ids=${ids.join(",")})`
    );
    const moved2 = after.find((p) => p.id === 2);
    const moved4 = after.find((p) => p.id === 4);
    assert.ok(moved2 && Math.abs(moved2.y - 0.55) < 1e-9, "selected point 2 should move in y");
    assert.ok(moved4 && Math.abs(moved4.y - (0.9 - 0.25)) < 1e-9, "selected point 4 should move by same dy");
    assert.ok(moved2 && Math.abs(moved2.x - 0.25) < 1e-9, "selected point 2 x unchanged on vertical drag");
    assert.ok(moved4 && Math.abs(moved4.x - 0.75) < 1e-9, "selected point 4 x unchanged on vertical drag");
}

console.log("SUCCESS: shaper bugsweep RED tests passed (unexpected — bug may already be fixed)");
