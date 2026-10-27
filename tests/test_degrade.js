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
 *  4. #0- instance isolation, `scope ---degscope` loadbang binding, and background panel z-order
 *  5. Zero widget overlap across all presentation controls and v8ui canvas
 *  6. Complete patchline graph verification for all 13 continuous and 8 enum/toggle parameters
 *  7. v8ui runtime execution: relative_coords === 0, OrderData versioned serialization
 *     (getvalueof / setvalueof), undo/redo discipline (pushUndoState on onclick), drag-to-reorder
 *     emitting `order_code`, and Technical/Abstract visualizer rendering
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { minifyGen } = require("./minify_gen.js");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "degrade_core.genexpr");
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

// FFT Glitch modes (all 4 modes: 0=Den, 1=Scr, 2=Spl, 3=Cmb)
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
assert.ok(!gen.match(/\be\d/), "Never use e0..e9 identifiers in GenExpr (parsed as Euler's constant)");
assert.ok(!gen.includes("delay("), "GenExpr must use Delay.read / Delay.write instead of delay()");

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
// and the entire DSP loop is gated by `if (runDsp > 0)` when no audio is coming in
assert.ok(gen.includes("if (runDsp > 0)"), "DSP loop and PRNG must be gated by runDsp > 0 when audio is idle/silent");
assert.ok(gen.includes("(stId == 0) * (bit_on > 0.5)"), "Stage 0 (BIT) must be gated by bit_on > 0.5");
assert.ok(gen.includes("(stId == 1) * (sr_on > 0.5)"), "Stage 1 (SR) must be gated by sr_on > 0.5");
assert.ok(gen.includes("(stId == 2) * (codec_on > 0.5)"), "Stage 2 (CODEC) must be gated by codec_on > 0.5");
assert.ok(gen.includes("(stId == 3) * (tele_on > 0.5)"), "Stage 3 (TELE) must be gated by tele_on > 0.5");
assert.ok(gen.includes("(stId == 4) * (fft_on > 0.5)"), "Stage 4 (FFT) must be gated by fft_on > 0.5");

