// Degrade interactive reorderable 5-stage chain editor + dual-mode (Technical / Abstract)
// audio-reactive visualizer.
// src/degrade_config.js is prepended at build time.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var scopeBuf = null;
var scopeTask = null;

// Persistent serialized state (saved via OrderData blob parameter)
var stageOrder = [0, 1, 2, 3, 4];
var vizMode = 0; // 0 = Technical (Waveform Staircase + Spectral Holes), 1 = Abstract (Phase-Space CRT Glitch)
var selectedStage = 0; // 0..4 (controls active inspector tab in Compact layout)

// Live parameter mirrors for visualization (default: transparent with Mix = 50%)
var stageEnabled = [0, 0, 0, 0, 0];
var curBits = 16.0;
var curWrap = 0.0;
var curDither = 0.0;
var curSrate = 44100.0;
var curJitter = 0.0;
var curSrMode = 0;
var curCodecLoss = 0.0;
var curPreecho = 0.0;
var curBirdies = 0.0;
var curTeleMode = 0;
var curTeleLine = 0.0;
var curFftMode = 0;
var curFftGlitch = 0.0;
var curFftFrame = 45.0;
var curWet = 0.5;

// Telemetry state polled from #0-degscope
var liveInPeak = 0.35;
var liveOutPeak = 0.52;
var stageActivity = [0.65, 0.55, 0.0, 0.0, 0.0];
var waveRing = [0, 0, 0, 0, 0, 0, 0, 0];
var specBands = [0.6, 0.72, 0.58, 0.14, 0.65, 0.78, 0.12, 0.52, 0.64, 0.18, 0.42, 0.30];
var histIn = [];
var histOut = [];
var animPhase = 0.0;

// Undo / Redo stacks & interaction state
var undoStack = [];
var redoStack = [];
var MAX_UNDO = 32;

var dragMode = ""; // "reorder" | "macro" | ""
var dragSlotIdx = -1;
var dragStageId = -1;
var dragStartX = 0;
var dragStartY = 0;
var hoverTooltip = "";

function cloneState() {
    return {
        order: stageOrder.slice(),
        vizMode: vizMode,
        selectedStage: selectedStage,
        enabled: stageEnabled.slice(),
    };
}

function pushUndoState() {
    undoStack.push(cloneState());
    if (undoStack.length > MAX_UNDO) {
        undoStack.shift();
    }
    redoStack = [];
}

function applySnapshot(snap) {
    if (!snap) return;
    stageOrder = normalizeOrder(snap.order);
    vizMode = snap.vizMode ? 1 : 0;
    selectedStage = clamp(Math.round(snap.selectedStage || 0), 0, STAGE_COUNT - 1);
    if (snap.enabled && snap.enabled.length) {
        for (var i = 0; i < STAGE_COUNT; i++) {
            var nextOn = snap.enabled[i] ? 1 : 0;
            if (nextOn !== stageEnabled[i]) {
                stageEnabled[i] = nextOn;
                outlet(0, "toggle", STAGE_META[i].key, nextOn);
            }
        }
    }
    emitOrderAndFocus();
    notifyclients();
    mgraphics.redraw();
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(cloneState());
    var prev = undoStack.pop();
    applySnapshot(prev);
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(cloneState());
    var next = redoStack.pop();
    applySnapshot(next);
}

function getvalueof() {
    return [
        DEG_STATE_VERSION,
        stageOrder[0],
        stageOrder[1],
        stageOrder[2],
        stageOrder[3],
        stageOrder[4],
        vizMode,
        selectedStage,
    ];
}

function setvalueof() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 1 && Array.isArray(args[0])) {
        args = args[0];
    }
    if (!args || args.length === 0) return;

    if (args.length >= 6 && args[0] === DEG_STATE_VERSION) {
        stageOrder = normalizeOrder(args.slice(1, 6));
        if (args.length >= 7) vizMode = Number(args[6]) ? 1 : 0;
        if (args.length >= 8) selectedStage = clamp(Math.round(Number(args[7]) || 0), 0, STAGE_COUNT - 1);
    } else if (args.length >= 5) {
        // Fallback for unversioned 5-element permutation arrays
        stageOrder = normalizeOrder(args.slice(0, 5));
    }
    emitOrderAndFocus();
    mgraphics.redraw();
}

function emitOrderAndFocus() {
    var code = encodeOrderCode(stageOrder);
    outlet(0, "order_code", code);
    outlet(0, "focus", selectedStage);
}

