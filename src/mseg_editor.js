/*
 * Bitwig-Style MSEG Editor for Max for Live (v8ui)
 * File: src/mseg_editor.js
 *
 * Features:
 *  - Single-click on curve or empty space to create point
 *  - Double-click on point to delete point (or reset curve handle)
 *  - Alt+drag on segment (or drag segment midpoint handle directly) to bend tension curve
 *  - S-Curve mode per segment (symmetric sigmoid tension; toggle via 'S-Crv' button or Ctrl/Right-click segment)
 *  - Dragging point(s) over other points overwrites ("eats") them like Bitwig
 *  - Drag in empty space (or Shift+drag) to draw marquee selection box for multiple points
 *  - Multi-selection move, vertical bounding-box scale, and multi-segment curve adjust
 *  - Paint / Draw Step Brush mode (Step, Ramp, Decay, Triangle, Freehand) synced to Grid
 *  - Draggable Loop Start / Loop End region markers with audio-rate phase windowing
 *  - Undo / Redo history stack (up to 64 states)
 *  - Preset shapes, Flip X / Flip Y, Loop endpoint link, Grid & Snap
 */

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;

let bufName = "";
let bufObj = null;
const TABLE_SIZE = 4096;

// LFO Rate state
// Outlet 0: ["loop", loopStart, loopSpan] for MSP phase windowing
// Outlet 1: frequency in Hz (float) for phasor~
let rateMode = 0; // 0 = Hz, 1 = Sync
let rateHz = 1.0;
let rateSync = 9; // default 1/4 note
let hostBpm = 120.0;
const SYNC_BEATS = [
    0.0625,      // 0: 1/64
    0.125,       // 1: 1/32
    0.16666667,  // 2: 1/16T
    0.25,        // 3: 1/16
    0.375,       // 4: 1/16D
    0.33333333,  // 5: 1/8T
    0.5,         // 6: 1/8
    0.75,        // 7: 1/8D
    0.66666667,  // 8: 1/4T
    1.0,         // 9: 1/4
    1.5,         // 10: 1/4D
    2.0,         // 11: 1/2
    4.0,         // 12: 1 Bar
    8.0,         // 13: 2 Bars
    16.0,        // 14: 4 Bars
    32.0         // 15: 8 Bars
];

// Editor settings
let gridX = 8;
let gridY = 4;
let snapEnabled = 1;
let loopLink = 0;      // Link start (x=0) and end (x=1) Y values
let loopEnabled = 0;   // Sub-region loop active
let loopStart = 0.0;   // Loop start marker in [0, 1]
let loopEnd = 1.0;     // Loop end marker in [0, 1]
let currentPhase = 0.0;

// Paint / Draw Step Brush state
let drawMode = 0;      // 0 = Edit mode, 1 = Paint/Draw Brush mode
let brushType = 0;     // 0 = Step, 1 = Ramp Up, 2 = Decay Down, 3 = Triangle, 4 = Freehand
const BRUSH_NAMES = ["Step", "Ramp", "Decay", "Tri", "Free"];

// MSEG Points: sorted by x in [0, 1], y in [0, 1], curve in [-1, 1], sCurve in {0, 1}
let nextId = 10;
let points = [
    { id: 1, x: 0.0, y: 0.0, curve: 0.45, sCurve: 0 },
    { id: 2, x: 0.5, y: 1.0, curve: 0.0, sCurve: 0 },
    { id: 3, x: 0.5001, y: 0.0, curve: -0.45, sCurve: 0 },
    { id: 4, x: 1.0, y: 1.0, curve: 0.0, sCurve: 0 }
];

let selectedIds = [];

// Undo / Redo History Stack
const MAX_HISTORY = 64;
let undoStack = [];
let redoStack = [];

function captureStateSnapshot() {
    return {
        loopLink: loopLink,
        loopEnabled: loopEnabled,
        loopStart: loopStart,
        loopEnd: loopEnd,
        points: points.map(function(pt) {
            return {
                id: pt.id,
                x: pt.x,
                y: pt.y,
                curve: pt.curve || 0.0,
                sCurve: pt.sCurve ? 1 : 0
            };
        })
    };
}

function restoreStateSnapshot(snap) {
    if (!snap || !snap.points || snap.points.length < 2) return;
    loopLink = snap.loopLink ? 1 : 0;
    loopEnabled = snap.loopEnabled ? 1 : 0;
    loopStart = (typeof snap.loopStart === "number") ? snap.loopStart : 0.0;
    loopEnd = (typeof snap.loopEnd === "number") ? snap.loopEnd : 1.0;
    points = snap.points.map(function(pt) {
        return {
            id: pt.id || (nextId++),
            x: pt.x,
            y: pt.y,
            curve: pt.curve || 0.0,
            sCurve: pt.sCurve ? 1 : 0
        };
    });
    selectedIds = [];
    updateLoopOutput();
    updateRateOutput();
    updateBufferAndNotify(true);
}

function pushUndoState() {
    undoStack.push(captureStateSnapshot());
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(captureStateSnapshot());
    let prev = undoStack.pop();
    restoreStateSnapshot(prev);
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(captureStateSnapshot());
    let next = redoStack.pop();
    restoreStateSnapshot(next);
}

let hoverInfo = {
    type: "none",
    pointId: null,
    segIndex: -1,
    toolbarIndex: -1,
    mouseX: -1,
    mouseY: -1,
    normX: 0,
    normY: 0,
    curveY: 0
};

let dragState = {
    mode: "none", // "none", "point", "curve", "marquee_pending", "marquee", "bbox_scale", "paint", "loop_start", "loop_end", "loop_move"
    startMouseX: 0,
    startMouseY: 0,
    lastMouseX: 0,
    lastMouseY: 0,
    startNormX: 0,
    startNormY: 0,
    primaryId: null,
    existingClickedId: null,
    justCreatedId: null,
    justCreatedTime: 0,
    segIndex: -1,
    startCurve: 0,
    slopeSign: 1,
    multiCurves: null,
    startPointsMap: {},
    marqueeRect: null,
    baseSelection: [],
    scaleEdge: "top",
    scaleMinY: 0,
    scaleMaxY: 1,
    startLoopStart: 0.0,
    startLoopEnd: 1.0,
    lastFreeX: -1
};

const TOOLBAR_ITEMS = [
    { id: "undo",  label: "<",     title: "Undo" },
    { id: "redo",  label: ">",     title: "Redo" },
    { id: "draw",  label: "Draw",  title: "Paint / Step Brush Mode" },
    { id: "brush", label: "Shape", title: "Brush Shape (Step/Ramp/Decay/Tri/Free)" },
    { id: "scurve",label: "S-Crv", title: "Toggle S-Curve on Segment(s)" },
    { id: "loopr", label: "Loop",  title: "Toggle Loop Region" },
    { id: "clear", label: "X",     title: "Delete Selected / Reset" },
    { id: "decay", label: "Dec",   title: "Exp Decay" },
    { id: "ramp",  label: "Rmp",   title: "Exp Ramp" },
    { id: "sine",  label: "Sin",   title: "Sine" },
    { id: "tri",   label: "Tri",   title: "Triangle" },
    { id: "saw2",  label: "Saw",   title: "Double Saw" },
    { id: "steps", label: "Stp",   title: "Steps" },
    { id: "rnd",   label: "Rnd",   title: "Randomize" },
    { id: "flipy", label: "FlipY", title: "Invert Vertically" },
    { id: "flipx", label: "FlipX", title: "Reverse Horizontally" },
    { id: "link",  label: "Link",  title: "Link Start/End Y" }
];

// Layout metrics
function getLayout() {
    let sz = mgraphics.size;
    let w = sz[0] || 320;
    let h = sz[1] || 134;
    let loopBarH = 11;
    let toolbarH = 22;
    let padX = 7;
    let padTop = 7;
    let padBot = 6;
    let plotY = loopBarH + padTop;
    let plotW = Math.max(20, w - padX * 2);
    let plotH = Math.max(20, h - toolbarH - plotY - padBot);
    return {
        w: w,
        h: h,
        loopBarY: 0,
        loopBarH: loopBarH,
        padX: padX,
        plotX: padX,
        plotY: plotY,
        plotW: plotW,
        plotH: plotH,
        toolbarY: h - toolbarH,
        toolbarH: toolbarH
    };
}

function normToScreen(nx, ny, lay) {
    if (!lay) lay = getLayout();
    return [
        lay.plotX + nx * lay.plotW,
        lay.plotY + (1.0 - ny) * lay.plotH
    ];
}

function screenToNorm(sx, sy, lay) {
    if (!lay) lay = getLayout();
    let nx = (sx - lay.plotX) / lay.plotW;
    let ny = 1.0 - (sy - lay.plotY) / lay.plotH;
    return [
        Math.max(0.0, Math.min(1.0, nx)),
        Math.max(0.0, Math.min(1.0, ny))
    ];
}

function snapValue(val, subdiv, bypassSnap) {
    let doSnap = snapEnabled ? !bypassSnap : bypassSnap;
    if (!doSnap) return val;
    if (subdiv <= 0) return val;
    let step = 1.0 / subdiv;
    return Math.round(val / step) * step;
}

function snapYMagnetic(ny, bypassSnap) {
    let doSnap = snapEnabled ? !bypassSnap : bypassSnap;
    if (!doSnap) return ny;
    let step = 1.0 / gridY;
    let nearest = Math.round(ny / step) * step;
    if (Math.abs(ny - nearest) < 0.045) {
        return nearest;
    }
    return ny;
}

// Evaluate segment curve at normalized t in [0, 1] (supports standard bow & symmetric S-Curve)
function evalSegmentT(t, curve, sCurve) {
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    if (Math.abs(curve) < 0.001) return t;

    let p = Math.pow(2.0, Math.abs(curve) * 3.6);
    if (sCurve) {
        // Symmetric S-Curve inflection at t = 0.5
        if (t < 0.5) {
            let u = t * 2.0;
            let shaped = (curve > 0.0) ? (1.0 - Math.pow(1.0 - u, p)) : Math.pow(u, p);
            return 0.5 * shaped;
        } else {
            let u = (t - 0.5) * 2.0;
            let shaped = (curve > 0.0) ? Math.pow(u, p) : (1.0 - Math.pow(1.0 - u, p));
            return 0.5 + 0.5 * shaped;
        }
    } else {
        if (curve > 0.0) {
            return 1.0 - Math.pow(1.0 - t, p);
        } else {
            return Math.pow(t, p);
        }
    }
}