// One loop, one call site per stage (gen~ compiles each stage once, not once per slot).
assert.strictEqual((gen.match(/for \(slot = 0; slot < 5; slot \+= 1\)/g) || []).length, 1, "Stages must share a single slot loop");
for (const gate of ["(stId == 0)", "(stId == 1)", "(stId == 2)", "(stId == 3)", "(stId == 4)"]) {
    assert.strictEqual((gen.split(gate).length - 1), 1, `${gate} must appear once`);
}
assert.ok(gen.includes("cBitSteps") && gen.includes("cBitRcp"), "Bit quantizer step and reciprocal must be cached");
assert.ok(gen.includes("cSrBaseInc") && gen.includes("cCf0") && gen.includes("cFf0"), "SR ratio and SVF coefficients must be cached");
assert.ok(gen.includes("cHpCoef") && gen.includes("cTelCos") && gen.includes("cTelQ"), "Telecom bandpass and compander constants must be cached");
assert.ok(gen.includes("dbtoa(outGainDbS)"), "Output gain must use cached dbtoa");
assert.ok(gen.includes("cDryG") && gen.includes("cWetG"), "Wet/dry cos/sin gains must be cached");
assert.ok(gen.includes("cOrd0") && gen.includes("orderNow != orderLatch"), "Slot permutation must be decoded only when order_code changes");
const dspEnd = gen.indexOf("end if (runDsp");
const framePoke = gen.indexOf("poke(scope, rollCounter, 7, 0)");
assert.ok(dspEnd > 0 && framePoke > dspEnd, "Frame counter in slot 7 must advance even when runDsp is 0");

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
    assert.strictEqual(byId["obj-plugin"].varname, "deg_plugin", `${amxdFile}: plugin~ scripting name`);
    assert.ok(byId["obj-plugout"] && byId["obj-plugout"].text === "plugout~", `${amxdFile}: Missing plugout~`);
    assert.strictEqual(byId["obj-plugout"].varname, "deg_plugout", `${amxdFile}: plugout~ scripting name`);
    assert.ok(!byId["obj-gen"], `${amxdFile}: static gen.codebox~ must not ship (deferred gen~)`);
    assert.ok(!boxes.some((b) => b.maxclass === "gen.codebox~" || (b.text && String(b.text).startsWith("gen~"))), `${amxdFile}: no static gen~`);
    assert.strictEqual(byId["obj-gen-in"].text, "gate 1 1", `${amxdFile}: gen hub must be an open gate`);
    assert.strictEqual(byId["obj-gen-in"].varname, "deg_genin", `${amxdFile}: gen hub scripting name`);
    assert.ok(byId["obj-thisdevice"] && byId["obj-thisdevice"].text === "live.thisdevice", `${amxdFile}: Missing live.thisdevice`);
    assert.strictEqual(byId["obj-msg-init-dsp"].text, "init_dsp", `${amxdFile}: Missing init_dsp message`);
    assert.ok(!lines.some((l) => l.source[0] === "obj-plugin" && l.destination[0] === "obj-plugout"), `${amxdFile}: plugin~ must not bypass to plugout~`);
    assert.ok(!lines.some((l) => l.destination[0] === "obj-gen"), `${amxdFile}: nothing may target a static obj-gen`);
    for (const l of lines) {
        if (l.destination[0] === "obj-gen-in") {
            assert.strictEqual(l.destination[1], 1, `${amxdFile}: gen-bound messages go to the gate's data inlet`);
        }
    }

    // Instance isolation (#0- prefix) and loadbang buffer binding
    assert.strictEqual(byId["obj-msg-gen-buf"].text, "scope ---degscope", `${amxdFile}: Buffer bind message mismatch`);
    assert.strictEqual(byId["obj-msg-ui-buf"].text, "setbuffer ---degscope", `${amxdFile}: UI buffer message mismatch`);
    assert.ok(hasLine("obj-loadbang", "obj-msg-gen-buf") && hasLine("obj-msg-gen-buf", "obj-gen-in"));
    assert.ok(hasLine("obj-loadbang", "obj-msg-ui-buf") && hasLine("obj-msg-ui-buf", "obj-viz"));
    assert.ok(hasLine("obj-thisdevice", "obj-msg-init-dsp") && hasLine("obj-msg-init-dsp", "obj-viz"));
    assert.ok(hasLine("obj-viz", "obj-route-ui") && hasLine("obj-route-ui", "obj-prep-order") && hasLine("obj-prep-order", "obj-gen-in"));
    assert.ok(hasLine("obj-route-ui", "obj-trig-resend"), `${amxdFile}: dsp_resend must bang the parameter retrigger`);

    for (const b of boxes) {
        if (b.text && b.text.startsWith("buffer~")) {
            assert.ok(b.text.includes("---"), `${amxdFile}: buffer~ must use --- prefix: ${b.text}`);
        }
    }

    // Verify all 21 parameters exist, route into obj-gen, and default to transparent values (Mix = 50%)
    const expectedDefaults = {
        bits: 16.0,
        wrap: 0.0,
        dither: 0.0,
        srate: 44100.0,
        jitter: 0.0,
        codec_loss: 0.0,
        preecho: 0.0,
        birdies: 0.0,
        tele_line: 0.0,
        fft_glitch: 0.0,
        fft_frame: 45.0,
        out_gain: 0.0,
        mix: 50.0,
        bit_on: 0,
        sr_on: 0,
        codec_on: 0,
        tele_on: 0,
        fft_on: 0,
        sr_mode: 0,
        tele_mode: 0,
        fft_mode: 0,
    };
    for (const key of ALL_PARAM_KEYS) {
        const ctrlId = `obj-ctrl-${key}`;
        const prepId = `obj-prep-${key}`;
        assert.ok(byId[ctrlId], `${amxdFile}: Missing control ${ctrlId}`);
        assert.ok(byId[prepId], `${amxdFile}: Missing prepend ${prepId}`);
        assert.ok(hasLine(prepId, "obj-gen-in"), `${amxdFile}: ${prepId} must connect to the gen hub`);
        const initVal = byId[ctrlId].saved_attribute_attributes.valueof.parameter_initial[0];
        assert.strictEqual(initVal, expectedDefaults[key], `${amxdFile}: Expected default ${expectedDefaults[key]} for ${key}, got ${initVal}`);
    }
    assert.strictEqual(byId["obj-ctrl-fft_mode"].maxclass, "live.numbox", `${amxdFile}: fft_mode must be a live.numbox text slider`);
    assert.deepStrictEqual(
        byId["obj-ctrl-fft_mode"].saved_attribute_attributes.valueof.parameter_enum,
        ["Den", "Scr", "Spl", "Cmb"],
        `${amxdFile}: fft_mode must have ["Den", "Scr", "Spl", "Cmb"]`
    );

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