function initWaveHistory(demo) {
    histIn = [];
    histOut = [];
    var holdVal = 0;
    var holdCounter = 0;
    var holdPeriod = Math.max(1, Math.round(44100 / Math.max(curSrate, 400)));
    var pred = 0;

    for (var i = 0; i < SCOPE_COLS; i++) {
        if (!demo) {
            histIn.push(0);
            histOut.push(0);
        } else {
            var t = (i / SCOPE_COLS) * Math.PI * 4.0 + animPhase;
            var raw = 0.68 * Math.sin(t) + 0.24 * Math.cos(t * 2.3);
            var sig = raw;

            for (var s = 0; s < STAGE_COUNT; s++) {
                var stId = stageOrder[s];
                if (stId === 0 && stageEnabled[0]) {
                    var rng = Math.sin(i * 12.7 + 1.9);
                    sig = processBitSample(sig, curBits, curWrap, curDither, Math.abs(raw), rng);
                } else if (stId === 1 && stageEnabled[1]) {
                    if (holdCounter <= 0) {
                        holdVal = sig;
                        holdCounter = Math.max(1, Math.min(8, Math.round(holdPeriod * 0.5)));
                    }
                    holdCounter--;
                    sig = curSrMode < 0.5 ? holdVal : (sig * 0.35 + holdVal * 0.65);
                } else if (stId === 2 && stageEnabled[2]) {
                    var hole = Math.sin(i * 0.45) > (curCodecLoss - 0.3) ? 1.0 : 0.18;
                    sig = sig * hole + 0.12 * curPreecho * Math.sin(i * 3.1);
                } else if (stId === 3 && stageEnabled[3]) {
                    sig = processTelecomSample(sig, curTeleMode, curTeleLine, pred);
                    pred = sig;
                } else if (stId === 4 && stageEnabled[4]) {
                    var gMod = Math.cos(i * 0.9 + curFftMode * 1.4);
                    sig = sig * (1.0 - curFftGlitch * 0.45) + gMod * 0.45 * curFftGlitch;
                }
            }
            histIn.push(clamp(raw, -1, 1));
            histOut.push(clamp(sig, -1, 1));
        }
    }

    if (demo) {
        liveInPeak = 0.68;
        liveOutPeak = 0.76;
        stageActivity = [
            stageEnabled[0] ? 0.78 : 0.0,
            stageEnabled[1] ? 0.66 : 0.0,
            stageEnabled[2] ? 0.72 : 0.0,
            stageEnabled[3] ? 0.64 : 0.0,
            stageEnabled[4] ? 0.80 : 0.0,
        ];
        for (var b = 0; b < 12; b++) {
            var base = 0.42 + 0.42 * Math.pow(Math.sin(b * 0.62 + 0.4), 2);
            if (stageEnabled[2] && (b === 3 || b === 6 || b === 9)) {
                base *= (1.0 - curCodecLoss * 0.82);
            }
            if (stageEnabled[3] && (b < 2 || b > 8)) {
                base *= (1.0 - curTeleLine * 0.80);
            }
            specBands[b] = clamp(base, 0.04, 0.98);
        }
    }
}

initWaveHistory(true);

function preview() {
    initWaveHistory(true);
}

function setbuffer(name) {
    if (!name) return;
    degScopeName = "" + name;
    scopeBuf = new Buffer("" + name);
}

