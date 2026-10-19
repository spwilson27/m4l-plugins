#!/usr/bin/env node
/**
 * Unit, structural, and UI interaction test suite for Better GrainSpec.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const slicer = require("../src/grainspec_slicer.js");

const ROOT = path.resolve(__dirname, "..");
const AMXD_PATH = path.join(ROOT, "devices", "Better GrainSpec.amxd");
const GEN_PATH = path.join(ROOT, "src", "grainspec_core.genexpr");

// ============================================================================
// 1. Slicer, Pitch Estimator & MIDI Mapping Invariants
// ============================================================================
const loop = slicer.synthesizeDefaultLoop(44100);
assert.strictEqual(loop.numFrames, 88200, "Default loop should be 2.0s at 44.1kHz");
assert.strictEqual(loop.left.length, 88200);
assert.strictEqual(loop.right.length, 88200);

let maxLoopPeak = 0;
const mono = new Array(loop.numFrames);
for (let i = 0; i < loop.numFrames; i++) {
    const l = loop.left[i];
    const r = loop.right[i];
    assert.ok(Number.isFinite(l) && Number.isFinite(r), "Default loop samples must be finite");
    mono[i] = (l + r) * 0.5;
    const pk = Math.max(Math.abs(l), Math.abs(r));
    if (pk > maxLoopPeak) maxLoopPeak = pk;
}
assert.ok(maxLoopPeak > 0.3 && maxLoopPeak <= 1.0, `Default loop peak out of range: ${maxLoopPeak}`);

// Onset count increases monotonically with sensitivity
const slicesLow = slicer.detectOnsets(mono, 44100, 0.15, 128);
const slicesMid = slicer.detectOnsets(mono, 44100, 0.55, 128);
const slicesHigh = slicer.detectOnsets(mono, 44100, 0.90, 128);
assert.ok(slicesLow.length >= 1, "Must detect at least 1 slice");
assert.ok(slicesMid.length >= slicesLow.length, `Mid sensitivity (${slicesMid.length}) should be >= low (${slicesLow.length})`);
assert.ok(slicesHigh.length >= slicesMid.length, `High sensitivity (${slicesHigh.length}) should be >= mid (${slicesMid.length})`);
assert.ok(slicesMid.length >= 8, `Expected >= 8 slices on 16-step breakbeat at mid sensitivity, got ${slicesMid.length}`);

// Verify slice boundaries are contiguous and valid
for (let i = 0; i < slicesMid.length; i++) {
    const s = slicesMid[i];
    assert.ok(s.startFrame >= 0 && s.endFrame > s.startFrame && s.endFrame <= loop.numFrames, "Invalid slice bounds");
    if (i > 0) {
        assert.strictEqual(s.startFrame, slicesMid[i - 1].endFrame, "Slices must be contiguous");
    }
    assert.ok(s.transientFrames >= 16, "Transient frames must be positive");
    assert.ok(s.pitchHz >= 40 && s.pitchHz <= 2000, `Detected pitch out of range: ${s.pitchHz}`);
}

// Verify pitch estimator accuracy on synthetic 220 Hz and 440 Hz signals
function makeSine(freq, sr, frames) {
    const arr = new Array(frames);
    for (let i = 0; i < frames; i++) {
        arr[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.8;
    }
    return arr;
}
const hz220 = slicer.estimateSlicePitchHz(makeSine(220, 44100, 4096), 44100, 0, 4096);
const hz440 = slicer.estimateSlicePitchHz(makeSine(440, 44100, 4096), 44100, 0, 4096);
assert.ok(Math.abs(hz220 - 220) < 6, `Expected ~220 Hz, got ${hz220}`);
assert.ok(Math.abs(hz440 - 440) < 12, `Expected ~440 Hz, got ${hz440}`);

// Verify MIDI trigger resolution in 128-Map vs Chromatic modes
const mapTrig0 = slicer.resolveMidiTrigger(0, 100, 0, 2, slicesMid, 0);
const mapTrig1 = slicer.resolveMidiTrigger(1, 100, 0, 2, slicesMid, 0);
assert.strictEqual(mapTrig0.sliceIndex, 0);
assert.strictEqual(mapTrig1.sliceIndex, 1);
assert.ok(Math.abs(mapTrig0.pitchRatio - 1.0) < 1e-6, "128 Map mode keeps base pitch ratio 1.0");
assert.ok(Math.abs(mapTrig0.combHz - slicesMid[0].pitchHz) < 1e-3, "128 Map mode matches slice pitch");

const chrRoot = slicer.resolveMidiTrigger(60, 100, 1, 3, slicesMid, 0);
const chrOct = slicer.resolveMidiTrigger(72, 100, 1, 3, slicesMid, 0);
assert.strictEqual(chrRoot.sliceIndex, 3, "Chromatic mode triggers selectedSlice");
assert.strictEqual(chrOct.sliceIndex, 3, "Chromatic mode triggers selectedSlice");
assert.ok(Math.abs(chrOct.pitchRatio - 2.0) < 1e-6, "Chromatic mode +12st doubles pitch ratio");
assert.ok(Math.abs(chrOct.combHz - chrRoot.combHz * 2) < 1e-2, "Chromatic mode scales comb Hz with note");

// ============================================================================
// 2. GenExpr Code Invariants
// ============================================================================
const gen = fs.readFileSync(GEN_PATH, "utf8");
const fnAt = gen.indexOf("\nslew(target, coef)");
const bufferAt = gen.indexOf("\nBuffer ");
const paramAt = gen.indexOf("\nParam ");
const historyAt = gen.indexOf("\nHistory ");
const delayAt = gen.indexOf("\nDelay ");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1);");

assert.ok(fnAt > 0 && fnAt < bufferAt && fnAt < paramAt, "GenExpr functions must precede Buffer and Param");
assert.ok(historyAt > paramAt && delayAt > historyAt && exprAt > delayAt, "History and Delay must precede expressions");
assert.ok(!gen.match(/\be\d/), "GenExpr must not use e0..e9 variable names (Euler constant lexer bug)");
assert.strictEqual((gen.match(/\bdelay\s*\(/g) || []).length, 0, "GenExpr must use Delay.read/write instead of delay()");
assert.ok(gen.includes("combDL.read(") && gen.includes("combDL.write("), "Comb filter must use Delay.read/write");
assert.ok(gen.includes("resonBand("), "Spectral engine must include harmonic resonator bank");

// ============================================================================
// 3. .amxd Binary & Presentation Layout Invariants
// ============================================================================
assert.ok(fs.existsSync(AMXD_PATH), "devices/Better GrainSpec.amxd does not exist");
const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", "Expected ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "iiii", "Expected iiii Max Instrument 4CC");
assert.strictEqual(raw.slice(12, 16).toString("ascii"), "meta", "Expected meta chunk");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");

const jsonLen = raw.readUInt32LE(28);
assert.strictEqual(raw.length, 32 + jsonLen, "Payload byte length mismatch");
const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.openinpresentation, 1);
assert.strictEqual(p.devicewidth, 740.0);
assert.deepStrictEqual(p.openrect, [0.0, 0.0, 740.0, 169.0]);
assert.strictEqual(p.amxdtype, 1768515945);

const boxes = p.boxes.map((b) => b.box);
const uiBox = boxes.find((b) => b.id === "obj-ui");
assert.ok(uiBox && uiBox.maxclass === "v8ui", "Missing obj-ui v8ui box");

// Verify #0- instance isolation on all buffers and bind messages
const bufBoxes = boxes.filter((b) => b.maxclass === "newobj" && /^buffer~\s/.test(b.text || ""));
assert.strictEqual(bufBoxes.length, 3, "Expected 3 buffer~ objects");
for (const b of bufBoxes) {
    assert.ok(b.text.includes("#0-"), `Buffer must use #0- prefix: ${b.text}`);
}
const genBindMsg = boxes.find((b) => b.id === "obj-msg-genbufs");
assert.strictEqual(
    genBindMsg.text,
    "samp #0-gssample, slices #0-gsslices, state #0-gsstate",
    "Gen buffer bind message must use exact GenExpr variable names without set prefix"
);

// Verify zero overlap between v8ui and interactive live.* widgets in presentation mode
function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}
const uiRect = uiBox.presentation_rect;
const liveInteractive = boxes.filter(
    (b) => b.presentation === 1 && /^live\.(dial|numbox|text|tab)$/.test(b.maxclass)
);
assert.strictEqual(liveInteractive.length, 14, "Expected 10 live.dials + Load + Cap + KeyMode + Sens");
for (const w of liveInteractive) {
    assert.ok(
        !rectsOverlap(uiRect, w.presentation_rect),
        `Widget ${w.id} (${w.maxclass}) overlaps v8ui presentation_rect`
    );
}

// Verify background panels are last and have background: 1
const panelIndices = [];
boxes.forEach((b, idx) => {
    if (b.maxclass === "panel") {
        assert.strictEqual(b.background, 1, `Panel ${b.id} must have background: 1`);
        panelIndices.push(idx);
    }
});
assert.strictEqual(panelIndices.length, 2, "Expected 2 background panels");
assert.deepStrictEqual(panelIndices, [boxes.length - 2, boxes.length - 1], "Panels must be last in boxes array");

// ============================================================================
// 4. v8ui Execution, Coordinates, Undo/Redo & Serialization
// ============================================================================
const emitted = [[], []];
let notified = 0;
global.mgraphics = {
    size: [368, 132],
    relative_coords: 1,
    autofill: 1,
    init() {},
    redraw() {},
    set_source_rgba() {},
    set_line_width() {},
    rectangle() {},
    rectangle_rounded() {},
    move_to() {},
    line_to() {},
    close_path() {},
    arc() {},
    fill() {},
    stroke() {},
    select_font_face() {},
    set_font_size() {},
    show_text() {},
};
global.outlet = (idx, val) => emitted[idx].push(val);
global.notifyclients = () => { notified++; };
global.arrayfromargs = (args) => Array.from(args);
global.Buffer = function (name) {
    this.name = name;
    this.framecount = () => 88200;
    this.length = () => 2000;
    this.peek = () => [];
    this.poke = () => {};
};

eval(uiBox.textfile.text);

assert.strictEqual(global.mgraphics.relative_coords, 0, "v8ui must disable relative_coords for pixel drawing");
assert.strictEqual(global.mgraphics.autofill, 0, "v8ui must disable autofill");

loadbang();
paint();

const initialCount = slices.length;
assert.ok(initialCount >= 8, "UI should initialize default breakbeat slices");

// Test double-click inside slice 0 to insert a slice and undo/redo
const savedBefore = getvalueof();
assert.strictEqual(savedBefore[0], 1, "Serialization version must be 1");

const midSlice0X = 6 + ((slices[0].startFrame + slices[0].endFrame) * 0.5 / sampleFrames) * (368 - 12);
ondblclick(midSlice0X, 60);
assert.strictEqual(slices.length, initialCount + 1, "Double-click inside slice should insert a slice marker");
assert.ok(notified >= 1, "Slice edit must call notifyclients()");

undo();
assert.strictEqual(slices.length, initialCount, "Undo should restore previous slice count");
redo();
assert.strictEqual(slices.length, initialCount + 1, "Redo should re-apply slice insertion");

// Test double-click on the newly created marker to remove it
ondblclick(midSlice0X, 60);
assert.strictEqual(slices.length, initialCount, "Double-click on slice marker should delete it");

setvalueof.apply(null, savedBefore);
assert.strictEqual(slices.length, initialCount, "setvalueof should restore serialized slice state");

// Test MIDI note input routing
emitted[0].length = 0;
midi_in(64, 110);
assert.ok(emitted[0].some((msg) => Array.isArray(msg) && msg[0] === "trigcount"), "midi_in must emit trigcount");

console.log("test_grainspec: ok");
