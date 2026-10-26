#!/usr/bin/env node
/**
 * Degrade - Bug Sweep Pass 1 (second sweep, on the post-D1..D4 baseline): RED TESTS ONLY.
 *
 * Each check below FAILS on the current code because of the bug it names
 * (see BUGS.md, section "Degrade - Bug Sweep Pass 1 (bugsweep/degrade, 2026-10-25)").
 * No production code was changed. Bugs D1-D4 from the first Degrade sweep are
 * already fixed in this baseline and are covered by tests/test_degrade.js.
 *
 * The checks run through a small collecting harness so a single run reports
 * every red check (a plain assert chain would stop at the first failure);
 * the process still exits non-zero while any check is red.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "degrade_config.js"));
const gen = fs.readFileSync(path.join(ROOT, "src", "degrade_core.genexpr"), "utf8");

const failures = [];
function check(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (err) {
        failures.push({ name, err });
        console.log(`RED  ${name}: ${err && err.message ? err.message : err}`);
    }
}

// --- Bug D5: FFT glitch helper is not neutral at Glitch = 0% (Den / Cmb modes) ---
// src/degrade_config.js computeFftGlitchBands(): Scramble (mode 1) and Splat
// (mode 2) both return the input bands unchanged at glitchAmt = 0, and the real
// gen~ stage is fully bypassed at fft_glitch = 0 (fftActive requires
// fftGlitchVal > 0.001 and the stage output is mixed in by fftGlitchVal).
// But Denoise (mode 0) boosts every band above 0.35 by 1.35x regardless of the
// amount, and Comb (mode 3) boosts every even band by 1.45x regardless of the
// amount, so the shared helper reports a degraded spectrum when the FFT stage
// is at its neutral setting.
check("D5 fft-glitch-neutral-at-zero", () => {
    const bands = [0.1, 0.8, 0.2, 0.9, 0.15, 0.7, 0.05, 0.6];
    for (let m = 0; m < 4; m++) {
        const out = cfg.computeFftGlitchBands(bands, m, 0.0, 1.2);
        assert.deepStrictEqual(
            out, bands,
            `mode ${m} at glitchAmt=0 must return the bands unchanged, got ${JSON.stringify(out)}`
        );
    }
});

// --- Bug D6: Telecom ADPCM / GSM modes are not neutral at Line = 0% ---
// src/degrade_config.js processTelecomSample(): u-Law (mode 0) and A-Law
// (mode 1) blend toward the companded signal by amt * 0.85, so at lineAmt = 0
// they return the input exactly. ADPCM (mode 2) and GSM (mode 3) have no such
// blend: ADPCM returns prev * 0.94 + qDiff (a 6% level loss plus slew limiting
// even at amt = 0) and GSM always returns its tanh/grid-quantized signal.
// The gen~ mirrors the neutral expectation: the TELE stage is gated off at
// tele_line <= 0.001 (telActive) and mixed by teleWet = clip(teleLine * 2.5).
check("D6 telecom-neutral-at-zero", () => {
    for (let m = 0; m < 4; m++) {
        const outPos = cfg.processTelecomSample(0.42, m, 0.0, 0.42);
        assert.ok(
            Math.abs(outPos - 0.42) < 1e-9,
            `mode ${m} at lineAmt=0 must return the input 0.42 unchanged, got ${outPos}`
        );
        const outNeg = cfg.processTelecomSample(-0.35, m, 0.0, -0.35);
        assert.ok(
            Math.abs(outNeg + 0.35) < 1e-9,
            `mode ${m} at lineAmt=0 must return the input -0.35 unchanged, got ${outNeg}`
        );
    }
});

// --- Bug D7: Wet/dry History defaults contradict the equal-power cache law ---
// src/degrade_core.genexpr: the control-rate cache recomputes the Mix gains as
// cWetG = sin(clip(wetSlew, 0, 1) * pi/2) and cDryG = cos(asin(cWetG)) - the
// documented "Equal-power dry/wet mix" (scripts/build_degrade.py PARAM_SPECS).
// But the History defaults are cWetG(0.5) / cDryG(0.5) (linear gains), and
// cWetLat defaults to 0.5, exactly the slewed Mix default, so the cache block
// is skipped at load and the device runs with 0.5/0.5 gains until Mix is first
// moved - after which Mix = 50% suddenly means 0.7071/0.7071. On the
// transparent path (runDsp = 0, wetOut = in) that is a jump from exact unity
// (0.5 + 0.5) to +3.01 dB (0.7071 + 0.7071) caused purely by touching Mix.
// Every other cache default in the file matches its formula at the default
// parameter value (cBitSteps = 2^16, cOutLin = dbtoa(0) = 1, cOrd* = 1234).
check("D7 wet-dry-defaults-match-equal-power-law", () => {
    function histDefault(name) {
        const m = gen.match(new RegExp("History " + name + "\\(([-0-9.]+)\\)"));
        assert.ok(m, `missing History ${name}`);
        return Number(m[1]);
    }
    assert.strictEqual(histDefault("cWetLat"), 0.5, "premise: cWetLat defaults to the Mix default, so the cache is skipped at load");
    const eqWet = Math.sin(0.5 * Math.PI / 2); // 0.70710678...
    const eqDry = Math.cos(Math.asin(eqWet)); // 0.70710678...
    assert.ok(
        Math.abs(histDefault("cWetG") - eqWet) < 1e-6,
        `cWetG History default ${histDefault("cWetG")} must equal the equal-power gain at Mix=50% (${eqWet})`
    );
    assert.ok(
        Math.abs(histDefault("cDryG") - eqDry) < 1e-6,
        `cDryG History default ${histDefault("cDryG")} must equal the equal-power gain at Mix=50% (${eqDry})`
    );
});

// --- Bug D8: Undo does not restore stage-enable toggles made from the face ---
// src/degrade_ui.js: onclick() calls pushUndoState() for every pill click,
// including a click on the power-LED dot that toggles stageEnabled[stId], and
// comment/test conventions treat that push as the undo snapshot for the click.
// But cloneState() captures only { order, vizMode, selectedStage } - not
// stageEnabled - so undo() after an LED toggle restores an identical snapshot
// and the toggle silently survives the undo (while still consuming a redo
// slot). ondblclick() toggles the same state with no undo push at all.
check("D8 undo-restores-stage-enable-toggle", () => {
    const uiSrc = ["degrade_config.js", "degrade_dsp.js", "degrade_ui.js"]
        .map((f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8"))
        .join("\n");
    const emitted = [];
    const sandbox = {
        Math, Number, Array, Object, console,
        mgraphics: {
            size: [220, 136], relative_coords: 1, autofill: 1,
            init() {}, redraw() {},
            set_source_rgba() {}, set_line_width() {},
            rectangle() {}, rectangle_rounded() {},
            move_to() {}, line_to() {}, arc() {}, close_path() {},
            fill() {}, stroke() {}, select_font_face() {}, set_font_size() {}, show_text() {},
        },
        outlet(idx, ...args) { emitted.push({ idx, args }); },
        notifyclients() {},
    };
    vm.createContext(sandbox);
    vm.runInContext(uiSrc, sandbox);

    assert.strictEqual(sandbox.stageEnabled[0], 0, "premise: stage 0 starts disabled");
    sandbox.onclick(9, 12); // pill 0 power-LED dot (slot 0 pill starts at x=4, LED zone is x-px <= 11)
    assert.strictEqual(sandbox.stageEnabled[0], 1, "premise: LED click toggles stage 0 on");
    assert.ok(
        emitted.some((e) => e.args[0] === "toggle" && e.args[1] === "bit" && e.args[2] === 1),
        "premise: LED click emits the toggle outlet message"
    );
    sandbox.undo();
    assert.strictEqual(
        sandbox.stageEnabled[0], 0,
        "undo() after an LED toggle must restore stageEnabled[0] to 0 (the state its own pushUndoState snapshot was taken from)"
    );
});

// --- Bug D9: Codec pre-echo taps overrun the 8192-sample delay lines at high sample rates ---
// src/degrade_core.genexpr: Delay codecDL / codecDR are 8192 samples, but the
// pre-echo reader asks for preDelaySamps = preechoVal * sr * 0.072 and a
// longest tap tapPost = preDelaySamps * 1.35 (with tapE3 at 0.76x and the main
// delL/delR read at 1.0x). At 100% Pre-Echo the longest tap exceeds the delay
// line whenever sr > 8192 / (0.072 * 1.35) ~= 84.3 kHz, so at 88.2 / 96 /
// 176.4 / 192 kHz the tap cannot read the sample it asks for and the pre-echo
// smear uses aliased/wrong history instead of the documented 72 ms lookahead
// cloud (the header promises up to 72 ms; the comment at the tap block says
// taps span the 72 ms window).
check("D9 codec-preecho-taps-fit-delay-line", () => {
    const delayMatch = gen.match(/Delay codecDL\((\d+)\)/);
    assert.ok(delayMatch, "missing Delay codecDL declaration");
    const delaySize = Number(delayMatch[1]);
    assert.ok(gen.includes("preDelaySamps = preechoVal * sr * 0.072"), "premise: base pre-echo delay is preecho * sr * 0.072");
    assert.ok(gen.includes("tapPost = preDelaySamps * 1.35"), "premise: longest smear tap is 1.35x the base delay");
    const maxTap192k = Math.ceil(1.0 * 192000 * 0.072 * 1.35); // 18663 samples
    assert.ok(
        delaySize >= maxTap192k,
        `codecDL holds ${delaySize} samples but the longest pre-echo tap at 192 kHz / 100% Pre-Echo requests ${maxTap192k} samples`
    );
});

if (failures.length > 0) {
    console.log(`\n${failures.length} red check(s): ${failures.map((f) => f.name).join(", ")}`);
    assert.strictEqual(failures.length, 0, "Degrade bugsweep Pass 1: all checks must pass once the bugs are fixed");
}
console.log("All Degrade bugsweep Pass 1 checks passed!");