// Evaluate MSEG Y at normalized X in [0, 1]
function evalCurveAt(nx) {
    if (points.length === 0) return 0.0;
    if (nx <= points[0].x) return points[0].y;
    let last = points[points.length - 1];
    if (nx >= last.x) return last.y;

    for (let i = 0; i < points.length - 1; i++) {
        let p0 = points[i];
        let p1 = points[i + 1];
        if (nx >= p0.x && nx <= p1.x) {
            let dx = p1.x - p0.x;
            if (dx <= 0.00001) {
                return p1.y;
            }
            let t = (nx - p0.x) / dx;
            let u = evalSegmentT(t, p0.curve || 0.0, p0.sCurve ? 1 : 0);
            return p0.y + (p1.y - p0.y) * u;
        }
    }
    return last.y;
}

function sortAndSanitizePoints() {
    if (points.length < 2) {
        points = [
            { id: nextId++, x: 0.0, y: 0.0, curve: 0.0, sCurve: 0 },
            { id: nextId++, x: 1.0, y: 1.0, curve: 0.0, sCurve: 0 }
        ];
    }
    points.sort(function(a, b) {
        if (Math.abs(a.x - b.x) < 0.000001) return a.id - b.id;
        return a.x - b.x;
    });
    points[0].x = 0.0;
    points[points.length - 1].x = 1.0;
    for (let i = 0; i < points.length; i++) {
        points[i].x = Math.max(0.0, Math.min(1.0, points[i].x));
        points[i].y = Math.max(0.0, Math.min(1.0, points[i].y));
        points[i].curve = Math.max(-1.0, Math.min(1.0, points[i].curve || 0.0));
        points[i].sCurve = points[i].sCurve ? 1 : 0;
    }
    loopStart = Math.max(0.0, Math.min(0.95, loopStart));
    loopEnd = Math.max(loopStart + 0.05, Math.min(1.0, loopEnd));
}

function updateBufferAndNotify(notify) {
    sortAndSanitizePoints();
    if (!bufObj && bufName) {
        try {
            bufObj = new Buffer(bufName);
        } catch (e) {
            bufObj = null;
        }
    }
    if (bufObj) {
        let samples = new Array(TABLE_SIZE);
        let denom = TABLE_SIZE - 1;
        for (let i = 0; i < TABLE_SIZE; i++) {
            samples[i] = evalCurveAt(i / denom);
        }
        try {
            bufObj.poke(1, 0, samples);
        } catch (e) {}
    }
    if (notify !== false) {
        notifyclients();
    }
    mgraphics.redraw();
}

function updateLoopOutput() {
    if (loopEnabled) {
        let span = Math.max(0.05, loopEnd - loopStart);
        outlet(0, "loop", loopStart, span);
    } else {
        outlet(0, "loop", 0.0, 1.0);
    }
}

function updateRateOutput() {
    let freq = rateHz;
    if (rateMode === 1) {
        let idx = Math.max(0, Math.min(SYNC_BEATS.length - 1, Math.round(rateSync)));
        let beats = SYNC_BEATS[idx] || 1.0;
        freq = (Math.max(20.0, hostBpm) / 60.0) / beats;
    }
    if (loopEnabled) {
        let span = Math.max(0.05, loopEnd - loopStart);
        freq = freq / span;
    }
    outlet(1, freq);
}

// Paint / Step Brush Engine
function applyPaintBrushAt(nx, ny, shiftHeld, isDragContinuation) {
    let yVal = snapYMagnetic(ny, shiftHeld);

    if (brushType === 4) {
        // Freehand brush: overwrite points in small swept window and drop point
        let freeX = Math.max(0.002, Math.min(0.998, nx));
        if (isDragContinuation && dragState.lastFreeX >= 0) {
            let minX = Math.min(dragState.lastFreeX, freeX) - 0.005;
            let maxX = Math.max(dragState.lastFreeX, freeX) + 0.005;
            let firstId = points[0].id;
            let lastId = points[points.length - 1].id;
            points = points.filter(function(pt) {
                if (pt.id === firstId || pt.id === lastId) return true;
                return (pt.x < minX || pt.x > maxX);
            });
        }
        points.push({ id: nextId++, x: freeX, y: yVal, curve: 0.0, sCurve: 0 });
        dragState.lastFreeX = freeX;
        updateBufferAndNotify(false);
        return;
    }

    // Grid-quantized brushes: Step (0), Ramp Up (1), Decay Down (2), Triangle (3)
    let n = Math.max(1, gridX);
    let cell = Math.min(n - 1, Math.max(0, Math.floor(nx * n)));
    let x0 = cell / n;
    let x1 = (cell + 1) / n;
    let eps = 0.0004;

    // Remove existing interior points inside [x0 - eps, x1 + eps]
    let firstId = points[0].id;
    let lastId = points[points.length - 1].id;
    points = points.filter(function(pt) {
        if (pt.id === firstId || pt.id === lastId) return true;
        return (pt.x < (x0 - eps) || pt.x > (x1 + eps));
    });

    let startX = (cell === 0) ? 0.0005 : (x0 + 0.0002);
    let endX = (cell === n - 1) ? 0.9995 : (x1 - 0.0002);

    if (brushType === 0) {
        // Flat Step bar
        if (cell === 0) points[0].y = yVal;
        if (cell === n - 1) points[points.length - 1].y = yVal;
        points.push({ id: nextId++, x: startX, y: yVal, curve: 0.0, sCurve: 0 });
        points.push({ id: nextId++, x: endX,   y: yVal, curve: 0.0, sCurve: 0 });
    } else if (brushType === 1) {
        // Ramp Up (0 -> yVal)
        if (cell === 0) points[0].y = 0.0;
        if (cell === n - 1) points[points.length - 1].y = yVal;
        points.push({ id: nextId++, x: startX, y: 0.0,  curve: 0.0, sCurve: 0 });
        points.push({ id: nextId++, x: endX,   y: yVal, curve: 0.0, sCurve: 0 });
    } else if (brushType === 2) {
        // Decay Down (yVal -> 0)
        if (cell === 0) points[0].y = yVal;
        if (cell === n - 1) points[points.length - 1].y = 0.0;
        points.push({ id: nextId++, x: startX, y: yVal, curve: 0.35, sCurve: 0 });
        points.push({ id: nextId++, x: endX,   y: 0.0,  curve: 0.0,  sCurve: 0 });
    } else if (brushType === 3) {
        // Triangle Peak (0 -> yVal -> 0)
        let midX = 0.5 * (startX + endX);
        if (cell === 0) points[0].y = 0.0;
        if (cell === n - 1) points[points.length - 1].y = 0.0;
        points.push({ id: nextId++, x: startX, y: 0.0,  curve: 0.0, sCurve: 0 });
        points.push({ id: nextId++, x: midX,   y: yVal, curve: 0.0, sCurve: 0 });
        points.push({ id: nextId++, x: endX,   y: 0.0,  curve: 0.0, sCurve: 0 });
    }

    updateBufferAndNotify(false);
}

// Max Message Handlers
function loadbang() {
    updateLoopOutput();
    updateRateOutput();
    updateBufferAndNotify(false);
}

function setbuffer(name) {
    bufName = String(name);
    try {
        bufObj = new Buffer(bufName);
    } catch (e) {
        bufObj = null;
    }
    updateBufferAndNotify(false);
}

function setphase(p) {
    currentPhase = Math.max(0.0, Math.min(1.0, Number(p) || 0.0));
    mgraphics.redraw();
}

function grid(g) {
    gridX = Math.max(1, Math.min(32, Math.round(Number(g) || 8)));
    mgraphics.redraw();
}

function snap(s) {
    snapEnabled = Number(s) ? 1 : 0;
    mgraphics.redraw();
}

function ratemode(m) {
    rateMode = Number(m) ? 1 : 0;
    updateRateOutput();
}

function ratehz(f) {
    rateHz = Math.max(0.01, Number(f) || 1.0);
    updateRateOutput();
}

function ratesync(s) {
    rateSync = Math.max(0, Math.min(SYNC_BEATS.length - 1, Math.round(Number(s) || 9)));
    updateRateOutput();
}

function bpm(b) {
    hostBpm = Math.max(20.0, Number(b) || 120.0);
    updateRateOutput();
}

// Parameter persistence (Live Set & Preset save/restore - v2 format with v1 fallback)
function getvalueof() {
    let arr = [2, loopLink ? 1 : 0, loopEnabled ? 1 : 0, loopStart, loopEnd, points.length];
    for (let i = 0; i < points.length; i++) {
        arr.push(
            points[i].x,
            points[i].y,
            points[i].curve || 0.0,
            points[i].sCurve ? 1 : 0
        );
    }
    return arr;
}

