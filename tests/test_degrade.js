#!/usr/bin/env node
/**
 * Comprehensive verification suite for Degrade (.amxd):
 *   - devices/Degrade.amxd (780 x 169 px Modular Strip)
 *   - devices/Degrade Strip.amxd (780 x 169 px Modular Strip)
 *   - devices/Degrade Compact.amxd (480 x 169 px Compact Matrix Rack)
 *   - devices/Degrade Hero.amxd (560 x 169 px Visualizer-Hero Pedal)
 *
 * Covers:
 *  1. DSP math invariants in src/degrade_config.js (Bit reduction, Integer wrap, SR, Codec holes,
 *     Telecom u-Law/A-Law/ADPCM/GSM, FFT Glitch, and 5-stage permutation encode/decode/move)
 *  2. GenExpr ordering & lexer safety (functions first, Buffer -> Param -> History -> Delay,
 *     no e0..e9 identifiers, per-stage `if (<stage>_on > 0.5)` zero-CPU bypass gates, fixnan() guards)
 *  3. .amxd binary header ("aaaa" Audio Effect) & 169.0 px presentation height across all variants
 *  4. #0- instance isolation, `scope #0-degscope` loadbang binding, and background panel z-order
 *  5. Zero widget overlap across all presentation controls and v8ui canvas
 *  6. Complete patchline graph verification for all 13 continuous and 8 enum/toggle parameters
 *  7. v8ui runtime execution: relative_coords === 0, OrderData versioned serialization
 *     (getvalueof / setvalueof), undo/redo discipline (pushUndoState on onclick), drag-to-reorder
 *     emitting `order_code`, and Technical/Abstract visualizer rendering
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "degrade_core.genexpr");
const SPEC_GEN_PATH = path.join(ROOT, "src", "degrade_spectral.genexpr");
const cfg = require(path.join(ROOT, "src", "degrade_config.js"));

// ============================================================================
// 1. DSP Math & Reorder Permutation Invariants
// ============================================================================
assert.deepStrictEqual(cfg.normalizeOrder([3, 0, 2, 1, 4]), [3, 0, 2, 1, 4], "Valid permutation should pass through");
assert.deepStrictEqual(cfg.normalizeOrder([4, 4, 99, -1]), [4, 0, 1, 2, 3], "Invalid/duplicate order should heal to full 0..4 permutation");
assert.strictEqual(cfg.encodeOrderCode([0, 1, 2, 3, 4]), 1234, "Default order code should encode to 1234");
assert.strictEqual(cfg.encodeOrderCode([3, 0, 1, 2, 4]), 30124, "[3,0,1,2,4] should encode to 30124");
assert.deepStrictEqual(cfg.decodeOrderCode(30124), [3, 0, 1, 2, 4], "decodeOrderCode(30124) should round-trip");
assert.deepStrictEqual(cfg.moveStageInOrder([0, 1, 2, 3, 4], 0, 3), [1, 2, 3, 0, 4], "moveStageInOrder should shift stage 0 to slot 3");

// Bit reduction & integer wrap
const cleanQuant = cfg.processBitSample(0.33, 16.0, 0.0, 0.0, 0.0, 0.0);
assert.ok(Math.abs(cleanQuant - 0.33) < 0.001, "16-bit with 0 wrap/dither should preserve sample");
const coarseQuant = cfg.processBitSample(0.33, 2.0, 0.0, 0.0, 0.0, 0.0);
assert.strictEqual(coarseQuant, 0.5, "2-bit quantizer should snap 0.33 to 0.5 staircase step");
const wrappedSample = cfg.processBitSample(0.85, 16.0, 1.0, 0.0, 0.0, 0.0);
assert.ok(wrappedSample < 0.0, "High amplitude with 100% integer wrap must fold across [-1, 1] into negative territory");

// Sample rate & jitter
const srNoJit = cfg.computeEffectiveSrRatio(11025, 44100, 0.0, 0.8);
assert.ok(Math.abs(srNoJit - 0.25) < 1e-6, "11025 Hz at 44100 Hz SR with 0 jitter should be 0.25 ratio");
const srWithJit = cfg.computeEffectiveSrRatio(11025, 44100, 1.0, 0.8);
assert.ok(Math.abs(srWithJit - srNoJit) > 0.05, "Clock jitter should modulate effective sample-rate ratio");

// Perceptual Codec spectral holes & extreme packet starvation
const holeGainQuiet = cfg.computeCodecBandGain(0.02, 0.35, 0.9, 0.0);
const holeGainLoud = cfg.computeCodecBandGain(0.80, 0.35, 0.6, 0.0);
const holeGain100Silent = cfg.computeCodecBandGain(0.80, 0.35, 1.0, 0.2);
const holeGain100Glitch = cfg.computeCodecBandGain(0.80, 0.35, 1.0, 0.98);
assert.strictEqual(holeGainQuiet, 0.0, "Quiet sub-band under high Codec damage must be gated into a spectral hole (0)");
assert.ok(holeGainLoud >= 0.95, "Dominant sub-band at moderate damage must survive");
assert.strictEqual(holeGain100Silent, 0.0, "At 100% Damage, normal frames must starve to silence (0.0)");
assert.ok(holeGain100Glitch > 0.1, "At 100% Damage, rare birdie spikes (0.98) should poke through");

// Telecom modes (u-Law, A-Law, ADPCM, GSM)
const uLawVal = cfg.processTelecomSample(0.42, 0, 0.8, 0);
const aLawVal = cfg.processTelecomSample(0.42, 1, 0.8, 0);
const adpcmVal = cfg.processTelecomSample(0.85, 2, 0.9, 0.0);
const gsmVal = cfg.processTelecomSample(0.42, 3, 0.8, 0);
assert.ok(Math.abs(uLawVal) > 0.1 && Math.abs(uLawVal) <= 1.0, "u-Law output must be bounded");
assert.ok(Math.abs(aLawVal) > 0.1 && Math.abs(aLawVal) <= 1.0, "A-Law output must be bounded");
assert.ok(adpcmVal < 0.3, "ADPCM at high Line degradation must slew-limit fast transient jumps (slope overload)");
assert.ok(Math.abs(gsmVal) > 0.1 && Math.abs(gsmVal) <= 1.0, "GSM output must be bounded");

// FFT Glitch modes
const origBands = [0.1, 0.8, 0.2, 0.9, 0.15, 0.7, 0.05, 0.6];
for (let m = 0; m < 4; m++) {
    const glitched = cfg.computeFftGlitchBands(origBands, m, 0.85, 1.2);
    assert.strictEqual(glitched.length, origBands.length);
    assert.ok(glitched.some((v, idx) => Math.abs(v - origBands[idx]) > 0.01), `FFT mode ${m} should alter spectrum`);
}

// ============================================================================
// 2. GenExpr Ordering, Lexer Rules & Zero-CPU Bypass Gate Verification
// ============================================================================
const gen = fs.readFileSync(GEN_PATH, "utf8");
const specGen = fs.readFileSync(SPEC_GEN_PATH, "utf8");
assert.ok(!gen.match(/\be\d/), "Never use e0..e9 identifiers in GenExpr (parsed as Euler's constant)");
assert.ok(!specGen.match(/\be\d/), "Never use e0..e9 identifiers in spectral GenExpr");
assert.ok(!gen.includes("delay("), "GenExpr must use Delay.read / Delay.write instead of delay()");
assert.ok(!specGen.includes("delay("), "Spectral GenExpr must use Delay.read / Delay.write instead of delay()");

const fnAt = gen.indexOf("slew(target, coef)");
const bufAt = gen.indexOf("\nBuffer ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const delayAt = gen.indexOf("\nDelay ");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1);");

assert.ok(fnAt >= 0 && fnAt < bufAt, "Helper functions must precede Buffer in GenExpr");
assert.ok(bufAt < paramAt && paramAt < histAt && histAt < delayAt, "Declarations must follow Buffer -> Param -> History -> Delay order");
assert.ok(delayAt < exprAt, "All Delay declarations must precede expressions");
assert.strictEqual((gen.match(/^Delay /gm) || []).length, 4, "Expected 4 Delay lines (codecDL, codecDR, fftDL, fftDR)");
assert.ok(gen.includes("fixnan(outL)") && gen.includes("fixnan(outR)"), "Outputs must be protected with fixnan()");

// Verify each of the 5 sections is gated by its own `if ((stId == k) * (<stage>_on > 0.5))` block
assert.ok(gen.includes("if ((stId == 0) * (bit_on > 0.5))"), "Stage 0 (BIT) must be gated by bit_on > 0.5");
assert.ok(gen.includes("if ((stId == 1) * (sr_on > 0.5))"), "Stage 1 (SR) must be gated by sr_on > 0.5");
assert.ok(gen.includes("if ((stId == 2) * (codec_on > 0.5))"), "Stage 2 (CODEC) must be gated by codec_on > 0.5");
assert.ok(gen.includes("if ((stId == 3) * (tele_on > 0.5))"), "Stage 3 (TELE) must be gated by tele_on > 0.5");
assert.ok(gen.includes("if ((stId == 4) * (fft_on > 0.5))"), "Stage 4 (FFT) must be gated by fft_on > 0.5");

// ============================================================================
// 3. Verify All 4 Generated .amxd Files & Presentation Layouts
// ============================================================================
function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}

const ALL_PARAM_KEYS = [
    "bits", "wrap", "dither",
    "srate", "jitter",
    "codec_loss", "preecho", "birdies",
    "tele_line",
    "fft_glitch", "fft_frame",
    "out_gain", "mix",
    "bit_on", "sr_on", "codec_on", "tele_on", "fft_on",
    "sr_mode", "tele_mode", "fft_mode",
];

function verifyAmxd(amxdFile, expectedWidth) {
    const fullPath = path.join(ROOT, "devices", amxdFile);
    assert.ok(fs.existsSync(fullPath), `Missing generated device: ${fullPath}`);
    const raw = fs.readFileSync(fullPath);

    assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", `${amxdFile}: Expected ampf header`);
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", `${amxdFile}: Expected aaaa audio-effect type`);
    assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", `${amxdFile}: Expected ptch chunk`);
    const jsonLen = raw.readUInt32LE(28);
    assert.strictEqual(jsonLen, raw.length - 32, `${amxdFile}: Payload length mismatch`);

    const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.strictEqual(patcher.openinpresentation, 1, `${amxdFile}: Must open in presentation mode`);
    assert.strictEqual(patcher.openrect[2], expectedWidth, `${amxdFile}: Expected width ${expectedWidth}`);
    assert.strictEqual(patcher.openrect[3], 169.0, `${amxdFile}: Expected height 169.0`);

    const boxes = patcher.boxes.map((b) => b.box);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    const lines = patcher.lines.map((l) => l.patchline);

    function hasLine(srcId, dstId) {
        return lines.some((l) => l.source[0] === srcId && l.destination[0] === dstId);
    }

    assert.ok(byId["obj-plugin"] && byId["obj-plugin"].text === "plugin~", `${amxdFile}: Missing plugin~`);
    assert.ok(byId["obj-plugout"] && byId["obj-plugout"].text === "plugout~", `${amxdFile}: Missing plugout~`);
    assert.ok(byId["obj-gen"] && byId["obj-gen"].maxclass === "gen.codebox~", `${amxdFile}: Missing gen.codebox~`);
    assert.strictEqual(byId["obj-gen"].code, gen, `${amxdFile}: Embedded GenExpr mismatch`);

    // Instance isolation (#0- prefix) and loadbang buffer binding
    assert.strictEqual(byId["obj-msg-gen-buf"].text, "scope #0-degscope", `${amxdFile}: Buffer bind message mismatch`);
    assert.strictEqual(byId["obj-msg-ui-buf"].text, "setbuffer #0-degscope", `${amxdFile}: UI buffer message mismatch`);
    assert.ok(hasLine("obj-loadbang", "obj-msg-gen-buf") && hasLine("obj-msg-gen-buf", "obj-gen"));
    assert.ok(hasLine("obj-loadbang", "obj-msg-ui-buf") && hasLine("obj-msg-ui-buf", "obj-viz"));
    assert.ok(hasLine("obj-viz", "obj-route-ui") && hasLine("obj-route-ui", "obj-prep-order") && hasLine("obj-prep-order", "obj-gen"));

    for (const b of boxes) {
        if (b.text && b.text.startsWith("buffer~")) {
            assert.ok(b.text.includes("#0-"), `${amxdFile}: buffer~ must use #0- prefix: ${b.text}`);
        }
    }

    // Verify all 21 parameters exist and route into obj-gen
    for (const key of ALL_PARAM_KEYS) {
        const ctrlId = `obj-ctrl-${key}`;
        const prepId = `obj-prep-${key}`;
        assert.ok(byId[ctrlId], `${amxdFile}: Missing control ${ctrlId}`);
        assert.ok(byId[prepId], `${amxdFile}: Missing prepend ${prepId}`);
        assert.ok(hasLine(prepId, "obj-gen"), `${amxdFile}: ${prepId} must connect to obj-gen`);
    }

    // Verify background panels are at the end of `boxes` with background: 1
    let seenPanel = false;
    for (const b of boxes) {
        if (b.maxclass === "panel") {
            seenPanel = true;
            assert.strictEqual(b.background, 1, `${amxdFile}: Panel ${b.id} must have background: 1`);
        } else if (seenPanel) {
            assert.fail(`${amxdFile}: Non-panel box ${b.id} appears after a panel box!`);
        }
    }

    // Verify no interactive live.* widget overlaps v8ui or any other interactive widget
    const vizRect = byId["obj-viz"].presentation_rect;
    const interactive = boxes.filter(
        (b) => b.presentation === 1 && b.maxclass !== "panel" && b.maxclass !== "live.comment" && b.id !== "obj-viz"
    );
    for (let i = 0; i < interactive.length; i++) {
        const a = interactive[i];
        assert.ok(
            !rectsOverlap(a.presentation_rect, vizRect),
            `${amxdFile}: Widget ${a.id} (${a.presentation_rect}) overlaps v8ui (${vizRect})`
        );
        assert.ok(
            a.presentation_rect[0] >= 0 &&
            a.presentation_rect[1] >= 0 &&
            a.presentation_rect[0] + a.presentation_rect[2] <= expectedWidth &&
            a.presentation_rect[1] + a.presentation_rect[3] <= 169.0,
            `${amxdFile}: Widget ${a.id} out of device bounds: ${a.presentation_rect}`
        );
        for (let j = i + 1; j < interactive.length; j++) {
            const b = interactive[j];
            assert.ok(
                !rectsOverlap(a.presentation_rect, b.presentation_rect),
                `${amxdFile}: Widgets ${a.id} and ${b.id} overlap!`
            );
        }
    }

    return byId["obj-viz"].textfile.text;
}

const uiCode = verifyAmxd("Degrade.amxd", 480.0);
verifyAmxd("Degrade Strip.amxd", 780.0);
verifyAmxd("Degrade Compact.amxd", 480.0);
verifyAmxd("Degrade Hero.amxd", 560.0);

// ============================================================================
// 4. Verify v8ui Runtime: Pixel Coords, Serialization, Undo, Reorder & Paint
// ============================================================================
const emitted = [];
let notified = 0;
const drawCmds = [];

const sandbox = {
    Math,
    Number,
    Array,
    Object,
    inlets: 1,
    outlets: 1,
    mgraphics: {
        size: [220, 136],
        relative_coords: 1,
        autofill: 1,
        init() {},
        redraw() {},
        set_source_rgba(r, g, b, a) { drawCmds.push({ op: "rgba", r, g, b, a }); },
        set_line_width(w) { drawCmds.push({ op: "lw", w }); },
        rectangle(x, y, w, h) { drawCmds.push({ op: "rect", x, y, w, h }); },
        rectangle_rounded(x, y, w, h) { drawCmds.push({ op: "rrect", x, y, w, h }); },
        move_to(x, y) { drawCmds.push({ op: "move", x, y }); },
        line_to(x, y) { drawCmds.push({ op: "line", x, y }); },
        arc(x, y, r, a1, a2) { drawCmds.push({ op: "arc", x, y, r, a1, a2 }); },
        close_path() {},
        fill() { drawCmds.push({ op: "fill" }); },
        stroke() { drawCmds.push({ op: "stroke" }); },
        select_font_face(f) {},
        set_font_size(s) {},
        show_text(txt) { drawCmds.push({ op: "text", txt }); },
    },
    outlet(idx, ...args) {
        emitted.push({ idx, args });
    },
    notifyclients() {
        notified++;
    },
    Buffer: function () {
        this.peek = () => [0.4, 0.6, 0.7, 0.5, 0.4, 0.2, 0.8, 12, 0.2, -0.3, 0.4, -0.2, 0.1, -0.1, 0.3, -0.4];
    },
};

vm.createContext(sandbox);
vm.runInContext(uiCode, sandbox);

assert.strictEqual(sandbox.mgraphics.relative_coords, 0, "v8ui must set mgraphics.relative_coords = 0");
assert.strictEqual(sandbox.mgraphics.autofill, 0, "v8ui must set mgraphics.autofill = 0");

// Verify getvalueof / setvalueof versioned state serialization
const initBlob = sandbox.getvalueof();
assert.deepStrictEqual(Array.from(initBlob), [1, 0, 1, 2, 3, 4, 0, 0], "Initial OrderData blob mismatch");

sandbox.setvalueof(1, 4, 3, 2, 1, 0, 1, 2);
assert.deepStrictEqual(Array.from(sandbox.getvalueof()), [1, 4, 3, 2, 1, 0, 1, 2], "setvalueof should restore custom order and vizMode");
assert.ok(emitted.some((e) => e.args[0] === "order_code" && e.args[1] === 43210), "setvalueof must emit order_code 43210");

// Fallback unversioned 5-element array
sandbox.setvalueof([2, 0, 1, 4, 3]);
assert.deepStrictEqual(Array.from(sandbox.getvalueof()).slice(1, 6), [2, 0, 1, 4, 3], "Legacy 5-element array should parse cleanly");

// Reset to default order and test interactive drag-to-reorder + undo/redo
sandbox.reset_order();
assert.deepStrictEqual(Array.from(sandbox.getvalueof()).slice(1, 6), [0, 1, 2, 3, 4]);

// Click pill 0 (at x=22, y=12) and drag to slot 3 (x=150, y=12)
sandbox.onclick(22, 12);
sandbox.ondrag(150, 12, 1);
sandbox.ondrag(150, 12, 0);
const reordered = Array.from(sandbox.getvalueof()).slice(1, 6);
assert.notDeepStrictEqual(reordered, [0, 1, 2, 3, 4], "Dragging stage pill must reorder stageOrder");
assert.ok(emitted.some((e) => e.args[0] === "order_code" && e.args[1] === cfg.encodeOrderCode(reordered)));

// Undo must restore [0, 1, 2, 3, 4]
sandbox.undo();
assert.deepStrictEqual(Array.from(sandbox.getvalueof()).slice(1, 6), [0, 1, 2, 3, 4], "undo() must restore previous stage order");
sandbox.redo();
assert.deepStrictEqual(Array.from(sandbox.getvalueof()).slice(1, 6), reordered, "redo() must re-apply reordered stage order");

// Verify both Technical and Abstract visualizer modes paint cleanly
drawCmds.length = 0;
sandbox.set_viz_mode(0);
sandbox.paint();
assert.ok(drawCmds.some((c) => c.op === "text" && c.txt === "SPEC"), "Technical mode must render SPEC analyzer");

drawCmds.length = 0;
sandbox.set_viz_mode(1);
sandbox.paint();
assert.ok(drawCmds.some((c) => c.op === "text" && c.txt === "PHASE GLITCH FIELD"), "Abstract mode must render PHASE GLITCH FIELD");

console.log("All Degrade unit, GenExpr, layout, patchline, and v8ui tests passed!");
