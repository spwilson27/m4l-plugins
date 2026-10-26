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

// Regression (already fixed): multi-select pure vertical must not union the
// whole selection span and delete an unselected middle point far from both.
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
    const after = msegMoveSelection(clonePts(pts), sel, start, 2, 0.25, 0.55, 0);
    const ids = after.map((p) => p.id);
    assert.strictEqual(
        after.some((p) => p.id === 3),
        true,
        "vertical multi-select drag must not delete unselected middle point 3 " +
            `(got ids=${ids.join(",")}); union of selection span must stay dx-gated`
    );
    assert.strictEqual(after.length, 5, `expected 5 points after vertical group move, got ${after.length}`);
}

// Bug (RED): src/mseg_edit.js msegMoveSelection still pushes per-point sweep
// intervals of ±0.002 even when dx===0 (no horizontal travel). A pure vertical
// drag of a selected point therefore deletes any unselected neighbor within
// 0.002 in x — contradicting the L41 comment that only points on a selected
// point's *travel* are removed.
{
    const pts = [
        { id: 1, x: 0, y: 0.5 },
        { id: 2, x: 0.25, y: 0.8 },
        { id: 3, x: 0.251, y: 0.2 },
        { id: 4, x: 0.75, y: 0.9 },
        { id: 5, x: 1, y: 0.5 },
    ];
    const sel = [2];
    const start = startMapFrom(pts);
    const after = msegMoveSelection(clonePts(pts), sel, start, 2, 0.25, 0.55, 0);
    const ids = after.map((p) => p.id);
    assert.strictEqual(
        after.some((p) => p.id === 3),
        true,
        "pure vertical drag must not delete unselected neighbor at x+0.001 " +
            `(got ids=${ids.join(",")}); zero-travel ±0.002 sweep in mseg_edit.js`
    );
    assert.strictEqual(after.length, 5, `expected 5 points after vertical move, got ${after.length} (ids=${ids.join(",")})`);
    const moved2 = after.find((p) => p.id === 2);
    assert.ok(moved2 && Math.abs(moved2.y - 0.55) < 1e-9, "selected point 2 should move in y");
    assert.ok(moved2 && Math.abs(moved2.x - 0.25) < 1e-9, "selected point 2 x unchanged on vertical drag");
}

// Bug (RED): same zero-travel sweep under multi-select — neighbors within
// ±0.002 of EACH selected point are deleted even though dx===0.
{
    const pts = [
        { id: 1, x: 0, y: 0.5 },
        { id: 2, x: 0.25, y: 0.8 },
        { id: 3, x: 0.252, y: 0.2 },
        { id: 4, x: 0.75, y: 0.9 },
        { id: 5, x: 0.752, y: 0.3 },
        { id: 6, x: 1, y: 0.5 },
    ];
    const sel = [2, 4];
    const start = startMapFrom(pts);
    const after = msegMoveSelection(clonePts(pts), sel, start, 2, 0.25, 0.55, 0);
    const ids = after.map((p) => p.id);
    assert.strictEqual(
        after.some((p) => p.id === 3) && after.some((p) => p.id === 5),
        true,
        "multi-select vertical drag must keep neighbors at +0.002 from each selected x " +
            `(got ids=${ids.join(",")})`
    );
    assert.strictEqual(after.length, 6, `expected 6 points, got ${after.length} (ids=${ids.join(",")})`);
}

console.log("SUCCESS: shaper bugsweep RED tests passed (unexpected — bug may already be fixed)");