function setvalueof() {
    let arr = [];
    if (arguments.length === 1 && Array.isArray(arguments[0])) {
        arr = arguments[0];
    } else {
        for (let i = 0; i < arguments.length; i++) {
            arr.push(arguments[i]);
        }
    }
    if (arr.length >= 14 && arr[0] === 2) {
        loopLink = arr[1] ? 1 : 0;
        loopEnabled = arr[2] ? 1 : 0;
        loopStart = Number(arr[3]) || 0.0;
        loopEnd = (typeof arr[4] === "number") ? Number(arr[4]) : 1.0;
        let count = Math.round(arr[5]);
        let newPts = [];
        let idx = 6;
        for (let i = 0; i < count && idx + 3 < arr.length; i++) {
            newPts.push({
                id: nextId++,
                x: Number(arr[idx]) || 0.0,
                y: Number(arr[idx + 1]) || 0.0,
                curve: Number(arr[idx + 2]) || 0.0,
                sCurve: Number(arr[idx + 3]) ? 1 : 0
            });
            idx += 4;
        }
        if (newPts.length >= 2) {
            points = newPts;
            selectedIds = [];
            updateLoopOutput();
            updateRateOutput();
            updateBufferAndNotify(false);
        }
    } else if (arr.length >= 9 && arr[0] === 1) {
        // Backward compatibility with v1 state
        loopLink = arr[1] ? 1 : 0;
        let count = Math.round(arr[2]);
        let newPts = [];
        let idx = 3;
        for (let i = 0; i < count && idx + 2 < arr.length; i++) {
            newPts.push({
                id: nextId++,
                x: Number(arr[idx]) || 0.0,
                y: Number(arr[idx + 1]) || 0.0,
                curve: Number(arr[idx + 2]) || 0.0,
                sCurve: 0
            });
            idx += 3;
        }
        if (newPts.length >= 2) {
            points = newPts;
            selectedIds = [];
            updateLoopOutput();
            updateRateOutput();
            updateBufferAndNotify(false);
        }
    }
}

// Toolbar & Preset Actions
function applyToolbarAction(id) {
    if (id === "undo") {
        undo();
        return;
    }
    if (id === "redo") {
        redo();
        return;
    }
    if (id === "draw") {
        drawMode = drawMode ? 0 : 1;
        mgraphics.redraw();
        return;
    }
    if (id === "brush") {
        brushType = (brushType + 1) % BRUSH_NAMES.length;
        drawMode = 1;
        mgraphics.redraw();
        return;
    }
    if (id === "scurve") {
        pushUndoState();
        let toggledAny = false;
        if (selectedIds.length >= 2) {
            for (let i = 0; i < points.length - 1; i++) {
                if (selectedIds.indexOf(points[i].id) !== -1 && selectedIds.indexOf(points[i + 1].id) !== -1) {
                    points[i].sCurve = points[i].sCurve ? 0 : 1;
                    if (Math.abs(points[i].curve || 0.0) < 0.05) points[i].curve = 0.45;
                    toggledAny = true;
                }
            }
        } else if (selectedIds.length === 1) {
            for (let i = 0; i < points.length - 1; i++) {
                if (points[i].id === selectedIds[0]) {
                    points[i].sCurve = points[i].sCurve ? 0 : 1;
                    if (Math.abs(points[i].curve || 0.0) < 0.05) points[i].curve = 0.45;
                    toggledAny = true;
                    break;
                }
            }
        }
        if (!toggledAny) {
            let allS = true;
            for (let i = 0; i < points.length - 1; i++) {
                if (!points[i].sCurve) allS = false;
            }
            let targetS = allS ? 0 : 1;
            for (let i = 0; i < points.length - 1; i++) {
                points[i].sCurve = targetS;
                if (targetS && Math.abs(points[i].curve || 0.0) < 0.05) {
                    points[i].curve = 0.45;
                }
            }
        }
        updateBufferAndNotify(true);
        return;
    }
    if (id === "loopr") {
        pushUndoState();
        loopEnabled = loopEnabled ? 0 : 1;
        if (loopEnabled && (loopEnd - loopStart) > 0.98) {
            loopStart = 0.25;
            loopEnd = 0.75;
        }
        updateLoopOutput();
        updateRateOutput();
        updateBufferAndNotify(true);
        return;
    }

    pushUndoState();

    if (id === "clear") {
        let hasSelectedInterior = false;
        if (selectedIds.length > 0 && points.length > 2) {
            let firstId = points[0].id;
            let lastId = points[points.length - 1].id;
            points = points.filter(function(pt) {
                if (pt.id === firstId || pt.id === lastId) return true;
                if (selectedIds.indexOf(pt.id) !== -1) {
                    hasSelectedInterior = true;
                    return false;
                }
                return true;
            });
        }
        selectedIds = [];
        if (!hasSelectedInterior) {
            points = [
                { id: nextId++, x: 0.0, y: 0.0, curve: 0.0, sCurve: 0 },
                { id: nextId++, x: 1.0, y: 1.0, curve: 0.0, sCurve: 0 }
            ];
            loopLink = 0;
        }
        updateBufferAndNotify(true);
        return;
    }

    selectedIds = [];
    if (id === "decay") {
        points = [
            { id: nextId++, x: 0.0, y: 1.0, curve: 0.65, sCurve: 0 },
            { id: nextId++, x: 1.0, y: 0.0, curve: 0.0, sCurve: 0 }
        ];
        loopLink = 0;
    } else if (id === "ramp") {
        points = [
            { id: nextId++, x: 0.0, y: 0.0, curve: -0.65, sCurve: 0 },
            { id: nextId++, x: 1.0, y: 1.0, curve: 0.0, sCurve: 0 }
        ];
        loopLink = 0;
    } else if (id === "sine") {
        points = [
            { id: nextId++, x: 0.0,  y: 0.5, curve: 0.38,  sCurve: 0 },
            { id: nextId++, x: 0.25, y: 1.0, curve: -0.38, sCurve: 0 },
            { id: nextId++, x: 0.5,  y: 0.5, curve: 0.38,  sCurve: 0 },
            { id: nextId++, x: 0.75, y: 0.0, curve: -0.38, sCurve: 0 },
            { id: nextId++, x: 1.0,  y: 0.5, curve: 0.0,   sCurve: 0 }
        ];
        loopLink = 1;
    } else if (id === "tri") {
        points = [
            { id: nextId++, x: 0.0, y: 0.0, curve: 0.0, sCurve: 0 },
            { id: nextId++, x: 0.5, y: 1.0, curve: 0.0, sCurve: 0 },
            { id: nextId++, x: 1.0, y: 0.0, curve: 0.0, sCurve: 0 }
        ];
        loopLink = 1;
    } else if (id === "saw2") {
        points = [
            { id: nextId++, x: 0.0,    y: 0.0, curve: 0.45,  sCurve: 0 },
            { id: nextId++, x: 0.5,    y: 1.0, curve: 0.0,   sCurve: 0 },
            { id: nextId++, x: 0.5001, y: 0.0, curve: -0.45, sCurve: 0 },
            { id: nextId++, x: 1.0,    y: 1.0, curve: 0.0,   sCurve: 0 }
        ];
        loopLink = 0;
    } else if (id === "steps") {
        let n = Math.max(2, Math.min(16, gridX));
        let newPts = [];
        for (let i = 0; i < n; i++) {
            let x0 = i / n;
            let x1 = (i + 1) / n;
            let y = (i % 2 === 0) ? 1.0 : ((i % 4 === 1) ? 0.25 : 0.65);
            newPts.push({ id: nextId++, x: x0, y: y, curve: 0.0, sCurve: 0 });
            newPts.push({ id: nextId++, x: (i === n - 1) ? 1.0 : (x1 - 0.0002), y: y, curve: 0.0, sCurve: 0 });
        }
        points = newPts;
        loopLink = 0;
    } else if (id === "rnd") {
        let n = Math.max(3, Math.min(12, gridX));
        let newPts = [];
        let startY = Math.round(Math.random() * 4) / 4;
        for (let i = 0; i <= n; i++) {
            let x = i / n;
            let y = (i === 0) ? startY : (i === n && loopLink ? startY : Math.random());
            if (snapEnabled) {
                y = Math.round(y * 8) / 8;
            }
            let c = (Math.random() - 0.5) * 1.3;
            let s = (Math.random() > 0.65) ? 1 : 0;
            newPts.push({ id: nextId++, x: x, y: y, curve: c, sCurve: s });
        }
        points = newPts;
    } else if (id === "flipy") {
        for (let i = 0; i < points.length; i++) {
            points[i].y = 1.0 - points[i].y;
        }
    } else if (id === "flipx") {
        let n = points.length;
        let rev = [];
        for (let i = n - 1; i >= 0; i--) {
            let prevCurve = (i > 0) ? -(points[i - 1].curve || 0.0) : 0.0;
            let prevS = (i > 0) ? (points[i - 1].sCurve ? 1 : 0) : 0;
            rev.push({
                id: points[i].id,
                x: 1.0 - points[i].x,
                y: points[i].y,
                curve: prevCurve,
                sCurve: prevS
            });
        }
        points = rev;
    } else if (id === "link") {
        loopLink = loopLink ? 0 : 1;
        if (loopLink && points.length >= 2) {
            points[points.length - 1].y = points[0].y;
        }
    }
    updateBufferAndNotify(true);
}

// Multi-selection bounding box in screen coordinates
function getSelectionBounds(lay) {
    if (selectedIds.length < 2) return null;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    let minNormY = 1.0, maxNormY = 0.0;
    let count = 0;
    for (let i = 0; i < points.length; i++) {
        if (selectedIds.indexOf(points[i].id) !== -1) {
            let sc = normToScreen(points[i].x, points[i].y, lay);
            if (sc[0] < minX) minX = sc[0];
            if (sc[0] > maxX) maxX = sc[0];
            if (sc[1] < minY) minY = sc[1];
            if (sc[1] > maxY) maxY = sc[1];
            if (points[i].y < minNormY) minNormY = points[i].y;
            if (points[i].y > maxNormY) maxNormY = points[i].y;
            count++;
        }
    }
    if (count < 2) return null;
    return {
        x: minX - 8,
        y: minY - 8,
        w: Math.max(16, (maxX - minX) + 16),
        h: Math.max(16, (maxY - minY) + 16),
        minNormY: minNormY,
        maxNormY: maxNormY
    };
}