function sampleAt(chunk, idx) {
    if (typeof chunk === "number") return idx === 0 ? chunk : 0;
    if (!chunk || !chunk.length || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (v === v) ? v : 0;
}

var uiSettled = false;

function pullScope() {
    if (!scopeBuf) return;
    var chunk = scopeBuf.peek(1, 0, SCOPE_FLOATS);
    var inPk = clamp(sampleAt(chunk, 0), 0, 1.5);
    var outPk = clamp(sampleAt(chunk, 1), 0, 1.5);

    // Silent audio with no in-progress drag: skip the redraw once the meters have settled.
    // Parameter setters and hover/drag call redraw themselves when something actually changes.
    var isSilent = (inPk < 0.0005 && outPk < 0.0005 && liveInPeak < 0.001 && liveOutPeak < 0.001);
    if (isSilent && uiSettled && dragMode === "") {
        return;
    }

    liveInPeak = liveInPeak + (inPk - liveInPeak) * 0.4;
    liveOutPeak = liveOutPeak + (outPk - liveOutPeak) * 0.4;

    for (var s = 0; s < STAGE_COUNT; s++) {
        var act = clamp(sampleAt(chunk, 2 + s), 0, 1);
        stageActivity[s] = stageEnabled[s] ? (stageActivity[s] * 0.6 + act * 0.4) : 0.0;
    }

    for (var w = 0; w < 8; w++) {
        waveRing[w] = clamp(sampleAt(chunk, 8 + w), -1, 1);
    }

    for (var b = 0; b < 12; b++) {
        var sb = clamp(sampleAt(chunk, 16 + b), 0, 1);
        specBands[b] = specBands[b] * 0.55 + sb * 0.45;
    }

    if (inPk > 0.001 || outPk > 0.001) {
        uiSettled = false;
        animPhase = (animPhase + 0.18) % (Math.PI * 20);
        if (histOut.length >= SCOPE_COLS) {
            histIn.shift();
            histOut.shift();
        }
        histIn.push(clamp(inPk * Math.sin(animPhase * 2.1), -1, 1));
        histOut.push(clamp(waveRing[0] || (outPk * Math.sin(animPhase * 2.1)), -1, 1));
    } else if (liveInPeak < 0.001 && liveOutPeak < 0.001) {
        liveInPeak = 0;
        liveOutPeak = 0;
        uiSettled = true;
    }
    mgraphics.redraw();
}

if (typeof Task !== "undefined") {
    scopeTask = new Task(pullScope, this);
    scopeTask.interval = 40;
    scopeTask.repeat();
}

// Redraw only when a mirrored parameter actually changes (a DSP-confirm bang repeats the same values).
function commitParam(changed, rebuild) {
    if (!changed) return;
    uiSettled = false;
    if (rebuild) initWaveHistory(true);
    mgraphics.redraw();
}

// Parameter setters from Max patch
function set_bit_on(v) { var next = Number(v) > 0.5 ? 1 : 0; var changed = next !== stageEnabled[0]; stageEnabled[0] = next; commitParam(changed, true); }
function set_sr_on(v) { var next = Number(v) > 0.5 ? 1 : 0; var changed = next !== stageEnabled[1]; stageEnabled[1] = next; commitParam(changed, true); }
function set_codec_on(v) { var next = Number(v) > 0.5 ? 1 : 0; var changed = next !== stageEnabled[2]; stageEnabled[2] = next; commitParam(changed, true); }
function set_tele_on(v) { var next = Number(v) > 0.5 ? 1 : 0; var changed = next !== stageEnabled[3]; stageEnabled[3] = next; commitParam(changed, true); }
function set_fft_on(v) { var next = Number(v) > 0.5 ? 1 : 0; var changed = next !== stageEnabled[4]; stageEnabled[4] = next; commitParam(changed, true); }

function set_bits(v) { var next = clamp(Number(v) || 8, 1, 16); var changed = next !== curBits; curBits = next; commitParam(changed, true); }
function set_wrap(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curWrap; curWrap = next; commitParam(changed, true); }
function set_dither(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curDither; curDither = next; commitParam(changed, true); }

function set_srate(v) { var next = clamp(Number(v) || 12000, 100, 44100); var changed = next !== curSrate; curSrate = next; commitParam(changed, true); }
function set_jitter(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curJitter; curJitter = next; commitParam(changed, true); }
function set_sr_mode(v) { var next = Number(v) > 0.5 ? 1 : 0; var changed = next !== curSrMode; curSrMode = next; commitParam(changed, true); }

function set_codec_loss(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curCodecLoss; curCodecLoss = next; commitParam(changed, true); }
function set_preecho(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curPreecho; curPreecho = next; commitParam(changed, true); }
function set_birdies(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curBirdies; curBirdies = next; commitParam(changed, true); }

function set_tele_mode(v) { var next = clamp(Math.round(Number(v) || 0), 0, 3); var changed = next !== curTeleMode; curTeleMode = next; commitParam(changed, true); }
function set_tele_line(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curTeleLine; curTeleLine = next; commitParam(changed, true); }

function set_fft_mode(v) { var next = clamp(Math.round(Number(v) || 0), 0, 3); var changed = next !== curFftMode; curFftMode = next; commitParam(changed, true); }
function set_fft_glitch(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curFftGlitch; curFftGlitch = next; commitParam(changed, true); }
function set_fft_frame(v) { var next = clamp(Number(v) || 45, 5, 150); var changed = next !== curFftFrame; curFftFrame = next; commitParam(changed, true); }
function set_mix(v) { var next = clamp((Number(v) || 0) / 100.0, 0, 1); var changed = next !== curWet; curWet = next; commitParam(changed, false); }

function set_viz_mode(v) {
    vizMode = Number(v) ? 1 : 0;
    notifyclients();
    mgraphics.redraw();
}

function set_order_code(code) {
    stageOrder = decodeOrderCode(code);
    initWaveHistory(true);
    mgraphics.redraw();
}

function set_focus(idx) {
    selectedStage = clamp(Math.round(Number(idx) || 0), 0, STAGE_COUNT - 1);
    mgraphics.redraw();
}

function reset_order() {
    pushUndoState();
    stageOrder = [0, 1, 2, 3, 4];
    emitOrderAndFocus();
    initWaveHistory(true);
    notifyclients();
    mgraphics.redraw();
}

function getStageMacroNorm(stId) {
    if (stId === 0) return clamp((16.0 - curBits) / 15.0, 0, 1);
    if (stId === 1) return clamp(1.0 - Math.log(curSrate / 100.0) / Math.log(441.0), 0, 1);
    if (stId === 2) return curCodecLoss;
    if (stId === 3) return curTeleLine;
    return curFftGlitch;
}

function paint() {
    var sz = mgraphics.size;
    var w = sz[0] || 236;
    var h = sz[1] || 134;

    // 1. Dark LCD Background
    mgraphics.set_source_rgba(0.06, 0.07, 0.09, 1.0);
    mgraphics.rectangle_rounded(0, 0, w, h, 5, 5);
    mgraphics.fill();

    mgraphics.set_source_rgba(0.20, 0.24, 0.30, 1.0);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle_rounded(0.5, 0.5, w - 1, h - 1, 5, 5);
    mgraphics.stroke();

    // ========================================================================
    // 2. Top Reorderable 5-Stage Signal Chain Bar (y = 3..23)
    // ========================================================================
    var chainY = 3;
    var chainH = 20;
    var padX = 4;
    var gap = 4;
    var pillW = Math.floor((w - padX * 2 - gap * (STAGE_COUNT - 1)) / STAGE_COUNT);

    for (var slot = 0; slot < STAGE_COUNT; slot++) {
        var stId = stageOrder[slot];
        var meta = STAGE_META[stId];
        var px = padX + slot * (pillW + gap);
        var isOn = stageEnabled[stId] > 0;
        var isSel = (selectedStage === stId);
        var col = meta.color;

        // Pill background
        if (isOn) {
            mgraphics.set_source_rgba(col[0] * 0.26, col[1] * 0.26, col[2] * 0.28, 0.95);
        } else {
            mgraphics.set_source_rgba(0.11, 0.12, 0.15, 0.90);
        }
        mgraphics.rectangle_rounded(px, chainY, pillW, chainH, 3, 3);
        mgraphics.fill();

        // Bottom activity / intensity bar inside pill
        var macroAmt = getStageMacroNorm(stId);
        if (isOn && macroAmt > 0.02) {
            mgraphics.set_source_rgba(col[0], col[1], col[2], 0.55);
            mgraphics.rectangle(px + 2, chainY + chainH - 3, Math.max(2, (pillW - 4) * macroAmt), 2);
            mgraphics.fill();
        }

        // Pill border (brighter when selected or being dragged)
        if (isSel || dragSlotIdx === slot) {
            mgraphics.set_source_rgba(col[0], col[1], col[2], 1.0);
            mgraphics.set_line_width(1.4);
        } else if (isOn) {
            mgraphics.set_source_rgba(col[0] * 0.75, col[1] * 0.75, col[2] * 0.75, 0.85);
            mgraphics.set_line_width(1.0);
        } else {
            mgraphics.set_source_rgba(0.24, 0.27, 0.32, 0.7);
            mgraphics.set_line_width(1.0);
        }
        mgraphics.rectangle_rounded(px + 0.5, chainY + 0.5, pillW - 1, chainH - 1, 3, 3);
        mgraphics.stroke();

        // Power LED dot (left side of pill)
        var dotX = px + 6;
        var dotY = chainY + 9;
        if (isOn) {
            mgraphics.set_source_rgba(col[0], col[1], col[2], 1.0);
        } else {
            mgraphics.set_source_rgba(0.32, 0.35, 0.40, 0.8);
        }
        mgraphics.arc(dotX, dotY, 2.3, 0, Math.PI * 2);
        mgraphics.fill();

        // Short stage label (max 4 chars so it never clips)
        mgraphics.select_font_face("Arial Bold");
        mgraphics.set_font_size(8.5);
        if (isOn) {
            mgraphics.set_source_rgba(0.95, 0.97, 1.0, 1.0);
        } else {
            mgraphics.set_source_rgba(0.48, 0.52, 0.58, 0.9);
        }
        var lbl = meta.label.length > 4 ? meta.label.slice(0, 3) : meta.label;
        mgraphics.move_to(px + 11, chainY + 12.5);
        mgraphics.show_text(lbl);

        // Connector chevron between pills
        if (slot < STAGE_COUNT - 1) {
            var cx = px + pillW + 1;
            var cy = chainY + 10;
            mgraphics.set_source_rgba(0.45, 0.50, 0.58, 0.85);
            mgraphics.set_line_width(1.0);
            mgraphics.move_to(cx, cy - 2.5);
            mgraphics.line_to(cx + 2.2, cy);
            mgraphics.line_to(cx, cy + 2.5);
            mgraphics.stroke();
        }
    }

    // ========================================================================
    // 3. Main Audio-Reactive Viewport (y = 26..h-22)
    // ========================================================================
    var plotX = 5;
    var plotY = 26;
    var plotW = w - 10;
    var plotH = h - 48;

    mgraphics.set_source_rgba(0.04, 0.05, 0.07, 1.0);
    mgraphics.rectangle_rounded(plotX, plotY, plotW, plotH, 3, 3);
    mgraphics.fill();

    if (vizMode === 0) {
        drawTechnicalVisualizer(plotX, plotY, plotW, plotH);
    } else {
        drawAbstractVisualizer(plotX, plotY, plotW, plotH);
    }

    // ========================================================================
    // 4. Bottom View Toggle + Status HUD (y = h-20..h)
    // ========================================================================
    var barY = h - 19;
    var barH = 16;
    var iconW = 18;
    var bx = 5;

    // Single geometric vector icon button: Toggle Technical / Abstract view
    mgraphics.set_source_rgba(0.16, 0.22, 0.28, 0.95);
    mgraphics.rectangle_rounded(bx, barY, iconW, barH, 2.5, 2.5);
    mgraphics.fill();

    mgraphics.set_source_rgba(0.35, 0.78, 0.95, 0.85);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle_rounded(bx + 0.5, barY + 0.5, iconW - 1, barH - 1, 2.5, 2.5);
    mgraphics.stroke();

    var icx = bx + iconW * 0.5;
    var icy = barY + barH * 0.5;
    mgraphics.set_source_rgba(0.85, 0.90, 0.96, 0.95);
    mgraphics.set_line_width(1.2);

    if (vizMode === 0) {
        mgraphics.move_to(icx - 5, icy + 3);
        mgraphics.line_to(icx - 2, icy + 3);
        mgraphics.line_to(icx - 2, icy - 3);
        mgraphics.line_to(icx + 2, icy - 3);
        mgraphics.line_to(icx + 2, icy + 1);
        mgraphics.line_to(icx + 5, icy + 1);
        mgraphics.stroke();
    } else {
        mgraphics.move_to(icx, icy - 4.5);
        mgraphics.line_to(icx + 4.5, icy);
        mgraphics.line_to(icx, icy + 4.5);
        mgraphics.line_to(icx - 4.5, icy);
        mgraphics.close_path();
        mgraphics.stroke();
    }

    // Status HUD text on right side of bottom bar (plenty of room with only 1 button)
    var hudX = bx + iconW + 6;
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(8.5);
    mgraphics.set_source_rgba(0.66, 0.74, 0.84, 0.95);

    var chainStr = "";
    for (var k = 0; k < STAGE_COUNT; k++) {
        var st = STAGE_META[stageOrder[k]];
        chainStr += (k > 0 ? ">" : "") + st.label.slice(0, 3);
    }
    var statusText = hoverTooltip ? hoverTooltip : ((vizMode === 0 ? "TECH " : "ABST ") + chainStr);
    mgraphics.move_to(hudX, barY + 11.5);
    mgraphics.show_text(statusText);
    drawDspPill(w, h);
}

// Shown only after DSP creation has started (or failed). A static preview never calls init_dsp, so the pill stays hidden.
function drawDspPill(w, h) {
    if (typeof degDsp === "undefined" || !degDsp) return;
    if (degDsp.ready || !(degDsp.createdAt > 0 || degDsp.error)) return;
    var label = degDsp.error ? ("DSP failed: " + String(degDsp.error).substring(0, 26)) : "DSP loading...";
    var pw = Math.min(w - 8, 8 + label.length * 4.4);
    var ph = 12;
    var px = Math.max(4, w - pw - 4);
    var py = Math.max(4, h - 34);
    mgraphics.set_source_rgba(0.05, 0.06, 0.08, 0.88);
    mgraphics.rectangle_rounded(px, py, pw, ph, 3, 3);
    mgraphics.fill();
    if (degDsp.error) mgraphics.set_source_rgba(0.95, 0.42, 0.38, 0.95);
    else mgraphics.set_source_rgba(0.92, 0.72, 0.32, 0.95);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(8.0);
    mgraphics.move_to(px + 4, py + 9);
    mgraphics.show_text(label);
}

function drawTechnicalVisualizer(x, y, w, h) {
    var waveW = Math.floor(w * 0.62);
    var specX = x + waveW + 5;
    var specW = w - waveW - 7;
    var midY = y + h * 0.5;

    // Bit quantization horizontal grid lines
    var visSteps = Math.min(12, Math.max(2, Math.round(Math.pow(2, Math.min(curBits, 4.0)))));
    mgraphics.set_source_rgba(0.22, 0.26, 0.34, 0.42);
    mgraphics.set_line_width(0.75);
    for (var g = 1; g < visSteps; g++) {
        var gy = y + (g / visSteps) * h;
        mgraphics.move_to(x + 2, gy);
        mgraphics.line_to(x + waveW - 2, gy);
        mgraphics.stroke();
    }

    // Sample-rate vertical clock grid lines
    var srCols = Math.max(4, Math.min(18, Math.round((curSrate / 44100.0) * 18)));
    mgraphics.set_source_rgba(0.18, 0.32, 0.42, 0.32);
    for (var sc = 1; sc < srCols; sc++) {
        var gx = x + (sc / srCols) * waveW;
        mgraphics.move_to(gx, y + 2);
        mgraphics.line_to(gx, y + h - 2);
        mgraphics.stroke();
    }

    // Center zero line
    mgraphics.set_source_rgba(0.30, 0.35, 0.44, 0.55);
    mgraphics.move_to(x + 2, midY);
    mgraphics.line_to(x + waveW - 2, midY);
    mgraphics.stroke();

    // Input clean waveform silhouette (cyan)
    var nPts = histIn.length;
    if (nPts > 1) {
        mgraphics.set_source_rgba(0.26, 0.82, 0.96, 0.35);
        mgraphics.set_line_width(1.1);
        for (var i = 0; i < nPts; i++) {
            var px = x + 3 + (i / (nPts - 1)) * (waveW - 6);
            var py = midY - histIn[i] * (h * 0.42);
            if (i === 0) mgraphics.move_to(px, py);
            else mgraphics.line_to(px, py);
        }
        mgraphics.stroke();

        // Degraded staircase output trace (amber/coral)
        mgraphics.set_source_rgba(0.98, 0.58, 0.24, 0.95);
        mgraphics.set_line_width(1.4);
        for (var j = 0; j < nPts; j++) {
            var ox = x + 3 + (j / (nPts - 1)) * (waveW - 6);
            var oy = midY - histOut[j] * (h * 0.42);
            if (j === 0) {
                mgraphics.move_to(ox, oy);
            } else {
                var prevOx = x + 3 + ((j - 1) / (nPts - 1)) * (waveW - 6);
                // Staircase horizontal-then-vertical step when BIT or SR S&H is active
                if (stageEnabled[0] || (stageEnabled[1] && curSrMode < 0.5)) {
                    mgraphics.line_to(ox, midY - histOut[j - 1] * (h * 0.42));
                } else {
                    mgraphics.line_to((prevOx + ox) * 0.5, oy);
                }
                mgraphics.line_to(ox, oy);
            }
        }
        mgraphics.stroke();
    }

    // Divider between Waveform and Spectral Holes Analyzer
    mgraphics.set_source_rgba(0.22, 0.26, 0.34, 0.8);
    mgraphics.set_line_width(1.0);
    mgraphics.move_to(specX - 3, y + 3);
    mgraphics.line_to(specX - 3, y + h - 3);
    mgraphics.stroke();

    // Right pane: 12-Band Codec / Telecom / FFT Spectral Hole Analyzer
    var numBands = 12;
    var bGap = 2;
    var bW = Math.max(3, Math.floor((specW - bGap * (numBands - 1)) / numBands));
    var maxBarH = h - 16;

    for (var b = 0; b < numBands; b++) {
        var bx = specX + b * (bW + bGap);
        var val = clamp(specBands[b] || 0.2, 0.04, 1.0);
        var bh = Math.max(2, val * maxBarH);
        var by = y + h - 4 - bh;

        var isHole = stageEnabled[2] && (val < 0.22);
        var isTeleCut = stageEnabled[3] && (b < 2 || b > 8);

        // Ghost outline showing where a spectral hole was punched out
        mgraphics.set_source_rgba(0.24, 0.26, 0.34, 0.45);
        mgraphics.rectangle(bx, y + 12, bW, maxBarH);
        mgraphics.fill();

        if (isHole) {
            mgraphics.set_source_rgba(0.76, 0.46, 0.98, 0.55);
        } else if (isTeleCut) {
            mgraphics.set_source_rgba(0.32, 0.90, 0.58, 0.45);
        } else {
            mgraphics.set_source_rgba(0.28, 0.84, 0.96, 0.88);
        }
        mgraphics.rectangle(bx, by, bW, bh);
        mgraphics.fill();
    }

    // Compact badge overlays
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(8.0);
    mgraphics.set_source_rgba(0.95, 0.65, 0.32, 0.9);
    mgraphics.move_to(x + 4, y + 10);
    mgraphics.show_text(curBits.toFixed(1) + "b / " + Math.round(curSrate / 100) / 10 + "k");

    mgraphics.set_source_rgba(0.78, 0.60, 0.98, 0.9);
    mgraphics.move_to(specX, y + 10);
    mgraphics.show_text("SPEC");
}

function drawAbstractVisualizer(x, y, w, h) {
    var cx = x + w * 0.5;
    var cy = y + h * 0.52;
    var rx = w * 0.36;
    var ry = h * 0.38;

    // CRT scanlines reactive to Telecom / Sample-Rate
    var scanCount = stageEnabled[3] ? 9 : 15;
    mgraphics.set_line_width(0.8);
    for (var s = 0; s < scanCount; s++) {
        /** @type {number} */
        var sy = y + 4 + (s / (scanCount - 1)) * (h - 8);
        var jitX = stageEnabled[1] ? Math.sin(s * 2.3 + animPhase) * curJitter * 8.0 : 0;
        mgraphics.set_source_rgba(0.18, 0.36, 0.46, 0.22);
        mgraphics.move_to(x + 6 + Math.max(0, jitX), sy);
        mgraphics.line_to(x + w - 6 + Math.min(0, jitX), sy);
        mgraphics.stroke();
    }

    // Fractured Phase-Space Glitch Attractor
    var nodes = 28;
    var qGrid = stageEnabled[0] ? Math.max(2, Math.pow(2, Math.min(curBits, 5))) : 64;

    for (var ring = 0; ring < 2; ring++) {
        var scale = ring === 0 ? 1.0 : 0.58;
        var col = STAGE_META[stageOrder[ring * 2 % STAGE_COUNT]].color;
        mgraphics.set_source_rgba(col[0], col[1], col[2], ring === 0 ? 0.90 : 0.65);
        mgraphics.set_line_width(ring === 0 ? 1.4 : 1.0);

        for (var i = 0; i <= nodes; i++) {
            var ang = (i / nodes) * Math.PI * 2.0 + animPhase * (ring === 0 ? 0.4 : -0.3);
            // Codec spectral holes punch gaps in the ring
            var bandVal = specBands[i % 12] || 0.5;
            var radiusMod = 0.65 + 0.35 * bandVal;
            if (stageEnabled[4]) {
                radiusMod += 0.22 * curFftGlitch * Math.sin(ang * 5.0);
            }

            var nx = Math.cos(ang) * scale * radiusMod;
            var ny = Math.sin(ang * (stageEnabled[0] && curWrap > 0.3 ? 2.0 : 1.0)) * scale * radiusMod;

            // Quantize coordinates to discrete bit steps
            nx = Math.round(nx * qGrid) / qGrid;
            ny = Math.round(ny * qGrid) / qGrid;

            var px = cx + nx * rx;
            var py = cy + ny * ry;
            if (i === 0) mgraphics.move_to(px, py);
            else mgraphics.line_to(px, py);
        }
        mgraphics.stroke();
    }

    // Stage orbit satellites showing live stage order 1..5
    for (var k = 0; k < STAGE_COUNT; k++) {
        var stId = stageOrder[k];
        var stMeta = STAGE_META[stId];
        var stOn = stageEnabled[stId] > 0;
        var sx = x + 16 + (k / (STAGE_COUNT - 1)) * (w - 32);
        var sy = y + h - 9;

        mgraphics.set_source_rgba(stMeta.color[0], stMeta.color[1], stMeta.color[2], stOn ? 0.95 : 0.28);
        mgraphics.arc(sx, sy, stOn ? 3.2 : 2.0, 0, Math.PI * 2);
        mgraphics.fill();
    }

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(8.0);
    mgraphics.set_source_rgba(0.75, 0.88, 0.98, 0.9);
    mgraphics.move_to(x + 5, y + 10);
    mgraphics.show_text("PHASE GLITCH FIELD");
}

function slotAtPoint(x, y, w) {
    if (y < 2 || y > 25) return -1;
    var padX = 4;
    var gap = 4;
    var pillW = Math.floor((w - padX * 2 - gap * (STAGE_COUNT - 1)) / STAGE_COUNT);
    for (var s = 0; s < STAGE_COUNT; s++) {
        var px = padX + s * (pillW + gap);
        if (x >= px && x <= px + pillW) {
            return s;
        }
    }
    return -1;
}

function toolbarIndexAtPoint(x, y, h) {
    var barY = h - 19;
    if (y < barY - 2 || y > h) return -1;
    var iconW = 18;
    var bx = 5;
    if (x >= bx && x <= bx + iconW) return 0;
    return -1;
}

function onclick(x, y) {
    var sz = mgraphics.size;
    var w = sz[0] || 236;
    var h = sz[1] || 134;

    // 1. Check bottom Technical/Abstract view toggle button
    var tbIdx = toolbarIndexAtPoint(x, y, h);
    if (tbIdx === 0) {
        pushUndoState();
        vizMode = vizMode === 0 ? 1 : 0;
        notifyclients();
        mgraphics.redraw();
        return;
    }

    // 2. Check top 5-stage reorderable pill bar
    var slot = slotAtPoint(x, y, w);
    if (slot >= 0) {
        var stId = stageOrder[slot];
        var padX = 4;
        var gap = 4;
        var pillW = Math.floor((w - padX * 2 - gap * (STAGE_COUNT - 1)) / STAGE_COUNT);
        var px = padX + slot * (pillW + gap);

        pushUndoState();
        selectedStage = stId;
        outlet(0, "focus", selectedStage);

        // Clicking the left power LED dot toggles stage enable
        if (x - px <= 11) {
            var nextOn = stageEnabled[stId] ? 0 : 1;
            stageEnabled[stId] = nextOn;
            outlet(0, "toggle", STAGE_META[stId].key, nextOn);
            initWaveHistory(true);
            notifyclients();
            mgraphics.redraw();
            return;
        }

        // Otherwise begin drag-to-reorder gesture
        dragMode = "reorder";
        dragSlotIdx = slot;
        dragStageId = stId;
        dragStartX = x;
        dragStartY = y;
        mgraphics.redraw();
        return;
    }

    // 3. Clicking inside the main visualizer plot adjusts focused stage macro or toggles view on double-click
    dragMode = "macro";
    dragStartX = x;
    dragStartY = y;
}

function ondrag(x, y, but) {
    var sz = mgraphics.size;
    var w = sz[0] || 236;
    var h = sz[1] || 134;

    if (but === 0) {
        if (dragMode === "reorder") {
            notifyclients();
        }
        dragMode = "";
        dragSlotIdx = -1;
        mgraphics.redraw();
        return;
    }

    if (dragMode === "reorder" && dragSlotIdx >= 0) {
        var padX = 4;
        var gap = 4;
        var pillW = Math.floor((w - padX * 2 - gap * (STAGE_COUNT - 1)) / STAGE_COUNT);
        var targetSlot = clamp(Math.floor((x - padX) / Math.max(pillW + gap, 1)), 0, STAGE_COUNT - 1);
        if (targetSlot !== dragSlotIdx) {
            stageOrder = moveStageInOrder(stageOrder, dragSlotIdx, targetSlot);
            dragSlotIdx = targetSlot;
            emitOrderAndFocus();
            initWaveHistory(true);
            mgraphics.redraw();
        }
    } else if (dragMode === "macro") {
        var plotY = 26;
        var plotH = Math.max(40, h - 48);
        var normY = clamp(1.0 - (y - plotY) / plotH, 0.0, 1.0);
        var stKey = STAGE_META[selectedStage].key;
        outlet(0, "macro", stKey, normY);
        mgraphics.redraw();
    }
}

function ondblclick(x, y) {
    var sz = mgraphics.size;
    var w = sz[0] || 236;
    var slot = slotAtPoint(x, y, w);
    if (slot >= 0) {
        var stId = stageOrder[slot];
        pushUndoState();
        var nextOn = stageEnabled[stId] ? 0 : 1;
        stageEnabled[stId] = nextOn;
        outlet(0, "toggle", STAGE_META[stId].key, nextOn);
        initWaveHistory(true);
        notifyclients();
        mgraphics.redraw();
        return;
    }
    pushUndoState();
    vizMode = vizMode === 0 ? 1 : 0;
    notifyclients();
    mgraphics.redraw();
}

function onidle(x, y) {
    var sz = mgraphics.size;
    var w = sz[0] || 236;
    var h = sz[1] || 134;
    var nextTip = "";

    var tbIdx = toolbarIndexAtPoint(x, y, h);
    if (tbIdx === 0) nextTip = "Toggle Tech/Abstract";
    else {
        var slot = slotAtPoint(x, y, w);
        if (slot >= 0) {
            var st = STAGE_META[stageOrder[slot]];
            nextTip = "Drag:Reorder | Click:" + st.label;
        }
    }

    if (nextTip !== hoverTooltip) {
        hoverTooltip = nextTip;
        mgraphics.redraw();
    }
}

function onidleout() {
    if (hoverTooltip !== "") {
        hoverTooltip = "";
        mgraphics.redraw();
    }
}
