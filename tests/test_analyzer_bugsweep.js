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

// ---------------------------------------------------------------------------
// Pass 1 i1 — spectrum axis, bars calibration, scope timebase.
// Each test below fails on main for the stated reason (measured with the real
// ui FFT in a vm sandbox). No fixes in pass 1.
// ---------------------------------------------------------------------------
const CFG = require(path.join(ROOT, "src/analyzer_config.js"));
const VM = require("vm");

// Bug 1 — log axis floor (40 Hz in anLogX, src/analyzer_config.js) is above the
// lowest 1/3-octave centres (19.7 Hz in anThirdCenters) and the heat-row start
// (30 Hz in anRowFreq, src/analyzer_ui.js). anPaintBars positions bars with
// anLogX(centres[i]) and anPaintHeat/Fall position rows with anRowX, so the
// four lowest bars (19.7/24.8/31.3/39.4 Hz) all clamp to the same left-edge x
// and stack on top of each other; the 20-40 Hz bands are unreadable.
ok(UI.includes("anLogX(centers"), "bars are positioned with anLogX(centres) (axis test is tied to the paint path)");
(function () {
    var centers = CFG.anThirdCenters();
    var prev = -Infinity;
    var distinct = true;
    var i;
    for (i = 0; i < centers.length; i++) {
        var x = CFG.anLogX(centers[i], 0, 300);
        if (!(x > prev)) distinct = false;
        prev = x;
    }
    ok(distinct, "every 1/3-octave centre maps to a distinct, increasing log-axis x (no stacked bars)");
})();

// Load config + ui exactly as the build concatenates them (minus theme/dsp,
// whose functions the paths below never call), with a stub Buffer serving a
// deterministic scope ring and header.
function loadFace() {
    var HEAD = 3000;
    function FakeBuffer() {}
    FakeBuffer.prototype.peek = function (chan, start, count) {
        var out = [];
        var i;
        for (i = 0; i < count; i++) {
            if (start === 0) out.push([1, 48000, HEAD, HEAD][i] || 0);
            else out.push(Math.sin(2 * Math.PI * (start + i) / 480));
        }
        return out;
    };
    var sb = {
        Math: Math, Number: Number, String: String, Array: Array, Object: Object,
        Float64Array: Float64Array, Date: Date, console: console,
        Buffer: FakeBuffer,
        outlet: function () {}, notifyclients: function () {}, post: function () {},
        arrayfromargs: function (a) { return Array.prototype.slice.call(a); },
        mgraphics: { init: function () {}, redraw: function () {}, size: [392, 169], relative_coords: 0, autofill: 0 }
    };
    VM.createContext(sb);
    VM.runInContext(fs.readFileSync(path.join(ROOT, "src/analyzer_config.js"), "utf8"), sb);
    VM.runInContext(UI, sb);
    return sb;
}

var face = null;
try { face = loadFace(); } catch (err) { face = null; }
ok(!!face, "config + ui load in a vm sandbox");

// Bug 2 — Bars over-read a tone by +1.76 dB. anBandEnergies
// (src/analyzer_config.js) sums the raw Hann-windowed FFT power and
// anTakeSpectrum (src/analyzer_ui.js) converts it straight to dB on the same
// AN_DB scale where the Heat view (peak bin) is exact: a bin-centred sine at
// amp 0.5 reads -6.02 dB in Heat but -4.26 dB in its 1/3-octave band (the
// window power/peak ratio 1.5 is never divided out). Expected: the band reads
// the tone's true level, matching Heat.
if (face) {
    var frame = [];
    var i2;
    for (i2 = 0; i2 < CFG.AN_FFT_N; i2++) frame.push(0.5 * Math.sin(2 * Math.PI * 171 * i2 / CFG.AN_FFT_N));
    var power = face.anFftPower(frame);
    var col = face.anColFromPower(power, 48000);
    var heatPeak = -999;
    for (i2 = 0; i2 < col.length; i2++) heatPeak = Math.max(heatPeak, col[i2]);
    ok(Math.abs(heatPeak - (-6.02)) < 0.15, "heat peak of an amp 0.5 sine is -6.02 dB (got " + heatPeak.toFixed(2) + ")");
    var energies = CFG.anBandEnergies(power, CFG.AN_FFT_N, 48000);
    var bandDb = CFG.anClamp(10 * Math.log10(Math.max(energies[17], 1e-12)), -80, 0);
    ok(Math.abs(bandDb - (-6.02)) < 0.15, "1 kHz band of an amp 0.5 sine reads -6.02 dB like Heat (got " + bandDb.toFixed(2) + ")");
    var rowXs = [];
    var r2;
    for (r2 = 0; r2 < CFG.AN_HEAT_ROWS; r2++) rowXs.push(face.anRowX(r2, CFG.AN_HEAT_ROWS, [0, 0, 300, 100]));
    var rowsDistinct = true;
    for (r2 = 1; r2 < rowXs.length; r2++) if (!(rowXs[r2] > rowXs[r2 - 1])) rowsDistinct = false;
    ok(rowsDistinct, "every heat row maps to a distinct, increasing x (rows below 40 Hz do not collapse)");
}

// Bug 3 — the 50 ms scope timebase is silently truncated. anTakeScope
// (src/analyzer_ui.js) caps the sample count at AN_SCOPE_N / 2 (2048), so at
// 48 kHz the "50 ms" window shows 2048 samples = 42.7 ms, although a
// 2400-sample cut fits the 4096-sample ring for both Auto (last rising
// crossing with i + count <= n) and Free (tail). Expected: 2400 samples.
if (face) {
    face.anScopeTime = 2; // AN_SCOPE_MS[2] = 50
    face.anSr = 48000;
    face.anTakeScope();
    var got = face.anScopeL ? face.anScopeL.length : -1;
    ok(got === 2400, "50 ms scope window at 48 kHz holds 2400 samples (got " + got + ")");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