// Hit testing for Bitwig-style interactions
function hitTest(sx, sy, lay) {
    if (!lay) lay = getLayout();

    // 1. Check bottom toolbar
    if (sy >= lay.toolbarY) {
        let itemW = lay.w / TOOLBAR_ITEMS.length;
        let idx = Math.floor(sx / itemW);
        if (idx >= 0 && idx < TOOLBAR_ITEMS.length) {
            return { type: "toolbar", toolbarIndex: idx, pointId: null, segIndex: -1 };
        }
    }

    // 2. Check Top Loop Region Bar (y <= lay.loopBarH + 2)
    if (sy <= lay.loopBarH + 2) {
        let lx0 = lay.plotX + loopStart * lay.plotW;
        let lx1 = lay.plotX + loopEnd * lay.plotW;
        if (Math.abs(sx - lx0) <= 6) {
            return { type: "loop_start", pointId: null, segIndex: -1, toolbarIndex: -1 };
        }
        if (Math.abs(sx - lx1) <= 6) {
            return { type: "loop_end", pointId: null, segIndex: -1, toolbarIndex: -1 };
        }
        if (sx >= lx0 && sx <= lx1) {
            return { type: "loop_bar", pointId: null, segIndex: -1, toolbarIndex: -1 };
        }
        return { type: "loop_track", pointId: null, segIndex: -1, toolbarIndex: -1 };
    }

    // 3. Check existing control points (radius 9px)
    let bestPt = null;
    let bestDist = 9.0;
    for (let i = 0; i < points.length; i++) {
        let sc = normToScreen(points[i].x, points[i].y, lay);
        let d = Math.hypot(sx - sc[0], sy - sc[1]);
        if (d <= bestDist) {
            bestDist = d;
            bestPt = points[i];
        }
    }
    if (bestPt) {
        let segIdx = 0;
        for (let i = 0; i < points.length - 1; i++) {
            if (points[i].id === bestPt.id) { segIdx = i; break; }
        }
        return { type: "point", pointId: bestPt.id, segIndex: segIdx, toolbarIndex: -1 };
    }

    // 4. Check multi-selection bounding box top/bottom scale handles
    let bbox = getSelectionBounds(lay);
    if (bbox && (bbox.maxNormY - bbox.minNormY) > 0.02) {
        if (sx >= bbox.x && sx <= bbox.x + bbox.w) {
            if (Math.abs(sy - bbox.y) <= 5) {
                return { type: "bbox_top", pointId: null, segIndex: -1, toolbarIndex: -1 };
            }
            if (Math.abs(sy - (bbox.y + bbox.h)) <= 5) {
                return { type: "bbox_bottom", pointId: null, segIndex: -1, toolbarIndex: -1 };
            }
        }
    }

    // 5. Check segment midpoint tension handles (radius 7.5px)
    for (let i = 0; i < points.length - 1; i++) {
        let p0 = points[i];
        let p1 = points[i + 1];
        let sc0 = normToScreen(p0.x, p0.y, lay);
        let sc1 = normToScreen(p1.x, p1.y, lay);
        if (Math.abs(sc1[0] - sc0[0]) >= 18) {
            let midX = 0.5 * (p0.x + p1.x);
            let midY = p0.y + (p1.y - p0.y) * evalSegmentT(0.5, p0.curve || 0.0, p0.sCurve ? 1 : 0);
            let scm = normToScreen(midX, midY, lay);
            if (Math.hypot(sx - scm[0], sy - scm[1]) <= 7.5) {
                return { type: "midhandle", pointId: null, segIndex: i, toolbarIndex: -1 };
            }
        }
    }

    // 6. Find segment containing sx and check distance to curve
    let norm = screenToNorm(sx, sy, lay);
    let nx = norm[0];
    let ny = norm[1];
    let segIndex = -1;
    for (let i = 0; i < points.length - 1; i++) {
        if (nx >= points[i].x && nx <= points[i + 1].x && (points[i + 1].x - points[i].x) > 0.0001) {
            segIndex = i;
            break;
        }
    }
    let curveY = evalCurveAt(nx);
    let curveScreen = normToScreen(nx, curveY, lay);
    if (Math.abs(sy - curveScreen[1]) <= 10.5) {
        return {
            type: "curve",
            pointId: null,
            segIndex: segIndex,
            toolbarIndex: -1,
            normX: nx,
            normY: ny,
            curveY: curveY
        };
    }

    return {
        type: "empty",
        pointId: null,
        segIndex: segIndex,
        toolbarIndex: -1,
        normX: nx,
        normY: ny,
        curveY: curveY
    };
}

function snapshotSelectionStart() {
    dragState.startPointsMap = {};
    for (let i = 0; i < points.length; i++) {
        dragState.startPointsMap[points[i].id] = {
            x: points[i].x,
            y: points[i].y,
            curve: points[i].curve || 0.0,
            sCurve: points[i].sCurve ? 1 : 0,
            isFirst: (i === 0),
            isLast: (i === points.length - 1)
        };
    }
}

function insertPointAt(nx, ny, selectIt) {
    let segIdx = 0;
    for (let i = 0; i < points.length - 1; i++) {
        if (nx >= points[i].x && nx <= points[i + 1].x) {
            segIdx = i;
            break;
        }
    }
    if (points[segIdx]) {
        points[segIdx].curve = (points[segIdx].curve || 0.0) * 0.5;
    }
    let newPt = {
        id: nextId++,
        x: Math.max(0.001, Math.min(0.999, nx)),
        y: Math.max(0.0, Math.min(1.0, ny)),
        curve: 0.0,
        sCurve: 0
    };
    points.push(newPt);
    sortAndSanitizePoints();
    if (selectIt) {
        selectedIds = [newPt.id];
    }
    return newPt;
}

// Mouse Event Handlers
function onidle(x, y, but, cmd, shift, caps, opt, ctrl) {
    let lay = getLayout();
    let hit = hitTest(x, y, lay);
    let norm = screenToNorm(x, y, lay);
    hoverInfo = {
        type: hit.type,
        pointId: hit.pointId,
        segIndex: hit.segIndex,
        toolbarIndex: hit.toolbarIndex,
        mouseX: x,
        mouseY: y,
        normX: norm[0],
        normY: norm[1],
        curveY: evalCurveAt(norm[0])
    };
    mgraphics.redraw();
}

function onidleout() {
    hoverInfo.type = "none";
    hoverInfo.mouseX = -1;
    hoverInfo.mouseY = -1;
    mgraphics.redraw();
}

function onclick(x, y, but, cmd, shift, caps, opt, ctrl) {
    let lay = getLayout();
    let hit = hitTest(x, y, lay);
    let norm = screenToNorm(x, y, lay);

    dragState.startMouseX = x;
    dragState.startMouseY = y;
    dragState.lastMouseX = x;
    dragState.lastMouseY = y;
    dragState.startNormX = norm[0];
    dragState.startNormY = norm[1];
    dragState.existingClickedId = null;
    dragState.lastFreeX = -1;

    // 1. Toolbar click
    if (hit.type === "toolbar" && hit.toolbarIndex >= 0) {
        dragState.mode = "none";
        applyToolbarAction(TOOLBAR_ITEMS[hit.toolbarIndex].id);
        return;
    }

    // 2. Top Loop Region Bar interactions
    if (hit.type === "loop_start" || hit.type === "loop_end" || hit.type === "loop_bar" || hit.type === "loop_track") {
        pushUndoState();
        loopEnabled = 1;
        dragState.startLoopStart = loopStart;
        dragState.startLoopEnd = loopEnd;
        if (hit.type === "loop_start") {
            dragState.mode = "loop_start";
        } else if (hit.type === "loop_end") {
            dragState.mode = "loop_end";
        } else if (hit.type === "loop_bar") {
            dragState.mode = "loop_move";
        } else {
            let snapped = snapValue(norm[0], gridX, shift);
            if (Math.abs(snapped - loopStart) < Math.abs(snapped - loopEnd)) {
                loopStart = Math.max(0.0, Math.min(loopEnd - 0.05, snapped));
                dragState.mode = "loop_start";
            } else {
                loopEnd = Math.max(loopStart + 0.05, Math.min(1.0, snapped));
                dragState.mode = "loop_end";
            }
        }
        updateLoopOutput();
        updateRateOutput();
        updateBufferAndNotify(true);
        return;
    }

    // 3. Paint / Step Brush Mode (or Ctrl+Alt+Drag shortcut anywhere!)
    if (drawMode || (ctrl && opt)) {
        pushUndoState();
        dragState.mode = "paint";
        selectedIds = [];
        applyPaintBrushAt(norm[0], norm[1], shift, false);
        return;
    }

    // 4. Right-click / Ctrl-click on segment or midpoint handle -> Toggle S-Curve!
    if (ctrl && !opt && hit.segIndex >= 0 && hit.segIndex < points.length - 1) {
        pushUndoState();
        points[hit.segIndex].sCurve = points[hit.segIndex].sCurve ? 0 : 1;
        if (points[hit.segIndex].sCurve && Math.abs(points[hit.segIndex].curve || 0.0) < 0.05) {
            points[hit.segIndex].curve = 0.45;
        }
        dragState.mode = "none";
        updateBufferAndNotify(true);
        return;
    }

    // 5. Alt + Click / Drag or Midpoint Handle -> Tension curve adjustment
    if (opt || hit.type === "midhandle") {
        let segIdx = hit.segIndex;
        if (segIdx >= 0 && segIdx < points.length - 1) {
            pushUndoState();
            if (cmd) {
                points[segIdx].curve = 0.0;
                dragState.mode = "none";
                updateBufferAndNotify(true);
                return;
            }
            dragState.mode = "curve";
            dragState.segIndex = segIdx;
            dragState.startCurve = points[segIdx].curve || 0.0;
            let dySeg = points[segIdx + 1].y - points[segIdx].y;
            dragState.slopeSign = (dySeg >= 0.0) ? 1.0 : -1.0;
            dragState.multiCurves = {};
            for (let i = 0; i < points.length - 1; i++) {
                if (selectedIds.indexOf(points[i].id) !== -1 && selectedIds.indexOf(points[i + 1].id) !== -1) {
                    dragState.multiCurves[points[i].id] = {
                        curve: points[i].curve || 0.0,
                        sign: (points[i + 1].y >= points[i].y) ? 1.0 : -1.0
                    };
                }
            }
            return;
        }
    }

    // 6. Bounding box top/bottom vertical scaling
    if (hit.type === "bbox_top" || hit.type === "bbox_bottom") {
        let bbox = getSelectionBounds(lay);
        if (bbox) {
            pushUndoState();
            dragState.mode = "bbox_scale";
            dragState.scaleEdge = (hit.type === "bbox_top") ? "top" : "bottom";
            dragState.scaleMinY = bbox.minNormY;
            dragState.scaleMaxY = bbox.maxNormY;
            snapshotSelectionStart();
            return;
        }
    }

    // 7. Existing Point click
    if (hit.type === "point" && hit.pointId !== null) {
        dragState.existingClickedId = hit.pointId;
        if (shift) {
            let idx = selectedIds.indexOf(hit.pointId);
            if (idx === -1) selectedIds.push(hit.pointId);
            else selectedIds.splice(idx, 1);
        } else {
            if (selectedIds.indexOf(hit.pointId) === -1) {
                selectedIds = [hit.pointId];
            }
        }
        pushUndoState();
        dragState.mode = "point";
        dragState.primaryId = hit.pointId;
        snapshotSelectionStart();
        mgraphics.redraw();
        return;
    }

    // 8. Click on Curve (or Cmd+Click in empty space) -> Create point immediately & drag it!
    if ((hit.type === "curve" && !shift) || cmd) {
        pushUndoState();
        let nx = snapValue(norm[0], gridX, shift);
        let ny = (hit.type === "curve" && !cmd) ? evalCurveAt(nx) : snapYMagnetic(norm[1], shift);
        let newPt = insertPointAt(nx, ny, true);
        dragState.justCreatedId = newPt.id;
        dragState.justCreatedTime = Date.now();
        dragState.mode = "point";
        dragState.primaryId = newPt.id;
        dragState.startNormX = newPt.x;
        dragState.startNormY = newPt.y;
        snapshotSelectionStart();
        updateBufferAndNotify(true);
        return;
    }

    // 9. Click in Empty Space -> Single-click creates a point; Drag draws a Bitwig selection box!
    dragState.mode = "marquee_pending";
    dragState.baseSelection = shift ? selectedIds.slice() : [];
    dragState.marqueeRect = null;
}
onclick.local = 1;

