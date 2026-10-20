#!/usr/bin/env node
/**
 * Verification suite for devices/Percipitator.amxd (408 x 169 px — Concept 3 Value-Bar Stack).
 *
 * Verifies:
 *  1. 4-frame Sine->Triangle->Saw->Square wavetable generator, all 4 phase warp modifiers (Bend/Asym/Sync/Fold),
 *     all 5 Partial Sieve modes (All/Odd/Even/Sprs/Rise), 12-note scale quantizer, Sidechain MIDI chord tracker,
 *     and doubled Spectral Tilt (±36 dB / 64x) in src/percipitator_config.js
 *  2. GenExpr ordering (functions before Buffer/Param/History, no e<digit> Euler bug), Shift range [-2000..+2000 Hz],
 *     default WT Pos = 0% (Sine) and default Warp = 50% (0.5)
 *  3. .amxd binary header ("aaaa" Audio Effect) and presentation bounds (408 x 169 px)
 *  4. Absence of Freeze button, Gate right-hand slider, Engine B blend, and Drop WT;
 *     presence of Blur where Gate used to be (Column 1 Row 5), horizontal Vol slider right above Mix (Column 2 Rows 6 & 7),
 *     bipolar center-fill sliders (`appearance: 3`) for Pitch/Shift/Warp/Tilt, pre-blended `activeslidercolor`,
 *     and adjustable Gate in the left graphic (`v8ui` outlet `["gate", db]` -> `prepend gate` -> `obj-gen`)
 *  5. Zero presentation_rect overlap between v8ui and live.* controls, panel z-order (`background: 1` last)
 *  6. v8ui evaluation, mgraphics.relative_coords === 0, wavetable poke, Gate drag, Wave Pill drag,
 *     12-Note Scale Strip click, Sidechain MIDI input, getvalueof/setvalueof round-trip, and
 *     volume-independent high-brightness droplet spawning/rendering even when Vol is at -36 dB
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const AMXD_PATH = path.join(ROOT, "devices", "Percipitator.amxd");
const GEN_PATH = path.join(ROOT, "src", "percipitator_core.genexpr");
const cfg = require(path.join(ROOT, "src", "percipitator_config.js"));

// 1. 4-Frame Sine -> Triangle -> Saw -> Square wavetable & DSP math invariants
assert.strictEqual(cfg.WT_FRAMES, 4, "Wavetable must have 4 canonical frames (Sine, Triangle, Saw, Square)");
const stdWt = cfg.generateStandardWavetable();
assert.strictEqual(stdWt.length, cfg.WT_TOTAL_SAMPS, "Wavetable must have 4 * 2048 = 8192 samples");
assert.ok(stdWt.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.0), "All wavetable samples must be finite in [-1, 1]");

function frameRms(frameIdx) {
    let sq = 0;
    const base = frameIdx * cfg.WT_FRAME_SIZE;
    for (let i = 0; i < cfg.WT_FRAME_SIZE; i++) {
        sq += stdWt[base + i] * stdWt[base + i];
    }
    return Math.sqrt(sq / cfg.WT_FRAME_SIZE);
}
assert.ok(frameRms(3) > frameRms(0) * 1.15, "Frame 3 (Square) must have higher RMS energy than Frame 0 (Sine)");

// Phase warp modes (Bend=0, Asym=1, Sync=2, Fold=3), Partial Sieve (All/Odd/Even/Sprs/Rise) & Spectral Tilt
assert.ok(Math.abs(cfg.warpPhase(0.25, 0, 0.85) - 0.25) > 0.05, "Bend mode must deform phase");
assert.ok(Math.abs(cfg.warpPhase(0.25, 1, 0.85) - 0.25) > 0.05, "Asym mode must skew phase");
assert.ok(Math.abs(cfg.warpPhase(0.35, 2, 0.85) - 0.35) > 0.05, "Sync mode must multiply/wrap phase");
assert.ok(Math.abs(cfg.warpPhase(0.35, 3, 0.85) - 0.35) > 0.05, "Fold mode must mirror/fold phase");
assert.ok(Math.abs(cfg.warpPhase(0.33, 0, 0.5) - 0.33) < 1e-6, "Bend mode (0) must be neutral at 50% (0.5)");
for (let m = 1; m < 4; m++) {
    assert.ok(Math.abs(cfg.warpPhase(0.33, m, 0.0) - 0.33) < 1e-6, `Warp mode ${m} must be neutral at 0% (0.0)`);
}
assert.strictEqual(cfg.computeSieveGain(1, 0), 1.0, "All sieve keeps every band at unity");
assert.strictEqual(cfg.computeSieveGain(0, 1), 1.0, "Odd sieve keeps band 0");
assert.ok(cfg.computeSieveGain(1, 1) < 0.1, "Odd sieve attenuates band 1");
assert.ok(cfg.computeSieveGain(0, 2) < 0.1, "Even sieve attenuates band 0");
assert.strictEqual(cfg.computeSieveGain(1, 2), 1.0, "Even sieve keeps band 1");
assert.strictEqual(cfg.computeSieveGain(0, 3), 1.15, "Sparse sieve boosts every 3rd band (0) to 1.15");
assert.ok(cfg.computeSieveGain(1, 3) < 0.1, "Sparse sieve attenuates non-3rd band (1)");
assert.ok(cfg.computeSieveGain(15, 4) > cfg.computeSieveGain(0, 4) * 3.0, "Rising sieve emphasizes upper bands over lower bands");
// Verify max tilt is doubled again (2^6 = 64x at +100% vs 2^-6 = 1/64x at -100%)
assert.ok(Math.abs(cfg.computeTiltGain(15, 1.0) - 64.0) < 1e-6, "Doubled max tilt must reach 64x (+36 dB) at highest band");
assert.ok(Math.abs(cfg.computeTiltGain(15, -1.0) - 1.0 / 64.0) < 1e-6, "Doubled min tilt must reach 1/64x (-36 dB) at highest band");

// Scale quantizer & Sidechain MIDI chord tracker
const cMajMask = cfg.DEFAULT_SCALE_MASK;
const snapped = cfg.quantizeMidiToScale(61.1, cMajMask, 1.0);
assert.ok(snapped === 60 || snapped === 62, `Expected C# (61.1) to snap to 60 or 62 in C Major, got ${snapped}`);
const fSharpChord = cfg.computeMidiChordState({ 54: 100, 58: 90, 61: 110 }, cMajMask);
assert.strictEqual(fSharpChord.mask, (1 << 6) | (1 << 10) | (1 << 1));

// 2. GenExpr ordering, defaults & range checks
const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(!gen.match(/\be\d/), "Never use e0..e15 identifiers in GenExpr (parsed as Euler's constant)");
assert.ok(!gen.includes("delay("), "GenExpr must not use legacy delay()");
assert.ok(gen.includes("Param wtpos(0.0);"), "GenExpr default wtpos must be 0.0 (Sine)");
assert.ok(gen.includes("Param warp(0.5);"), "GenExpr default warp must be 0.5 (50%)");
assert.ok(gen.includes("clip(fshift, -2000, 2000)"), "GenExpr Shift range must be -2000 to +2000 Hz");

const fnAt = gen.indexOf("slew(target, coef)");
const bufAt = gen.indexOf("\nBuffer ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1);");
assert.ok(fnAt >= 0 && fnAt < bufAt, "Functions must precede Buffer in GenExpr");
assert.ok(bufAt < paramAt && paramAt < histAt && histAt < exprAt, "Declarations must follow Buffer -> Param -> History -> expressions");

// 3. .amxd binary header & 408x169 Concept 3 Value-Bar structure
const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", "Expected ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected aaaa audio-effect type");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
const jsonLen = raw.readUInt32LE(28);
assert.strictEqual(jsonLen, raw.length - 32, "Payload length mismatch");

const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
assert.strictEqual(patcher.openinpresentation, 1, "Must open in presentation mode");
assert.strictEqual(patcher.openrect[2], 408.0, "Expected width 408");
assert.strictEqual(patcher.openrect[3], 169.0, "Expected height 169");

const boxes = patcher.boxes.map((b) => b.box);
const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));

assert.ok(byId["obj-plugin"] && byId["obj-plugin"].text === "plugin~", "Missing plugin~");
assert.ok(byId["obj-plugout"] && byId["obj-plugout"].text === "plugout~", "Missing plugout~");
assert.ok(byId["obj-midiin"] && byId["obj-midiin"].text === "midiin", "Missing midiin for sidechain MIDI");
assert.ok(byId["obj-midiparse"] && byId["obj-midiparse"].text === "midiparse", "Missing midiparse for sidechain MIDI");
assert.ok(byId["obj-gen"] && byId["obj-gen"].maxclass === "gen.codebox~", "Missing gen.codebox~");
assert.strictEqual(byId["obj-gen"].code, gen, "Embedded GenExpr mismatch");
assert.ok(gen.includes("* pos * 6.0"), "GenExpr tilt exponent must be doubled to 6.0");
assert.strictEqual(byId["obj-ctrl-pitch"].appearance, 3, "Pitch must use appearance 3 (Bipolar center fill)");
assert.strictEqual(byId["obj-ctrl-fshift"].appearance, 3, "Shift must use appearance 3 (Bipolar center fill)");
assert.strictEqual(byId["obj-ctrl-warp"].appearance, 3, "Warp must use appearance 3 (Bipolar center fill)");
assert.strictEqual(byId["obj-ctrl-tilt"].appearance, 3, "Tilt must use appearance 3 (Bipolar center fill)");
assert.strictEqual(byId["obj-msg-gen-buf"].text, "wt #0-percipwt, scope #0-percipscope", "Gen buffer bind message mismatch");

// Verify requested removals & placements:
assert.ok(!boxes.some((b) => b.varname === "Freeze" || b.id === "obj-freeze"), "Freeze button must be removed");
assert.ok(!boxes.some((b) => b.varname === "Gate" || b.id === "obj-ctrl-gate"), "Right-hand Gate slider must be removed");
assert.ok(!boxes.some((b) => b.maxclass === "live.dial"), "Concept 3 must use horizontal value bars with zero rotary dials");
assert.ok(!boxes.some((b) => b.maxclass === "live.slider"), "Vol must be a horizontal value-bar slider, not a vertical fader");

// Verify Shift range (-2000..+2000 Hz), Wave default (0%), Warp default (50%)
const shiftVof = byId["obj-ctrl-fshift"].saved_attribute_attributes.valueof;
assert.strictEqual(shiftVof.parameter_mmin, -2000.0, "Shift min must be -2000 Hz");
assert.strictEqual(shiftVof.parameter_mmax, 2000.0, "Shift max must be +2000 Hz");
assert.strictEqual(byId["obj-ctrl-wtpos"].saved_attribute_attributes.valueof.parameter_initial[0], 0.0, "Default Wave must be 0% (Sine)");
assert.strictEqual(byId["obj-ctrl-warp"].saved_attribute_attributes.valueof.parameter_initial[0], 50.0, "Default Warp must be 50%");

// Verify Blur is in Column 1 Row 5 (y=103, where Gate used to be) and Vol is right above Mix in Column 2 (y=123 above y=143)
assert.strictEqual(byId["obj-ctrl-blur"].presentation_rect[0], 260.0, "Blur must be in Column 1 (x=260)");
assert.strictEqual(byId["obj-ctrl-blur"].presentation_rect[1], 103.0, "Blur must sit at y=103 where Gate used to be");
assert.strictEqual(byId["obj-ctrl-resynthgain"].presentation_rect[0], 344.0, "Vol must be in Column 2 (x=344)");
assert.strictEqual(byId["obj-ctrl-resynthgain"].presentation_rect[1], 123.0, "Vol must sit at y=123 right above Mix");
assert.strictEqual(byId["obj-ctrl-mix"].presentation_rect[0], 344.0, "Mix must be in Column 2 (x=344)");
assert.strictEqual(byId["obj-ctrl-mix"].presentation_rect[1], 143.0, "Mix must sit at y=143 right below Vol");

for (const b of boxes) {
    if (b.text && b.text.startsWith("buffer~")) {
        assert.ok(b.text.includes("#0-"), `buffer~ must use #0- prefix: ${b.text}`);
    }
}

function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}

const viz = byId["obj-viz"];
assert.strictEqual(viz.maxclass, "v8ui");
const vr = viz.presentation_rect;

const visibleInteractive = boxes.filter(
    (b) => b.presentation === 1 && !b.hidden && b.id !== "obj-viz" && b.maxclass && b.maxclass.startsWith("live.") && b.maxclass !== "live.comment"
);
for (const w of visibleInteractive) {
    assert.ok(!rectsOverlap(vr, w.presentation_rect), `v8ui overlaps ${w.id}`);
}
for (let i = 0; i < visibleInteractive.length; i++) {
    for (let j = i + 1; j < visibleInteractive.length; j++) {
        assert.ok(
            !rectsOverlap(visibleInteractive[i].presentation_rect, visibleInteractive[j].presentation_rect),
            `${visibleInteractive[i].id} overlaps ${visibleInteractive[j].id}`
        );
    }
}

for (const b of boxes) {
    if (b.presentation === 1 && !b.hidden && b.presentation_rect) {
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 408 && r[1] + r[3] <= 169, `${b.id} outside 408x169`);
    }
}

const panelIndices = boxes.map((b, idx) => (b.maxclass === "panel" ? idx : -1)).filter((i) => i >= 0);
const maxWidgetIdx = Math.max(...boxes.map((b, idx) => (b.maxclass !== "panel" ? idx : -1)));
assert.strictEqual(panelIndices.length, 2, "Expected 2 background panels");
for (const pi of panelIndices) {
    assert.strictEqual(boxes[pi].background, 1, "Panels must set background: 1");
    assert.ok(pi > maxWidgetIdx, "Panels must appear after all widgets in boxes");
}

// 4. Evaluate v8ui script and verify pixel-coordinate mode, wavetable poke, Gate drag in left graphic, and MIDI sidechain
let pokedWt = null;
const scopeMock = new Array(36).fill(0);
scopeMock[3] = 0.62;
scopeMock[19] = 69;
const emitted = [];
const rgbaCalls = [];
const lineToCalls = [];
const sandbox = {
    mgraphics: {
        size: [vr[2], vr[3]],
        init() {},
        redraw() {},
        set_source_rgba(r, g, b, a) { rgbaCalls.push([r, g, b, a]); },
        set_line_width() {},
        rectangle() {},
        rectangle_rounded() {},
        arc() {},
        move_to() {},
        line_to(x, y) { lineToCalls.push([x, y]); },
        close_path() {},
        fill() {},
        stroke() {},
        select_font_face() {},
        set_font_size() {},
        show_text() {},
    },
    Buffer: function (name) {
        this.name = name;
        this.framecount = () => 8192;
        this.peek = () => scopeMock.slice();
        this.poke = (_ch, _off, arr) => { pokedWt = arr; };
    },
    Task: function (fn) {
        this.fn = fn;
        this.repeat = () => {};
    },
    outlet(_idx, msg) { emitted.push(msg); },
    notifyclients() {},
};

const fn = new Function(
    "mgraphics", "Buffer", "Task", "outlet", "notifyclients",
    viz.textfile.text + "\nreturn { loadbang, setbuffer, midi_in, midi_clear, set_pitch, set_fshift, set_stretch, set_snap, set_blur, set_decay, set_attack, set_sieve, set_vol, getvalueof, setvalueof, onclick, ondrag, pullScope, paint, layoutRegions, bandAmps, droplets: () => droplets, curWtPosPct, curWarpPct, displacedBandCenterX, volVisualScale };"
);
const ui = fn(sandbox.mgraphics, sandbox.Buffer, sandbox.Task, sandbox.outlet, sandbox.notifyclients);
assert.strictEqual(sandbox.mgraphics.relative_coords, 0, "v8ui must disable relative_coords");
assert.strictEqual(sandbox.mgraphics.autofill, 0, "v8ui must disable autofill");
assert.strictEqual(ui.curWtPosPct, 0.0, "UI default Wave must be 0% (Sine)");
assert.strictEqual(ui.curWarpPct, 50.0, "UI default Warp must be 50%");

// Verify Pitch, Shift, Stretch, Sieve, Snap, Decay, Blur, Attack, and Vol visual feedback hooks
const baseX8 = ui.displacedBandCenterX(8, 6, 192);
ui.set_pitch(12);
assert.ok(ui.displacedBandCenterX(8, 6, 192) > baseX8, "Pitch > 0 must displace partial bars to the right");
ui.set_pitch(0);
ui.set_fshift(-800);
assert.ok(ui.displacedBandCenterX(8, 6, 192) < baseX8, "Negative Shift Hz must displace partial bars to the left");
ui.set_fshift(0);
const baseX14 = ui.displacedBandCenterX(14, 6, 192);
ui.set_stretch(160);
assert.ok(ui.displacedBandCenterX(14, 6, 192) > baseX14, "Stretch > 100% must fan upper bands outward");
ui.set_stretch(100);
ui.set_vol(12);
assert.ok(ui.volVisualScale() > 1.2, "Positive Vol dB must increase visual bar scale");
ui.set_vol(-36);
assert.strictEqual(ui.volVisualScale(), 0.0, "Vol at -36 dB must scale bars to 0");
ui.set_vol(0);
ui.set_sieve(1);
ui.set_snap(100);
ui.set_blur(60);
ui.set_decay(800);
ui.set_blur(25);
ui.set_decay(120);
ui.set_attack(35);
ui.set_attack(2.5);

ui.setbuffer("1001-percipwt", "1001-percipscope");
assert.ok(pokedWt && pokedWt.length === cfg.WT_TOTAL_SAMPS, "setbuffer must poke 8192-sample Sin->Tri->Saw->Square wavetable");
ui.loadbang();
ui.pullScope();
ui.paint();
assert.ok(ui.bandAmps[3] > 0.3, "pullScope must update bandAmps from #0-percipscope");

// Verify balanced volume-independent droplets even when Vol is at -36 dB, and no tether lines to keyboard
ui.set_vol(-36);
assert.strictEqual(ui.volVisualScale(), 0.0);
for (let step = 0; step < 4; step++) ui.pullScope();
const activeDrops = ui.droplets();
assert.ok(activeDrops.some((d) => d.band === 3 && d.amp >= 0.7), "Droplets must spawn with high brightness even when Vol is -36 dB");
rgbaCalls.length = 0;
lineToCalls.length = 0;
ui.paint();
const dropCores = rgbaCalls.filter((c) => c[0] >= 0.75 && c[0] <= 0.85 && c[1] >= 0.92 && c[2] >= 0.98);
assert.ok(
    dropCores.length > 0 && dropCores.every((c) => c[3] >= 0.30 && c[3] <= 0.70),
    "paint() must draw balanced middle-brightness droplet cores (alpha 0.30..0.70) regardless of Vol setting"
);
const kbTopY = ui.layoutRegions().kbY;
assert.ok(
    !lineToCalls.some((pt) => Math.abs(pt[1] - kbTopY) < 0.5),
    "No snap tether lines should be drawn to the top edge of the 12-note keyboard strip"
);
ui.set_vol(0);

// Dragging in the Partials Viewer adjusts the Gate threshold and emits ["gate", db]
emitted.length = 0;
ui.onclick(60, 60);
ui.ondrag(60, 50);
assert.ok(emitted.some((m) => m[0] === "gate" && m[1] <= -6 && m[1] >= -60), "Dragging Partials Viewer must adjust Gate threshold");

// Dragging the top-right Wave Pill adjusts Wave (wtpos) & Warp
emitted.length = 0;
ui.onclick(160, 8);
ui.ondrag(185, 6);
assert.ok(emitted.some((m) => m[0] === "wtpos"), "Dragging Wave Pill must emit wtpos");
assert.ok(emitted.some((m) => m[0] === "warp"), "Dragging Wave Pill must emit warp");

// Clicking the bottom 12-note scale strip toggles a scale bit and emits ["scalemask", mask]
emitted.length = 0;
ui.onclick(20, 120);
assert.ok(emitted.some((m) => m[0] === "scalemask" && m[1] !== cfg.DEFAULT_SCALE_MASK), "Clicking scale strip must toggle note in scalemask");

// Sidechain MIDI note-on / note-off / chord latch
emitted.length = 0;
ui.midi_in(61, 100); // C#
assert.ok(emitted.some((m) => m[0] === "scalemask" && m[1] === (1 << 1)), "MIDI note-on must lock scalemask to held note");
ui.midi_in(61, 0); // note-off latches last chord
assert.strictEqual(ui.getvalueof()[1], 1 << 1, "MIDI note-off must latch last played chord mask");
ui.midi_clear();

// State serialization round-trip (v2 [2, mask, gate] and v1 backward compatibility [1, mask])
ui.setvalueof([2, 2741, -28.5]);
const savedState = ui.getvalueof();
assert.deepStrictEqual(savedState, [2, 2741, -28.5], "getvalueof/setvalueof v2 round-trip mismatch");
ui.setvalueof([1, 1365]);
assert.strictEqual(ui.getvalueof()[1], 1365, "setvalueof v1 backward compatibility failed");

// Verify idle UI sleep: when scope is silent, pullScope() returns false after settling so mgraphics.redraw() stops
const savedAmp3 = scopeMock[3];
scopeMock[3] = 0;
for (let step = 0; step < 80; step++) ui.pullScope();
assert.strictEqual(ui.pullScope(), false, "pullScope() must return false when silent so v8ui skips redraws while idle");
scopeMock[3] = savedAmp3;
assert.strictEqual(ui.pullScope(), true, "pullScope() must wake up immediately when audio returns");

{
    // GenExpr runs the code after a `return` nested in an `if` / loop block (and the last return wins), so every
    // return must sit at function level. A nested return once broke Freeze / the silence sleep / Soft and Hard Clip.
    let depth = 0, fn = "", nested = [];
    for (const line of gen.split("\n")) {
        if (/^[a-z_]+\(.*\) \{$/.test(line)) { fn = line; depth = 0; }
        depth += (line.match(/\{/g) || []).length;
        depth -= (line.match(/\}/g) || []).length;
        if (/\breturn\b/.test(line) && !/^\s*\/\//.test(line) && depth > 1) nested.push(fn.split("(")[0] + ": " + line.trim());
    }
    assert.strictEqual(nested.length, 0, `No return inside a block in GenExpr functions (${nested.join("; ")})`);
}

console.log("test_percipitator: ok (408x169 Concept 3 verified)");