function extractJsString(script, key) {
    const at = key instanceof RegExp ? script.search(key) : script.indexOf(key);
    assert.ok(at >= 0, `missing ${key}`);
    const start = key instanceof RegExp ? at + script.slice(at).match(key)[0].length : at + key.length;
    assert.strictEqual(script[start], '"');
    let j = start + 1;
    while (j < script.length) {
        if (script[j] === "\\") { j += 2; continue; }
        if (script[j] === '"') break;
        j++;
    }
    return { value: JSON.parse(script.slice(start, j + 1)), end: j + 1 };
}
const embedded = extractJsString(uiCode, /var GEN_DSP_TEXT\s*=\s*/);
const hashPart = uiCode.slice(embedded.end);
const hashMatch = /^\s*;\s*var GEN_DSP_HASH\s*=\s*"([0-9a-f]{12})"\s*;/.exec(hashPart);
assert.ok(hashMatch, "face must declare GEN_DSP_HASH");
assert.strictEqual(crypto.createHash("sha1").update(embedded.value).digest("hex").slice(0, 12), hashMatch[1], "GEN_DSP_HASH must match the embedded patch");
const gendsp = JSON.parse(embedded.value);
const codebox = gendsp.patcher.boxes.map((b) => b.box).find((b) => b.maxclass === "codebox");
assert.ok(codebox, "gendsp must wrap a codebox");
assert.strictEqual(codebox.code, minifyGen(gen), "GEN_DSP_TEXT codebox is the mangled src/degrade_core.genexpr");
assert.ok(uiCode.includes('function init_dsp') && uiCode.includes('Global("degrade_dspq")'), "face must load DSP through the degrade_dspq queue");
assert.ok(uiCode.includes("DSP loading...") && uiCode.includes("DSP failed:"), "face must be able to draw the DSP pill");

assert.ok(!fs.existsSync(path.join(ROOT, "devices", "Degrade Strip.amxd")), "Extra variant Degrade Strip.amxd should be removed");
assert.ok(!fs.existsSync(path.join(ROOT, "devices", "Degrade Compact.amxd")), "Extra variant Degrade Compact.amxd should be removed");
assert.ok(!fs.existsSync(path.join(ROOT, "devices", "Degrade Hero.amxd")), "Extra variant Degrade Hero.amxd should be removed");

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
assert.ok(!drawCmds.some((c) => c.op === "text" && String(c.txt).indexOf("DSP loading") >= 0), "Static paint must not show the DSP pill");

