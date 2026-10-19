// Percipitator audio-reactive Partials Viewer + 12-Note Scale & Sidechain MIDI Selector.
// src/percipitator_config.js is prepended at build time.
//
// Redesigned around a single full-width Partials + Note Selector stage (no cramped side-by-side
// wavetable sub-window). Supports direct manipulation of Gate threshold + Spectral Tilt line
// on the Partials graph, plus an integrated top-right single-cycle Wave Pill that previews and
// scrubs the active Sine->Triangle->Saw->Square wavetable & phase warp.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var wtBuf = null;
var scopeBuf = null;
var uiTask = null;

var localWt = generateStandardWavetable();

var bandAmps = [];
var bandPeakHold = [];
var bandMidis = [];
var activePitchClasses = [];
var droplets = [];

for (var bi = 0; bi < NUM_BANDS; bi++) {
    bandAmps.push(0);
    bandPeakHold.push(0);
    bandMidis.push(60 + bi * 2);
}
for (var pi = 0; pi < 12; pi++) {
    activePitchClasses.push(0);
}

var curGateDb = -42.0;
var curScaleMask = DEFAULT_SCALE_MASK; // C Major default (2741)
var curWtPosPct = 0.0;
var curWtMode = 0;
var curWarpPct = 50.0;
var curSieve = 0;
var curTiltPct = 0.0;

// Sidechain MIDI state
var heldMidiNotes = {};
var activeMidiMask = 0;
var activeMidiCount = 0;

var dragState = ""; // "gate" | "tilt" | "wave" | ""

function effectiveScaleMask() {
    if (activeMidiCount > 0 && activeMidiMask > 0) {
        return activeMidiMask;
    }
    return curScaleMask;
}

function initDemoState() {
    var demoAmps = [
        0.06, 0.22, 0.56, 0.16, 0.80, 0.36, 0.68, 0.26,
        0.86, 0.50, 0.20, 0.62, 0.34, 0.46, 0.22, 0.10
    ];
    droplets = [];
    var maskNow = effectiveScaleMask();
    for (var i = 0; i < NUM_BANDS; i++) {
        var weighted = demoAmps[i] * computeSieveGain(i, curSieve) * computeTiltGain(i, curTiltPct / 100.0);
        bandAmps[i] = clamp(weighted, 0, 1.2);
        bandPeakHold[i] = Math.min(1.0, bandAmps[i] * 1.18);
        bandMidis[i] = quantizeMidiToScale(freqToMidi(BAND_FREQS[i]), maskNow, 1.0);
        if (bandAmps[i] > 0.24) {
            droplets.push({ band: i, y: 0.20 + (i % 4) * 0.16, amp: bandAmps[i], speed: 0.04 });
            droplets.push({ band: i, y: 0.58 + (i % 3) * 0.12, amp: bandAmps[i] * 0.75, speed: 0.04 });
        }
    }
    for (var p = 0; p < 12; p++) activePitchClasses[p] = 0;
    activePitchClasses[0] = 0.9;
    activePitchClasses[4] = 0.75;
    activePitchClasses[7] = 0.85;
    activePitchClasses[11] = 0.6;
}

function preview() {
    initDemoState();
}

function pokeWavetableBuffer() {
    if (!wtBuf) return;
    wtBuf.poke(1, 0, localWt);
}

function setbuffer(wtBufName, scopeBufName) {
    if (wtBufName) {
        wtBuf = new Buffer("" + wtBufName);
        pokeWavetableBuffer();
    }
    if (scopeBufName) {
        scopeBuf = new Buffer("" + scopeBufName);
    }
}

function syncMaskToGen() {
    outlet(0, ["scalemask", effectiveScaleMask()]);
}

function midi_in(note, velocity) {
    var n = Math.round(Number(note));
    var v = Math.round(Number(velocity));
    if (!(n >= 0 && n < 128)) return;
    if (v > 0) {
        heldMidiNotes[n] = v;
    } else {
        delete heldMidiNotes[n];
    }
    var st = computeMidiChordState(heldMidiNotes, curScaleMask);
    activeMidiCount = st.count;
    activeMidiMask = st.active ? st.mask : 0;
    if (st.active) {
        curScaleMask = st.mask;
    }
    syncMaskToGen();
    mgraphics.redraw();
}