function ondrag(x, y, but, cmd, shift, caps, opt, ctrl) {
    let lay = getLayout();
    let norm = screenToNorm(x, y, lay);

    // Handle mouse release
    if (but === 0) {
        if (dragState.mode === "marquee_pending") {
            pushUndoState();
            let nx = snapValue(dragState.startNormX, gridX, shift);
            let ny = snapYMagnetic(dragState.startNormY, shift);
            let newPt = insertPointAt(nx, ny, true);
            dragState.justCreatedId = newPt.id;
            dragState.justCreatedTime = Date.now();
            updateBufferAndNotify(true);
        } else if (
            dragState.mode === "point" ||
            dragState.mode === "curve" ||
            dragState.mode === "bbox_scale" ||
            dragState.mode === "paint" ||
            dragState.mode === "loop_start" ||
            dragState.mode === "loop_end" ||
            dragState.mode === "loop_move"
        ) {
            updateBufferAndNotify(true);
        }
        dragState.mode = "none";
        dragState.marqueeRect = null;
        mgraphics.redraw();
        return;
    }

    // 1. Loop Region Marker Dragging
    if (dragState.mode === "loop_start") {
        let nx = snapValue(norm[0], gridX * 2, shift);
        loopStart = Math.max(0.0, Math.min(loopEnd - 0.05, nx));
        updateLoopOutput();
        updateRateOutput();
        mgraphics.redraw();
        return;
    }
    if (dragState.mode === "loop_end") {
        let nx = snapValue(norm[0], gridX * 2, shift);
        loopEnd = Math.max(loopStart + 0.05, Math.min(1.0, nx));
        updateLoopOutput();
        updateRateOutput();
        mgraphics.redraw();
        return;
    }
    if (dragState.mode === "loop_move") {
        let span = dragState.startLoopEnd - dragState.startLoopStart;
        let dx = norm[0] - dragState.startNormX;
        let newStart = snapValue(dragState.startLoopStart + dx, gridX * 2, shift);
        newStart = Math.max(0.0, Math.min(1.0 - span, newStart));
        loopStart = newStart;
        loopEnd = newStart + span;
        updateLoopOutput();
        updateRateOutput();
        mgraphics.redraw();
        return;
    }

    // 2. Paint / Step Brush Dragging
    if (dragState.mode === "paint") {
        applyPaintBrushAt(norm[0], norm[1], shift, true);
        return;
    }

    // 3. Curve Tension Dragging
    if (dragState.mode === "curve") {
        let dy = dragState.startMouseY - y;
        let sensitivity = shift ? 0.004 : 0.014;
        let deltaC = dy * sensitivity;

        let multiKeys = dragState.multiCurves ? Object.keys(dragState.multiCurves) : [];
        if (multiKeys.length > 0) {
            for (let i = 0; i < points.length - 1; i++) {
                let info = dragState.multiCurves[points[i].id];
                if (info) {
                    points[i].curve = Math.max(-0.98, Math.min(0.98, info.curve + deltaC * info.sign));
                }
            }
        } else {
            for (let i = 0; i < points.length - 1; i++) {
                if (i === dragState.segIndex) {
                    points[i].curve = Math.max(-0.98, Math.min(0.98, dragState.startCurve + deltaC * dragState.slopeSign));
                    break;
                }
            }
        }
        updateBufferAndNotify(false);
        return;
    }

    // 4. Multi-selection Bounding Box Vertical Scaling
    if (dragState.mode === "bbox_scale") {
        let span = dragState.scaleMaxY - dragState.scaleMinY;
        if (span > 0.01) {
            let curY = snapYMagnetic(norm[1], shift);
            for (let i = 0; i < points.length; i++) {
                let pt = points[i];
                if (selectedIds.indexOf(pt.id) !== -1 && dragState.startPointsMap[pt.id]) {
                    let st = dragState.startPointsMap[pt.id];
                    if (dragState.scaleEdge === "top") {
                        let rel = (st.y - dragState.scaleMinY) / span;
                        let newMax = Math.max(dragState.scaleMinY + 0.01, curY);
                        pt.y = Math.max(0.0, Math.min(1.0, dragState.scaleMinY + rel * (newMax - dragState.scaleMinY)));
                    } else {
                        let rel = (dragState.scaleMaxY - st.y) / span;
                        let newMin = Math.min(dragState.scaleMaxY - 0.01, curY);
                        pt.y = Math.max(0.0, Math.min(1.0, dragState.scaleMaxY - rel * (dragState.scaleMaxY - newMin)));
                    }
                }
            }
            if (loopLink && points.length >= 2) {
                points[points.length - 1].y = points[0].y;
            }
            updateBufferAndNotify(false);
        }
        return;
    }

    // 5. Point Dragging (with Bitwig Point Overwriting!)
    if (dragState.mode === "point") {
        let primaryStart = dragState.startPointsMap[dragState.primaryId];
        if (!primaryStart) return;

        let targetX = norm[0];
        let targetY = norm[1];
        if (!primaryStart.isFirst && !primaryStart.isLast) {
            targetX = snapValue(targetX, gridX, shift);
        }
        targetY = snapYMagnetic(targetY, shift);

        let dx = targetX - primaryStart.x;
        let dy = targetY - primaryStart.y;

        let minInteriorX = 1.0, maxInteriorX = 0.0, hasInterior = false;
        for (let i = 0; i < selectedIds.length; i++) {
            let st = dragState.startPointsMap[selectedIds[i]];
            if (st && !st.isFirst && !st.isLast) {
                hasInterior = true;
                if (st.x < minInteriorX) minInteriorX = st.x;
                if (st.x > maxInteriorX) maxInteriorX = st.x;
            }
        }
        if (hasInterior) {
            if (minInteriorX + dx < 0.0005) dx = 0.0005 - minInteriorX;
            if (maxInteriorX + dx > 0.9995) dx = 0.9995 - maxInteriorX;
        }

        let sweepIntervals = [];
        for (let i = 0; i < points.length; i++) {
            let pt = points[i];
            if (selectedIds.indexOf(pt.id) !== -1) {
                let st = dragState.startPointsMap[pt.id];
                if (!st) continue;
                let prevX = pt.x;
                let newY = Math.max(0.0, Math.min(1.0, st.y + dy));
                pt.y = newY;

                if (st.isFirst) {
                    pt.x = 0.0;
                    if (loopLink && points.length >= 2) {
                        points[points.length - 1].y = newY;
                    }
                } else if (st.isLast) {
                    pt.x = 1.0;
                    if (loopLink && points.length >= 2) {
                        points[0].y = newY;
                    }
                } else {
                    let newX = Math.max(0.0005, Math.min(0.9995, st.x + dx));
                    pt.x = newX;
                    sweepIntervals.push([
                        Math.min(prevX, newX) - 0.002,
                        Math.max(prevX, newX) + 0.002
                    ]);
                    sweepIntervals.push([
                        Math.min(st.x, newX) - 0.002,
                        Math.max(st.x, newX) + 0.002
                    ]);
                }
            }
        }

        if (sweepIntervals.length >= 2) {
            let minSpan = 1.0, maxSpan = 0.0;
            for (let i = 0; i < sweepIntervals.length; i++) {
                if (sweepIntervals[i][0] < minSpan) minSpan = sweepIntervals[i][0];
                if (sweepIntervals[i][1] > maxSpan) maxSpan = sweepIntervals[i][1];
            }
            sweepIntervals.push([minSpan, maxSpan]);
        }

        if (sweepIntervals.length > 0) {
            points = points.filter(function(pt) {
                let ptSt = dragState.startPointsMap[pt.id];
                if (ptSt && (ptSt.isFirst || ptSt.isLast)) return true;
                if (selectedIds.indexOf(pt.id) !== -1) return true;
                for (let k = 0; k < sweepIntervals.length; k++) {
                    if (pt.x >= sweepIntervals[k][0] && pt.x <= sweepIntervals[k][1]) {
                        return false;
                    }
                }
                return true;
            });
        }

        updateBufferAndNotify(false);
        return;
    }

    // 6. Marquee Selection Box Dragging
    if (dragState.mode === "marquee_pending" || dragState.mode === "marquee") {
        let dist = Math.hypot(x - dragState.startMouseX, y - dragState.startMouseY);
        if (dragState.mode === "marquee_pending" && dist >= 4.0) {
            dragState.mode = "marquee";
        }
        if (dragState.mode === "marquee") {
            let rx = Math.min(dragState.startMouseX, x);
            let ry = Math.min(dragState.startMouseY, y);
            let rw = Math.abs(x - dragState.startMouseX);
            let rh = Math.abs(y - dragState.startMouseY);
            dragState.marqueeRect = [rx, ry, rw, rh];

            let newSel = dragState.baseSelection.slice();
            for (let i = 0; i < points.length; i++) {
                let sc = normToScreen(points[i].x, points[i].y, lay);
                if (sc[0] >= rx && sc[0] <= rx + rw && sc[1] >= ry && sc[1] <= ry + rh) {
                    if (newSel.indexOf(points[i].id) === -1) {
                        newSel.push(points[i].id);
                    }
                }
            }
            selectedIds = newSel;
            mgraphics.redraw();
        }
    }
}
ondrag.local = 1;