// Silent, settled scope polls must not redraw. A real parameter change still does.
sandbox.setbuffer("---degscope");
sandbox.scopeBuf.peek = () => new Array(32).fill(0);
sandbox.liveInPeak = 0;
sandbox.liveOutPeak = 0;
sandbox.uiSettled = true;
sandbox.dragMode = "";
let redraws = 0;
sandbox.mgraphics.redraw = () => { redraws++; };
sandbox.pullScope();
sandbox.pullScope();
assert.strictEqual(redraws, 0, "silent settled polls must skip mgraphics.redraw()");
sandbox.set_bits(3);
assert.ok(redraws > 0, "a changed parameter must still redraw");
redraws = 0;
sandbox.set_bits(3);
assert.strictEqual(redraws, 0, "repeating the same parameter must not redraw");


// ============================================================================
// 5. BUGSWEEP PASS 1 — red tests for confirmed bugs (see BUGS.md at repo root)
// Each test below FAILS on the current code. No production code was changed.
// ============================================================================

// --- Bug D1: gen telecom companders quantize 2x coarser than the JS mirror ---
// src/degrade_config.js processTelecomSample quantizes the companded value
// with round(comp * qSteps) / qSteps, and the gen cache computes the identical
// qSteps (cTelQ = max(floor(64 - teleLine*56 + 0.5), 4)). But the gen helpers
// ulaw_compand / alaw_compand route through quant_steps(), which quantizes
// with round(x * steps/2) / (steps/2) — half the multiplier — so the shipped
// DSP staircase is twice as coarse as the mirror at every Line value. (The
// GSM branch at the quant_steps(tanh(...), gsmGrid) call site has the same
// halving, plus its own grid drift: gen max(3, 22 - line*18) vs JS
// max(3, 24 - amt*20).) The BIT caller is the only correct quant_steps user:
// there steps = pow(2, bits) is a total level count across [-1, 1], matching
// the JS bit quantizer. Execute the actual gen helper functions (trivially
// transpiled: GenExpr math names -> Math.*) and compare against the mirror.
function extractGenFn(signature) {
    const at = gen.indexOf(signature);
    assert.ok(at >= 0, `missing gen function ${signature}`);
    const end = gen.indexOf("\n}", at);
    assert.ok(end > at, `unterminated gen function ${signature}`);
    return "function " + gen.slice(at, end + 2);
}
const genPrelude = "const max=Math.max, min=Math.min, round=Math.round, floor=Math.floor, abs=Math.abs, log=Math.log, exp=Math.exp, pow=Math.pow; const clip=(v,a,b)=>Math.max(a,Math.min(b,v));\n";
const genFns = new Function(
    genPrelude +
    extractGenFn("quant_steps(x, steps) {") +
    extractGenFn("ulaw_compand(x, qSteps) {") +
    extractGenFn("alaw_compand(x, qSteps) {") +
    "; return { quant_steps, ulaw_compand, alaw_compand };"
)();
function jsUlawExpand(x, qSteps) {
    const mu = 255.0;
    const sgn = x >= 0 ? 1.0 : -1.0;
    const ax = Math.min(Math.abs(x), 1.0);
    const comp = sgn * (Math.log(1.0 + mu * ax) / Math.log(1.0 + mu));
    const qComp = Math.round(comp * qSteps) / qSteps;
    return (qComp >= 0 ? 1.0 : -1.0) * ((Math.pow(1.0 + mu, Math.abs(qComp)) - 1.0) / mu);
}
function jsAlawExpand(x, qSteps) {
    const A = 87.6;
    const lnA = 1.0 + Math.log(A);
    const sgn = x >= 0 ? 1.0 : -1.0;
    const ax = Math.min(Math.abs(x), 1.0);
    const comp = ax < (1.0 / A) ? sgn * (A * ax) / lnA : sgn * (1.0 + Math.log(A * ax)) / lnA;
    const qComp = Math.round(comp * qSteps) / qSteps;
    const aq = Math.abs(qComp);
    return (qComp >= 0 ? 1.0 : -1.0) * (aq < (1.0 / lnA) ? (aq * lnA) / A : Math.exp(aq * lnA - 1.0) / A);
}
for (const qSteps of [64, 32, 8]) {
    for (const x of [0.42, -0.42, 0.1, 0.83]) {
        assert.ok(
            Math.abs(genFns.ulaw_compand(x, qSteps) - jsUlawExpand(x, qSteps)) < 1e-6,
            `BUG D1: gen u-Law compand must match the JS mirror quantization step (qSteps=${qSteps}, x=${x}): gen=${genFns.ulaw_compand(x, qSteps)} mirror=${jsUlawExpand(x, qSteps)}`
        );
        assert.ok(
            Math.abs(genFns.alaw_compand(x, qSteps) - jsAlawExpand(x, qSteps)) < 1e-6,
            `BUG D1: gen A-Law compand must match the JS mirror quantization step (qSteps=${qSteps}, x=${x}): gen=${genFns.alaw_compand(x, qSteps)} mirror=${jsAlawExpand(x, qSteps)}`
        );
    }
}