function midi_clear() {
    heldMidiNotes = {};
    activeMidiCount = 0;
    activeMidiMask = 0;
    syncMaskToGen();
    mgraphics.redraw();
}

function set_gate(db) {
    curGateDb = clamp(Number(db) || -42.0, -66.0, -6.0);
    mgraphics.redraw();
}

function set_wtpos(pct) {
    curWtPosPct = clamp(Number(pct) || 0.0, 0.0, 100.0);
    mgraphics.redraw();
}

function set_wtmode(m) {
    curWtMode = Math.round(clamp(Number(m) || 0, 0, 3));
    mgraphics.redraw();
}

function set_warp(pct) {
    curWarpPct = clamp(Number(pct) || 0.0, 0.0, 100.0);
    mgraphics.redraw();
}

function set_sieve(s) {
    curSieve = Math.round(clamp(Number(s) || 0, 0, 4));
    if (!scopeBuf) initDemoState();
    mgraphics.redraw();
}

function set_tilt(pct) {
    curTiltPct = clamp(Number(pct) || 0.0, -100.0, 100.0);
    if (!scopeBuf) initDemoState();
    mgraphics.redraw();
}

function set_scalemask(mask) {
    var m = (Number(mask) | 0) & 0xFFF;
    if (m > 0) curScaleMask = m;
    syncMaskToGen();
    mgraphics.redraw();
}

function getvalueof() {
    return [2, curScaleMask, curGateDb];
}

function setvalueof(v) {
    if (Array.isArray(v) && v.length >= 2) {
        curScaleMask = (v[1] | 0) & 0xFFF;
        if (curScaleMask === 0) curScaleMask = 0xFFF;
        if (v.length >= 3 && Number.isFinite(Number(v[2]))) {
            curGateDb = clamp(Number(v[2]), -60.0, -6.0);
            outlet(0, ["gate", curGateDb]);
        }
        syncMaskToGen();
        mgraphics.redraw();
    }
}