function ondblclick(x, y, but, cmd, shift, caps, opt, ctrl) {
    let lay = getLayout();
    let hit = hitTest(x, y, lay);

    // 0. Double-click on loop bar toggles loopEnabled
    if (hit.type === "loop_bar" || hit.type === "loop_track" || hit.type === "loop_start" || hit.type === "loop_end") {
        pushUndoState();
        loopEnabled = loopEnabled ? 0 : 1;
        updateLoopOutput();
        updateRateOutput();
        updateBufferAndNotify(true);
        return;
    }

    // 1. Double-clicking a midpoint tension handle or Alt+double-clicking resets segment curve
    if (hit.type === "midhandle" || (opt && hit.segIndex >= 0)) {
        if (hit.segIndex >= 0 && hit.segIndex < points.length - 1) {
            pushUndoState();
            points[hit.segIndex].curve = 0.0;
            points[hit.segIndex].sCurve = 0;
            updateBufferAndNotify(true);
            return;
        }
    }

    // 2. Double-clicking an existing point deletes it (or deletes all selected interior points)
    let targetId = (hit.type === "point") ? hit.pointId : dragState.existingClickedId;
    if (targetId !== null) {
        if (targetId === dragState.justCreatedId && (Date.now() - dragState.justCreatedTime) < 250) {
            return;
        }

        let idsToDelete = (selectedIds.indexOf(targetId) !== -1 && selectedIds.length > 1)
            ? selectedIds.slice()
            : [targetId];

        let deletedAny = false;
        let firstIdx = 0;
        let lastIdx = points.length - 1;

        if (idsToDelete.length === 1) {
            if (points[firstIdx].id === targetId) {
                pushUndoState();
                points[firstIdx].y = 0.5;
                if (loopLink) points[lastIdx].y = 0.5;
                updateBufferAndNotify(true);
                return;
            }
            if (points[lastIdx].id === targetId) {
                pushUndoState();
                points[lastIdx].y = 0.5;
                if (loopLink) points[firstIdx].y = 0.5;
                updateBufferAndNotify(true);
                return;
            }
        }

        pushUndoState();
        let firstId = points[firstIdx].id;
        let lastId = points[lastIdx].id;
        points = points.filter(function(pt) {
            if (pt.id === firstId || pt.id === lastId) return true;
            if (idsToDelete.indexOf(pt.id) !== -1) {
                deletedAny = true;
                return false;
            }
            return true;
        });

        if (deletedAny) {
            selectedIds = [];
            updateBufferAndNotify(true);
        }
    }
}
ondblclick.local = 1;

// Paint / Vector Rendering (mgraphics)
function drawMiniPresetIcon(id, x, y, w, h) {
    let cx = x + w * 0.5;
    let cy = y + h * 0.5;
    let px = x + 4.5;
    let py = y + 5.0;
    let pw = w - 9.0;
    let ph = h - 10.0;

    if (id === "undo") {
        mgraphics.move_to(cx + 2.5, cy - 4.5);
        mgraphics.line_to(cx - 2.5, cy);
        mgraphics.line_to(cx + 2.5, cy + 4.5);
        mgraphics.stroke();
    } else if (id === "redo") {
        mgraphics.move_to(cx - 2.5, cy - 4.5);
        mgraphics.line_to(cx + 2.5, cy);
        mgraphics.line_to(cx - 2.5, cy + 4.5);
        mgraphics.stroke();
    } else if (id === "draw") {
        // Diagonal pencil / stylus vector icon
        mgraphics.move_to(cx - 4.0, cy + 4.5);
        mgraphics.line_to(cx - 1.5, cy + 4.5);
        mgraphics.line_to(cx + 4.2, cy - 1.2);
        mgraphics.line_to(cx + 1.7, cy - 3.7);
        mgraphics.line_to(cx - 4.0, cy + 2.0);
        mgraphics.close_path();
        mgraphics.stroke();
    } else if (id === "brush") {
        // Active brush shape icon (0=Step, 1=Ramp, 2=Decay, 3=Tri, 4=Free)
        if (brushType === 0) {
            // Step bars icon
            mgraphics.move_to(px, py + ph);
            mgraphics.line_to(px, py + 1);
            mgraphics.line_to(px + pw * 0.5, py + 1);
            mgraphics.line_to(px + pw * 0.5, py + ph * 0.55);
            mgraphics.line_to(px + pw, py + ph * 0.55);
            mgraphics.line_to(px + pw, py + ph);
            mgraphics.stroke();
        } else if (brushType === 1) {
            // Ramp up icon
            mgraphics.move_to(px, py + ph);
            mgraphics.line_to(px + pw, py + 1);
            mgraphics.line_to(px + pw, py + ph);
            mgraphics.stroke();
        } else if (brushType === 2) {
            // Decay down icon
            mgraphics.move_to(px, py + ph);
            mgraphics.line_to(px, py + 1);
            mgraphics.curve_to(px + pw * 0.3, py + ph * 0.8, px + pw * 0.65, py + ph, px + pw, py + ph);
            mgraphics.stroke();
        } else if (brushType === 3) {
            // Triangle peak icon
            mgraphics.move_to(px, py + ph);
            mgraphics.line_to(cx, py + 1);
            mgraphics.line_to(px + pw, py + ph);
            mgraphics.stroke();
        } else {
            // Freehand wave icon
            mgraphics.move_to(px, cy + 2);
            mgraphics.curve_to(px + pw * 0.3, py - 2, px + pw * 0.6, py + ph + 2, px + pw, cy - 2);
            mgraphics.stroke();
        }
    } else if (id === "scurve") {
        // Symmetric S-curve with midpoint inflection dot
        mgraphics.move_to(px, py + ph);
        mgraphics.curve_to(px + pw * 0.45, py + ph, px + pw * 0.55, py, px + pw, py);
        mgraphics.stroke();
        mgraphics.arc(cx, cy, 1.6, 0, Math.PI * 2);
        mgraphics.fill();
    } else if (id === "loopr") {
        // Loop region brackets [ ] with inner bar
        mgraphics.move_to(px + 2.5, py + 1);
        mgraphics.line_to(px, py + 1);
        mgraphics.line_to(px, py + ph - 1);
        mgraphics.line_to(px + 2.5, py + ph - 1);
        mgraphics.move_to(px + pw - 2.5, py + 1);
        mgraphics.line_to(px + pw, py + 1);
        mgraphics.line_to(px + pw, py + ph - 1);
        mgraphics.line_to(px + pw - 2.5, py + ph - 1);
        mgraphics.move_to(px + 2.5, cy);
        mgraphics.line_to(px + pw - 2.5, cy);
        mgraphics.stroke();
    } else if (id === "clear") {
        mgraphics.move_to(cx - 3.8, cy - 3.8);
        mgraphics.line_to(cx + 3.8, cy + 3.8);
        mgraphics.move_to(cx + 3.8, cy - 3.8);
        mgraphics.line_to(cx - 3.8, cy + 3.8);
        mgraphics.stroke();
    } else if (id === "decay") {
        mgraphics.move_to(px, py + 1);
        mgraphics.curve_to(px + pw * 0.25, py + ph * 0.85, px + pw * 0.6, py + ph, px + pw, py + ph);
        mgraphics.stroke();
    } else if (id === "ramp") {
        mgraphics.move_to(px, py + ph);
        mgraphics.curve_to(px + pw * 0.4, py + ph, px + pw * 0.75, py + ph * 0.85, px + pw, py + 1);
        mgraphics.stroke();
    } else if (id === "sine") {
        mgraphics.move_to(px, py + ph * 0.5);
        mgraphics.curve_to(px + pw * 0.25, py - 2, px + pw * 0.25, py - 2, px + pw * 0.5, py + ph * 0.5);
        mgraphics.curve_to(px + pw * 0.75, py + ph + 2, px + pw * 0.75, py + ph + 2, px + pw, py + ph * 0.5);
        mgraphics.stroke();
    } else if (id === "tri") {
        mgraphics.move_to(px, py + ph);
        mgraphics.line_to(px + pw * 0.5, py + 1);
        mgraphics.line_to(px + pw, py + ph);
        mgraphics.stroke();
    } else if (id === "saw2") {
        mgraphics.move_to(px, py + ph);
        mgraphics.line_to(px + pw * 0.5, py + 1);
        mgraphics.line_to(px + pw * 0.5, py + ph);
        mgraphics.line_to(px + pw, py + 1);
        mgraphics.stroke();
    } else if (id === "steps") {
        mgraphics.move_to(px, py + 2);
        mgraphics.line_to(px + pw * 0.33, py + 2);
        mgraphics.line_to(px + pw * 0.33, py + ph - 1);
        mgraphics.line_to(px + pw * 0.66, py + ph - 1);
        mgraphics.line_to(px + pw * 0.66, py + ph * 0.45);
        mgraphics.line_to(px + pw, py + ph * 0.45);
        mgraphics.stroke();
    } else if (id === "rnd") {
        // Random scatter / dice dots icon
        let r = 1.35;
        mgraphics.arc(cx - 3.2, cy - 3.0, r, 0, Math.PI * 2); mgraphics.fill();
        mgraphics.arc(cx + 3.2, cy - 2.2, r, 0, Math.PI * 2); mgraphics.fill();
        mgraphics.arc(cx - 0.3, cy + 0.5, r, 0, Math.PI * 2); mgraphics.fill();
        mgraphics.arc(cx - 2.8, cy + 3.4, r, 0, Math.PI * 2); mgraphics.fill();
        mgraphics.arc(cx + 3.0, cy + 3.2, r, 0, Math.PI * 2); mgraphics.fill();
    } else if (id === "flipy") {
        // Vertical flip double-arrow icon
        mgraphics.move_to(cx, py + 0.5);
        mgraphics.line_to(cx, py + ph - 0.5);
        mgraphics.move_to(cx - 3.0, py + 3.2);
        mgraphics.line_to(cx, py + 0.5);
        mgraphics.line_to(cx + 3.0, py + 3.2);
        mgraphics.move_to(cx - 3.0, py + ph - 3.2);
        mgraphics.line_to(cx, py + ph - 0.5);
        mgraphics.line_to(cx + 3.0, py + ph - 3.2);
        mgraphics.stroke();
    } else if (id === "flipx") {
        // Horizontal reverse double-arrow icon
        mgraphics.move_to(px + 0.5, cy);
        mgraphics.line_to(px + pw - 0.5, cy);
        mgraphics.move_to(px + 3.2, cy - 3.0);
        mgraphics.line_to(px + 0.5, cy);
        mgraphics.line_to(px + 3.2, cy + 3.0);
        mgraphics.move_to(px + pw - 3.2, cy - 3.0);
        mgraphics.line_to(px + pw - 0.5, cy);
        mgraphics.line_to(px + pw - 3.2, cy + 3.0);
        mgraphics.stroke();
    } else if (id === "link") {
        // Coupled circles (link start/end Y) icon
        mgraphics.arc(cx - 2.3, cy, 2.7, 0, Math.PI * 2);
        mgraphics.stroke();
        mgraphics.arc(cx + 2.3, cy, 2.7, 0, Math.PI * 2);
        mgraphics.stroke();
    }
}