// --- Bug D2: Master Output gain never reaches the dry path ---
// build_degrade.py documents out_gain as "Master output drive/trim in dB
// before final soft ceiling", but the gen output section computes
// outL = in1 * cDryG + wetOutL * cWetG with outGainSlew applied only inside
// wetOutL. At Mix = 50% a +6 dB Output setting therefore delivers only
// 0.5 + 0.5*2 = 1.5x (+3.5 dB), and at Mix = 0% the Output knob does nothing
// at all. The summed output line itself must carry the master gain.
const outLineL = gen.split("\n").find((l) => l.startsWith("outL ="));
const outLineR = gen.split("\n").find((l) => l.startsWith("outR ="));
assert.ok(outLineL && outLineL.includes("outGainSlew"), `BUG D2: master out_gain must scale the summed dry+wet output (L), got: ${outLineL}`);
assert.ok(outLineR && outLineR.includes("outGainSlew"), `BUG D2: master out_gain must scale the summed dry+wet output (R), got: ${outLineR}`);

// --- Bug D3: Mix law is linear, not the documented equal-power law ---
// build_degrade.py PARAM_SPECS documents mix as "Equal-power dry/wet mix"
// (and section 2 above is titled "Wet/dry cos/sin gains"), but the gen cache
// computes cWetG = clip(wetSlew, 0, 1) and cDryG = 1.0 - cWetG: a linear
// crossfade that dips -3 dB for decorrelated wet content at Mix = 50%.
// Equal-power gains must come from sin/cos of the wet position.
const wetAssign = gen.split("\n").find((l) => l.includes("cWetG =") && l.includes("wetSlew"));
const dryAssign = gen.split("\n").find((l) => l.includes("cDryG =") && l.includes("cWetG"));
assert.ok(wetAssign && /sin\s*\(/.test(wetAssign), `BUG D3: cWetG must be an equal-power (sin) gain, got: ${wetAssign}`);
assert.ok(dryAssign && /cos\s*\(/.test(dryAssign), `BUG D3: cDryG must be an equal-power (cos) gain, got: ${dryAssign}`);

// --- Bug D4: set_mix(0) mirrors Mix as 100% wet in the v8ui ---
// Every other percent setter uses (Number(v) || 0) / 100, but set_mix uses
// (Number(v) || 100) / 100, so the legitimate in-range value Mix = 0%
// (fully dry) sets curWet = 1.0. It also breaks change detection: after
// set_mix(100), a following set_mix(0) reports no change and skips redraw.
sandbox.set_mix(100);
assert.strictEqual(sandbox.curWet, 1.0, "set_mix(100) should mirror curWet = 1.0");
sandbox.set_mix(0);
assert.strictEqual(sandbox.curWet, 0.0, "BUG D4: set_mix(0) must mirror curWet = 0.0 (fully dry), not 1.0");
sandbox.set_mix(50);

console.log("All Degrade unit, GenExpr, layout, patchline, and v8ui tests passed!");