function numAt(chunk, idx) {
    if (typeof chunk === "number") return idx === 0 ? chunk : 0;
    if (!chunk || !chunk.length || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (v === v) ? v : 0;
}

function pullScope() {
    if (!scopeBuf) return;
    var chunk = scopeBuf.peek(1, 0, SCOPE_SAMPS);
    for (var p = 0; p < 12; p++) {
        activePitchClasses[p] *= 0.78;
    }
    for (var i = 0; i < NUM_BANDS; i++) {
        var rawAmp = clamp(numAt(chunk, i), 0, 1.2);
        var qMidi = numAt(chunk, 16 + i);
        var coef = rawAmp > bandAmps[i] ? 0.65 : 0.24;
        bandAmps[i] = bandAmps[i] + (rawAmp - bandAmps[i]) * coef;
        if (bandAmps[i] > bandPeakHold[i]) {
            bandPeakHold[i] = bandAmps[i];
        } else {
            bandPeakHold[i] = Math.max(0, bandPeakHold[i] - 0.018);
        }
        if (qMidi > 12) bandMidis[i] = qMidi;
        if (bandAmps[i] > 0.03) {
            var pc = ((Math.round(bandMidis[i]) % 12) + 12) % 12;
            if (bandAmps[i] > activePitchClasses[pc]) {
                activePitchClasses[pc] = Math.min(1, bandAmps[i] * 1.4);
            }
            if (rawAmp > 0.08 && droplets.length < 48 && ((i + Math.round(rawAmp * 100)) % 3 === 0)) {
                droplets.push({
                    band: i,
                    y: 0.04,
                    amp: Math.min(1.0, rawAmp),
                    speed: 0.045 + Math.min(0.05, rawAmp * 0.04)
                });
            }
        }
    }
    var nextDrops = [];
    for (var d = 0; d < droplets.length; d++) {
        var dr = droplets[d];
        dr.y += dr.speed;
        dr.amp *= 0.96;
        if (dr.y < 1.0 && dr.amp > 0.03) {
            nextDrops.push(dr);
        }
    }
    droplets = nextDrops;
}

function loadbang() {
    pokeWavetableBuffer();
    syncMaskToGen();
    outlet(0, ["gate", curGateDb]);
    if (typeof Task === "function") {
        uiTask = new Task(function () {
            pullScope();
            mgraphics.redraw();
        }, this);
        uiTask.interval = 33;
        uiTask.repeat();
    }
    mgraphics.redraw();
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [216, 134];
    return [s[0], s[1]];
}

function ampToVis01(lin) {
    if (lin <= 0.0001) return 0;
    var db = 20 * Math.log10(Math.min(lin, 1.2));
    var db01 = clamp((db + 60.0) / 60.0, 0, 1);
    return 0.65 * db01 + 0.35 * clamp(Math.sqrt(lin), 0, 1);
}

function vis01ToDb(v01) {
    return -60.0 + clamp(v01, 0, 1) * 54.0;
}

function layoutRegions() {
    var sz = canvasSize();
    var w = sz[0];
    var h = sz[1];
    var kbH = 22;
    var kbY = h - kbH - 4;
    var specX = 6;
    var specY = 20;
    var specW = w - 12;
    var specH = kbY - specY - 4;
    // Floating single-cycle wave pill in top-right of header/spectrum
    var pillW = 68;
    var pillH = 22;
    var pillX = w - pillW - 8;
    var pillY = 3;
    return {
        w: w,
        h: h,
        specX: specX,
        specY: specY,
        specW: specW,
        specH: specH,
        pillX: pillX,
        pillY: pillY,
        pillW: pillW,
        pillH: pillH,
        kbX: 6,
        kbY: kbY,
        kbW: w - 12,
        kbH: kbH
    };
}

function onclick(x, y) {
    var r = layoutRegions();
    // 1. Bottom 12-note scale selector strip
    if (y >= r.kbY && y <= r.kbY + r.kbH && x >= r.kbX && x <= r.kbX + r.kbW) {
        var noteIdx = clamp(Math.floor(((x - r.kbX) / r.kbW) * 12), 0, 11);
        var bit = 1 << noteIdx;
        var nextMask = curScaleMask ^ bit;
        if (nextMask !== 0) {
            curScaleMask = nextMask;
            syncMaskToGen();
            notifyclients();
            mgraphics.redraw();
        }
        dragState = "";
        return;
    }
    // 2. Top-right single-cycle Wave Pill -> scrub WT Pos (vertical) & Warp (horizontal)
    if (x >= r.pillX && x <= r.pillX + r.pillW && y >= r.pillY && y <= r.pillY + r.pillH + 10) {
        dragState = "wave";
        ondrag(x, y);
        return;
    }
    // 3. Partials graph or Gate readout in header -> drag Gate threshold vertically
    if (x >= r.specX && x <= r.specX + r.specW && y >= 0 && y <= r.specY + r.specH) {
        dragState = "gate";
        ondrag(x, y);
    }
}

function ondrag(x, y) {
    var r = layoutRegions();
    if (dragState === "gate") {
        var v01 = clamp((r.specY + r.specH - y) / Math.max(1, r.specH), 0, 1);
        curGateDb = Math.round(clamp(vis01ToDb(v01), -60.0, -6.0) * 10) / 10;
        outlet(0, ["gate", curGateDb]);
        notifyclients();
        mgraphics.redraw();
    } else if (dragState === "wave") {
        var pos01 = clamp(1.0 - (y - r.pillY) / Math.max(1, r.pillH + 10), 0, 1);
        var warp01 = clamp((x - r.pillX) / Math.max(1, r.pillW), 0, 1);
        curWtPosPct = Math.round(pos01 * 100);
        curWarpPct = Math.round(warp01 * 100);
        outlet(0, ["wtpos", curWtPosPct]);
        outlet(0, ["warp", curWarpPct]);
        mgraphics.redraw();
    }
}

function paint() {
    if (!scopeBuf && bandAmps[2] === 0 && bandAmps[4] === 0) {
        initDemoState();
    }

    var r = layoutRegions();
    var w = r.w;
    var h = r.h;
    var maskNow = effectiveScaleMask();

    // Outer background
    mgraphics.set_source_rgba(0.047, 0.059, 0.075, 1.0);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    // Top-left status text
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(8.5);
    if (activeMidiCount > 0) {
        mgraphics.set_source_rgba(0.28, 0.92, 0.68, 0.95);
        mgraphics.move_to(6, 13);
        mgraphics.show_text("MIDI (" + activeMidiCount + ")");
    } else {
        mgraphics.set_source_rgba(0.28, 0.84, 0.96, 0.92);
        mgraphics.move_to(6, 13);
        mgraphics.show_text("PARTIALS");
    }

    // Adjustable Gate pill in header + draggable Gate line in Partials graph
    mgraphics.set_source_rgba(0.16, 0.08, 0.10, 0.92);
    mgraphics.rectangle_rounded(55, 3, 52, 14, 2.5, 2.5);
    mgraphics.fill();
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.96, 0.42, 0.42, 0.65);
    mgraphics.rectangle_rounded(55, 3, 52, 14, 2.5, 2.5);
    mgraphics.stroke();

    mgraphics.set_source_rgba(0.98, 0.52, 0.52, 0.96);
    mgraphics.move_to(59, 13);
    mgraphics.show_text("G " + Math.round(curGateDb) + "dB");

    // --- FULL-WIDTH PARTIALS VIEWER ---
    mgraphics.set_source_rgba(0.068, 0.082, 0.105, 1.0);
    mgraphics.rectangle(r.specX, r.specY, r.specW, r.specH);
    mgraphics.fill();

    // Subtle horizontal grid lines
    mgraphics.set_line_width(1);
    for (var g = 1; g <= 3; g++) {
        var gy = r.specY + (g / 4.0) * r.specH;
        mgraphics.set_source_rgba(0.14, 0.18, 0.23, 0.65);
        mgraphics.move_to(r.specX, gy);
        mgraphics.line_to(r.specX + r.specW, gy);
        mgraphics.stroke();
    }

    var colW = r.specW / NUM_BANDS;
    var baseY = r.specY + r.specH;

    // Falling precipitation droplets
    for (var d = 0; d < droplets.length; d++) {
        var dr = droplets[d];
        var dx = r.specX + (dr.band + 0.5) * colW;
        var dy = r.specY + dr.y * (r.specH - 6) + 3;
        var rad = 1.7 + dr.amp * 1.7;
        mgraphics.set_source_rgba(0.38, 0.88, 0.98, clamp(dr.amp * 0.85, 0.15, 0.9));
        mgraphics.arc(dx, dy, rad, 0, Math.PI * 2);
        mgraphics.fill();
    }

    // 16 Resynthesis partial bars + peak-hold caps
    var wtMorph = clamp(curWtPosPct / 100.0, 0, 1);
    for (var b = 0; b < NUM_BANDS; b++) {
        var amp01 = ampToVis01(bandAmps[b]);
        var barH = amp01 * (r.specH - 4);
        var bx = r.specX + b * colW + 1.2;
        var bw = Math.max(2.5, colW - 2.4);
        var by = baseY - barH;

        var cr = 0.24 + wtMorph * 0.70;
        var cg = 0.82 - wtMorph * 0.16;
        var cb = 0.96 - wtMorph * 0.68;

        mgraphics.set_source_rgba(cr, cg, cb, 0.36 + amp01 * 0.56);
        mgraphics.rectangle(bx, by, bw, barH);
        mgraphics.fill();

        var pk01 = ampToVis01(bandPeakHold[b]);
        var py = baseY - pk01 * (r.specH - 4);
        mgraphics.set_source_rgba(0.92, 0.96, 1.0, 0.88);
        mgraphics.rectangle(bx, Math.max(r.specY + 1, py - 1.5), bw, 1.5);
        mgraphics.fill();
    }

    // Spectral Tilt vector line across the partial viewer (emerald)
    var tilt01 = clamp(curTiltPct / 100.0, -1, 1);
    var tiltMidY = r.specY + r.specH * 0.36;
    var tiltSpan = r.specH * 0.22;
    mgraphics.set_line_width(1.2);
    mgraphics.set_source_rgba(0.30, 0.90, 0.68, 0.65);
    mgraphics.move_to(r.specX + 2, tiltMidY + tilt01 * tiltSpan);
    mgraphics.line_to(r.specX + r.specW - 2, tiltMidY - tilt01 * tiltSpan);
    mgraphics.stroke();

    // Gate threshold dashed line (coral red)
    var gateY = baseY - ampToVis01(dbToLin(curGateDb)) * (r.specH - 4);
    mgraphics.set_line_width(1.3);
    mgraphics.set_source_rgba(0.96, 0.42, 0.42, 0.92);
    for (var gx = r.specX; gx < r.specX + r.specW; gx += 8) {
        mgraphics.move_to(gx, gateY);
        mgraphics.line_to(Math.min(gx + 4, r.specX + r.specW), gateY);
    }
    mgraphics.stroke();

    // --- TOP-RIGHT COMPACT WAVE PILL (Live Warped Single-Cycle Oscillator Badge) ---
    mgraphics.set_source_rgba(0.08, 0.10, 0.13, 0.94);
    mgraphics.rectangle_rounded(r.pillX, r.pillY, r.pillW, r.pillH, 3, 3);
    mgraphics.fill();
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.96, 0.66, 0.25, 0.55);
    mgraphics.rectangle_rounded(r.pillX, r.pillY, r.pillW, r.pillH, 3, 3);
    mgraphics.stroke();

    var wtPos01 = clamp(curWtPosPct / 100.0, 0, 1);
    var warp01 = clamp(curWarpPct / 100.0, 0, 1);
    var wSteps = 28;
    var wCenterY = r.pillY + r.pillH * 0.52;
    var wAmp = r.pillH * 0.36;
    mgraphics.set_line_width(1.4);
    mgraphics.set_source_rgba(0.96, 0.66, 0.25, 0.96);
    for (var k = 0; k <= wSteps; k++) {
        var phk = k / wSteps;
        var vNow = evalWavetableSample(localWt, phk, wtPos01, curWtMode, warp01);
        var wx = r.pillX + 4 + phk * (r.pillW - 8);
        var wy = clamp(wCenterY - vNow * wAmp, r.pillY + 2, r.pillY + r.pillH - 2);
        if (k === 0) mgraphics.move_to(wx, wy);
        else mgraphics.line_to(wx, wy);
    }
    mgraphics.stroke();

    // --- BOTTOM STRIP: Interactive 12-Note Scale / Sidechain MIDI Selector ---
    var cellW = r.kbW / 12.0;
    mgraphics.set_font_size(7.5);
    for (var n = 0; n < 12; n++) {
        var nx = r.kbX + n * cellW;
        var enabled = (maskNow & (1 << n)) !== 0;
        var midiHeld = (activeMidiMask & (1 << n)) !== 0;
        var hitGlow = clamp(activePitchClasses[n], 0, 1);

        if (midiHeld) {
            mgraphics.set_source_rgba(0.14, 0.62 + hitGlow * 0.28, 0.46 + hitGlow * 0.25, 0.95);
        } else if (enabled) {
            mgraphics.set_source_rgba(
                0.14 + hitGlow * 0.22,
                0.34 + hitGlow * 0.52,
                0.46 + hitGlow * 0.50,
                0.92
            );
        } else {
            mgraphics.set_source_rgba(0.075, 0.09, 0.11, 0.85);
        }
        mgraphics.rectangle(nx + 0.5, r.kbY, cellW - 1.5, r.kbH);
        mgraphics.fill();

        mgraphics.set_line_width(1);
        if (midiHeld) {
            mgraphics.set_source_rgba(0.32, 0.96, 0.72, 0.95);
        } else if (enabled) {
            mgraphics.set_source_rgba(0.28, 0.82, 0.95, 0.55 + hitGlow * 0.45);
        } else {
            mgraphics.set_source_rgba(0.16, 0.20, 0.25, 0.65);
        }
        mgraphics.rectangle(nx + 0.5, r.kbY, cellW - 1.5, r.kbH);
        mgraphics.stroke();

        if (enabled || midiHeld) {
            mgraphics.set_source_rgba(0.94, 0.98, 1.0, 0.95);
        } else {
            mgraphics.set_source_rgba(0.42, 0.48, 0.55, 0.7);
        }
        var label = NOTE_NAMES[n];
        var tx = nx + (label.length === 1 ? cellW * 0.30 : cellW * 0.14);
        mgraphics.move_to(tx, r.kbY + 14);
        mgraphics.show_text(label);
    }

    // Outer frame border
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.18, 0.22, 0.28, 1.0);
    mgraphics.rectangle(0.5, 0.5, w - 1, h - 1);
    mgraphics.stroke();
}
