// Percipitator audio-reactive Partials Viewer + 12-Note Scale & Sidechain MIDI Selector.
// src/percipitator_config.js is prepended at build time.
//
// Visual feedback for every synthesis parameter inside the Partials Viewer:
//   - Pitch, Shift & Stretch: Faint grey "input" ghost bars stay at the unshifted band positions,
//     while the active resynthesized bars slide left/right (Pitch + Shift) and fan outward/inward (Stretch).
//   - Sieve: Muted band slots (Odd, Even, Sprs, Rise) are visibly dimmed in the background grid.
//   - Decay, Blur & Attack: Decay controls peak-hold fall rate and falling droplet comet-tail length;
//     Blur blooms a soft horizontal aura around active bars; Attack morphs bar crests from sharp to rounded.
//   - Vol & Droplets: Vol scales the rendered height of the resynthesized bars, while falling precipitation
//     droplets render on top of the bars at balanced, volume-independent brightness.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var wtBuf = null;
var scopeBuf = null;
var wtBufName = "#0-percipwt";
var scopeBufName = "#0-percipscope";
var uiTask = null;

var localWt = generateStandardWavetable();

var bandAmps = [];
var bandPeakHold = [];
var bandMidis = [];
var activePitchClasses = [];
var droplets = [];
var dropTick = 0;
var uiIdleFrames = 0;

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
var curPitchSt = 0.0;
var curShiftHz = 0.0;
var curStretchPct = 100.0;
var curSnapPct = 100.0;
var curBlurPct = 25.0;
var curDecayMs = 120.0;
var curAttackMs = 2.5;
var curWtPosPct = 0.0;
var curWtMode = 0;
var curWarpPct = 50.0;
var curSieve = 0;
var curTiltPct = 0.0;
var curVolDb = 0.0;
var curMixPct = 100.0;

// Wave pill polyline, recomputed only when Wave, Mode or Warp changes.
var wavePillCacheKey = "";
var wavePillCache = null;

// Sidechain MIDI state
var heldMidiNotes = {};
var activeMidiMask = 0;
var activeMidiCount = 0;

var dragState = ""; // "gate" | "wave" | ""

function effectiveScaleMask() {
    if (activeMidiCount > 0 && activeMidiMask > 0) {
        return activeMidiMask;
    }
    return curScaleMask;
}

function volVisualScale() {
    // Maps Vol (-36..+18 dB) into a smooth visual height multiplier (0 at -36 dB, 1.0 at 0 dB, 1.45 at +18 dB)
    if (curVolDb <= -35.5) return 0.0;
    return clamp(Math.pow(10, curVolDb / 40), 0.08, 1.45);
}

function initDemoState() {
    var demoAmps = [
        0.08, 0.24, 0.56, 0.18, 0.78, 0.36, 0.68, 0.28,
        0.84, 0.50, 0.22, 0.62, 0.34, 0.48, 0.24, 0.12
    ];
    droplets = [];
    var maskNow = effectiveScaleMask();
    var stretchNow = clamp(curStretchPct / 100.0, 0.5, 2.0);
    var snapNow = clamp(curSnapPct / 100.0, 0, 1);
    for (var i = 0; i < NUM_BANDS; i++) {
        var weighted = demoAmps[i] * computeSieveGain(i, curSieve) * computeTiltGain(i, curTiltPct / 100.0);
        bandAmps[i] = clamp(weighted, 0, 1.4);
        bandPeakHold[i] = Math.min(1.2, bandAmps[i] * 1.15);
        var rawM = 69 + (freqToMidi(BAND_FREQS[i]) - 69) * stretchNow + curPitchSt;
        bandMidis[i] = quantizeMidiToScale(rawM, maskNow, snapNow);
        if (bandAmps[i] > 0.24) {
            droplets.push({ band: i, y: 0.22 + (i % 4) * 0.16, amp: bandAmps[i], speed: 0.04 });
            droplets.push({ band: i, y: 0.58 + (i % 3) * 0.12, amp: bandAmps[i] * 0.75, speed: 0.04 });
        }
    }
    for (var p = 0; p < 12; p++) activePitchClasses[p] = 0;
    for (var b = 0; b < NUM_BANDS; b++) {
        if (bandAmps[b] > 0.18) {
            var pc = ((Math.round(bandMidis[b]) % 12) + 12) % 12;
            activePitchClasses[pc] = Math.max(activePitchClasses[pc], Math.min(1, bandAmps[b]));
        }
    }
}

