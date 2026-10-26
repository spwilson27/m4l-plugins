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

// ---- Pass 1 iteration 1: src/mseg_editor.js (loaded with Max stubs, as in test_shaper.js) ----
global.mgraphics = { size: [262, 134], init() {}, redraw() {} };
global.outlet = function () {};
global.notifyclients = function () {};
global.Buffer = function () { this.poke = function () {}; };
eval(fs.readFileSync(path.join(ROOT, "src", "mseg_editor.js"), "utf8"));

const editorFailures = [];
function check(name, fn) {
    try { fn(); console.log("PASS: " + name); }
    catch (e) { editorFailures.push(name + ": " + e.message); console.log("FAIL: " + name + " -- " + e.message); }
}
function setEditorPoints(pts) {
    const arr = [2, 0, 0, 0.0, 1.0, pts.length];
    for (const p of pts) arr.push(p[0], p[1], p[2], p[3]);
    setvalueof(arr);
}

// Control (must PASS): flipx of a plain bow segment mirrors the shape exactly.
check("flipx plain segment mirror (control)", function () {
    setEditorPoints([[0, 0, 0.6, 0], [0.5, 1, 0, 0], [1, 0, 0, 0]]);
    const xs = [0.125, 0.375, 0.625, 0.875];
    const orig = xs.map((x) => evalCurveAt(1 - x));
    applyToolbarAction("flipx");
    for (let i = 0; i < xs.length; i++) {
        const got = evalCurveAt(xs[i]);
        assert.ok(Math.abs(got - orig[i]) < 1e-9, "plain flipx mirror mismatch at x=" + xs[i] + ": got " + got + ", want " + orig[i]);
    }
});

// Bug (RED): flipx negates the previous segment curve unconditionally (mseg_editor.js
// applyToolbarAction flipx). For an S-curve segment f(1-t) = 1 - f(t), so the mirrored
// segment must KEEP its curve sign; negating it produces the wrong S shape.
check("flipx S-curve segment mirror", function () {
    setEditorPoints([[0, 0, 0.6, 1], [0.5, 1, 0, 0], [1, 0, 0, 0]]);
    const xs = [0.125, 0.375, 0.625, 0.875];
    const orig = xs.map((x) => evalCurveAt(1 - x));
    applyToolbarAction("flipx");
    for (let i = 0; i < xs.length; i++) {
        const got = evalCurveAt(xs[i]);
        assert.ok(Math.abs(got - orig[i]) < 1e-9, "S-curve flipx mirror mismatch at x=" + xs[i] + ": got " + got + ", want " + orig[i] + " (curve sign must not be negated for sCurve segments)");
    }
});

// Bug (RED): hitTest point branch searches i < points.length - 1, so the LAST point
// never matches and segIndex falls back to 0. Alt+drag / Alt+dblclick on the last
// point then bends or toggles segment 0 instead of no segment.
check("hitTest last point segIndex", function () {
    setEditorPoints([[0, 0, 0, 0], [0.5, 1, 0, 0], [1, 0, 0, 0]]);
    const lay = getLayout();
    const sc = normToScreen(1.0, 0.0, lay);
    const hit = hitTest(sc[0], sc[1], lay);
    assert.strictEqual(hit.type, "point", "expected a point hit on the last point");
    assert.strictEqual(hit.segIndex, 2, "last point segIndex should be its own index 2, got " + hit.segIndex);
});

if (editorFailures.length) throw new Error("mseg_editor bugsweep failures: " + editorFailures.join(" | "));

console.log("SUCCESS: shaper bugsweep RED tests passed (unexpected — bug may already be fixed)");