function paint() {
    let lay = getLayout();

    // 1. Main LCD Background
    mgraphics.set_source_rgba(0.086, 0.102, 0.122, 1.0);
    mgraphics.rectangle_rounded(0, 0, lay.w, lay.h, 4, 4);
    mgraphics.fill();

    // 2. Top Loop Region Bar Track
    mgraphics.set_source_rgba(0.055, 0.065, 0.08, 1.0);
    mgraphics.rectangle(lay.plotX, 2, lay.plotW, lay.loopBarH - 2);
    mgraphics.fill();

    let lx0 = lay.plotX + loopStart * lay.plotW;
    let lx1 = lay.plotX + loopEnd * lay.plotW;
    let lw = Math.max(4, lx1 - lx0);

    // Loop bar body
    if (loopEnabled) {
        mgraphics.set_source_rgba(0.25, 0.78, 0.95, 0.28);
    } else {
        mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.08);
    }
    mgraphics.rectangle(lx0, 2, lw, lay.loopBarH - 2);
    mgraphics.fill();

    // Loop Start & End Markers
    mgraphics.set_line_width(1.6);
    if (loopEnabled) {
        mgraphics.set_source_rgba(0.32, 0.82, 0.98, 0.95);
    } else {
        mgraphics.set_source_rgba(0.55, 0.6, 0.65, 0.55);
    }
    // Left bracket flag
    mgraphics.move_to(lx0 + 4, 2);
    mgraphics.line_to(lx0, 2);
    mgraphics.line_to(lx0, lay.loopBarH);
    mgraphics.line_to(lx0 + 4, lay.loopBarH);
    mgraphics.stroke();
    // Right bracket flag
    mgraphics.move_to(lx1 - 4, 2);
    mgraphics.line_to(lx1, 2);
    mgraphics.line_to(lx1, lay.loopBarH);
    mgraphics.line_to(lx1 - 4, lay.loopBarH);
    mgraphics.stroke();

    // Plot area inset background
    mgraphics.set_source_rgba(0.067, 0.078, 0.094, 1.0);
    mgraphics.rectangle(lay.plotX, lay.plotY, lay.plotW, lay.plotH);
    mgraphics.fill();

    // Dim outside loop region when Loop is active
    if (loopEnabled) {
        mgraphics.set_source_rgba(0.0, 0.0, 0.0, 0.35);
        if (lx0 > lay.plotX) {
            mgraphics.rectangle(lay.plotX, lay.plotY, lx0 - lay.plotX, lay.plotH);
            mgraphics.fill();
        }
        if (lx1 < lay.plotX + lay.plotW) {
            mgraphics.rectangle(lx1, lay.plotY, (lay.plotX + lay.plotW) - lx1, lay.plotH);
            mgraphics.fill();
        }
        mgraphics.set_line_width(1.0);
        mgraphics.set_source_rgba(0.32, 0.82, 0.98, 0.45);
        mgraphics.move_to(lx0, lay.plotY);
        mgraphics.line_to(lx0, lay.plotY + lay.plotH);
        mgraphics.move_to(lx1, lay.plotY);
        mgraphics.line_to(lx1, lay.plotY + lay.plotH);
        mgraphics.stroke();
    }

    // 3. Grid Lines (X and Y)
    mgraphics.set_line_width(1.0);
    for (let i = 0; i <= gridX; i++) {
        let gx = lay.plotX + (i / gridX) * lay.plotW;
        let isMajor = (i === 0 || i === gridX || (gridX >= 4 && i % 4 === 0));
        mgraphics.set_source_rgba(1.0, 1.0, 1.0, isMajor ? 0.13 : 0.06);
        mgraphics.move_to(gx, lay.plotY);
        mgraphics.line_to(gx, lay.plotY + lay.plotH);
        mgraphics.stroke();
    }
    for (let j = 0; j <= gridY; j++) {
        let gy = lay.plotY + (j / gridY) * lay.plotH;
        let isCenter = (j * 2 === gridY);
        mgraphics.set_source_rgba(1.0, 1.0, 1.0, isCenter ? 0.16 : 0.06);
        mgraphics.move_to(lay.plotX, gy);
        mgraphics.line_to(lay.plotX + lay.plotW, gy);
        mgraphics.stroke();
    }

    // 4. Filled Shaded Area under MSEG Curve
    let steps = Math.max(120, Math.floor(lay.plotW));
    mgraphics.move_to(lay.plotX, lay.plotY + lay.plotH);
    for (let s = 0; s <= steps; s++) {
        let nx = s / steps;
        let ny = evalCurveAt(nx);
        let sc = normToScreen(nx, ny, lay);
        mgraphics.line_to(sc[0], sc[1]);
    }
    mgraphics.line_to(lay.plotX + lay.plotW, lay.plotY + lay.plotH);
    mgraphics.close_path();
    mgraphics.set_source_rgba(1.0, 0.69, 0.18, 0.13);
    mgraphics.fill();

    // 5. Animated Real-Time Playhead Line + Glowing Dot on Curve
    let phScreenX = lay.plotX + currentPhase * lay.plotW;
    let phValY = evalCurveAt(currentPhase);
    let phScreen = normToScreen(currentPhase, phValY, lay);

    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(1.0, 0.82, 0.4, 0.35);
    mgraphics.move_to(phScreenX, lay.plotY);
    mgraphics.line_to(phScreenX, lay.plotY + lay.plotH);
    mgraphics.stroke();

    mgraphics.set_source_rgba(1.0, 0.85, 0.45, 0.35);
    mgraphics.arc(phScreen[0], phScreen[1], 5.5, 0, Math.PI * 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(1.0, 0.92, 0.65, 0.95);
    mgraphics.arc(phScreen[0], phScreen[1], 2.6, 0, Math.PI * 2);
    mgraphics.fill();

    // 6. Main MSEG Curve Stroke
    mgraphics.set_line_width(1.85);
    mgraphics.set_source_rgba(1.0, 0.694, 0.18, 1.0);
    for (let s = 0; s <= steps; s++) {
        let nx = s / steps;
        let ny = evalCurveAt(nx);
        let sc = normToScreen(nx, ny, lay);
        if (s === 0) mgraphics.move_to(sc[0], sc[1]);
        else mgraphics.line_to(sc[0], sc[1]);
    }
    mgraphics.stroke();

    // 7. Segment Midpoint Tension Handles (Diamond = Standard, Circle = S-Curve)
    for (let i = 0; i < points.length - 1; i++) {
        let p0 = points[i];
        let p1 = points[i + 1];
        let sc0 = normToScreen(p0.x, p0.y, lay);
        let sc1 = normToScreen(p1.x, p1.y, lay);
        if (Math.abs(sc1[0] - sc0[0]) >= 18) {
            let midX = 0.5 * (p0.x + p1.x);
            let midY = p0.y + (p1.y - p0.y) * evalSegmentT(0.5, p0.curve || 0.0, p0.sCurve ? 1 : 0);
            let scm = normToScreen(midX, midY, lay);
            let isHovered = (hoverInfo.type === "midhandle" && hoverInfo.segIndex === i) ||
                            (dragState.mode === "curve" && dragState.segIndex === i);
            let hasCurve = Math.abs(p0.curve || 0.0) > 0.02 || p0.sCurve;

            if (isHovered || hasCurve || hoverInfo.segIndex === i) {
                let sz = isHovered ? 3.8 : 2.8;
                mgraphics.set_source_rgba(0.08, 0.1, 0.12, 1.0);
                if (p0.sCurve) {
                    // S-Curve indicator: Cyan-highlighted circle handle
                    mgraphics.arc(scm[0], scm[1], sz, 0, Math.PI * 2);
                    mgraphics.fill_preserve();
                    mgraphics.set_line_width(1.4);
                    mgraphics.set_source_rgba(0.32, 0.85, 0.98, isHovered ? 1.0 : 0.85);
                    mgraphics.stroke();
                } else {
                    // Standard bow indicator: Diamond handle
                    mgraphics.move_to(scm[0], scm[1] - sz);
                    mgraphics.line_to(scm[0] + sz, scm[1]);
                    mgraphics.line_to(scm[0], scm[1] + sz);
                    mgraphics.line_to(scm[0] - sz, scm[1]);
                    mgraphics.close_path();
                    mgraphics.fill_preserve();
                    mgraphics.set_line_width(1.2);
                    mgraphics.set_source_rgba(1.0, 0.82, 0.35, isHovered ? 1.0 : 0.75);
                    mgraphics.stroke();
                }
            }
        }
    }

    // 8. Multi-Selection Bounding Box
    let bbox = getSelectionBounds(lay);
    if (bbox) {
        mgraphics.set_line_width(1.0);
        mgraphics.set_source_rgba(0.45, 0.78, 1.0, 0.38);
        mgraphics.rectangle(bbox.x, bbox.y, bbox.w, bbox.h);
        mgraphics.stroke();

        let topHover = (hoverInfo.type === "bbox_top" || (dragState.mode === "bbox_scale" && dragState.scaleEdge === "top"));
        let botHover = (hoverInfo.type === "bbox_bottom" || (dragState.mode === "bbox_scale" && dragState.scaleEdge === "bottom"));
        mgraphics.set_line_width(2.2);
        mgraphics.set_source_rgba(0.55, 0.85, 1.0, topHover ? 1.0 : 0.65);
        mgraphics.move_to(bbox.x + bbox.w * 0.25, bbox.y);
        mgraphics.line_to(bbox.x + bbox.w * 0.75, bbox.y);
        mgraphics.stroke();

        mgraphics.set_source_rgba(0.55, 0.85, 1.0, botHover ? 1.0 : 0.65);
        mgraphics.move_to(bbox.x + bbox.w * 0.25, bbox.y + bbox.h);
        mgraphics.line_to(bbox.x + bbox.w * 0.75, bbox.y + bbox.h);
        mgraphics.stroke();
    }

    // 9. Control Points
    for (let i = 0; i < points.length; i++) {
        let pt = points[i];
        let sc = normToScreen(pt.x, pt.y, lay);
        let isSel = (selectedIds.indexOf(pt.id) !== -1);
        let isHov = (hoverInfo.type === "point" && hoverInfo.pointId === pt.id);

        if (isSel || isHov) {
            mgraphics.set_source_rgba(1.0, isSel ? 0.95 : 0.75, isSel ? 0.8 : 0.3, isHov ? 0.45 : 0.3);
            mgraphics.arc(sc[0], sc[1], 6.5, 0, Math.PI * 2);
            mgraphics.fill();
        }

        mgraphics.set_source_rgba(0.08, 0.1, 0.12, 1.0);
        mgraphics.arc(sc[0], sc[1], 3.7, 0, Math.PI * 2);
        mgraphics.fill_preserve();

        mgraphics.set_line_width(isSel ? 2.0 : 1.5);
        if (isSel) {
            mgraphics.set_source_rgba(1.0, 0.96, 0.85, 1.0);
        } else {
            mgraphics.set_source_rgba(1.0, 0.694, 0.18, 1.0);
        }
        mgraphics.stroke();
    }

    // 10. Ghost Hover Point on Curve or Paint Brush Cell Preview
    if (dragState.mode === "none" && hoverInfo.mouseY > lay.loopBarH && hoverInfo.mouseY < lay.toolbarY) {
        if (drawMode && brushType < 4) {
            let n = Math.max(1, gridX);
            let cell = Math.min(n - 1, Math.max(0, Math.floor(hoverInfo.normX * n)));
            let cx0 = lay.plotX + (cell / n) * lay.plotW;
            let cw = lay.plotW / n;
            let gy = snapYMagnetic(hoverInfo.normY, false);
            let csc = normToScreen(0, gy, lay);
            mgraphics.set_source_rgba(0.32, 0.82, 0.98, 0.16);
            mgraphics.rectangle(cx0, csc[1], cw, (lay.plotY + lay.plotH) - csc[1]);
            mgraphics.fill();
        } else if (hoverInfo.type === "curve") {
            let gx = snapValue(hoverInfo.normX, gridX, false);
            let gy = evalCurveAt(gx);
            let gsc = normToScreen(gx, gy, lay);
            mgraphics.set_source_rgba(1.0, 0.78, 0.3, 0.55);
            mgraphics.arc(gsc[0], gsc[1], 3.5, 0, Math.PI * 2);
            mgraphics.fill();
        }
    }

    // 11. Active Marquee Selection Box
    if (dragState.mode === "marquee" && dragState.marqueeRect) {
        let r = dragState.marqueeRect;
        mgraphics.set_source_rgba(1.0, 0.72, 0.2, 0.14);
        mgraphics.rectangle(r[0], r[1], r[2], r[3]);
        mgraphics.fill_preserve();
        mgraphics.set_line_width(1.0);
        mgraphics.set_source_rgba(1.0, 0.75, 0.25, 0.8);
        mgraphics.stroke();
    }

    // 12. Subtle Coordinate / Interaction HUD Overlay
    if (hoverInfo.mouseX >= 0) {
        let hudText = "";
        if (hoverInfo.type === "toolbar" && hoverInfo.toolbarIndex >= 0) {
            let item = TOOLBAR_ITEMS[hoverInfo.toolbarIndex];
            if (item.id === "brush") {
                hudText = "Brush: " + BRUSH_NAMES[brushType];
            } else {
                hudText = item.title;
            }
        } else if (dragState.mode === "loop_start" || dragState.mode === "loop_end" || dragState.mode === "loop_move") {
            hudText = "Loop: " + Math.round(loopStart * 100) + "-" + Math.round(loopEnd * 100) + "%";
        } else if (dragState.mode === "curve") {
            let seg = (dragState.segIndex >= 0 && points[dragState.segIndex]) ? points[dragState.segIndex] : null;
            let cVal = seg ? seg.curve : 0;
            hudText = (seg && seg.sCurve ? "S-Crv: " : "Curve: ") + Math.round(cVal * 100) + "%";
        } else if (drawMode) {
            hudText = "Paint [" + BRUSH_NAMES[brushType] + "]";
        } else if (hoverInfo.type === "point" || dragState.mode === "point") {
            let pid = (dragState.mode === "point") ? dragState.primaryId : hoverInfo.pointId;
            for (let i = 0; i < points.length; i++) {
                if (points[i].id === pid) {
                    hudText = Math.round(points[i].x * 100) + "% , " + Math.round(points[i].y * 100) + "%";
                    break;
                }
            }
        } else if (hoverInfo.mouseY < lay.toolbarY) {
            hudText = Math.round(hoverInfo.normX * 100) + "% , " + Math.round(hoverInfo.normY * 100) + "%";
        }
        if (hudText) {
            let boxW = Math.max(66, hudText.length * 5.0 + 10);
            mgraphics.select_font_face("Ableton Sans Book");
            mgraphics.set_font_size(8.5);
            mgraphics.set_source_rgba(0.08, 0.1, 0.12, 0.86);
            mgraphics.rectangle_rounded(lay.w - boxW - 8, lay.plotY + 2, boxW, 12, 2, 2);
            mgraphics.fill();
            mgraphics.set_source_rgba(0.86, 0.89, 0.92, 0.92);
            mgraphics.move_to(lay.w - boxW - 4, lay.plotY + 11);
            mgraphics.show_text(hudText);
        }
    }

    // 13. Bottom Preset & Tool Strip
    mgraphics.set_source_rgba(0.11, 0.125, 0.15, 1.0);
    mgraphics.rectangle(0, lay.toolbarY, lay.w, lay.toolbarH);
    mgraphics.fill();

    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.1);
    mgraphics.move_to(0, lay.toolbarY);
    mgraphics.line_to(lay.w, lay.toolbarY);
    mgraphics.stroke();

    let itemW = lay.w / TOOLBAR_ITEMS.length;
    for (let i = 0; i < TOOLBAR_ITEMS.length; i++) {
        let item = TOOLBAR_ITEMS[i];
        let ix = i * itemW;
        let isHov = (hoverInfo.type === "toolbar" && hoverInfo.toolbarIndex === i);
        let isActive = (item.id === "link" && loopLink) ||
                       (item.id === "draw" && drawMode) ||
                       (item.id === "loopr" && loopEnabled);

        if (isActive) {
            mgraphics.set_source_rgba(1.0, 0.694, 0.18, 0.25);
            mgraphics.rectangle(ix + 0.5, lay.toolbarY + 1, itemW - 1, lay.toolbarH - 2);
            mgraphics.fill();
        } else if (isHov) {
            mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.08);
            mgraphics.rectangle(ix + 0.5, lay.toolbarY + 1, itemW - 1, lay.toolbarH - 2);
            mgraphics.fill();
        }

        if (i > 0) {
            mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.07);
            mgraphics.move_to(ix, lay.toolbarY + 3);
            mgraphics.line_to(ix, lay.toolbarY + lay.toolbarH - 3);
            mgraphics.stroke();
        }

        let isDimmed = (item.id === "undo" && undoStack.length === 0) ||
                       (item.id === "redo" && redoStack.length === 0);

        mgraphics.set_line_width(1.2);
        if (isActive || isHov) {
            mgraphics.set_source_rgba(1.0, 0.72, 0.22, 1.0);
        } else if (isDimmed) {
            mgraphics.set_source_rgba(0.45, 0.48, 0.52, 0.4);
        } else {
            mgraphics.set_source_rgba(0.65, 0.68, 0.72, 0.9);
        }
        drawMiniPresetIcon(item.id, ix, lay.toolbarY, itemW, lay.toolbarH);
    }
}