function preview() {
    initDemoState();
}

function pokeWavetableBuffer() {
    if (!wtBuf) return;
    wtBuf.poke(1, 0, localWt);
}

function setbuffer(wtName, scopeName) {
    if (wtName) {
        wtBufName = "" + wtName;
        wtBuf = new Buffer(wtBufName);
        pokeWavetableBuffer();
    }
    if (scopeName) {
        scopeBufName = "" + scopeName;
        scopeBuf = new Buffer(scopeBufName);
    }
}

// Scope slot 35 is the gen's frame counter. It advances every 64 samples, including silence.
function pcpDspFrames() {
    if (!scopeBufName || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(scopeBufName).peek(1, 35, 1);
        return (typeof v === "number") ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (err) {
        return -1;
    }
}

// Buffer bindings, wavetable poke, and every gen parameter. wtpos/warp/gate/scalemask go out in the
// form `route` already expects (it scales wtpos/warp). Everything else is already in gen units and
// leaves through the route's unmatched outlet into the gen hub.
function pcpDspResend() {
    pokeWavetableBuffer();
    outlet(0, ["wt", wtBufName]);
    outlet(0, ["scope", scopeBufName]);
    outlet(0, ["pitch", curPitchSt]);
    outlet(0, ["fshift", curShiftHz]);
    outlet(0, ["stretch", curStretchPct / 100.0]);
    outlet(0, ["snap", curSnapPct / 100.0]);
    outlet(0, ["blur", curBlurPct / 100.0]);
    outlet(0, ["decay", curDecayMs]);
    outlet(0, ["attack", curAttackMs]);
    outlet(0, ["tilt", curTiltPct / 100.0]);
    outlet(0, ["resynthgain", curVolDb]);
    outlet(0, ["wet", curMixPct / 100.0]);
    outlet(0, ["wtmode", curWtMode]);
    outlet(0, ["sieve", curSieve]);
    outlet(0, ["freeze", 0]);
    outlet(0, ["scalemask", effectiveScaleMask()]);
    outlet(0, ["gate", curGateDb]);
    outlet(0, ["wtpos", curWtPosPct]);
    outlet(0, ["warp", curWarpPct]);
}

function pcpDspPillText() {
    if (!pcpDsp || pcpDsp.ready) return "";
    if (!(pcpDsp.createdAt > 0 || pcpDsp.error)) return "";
    if (pcpDsp.error) return "DSP failed: " + String(pcpDsp.error).substring(0, 24);
    return "DSP loading...";
}

function wavePillSamples() {
    var key = curWtPosPct + "|" + curWtMode + "|" + curWarpPct;
    if (wavePillCache && wavePillCacheKey === key) return wavePillCache;
    var wtPos01 = clamp(curWtPosPct / 100.0, 0, 1);
    var warp01 = clamp(curWarpPct / 100.0, 0, 1);
    var steps = 28;
    var pts = [];
    for (var k = 0; k <= steps; k++) {
        pts.push(evalWavetableSample(localWt, k / steps, wtPos01, curWtMode, warp01));
    }
    wavePillCache = pts;
    wavePillCacheKey = key;
    return pts;
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

function set_pitch(st) {
    curPitchSt = clamp(Number(st) || 0.0, -24.0, 24.0);
    if (!scopeBuf) initDemoState();
    mgraphics.redraw();
}

function set_fshift(hz) {
    curShiftHz = clamp(Number(hz) || 0.0, -2000.0, 2000.0);
    if (!scopeBuf) initDemoState();
    mgraphics.redraw();
}

function set_stretch(pct) {
    curStretchPct = clamp(Number(pct) || 100.0, 50.0, 200.0);
    if (!scopeBuf) initDemoState();
    mgraphics.redraw();
}

function set_snap(pct) {
    curSnapPct = clamp(Number(pct) || 0.0, 0.0, 100.0);
    if (!scopeBuf) initDemoState();
    mgraphics.redraw();
}

function set_blur(pct) {
    curBlurPct = clamp(Number(pct) || 0.0, 0.0, 100.0);
    mgraphics.redraw();
}

function set_decay(ms) {
    curDecayMs = clamp(Number(ms) || 120.0, 1.0, 1500.0);
    mgraphics.redraw();
}

function set_attack(ms) {
    curAttackMs = clamp(Number(ms) || 2.5, 0.2, 100.0);
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

function set_vol(db) {
    curVolDb = clamp(Number(db) || 0.0, -36.0, 18.0);
    mgraphics.redraw();
}

function set_mix(pct) {
    curMixPct = clamp(Number(pct) || 0.0, 0.0, 100.0);
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
    if (!scopeBuf) return false;
    // Settled silence: bands and droplets are already at rest. Read only the band
    // amplitudes (16) and skip the decay work until one of them wakes.
    if (uiIdleFrames > 2 && droplets.length === 0) {
        var wake = scopeBuf.peek(1, 0, NUM_BANDS);
        var hot = false;
        for (var w = 0; w < NUM_BANDS; w++) {
            if (numAt(wake, w) > 0.001) { hot = true; break; }
        }
        if (!hot) return false;
        uiIdleFrames = 0;
    }
    dropTick = (dropTick + 1) & 0x7FFF;
    var chunk = scopeBuf.peek(1, 0, SCOPE_SAMPS);
    var blur01 = clamp(curBlurPct / 100.0, 0, 1);
    var dec01 = clamp(Math.log(Math.max(1, curDecayMs)) / Math.log(1500), 0, 1);
    var fallStep = 0.038 - dec01 * 0.026; // Longer Decay = slower peak-cap fall
    var hasActivity = false;

    for (var p = 0; p < 12; p++) {
        activePitchClasses[p] *= (0.72 + blur01 * 0.20);
        if (activePitchClasses[p] > 0.005) hasActivity = true;
        else activePitchClasses[p] = 0;
    }
    for (var i = 0; i < NUM_BANDS; i++) {
        var rawAmp = clamp(numAt(chunk, i), 0, 1.4);
        var qMidi = numAt(chunk, 16 + i);
        if (rawAmp > 0.001 || bandAmps[i] > 0.001 || bandPeakHold[i] > 0.001) {
            hasActivity = true;
            var riseC = 0.72 - clamp(curAttackMs / 100.0, 0, 0.55);
            var fallC = 0.30 - blur01 * 0.20;
            var coef = rawAmp > bandAmps[i] ? riseC : fallC;
            bandAmps[i] = bandAmps[i] + (rawAmp - bandAmps[i]) * coef;
            if (bandAmps[i] < 0.0005) bandAmps[i] = 0;
            if (bandAmps[i] > bandPeakHold[i]) {
                bandPeakHold[i] = bandAmps[i];
            } else {
                bandPeakHold[i] = Math.max(0, bandPeakHold[i] - fallStep);
            }
            if (qMidi > 12) bandMidis[i] = qMidi;
            if (bandAmps[i] > 0.01) {
                var pc = ((Math.round(bandMidis[i]) % 12) + 12) % 12;
                if (bandAmps[i] > activePitchClasses[pc]) {
                    activePitchClasses[pc] = Math.min(1, bandAmps[i] * 1.4);
                }
                if (rawAmp > 0.015 && droplets.length < 56 && ((i + dropTick) % 2 === 0)) {
                    droplets.push({
                        band: i,
                        y: 0.04,
                        amp: clamp(0.75 + rawAmp * 0.6, 0.75, 1.0),
                        speed: (0.060 - dec01 * 0.042)
                    });
                }
            }
        } else {
            bandAmps[i] = 0;
            bandPeakHold[i] = 0;
        }
    }
    if (droplets.length > 0) {
        hasActivity = true;
        var persistence = 0.93 + dec01 * 0.06;
        var nextDrops = [];
        for (var d = 0; d < droplets.length; d++) {
            var dr = droplets[d];
            dr.y += dr.speed;
            dr.amp *= persistence;
            if (dr.y < 1.0 && dr.amp > 0.12) {
                nextDrops.push(dr);
            }
        }
        droplets = nextDrops;
    }
    if (hasActivity) {
        uiIdleFrames = 0;
        return true;
    }
    uiIdleFrames = Math.min(uiIdleFrames + 1, 100);
    return uiIdleFrames <= 2;
}

function loadbang() {
    pokeWavetableBuffer();
    syncMaskToGen();
    outlet(0, ["gate", curGateDb]);
    if (typeof Task === "function") {
        uiTask = new Task(function () {
            // Silence with settled bands, droplets and no gesture: skip the redraw.
            if (pullScope() || dragState) {
                mgraphics.redraw();
            }
        }, this);
        uiTask.interval = 33;
        uiTask.repeat();
    }
    mgraphics.redraw();
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [204, 134];
    return [s[0], s[1]];
}

function ampToVis01(lin) {
    if (lin <= 0.0001) return 0;
    var db = 20 * Math.log10(Math.min(lin, 1.5));
    var db01 = clamp((db + 60.0) / 60.0, 0, 1);
    return 0.65 * db01 + 0.35 * clamp(Math.sqrt(lin), 0, 1);
}

// Inverse of ampToVis01, the curve the gate line is drawn with. A straight
// -60..-6 map put a click on the -42 dB line at -48 dB.
function vis01ToDb(v01) {
    var target = clamp(v01, 0, 1);
    var lo = -60.0;
    var hi = -6.0;
    var i;
    for (i = 0; i < 24; i++) {
        var mid = (lo + hi) * 0.5;
        if (ampToVis01(dbToLin(mid)) < target) lo = mid;
        else hi = mid;
    }
    return (lo + hi) * 0.5;
}

// Compute the displaced horizontal X center of band b inside [specX .. specX + specW]
// reflecting Pitch (-24..+24 st), Stretch (50..200%), and Shift (-2000..+2000 Hz).
function displacedBandCenterX(bandIdx, specX, specW) {
    var colW = specW / NUM_BANDS;
    var normCenter = (bandIdx + 0.5) / NUM_BANDS; // 0..1
    var stretchFactor = clamp(curStretchPct / 100.0, 0.5, 2.0);
    var stretched = 0.5 + (normCenter - 0.5) * stretchFactor;
    var pitchOffset = (curPitchSt / 48.0) * 0.42;
    var shiftOffset = (curShiftHz / 2000.0) * 0.25;
    var finalNorm = clamp(stretched + pitchOffset + shiftOffset, 0.5 / NUM_BANDS, 1.0 - 0.5 / NUM_BANDS);
    return specX + finalNorm * specW;
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
    var pillW = 68;
    var pillH = 16;
    var pillX = w - pillW - 6;
    var pillY = 2;
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
    if (x >= r.pillX && x <= r.pillX + r.pillW && y >= r.pillY && y <= r.pillY + r.pillH + 6) {
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
        var v01 = clamp((r.specY + r.specH - y) / Math.max(1, r.specH - 4), 0, 1);
        curGateDb = Math.round(clamp(vis01ToDb(v01), -60.0, -6.0) * 10) / 10;
        outlet(0, ["gate", curGateDb]);
        notifyclients();
        mgraphics.redraw();
    } else if (dragState === "wave") {
        var pos01 = clamp(1.0 - (y - r.pillY) / Math.max(1, r.pillH), 0, 1);
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

    // Adjustable Gate pill in header
    mgraphics.set_source_rgba(0.16, 0.08, 0.10, 0.92);
    mgraphics.rectangle_rounded(55, 2, 52, 15, 2.5, 2.5);
    mgraphics.fill();
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.96, 0.42, 0.42, 0.65);
    mgraphics.rectangle_rounded(55, 2, 52, 15, 2.5, 2.5);
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
    var volScale = volVisualScale();
    var blur01 = clamp(curBlurPct / 100.0, 0, 1);
    var dec01 = clamp(Math.log(Math.max(1, curDecayMs)) / Math.log(1500), 0, 1);
    var atk01 = clamp(curAttackMs / 50.0, 0, 1);
    var hasPitchDisplacement = (Math.abs(curPitchSt) > 0.2) || (Math.abs(curShiftHz) > 8.0) || (Math.abs(curStretchPct - 100.0) > 1.5);

    // 1. SIEVE VISUAL FEEDBACK + GHOST INPUT BARS:
    // Muted Sieve band slots are shaded dark with an X-tick at the top;
    // when Pitch/Shift/Stretch are active, faint slate ghost bars show the original unshifted band positions.
    for (var sb = 0; sb < NUM_BANDS; sb++) {
        var slotX = r.specX + sb * colW;
        var sWeight = computeSieveGain(sb, curSieve);
        if (sWeight < 0.25) {
            // Dimmed/masked band lane for Sieve (Odd / Even / Sprs)
            mgraphics.set_source_rgba(0.03, 0.035, 0.045, 0.72);
            mgraphics.rectangle(slotX + 0.5, r.specY + 1, colW - 1.0, r.specH - 2);
            mgraphics.fill();
            // Subtle muted tick at bottom of slot
            mgraphics.set_line_width(1);
            mgraphics.set_source_rgba(0.45, 0.24, 0.28, 0.55);
            mgraphics.move_to(slotX + 2.5, baseY - 3);
            mgraphics.line_to(slotX + colW - 2.5, baseY - 3);
            mgraphics.stroke();
        } else if (hasPitchDisplacement) {
            // Faint unshifted ghost bar showing where the input band was before Pitch/Stretch/Shift
            var ghostH = clamp(ampToVis01(bandAmps[sb]), 0, 1) * (r.specH - 4);
            if (ghostH > 1.5) {
                mgraphics.set_source_rgba(0.38, 0.46, 0.56, 0.22);
                mgraphics.rectangle(slotX + 2.0, baseY - ghostH, Math.max(2.0, colW - 4.0), ghostH);
                mgraphics.fill();
            }
        }
    }

    // 2. DECAY COMET TRAILS & DROPLETS:
    // Longer Decay stretches a glowing vertical comet tail above each falling precipitation droplet.
    // Droplets are rendered after the bars (below) at high, volume-independent brightness so they
    // always pop clearly against the spectrum even on quiet signals.

    // 3. 16 RESYNTHESIZED PARTIAL BARS (with Pitch/Stretch/Shift displacement, Blur aura, Attack rounding, Vol height)
    var wtMorph = clamp(curWtPosPct / 100.0, 0, 1);
    var cellW = r.kbW / 12.0;

    for (var b = 0; b < NUM_BANDS; b++) {
        var amp01 = clamp(ampToVis01(bandAmps[b]) * volScale, 0, 1.0);
        var barH = amp01 * (r.specH - 4);
        var cx = displacedBandCenterX(b, r.specX, r.specW);
        var bw = Math.max(2.6, colW - 2.4);
        var bx = cx - bw * 0.5;
        var by = baseY - barH;

        var cr = 0.24 + wtMorph * 0.70;
        var cg = 0.82 - wtMorph * 0.16;
        var cb = 0.96 - wtMorph * 0.68;

        // BLUR VISUAL FEEDBACK: Soft horizontal bloom halo around active bars proportional to Blur %
        if (blur01 > 0.05 && barH > 2.0) {
            var haloPad = blur01 * 5.5;
            mgraphics.set_source_rgba(cr, cg, cb, blur01 * 0.24 * amp01);
            mgraphics.rectangle_rounded(bx - haloPad, by, bw + haloPad * 2.0, barH, 3.0, 3.0);
            mgraphics.fill();
        }

        // ATTACK VISUAL FEEDBACK: Fast Attack (0.2 ms) = razor-sharp rectangular bar crest;
        // Slow Attack (100 ms) = soft rounded dome bar crest.
        if (barH > 1.0) {
            mgraphics.set_source_rgba(cr, cg, cb, 0.38 + amp01 * 0.56);
            var cornerR = atk01 * Math.min(bw * 0.5, 4.5);
            if (cornerR > 0.8 && barH > cornerR * 2) {
                mgraphics.rectangle_rounded(bx, by, bw, barH, cornerR, cornerR);
            } else {
                mgraphics.rectangle(bx, by, bw, barH);
            }
            mgraphics.fill();
        }

        // Peak-hold cap (fades slower when Decay is high)
        var pk01 = clamp(ampToVis01(bandPeakHold[b]) * volScale, 0, 1.0);
        if (pk01 > 0.02) {
            var py = baseY - pk01 * (r.specH - 4);
            mgraphics.set_source_rgba(0.92, 0.96, 1.0, 0.88);
            mgraphics.rectangle(bx, Math.max(r.specY + 1, py - 1.5), bw, 1.5);
            mgraphics.fill();
        }
    }

    // 5. BALANCED VOLUME-INDEPENDENT DROPLETS & DECAY COMET TRAILS (drawn on top of bars)
    var tailLen = 4.0 + dec01 * 18.0;
    for (var d = 0; d < droplets.length; d++) {
        var dr = droplets[d];
        var dx = displacedBandCenterX(dr.band, r.specX, r.specW);
        var dy = r.specY + dr.y * (r.specH - 6) + 3;
        var lifeFade = clamp(1.0 - dr.y * 0.42, 0.45, 0.90);
        var rad = 1.85 + dr.amp * 0.65;

        // Subtle comet trail
        mgraphics.set_line_width(1.3);
        mgraphics.set_source_rgba(0.38, 0.86, 0.98, 0.42 * lifeFade);
        mgraphics.move_to(dx, Math.max(r.specY + 2, dy - tailLen));
        mgraphics.line_to(dx, dy);
        mgraphics.stroke();

        // Outer cyan droplet body
        mgraphics.set_source_rgba(0.32, 0.86, 0.98, 0.66 * lifeFade);
        mgraphics.arc(dx, dy, rad, 0, Math.PI * 2);
        mgraphics.fill();

        // Soft ice-cyan inner highlight (visible at any volume without glaring)
        mgraphics.set_source_rgba(0.78, 0.95, 1.0, 0.74 * lifeFade);
        mgraphics.arc(dx, dy, rad * 0.48, 0, Math.PI * 2);
        mgraphics.fill();
    }

    // Spectral Tilt vector line across the partial viewer (emerald) — steeper slope reflects doubled range
    var tilt01 = clamp(curTiltPct / 100.0, -1, 1);
    var tiltMidY = r.specY + r.specH * 0.42;
    var tiltSpan = r.specH * 0.36;
    mgraphics.set_line_width(1.3);
    mgraphics.set_source_rgba(0.30, 0.90, 0.68, 0.72);
    mgraphics.move_to(r.specX + 2, clamp(tiltMidY + tilt01 * tiltSpan, r.specY + 2, baseY - 2));
    mgraphics.line_to(r.specX + r.specW - 2, clamp(tiltMidY - tilt01 * tiltSpan, r.specY + 2, baseY - 2));
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

    var wPts = wavePillSamples();
    var wSteps = wPts.length - 1;
    var wCenterY = r.pillY + r.pillH * 0.52;
    var wAmp = r.pillH * 0.36;
    mgraphics.set_line_width(1.4);
    mgraphics.set_source_rgba(0.96, 0.66, 0.25, 0.96);
    for (var k = 0; k <= wSteps; k++) {
        var phk = k / wSteps;
        var vNow = wPts[k];
        var wx = r.pillX + 4 + phk * (r.pillW - 8);
        var wy = clamp(wCenterY - vNow * wAmp, r.pillY + 2, r.pillY + r.pillH - 2);
        if (k === 0) mgraphics.move_to(wx, wy);
        else mgraphics.line_to(wx, wy);
    }
    mgraphics.stroke();

    var dspLabel = pcpDspPillText();
    if (dspLabel) {
        mgraphics.set_font_size(7.5);
        var dspW = Math.min(r.specW - 8, dspLabel.length * 4.4 + 10);
        var dspX = r.specX + (r.specW - dspW) * 0.5;
        var dspY = r.specY + 3;
        var dspAlert = pcpDsp.error ? 1 : 0;
        mgraphics.set_source_rgba(0.05, 0.06, 0.08, 0.88);
        mgraphics.rectangle_rounded(dspX, dspY, dspW, 11, 2, 2);
        mgraphics.fill();
        if (dspAlert) mgraphics.set_source_rgba(0.98, 0.45, 0.42, 0.95);
        else mgraphics.set_source_rgba(0.96, 0.72, 0.35, 0.92);
        mgraphics.move_to(dspX + 5, dspY + 8.5);
        mgraphics.show_text(dspLabel);
    }

    // --- BOTTOM STRIP: Interactive 12-Note Scale / Sidechain MIDI Selector ---
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
