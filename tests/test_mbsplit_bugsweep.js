#!/usr/bin/env node
/**
 * Bugsweep Pass 1 RED tests for devices/Multiband Split.amxd (bug hunt, tests only).
 *
 * Each check below pins a NEW defect found in this pass, distinct from the two
 * defects already covered by tests/test_mbsplit_pass1.js (volume-slider mapping
 * and FIR display tolerance — both already fixed on this baseline).
 * Every check FAILS on the current tree for the stated reason and must pass
 * once the defect is fixed in Pass 3. No production code is changed by this file.
 *
 * Defect 1 (config): resolveEffectiveBandMask Auto Chain clamps the chain index
 *   to the last band instead of wrapping (chainIndex % numBands) as documented.
 * Defect 2 (UI): a volume double-click is handled twice (onclick 320 ms branch
 *   AND ondblclick); the second handler pushes an undo snapshot taken AFTER the
 *   reset, so the first undo() after the gesture is a no-op.
 * Defect 3 (UI): snapshotState / applySnapshot do not save manualBandsOverride,
 *   so undoing back to a manual band count is reverted by auto-detection.
 * Defect 4 (UI): onidle tracks hoverBandIdx for the band pills and redraws on
 *   change, but paint() always passes hot=false for the pills, so the pill
 *   hover highlight is never rendered.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "mbsplit_core.genexpr");
const CONFIG_PATH = path.join(ROOT, "src", "mbsplit_config.js");
const UI_PATH = path.join(ROOT, "src", "mbsplit_ui.js");
const DSP_PATH = path.join(ROOT, "src", "mbsplit_dsp.js");

const cfg = require(CONFIG_PATH);

const failures = [];
function check(name, fn) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (err) {
        failures.push(name + ": " + err.message);
        console.log("FAIL " + name + ": " + err.message);
    }
}

// ---------------------------------------------------------------------------
// UI instance harness — same vm + mock pattern as tests/test_mbsplit.js,
// with a fresh shared bus per instance so checks stay isolated.
// ---------------------------------------------------------------------------
const combinedCode = fs.readFileSync(CONFIG_PATH, "utf8") + "\n\n" + fs.readFileSync(path.join(ROOT, "src", "spectral_theme.js"), "utf8") +
    "\n\nvar GEN_DSP_TEXT = \"{}\";\nvar GEN_DSP_HASH = \"test\";\n" + fs.readFileSync(DSP_PATH, "utf8") + "\n\n" + fs.readFileSync(UI_PATH, "utf8");
const sawRing8192 = cfg.synthesizeSawWave8192(110.0, 48000.0);

function createUiInstance(lomPath) {
    const sharedBus = { groups: {}, peers: {} };
    const emitted0 = [];
    const emitted1 = [];
    const drawCmds = [];
    const sandbox = {
        Math: Math,
        Date: Date,
        Number: Number,
        String: String,
        Boolean: Boolean,
        Array: Array,
        Object: Object,
        parseInt: parseInt,
        isNaN: isNaN,
        liveLomPath: lomPath || "",
        cursorHiddenCount: 0,
        cursorShownCount: 0,
        max: {
            hidecursor: function() { sandbox.cursorHiddenCount++; },
            showcursor: function() { sandbox.cursorShownCount++; }
        },
        global: { __mbsplit_shared_bus: sharedBus },
        Global: function() { return sharedBus; },
        LiveAPI: function(cb, target) {
            const t = (typeof cb === "string" && target === undefined) ? cb : target;
            if (t === "this_device") {
                this.path = sandbox.liveLomPath;
                this.id = sandbox.liveLomPath ? "42" : "0";
            } else {
                this.path = t || "";
                this.id = this.path ? "10" : "0";
            }
        },
        Buffer: function() {
            this.peek = function(_ch, offset, count) {
                if (offset === 32 && count === 8192) {
                    return sawRing8192;
                }
                return [
                    0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.25, 0.2,
                    0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03,
                    0.45, 0.52, 0.31, 0.18, 0.65, 0.52, 2, 10, 0, 48000, sandbox.mockFirD, 0
                ];
            };
        },
        Task: function(fn) {
            this.interval = 40;
            this.repeat = function() {};
        },
        mgraphics: {
            size: [256, 136],
            relative_coords: 1,
            autofill: 1,
            init: function() {},
            redraw: function() { sandbox.paint(); },
            set_source_rgba: function(r, g, b, a) { drawCmds.push({ op: "rgba", r, g, b, a }); },
            set_line_width: function(w) { drawCmds.push({ op: "lw", w }); },
            rectangle: function(x, y, w, h) { drawCmds.push({ op: "rect", x, y, w, h }); },
            rectangle_rounded: function(x, y, w, h, rx, ry) { drawCmds.push({ op: "rrect", x, y, w, h }); },
            move_to: function(x, y) { drawCmds.push({ op: "move", x, y }); },
            line_to: function(x, y) { drawCmds.push({ op: "line", x, y }); },
            close_path: function() { drawCmds.push({ op: "close" }); },
            arc: function(x, y, r, a1, a2) { drawCmds.push({ op: "arc", x, y, r }); },
            fill: function() { drawCmds.push({ op: "fill" }); },
            stroke: function() { drawCmds.push({ op: "stroke" }); },
            select_font_face: function(f) {},
            set_font_size: function(s) {},
            text_measure: function(t) { return [String(t).length * 5, 9]; },
            show_text: function(t) { drawCmds.push({ op: "text", text: t }); }
        },
        inlets: 1,
        outlets: 2,
        outlet: function(idx, msg) {
            if (idx === 0) emitted0.push(msg);
            else emitted1.push(msg);
        },
        notifyclients: function() { sandbox.notified = (sandbox.notified || 0) + 1; },
        patcher: {
            latency: 0,
            setattr: function(k, v) { if (k === "latency") sandbox.patcher.latency = v; }
        },
        mockFirD: 128
    };
    vm.createContext(sandbox);
    vm.runInContext(combinedCode, sandbox);
    sandbox.setbuffer("---mbsplitscope");
    sandbox.TOPO_INTERVAL_MS = 0;
    sandbox.loadbang();
    sandbox.emitted0 = emitted0;
    sandbox.emitted1 = emitted1;
    sandbox.drawCmds = drawCmds;
    return sandbox;
}

// ---------------------------------------------------------------------------
// Defect 1 — Auto Chain mask must wrap, not clamp.
// Header contract in src/mbsplit_config.js (resolveEffectiveBandMask):
//   bandMode 0 = Auto Chain "solos Band (chainIndex % numBands) + 1".
// The code clamps the index to numBands - 1, so every chain at or past the
// last band piles onto the last band instead of wrapping around.
// ---------------------------------------------------------------------------
check("Auto Chain band mask wraps with chainIndex % numBands (defect: resolveEffectiveBandMask clamps to the last band instead of wrapping)", function () {
    // In-range behaviour is correct today and must stay.
    assert.strictEqual(cfg.resolveEffectiveBandMask(0, 0, 1, 1), 1);
    assert.strictEqual(cfg.resolveEffectiveBandMask(0, 1, 3, 1), 2);
    assert.strictEqual(cfg.resolveEffectiveBandMask(0, 2, 3, 1), 4);
    assert.strictEqual(cfg.resolveEffectiveBandMask(0, 3, 4, 1), 8);
    const bad = [];
    const cases = [
        // [chainIndex, numBands, expectedMask per the documented modulo rule]
        [3, 3, 1], // (3 % 3) + 1 = Band 1
        [4, 3, 2], // (4 % 3) + 1 = Band 2
        [5, 4, 2], // (5 % 4) + 1 = Band 2
        [6, 2, 1]  // (6 % 2) + 1 = Band 1
    ];
    for (const c of cases) {
        const got = cfg.resolveEffectiveBandMask(0, c[0], c[1], 1);
        if (got !== c[2]) bad.push("chainIndex " + c[0] + " / numBands " + c[1] + " -> mask " + got + " (documented wrap gives " + c[2] + ")");
    }
    assert.deepStrictEqual(bad, [], "Auto Chain mask does not wrap: " + bad.join("; "));
});

// ---------------------------------------------------------------------------
// Defect 2 — one undo after a volume double-click must restore the old gain.
// Max delivers a double-click as onclick, onclick, ondblclick (the sequence
// onclick's own 320 ms lastClickTarget/lastClickTime detection is built for).
// Both the onclick branch and ondblclick reset the gain AND pushUndoState();
// the ondblclick snapshot is taken after the reset, so it lands on top of the
// undo stack and the first undo() reapplies the reset state (a no-op).
// ---------------------------------------------------------------------------
check("one undo after a volume double-click reset restores the pre-gesture gain (defect: double-click handled twice, post-reset snapshot tops the undo stack)", function () {
    const inst = createUiInstance("live_set tracks 0 devices 0");
    inst.set_gain(12.0);
    assert.strictEqual(inst.curGainDb, 12.0);
    const vr = inst.getVolumeSliderRect();
    const x = vr[0] + 10;
    const y = vr[1] + 7;
    inst.onclick(x, y, 1, 0, 0);
    inst.onclick(x, y, 1, 0, 0);
    inst.ondblclick(x, y);
    assert.strictEqual(inst.curGainDb, 0.0, "double-click must reset the gain to 0 dB");
    inst.undo();
    assert.strictEqual(
        inst.curGainDb,
        12.0,
        "first undo after the double-click reset must restore 12.0 dB, got " + inst.curGainDb +
            " dB (the top undo snapshot was taken after the reset, so undo is a no-op)"
    );
});

// ---------------------------------------------------------------------------
// Defect 3 — undo must restore a manual band count durably.
// snapshotState() saves numBands but not manualBandsOverride; applySnapshot()
// therefore restores the number without the override that makes it stick, and
// auto-detection (next topology poll / the broadcast inside applySnapshot
// itself) immediately recomputes the detected count over the restored one.
// ---------------------------------------------------------------------------
check("undo restores a manual band count durably (defect: undo snapshot drops manualBandsOverride, auto-detection reverts the undo)", function () {
    const inst = createUiInstance("live_set tracks 0 devices 0");
    inst.set_numbands(4);
    assert.strictEqual(inst.curNumBands, 4);
    assert.strictEqual(inst.manualBandsOverride, 4);
    inst.pushUndoState(); // a mouse gesture snapshots this state
    inst.set_numbands(0); // back to Auto (lone instance detects 1 band)
    assert.strictEqual(inst.curNumBands, 1);
    inst.undo();
    inst.pullScope(); // one topology poll, as happens every 250 ms in Live
    assert.strictEqual(
        inst.manualBandsOverride,
        4,
        "undo must restore manualBandsOverride = 4, got " + inst.manualBandsOverride +
            " (snapshotState/applySnapshot never save or restore it)"
    );
    assert.strictEqual(inst.curNumBands, 4, "undone manual band count must survive auto-detection, got " + inst.curNumBands);
});

// ---------------------------------------------------------------------------
// Defect 4 — hovering a band pill must highlight it.
// onidle() maintains hoverBandIdx and forces a redraw when it changes, and
// every other hoverable control (Auto button, volume slider, link badge,
// crossover handles) renders its hover state — but paint() calls mbControl()
// for the band pills with the hot argument hard-coded to false, so the pill
// hover state is computed, triggers redraws, and is never drawn.
// ---------------------------------------------------------------------------
check("paint renders the band-pill hover highlight (defect: hoverBandIdx is tracked but paint always passes hot=false for the pills)", function () {
    const inst = createUiInstance("live_set tracks 0 devices 0");
    inst.set_numbands(3); // three pills; in Auto (chain rank 0) pills 2 and 3 are off
    inst.hoverBandIdx = -1;
    inst.drawCmds.length = 0;
    inst.paint();
    const plain = inst.drawCmds.slice();
    inst.hoverBandIdx = 2; // hover the (off) Band 3 pill
    inst.drawCmds.length = 0;
    inst.paint();
    const hovered = inst.drawCmds.slice();
    inst.hoverBandIdx = -1;
    assert.notDeepStrictEqual(
        hovered,
        plain,
        "hovering band pill 3 produced a byte-identical paint to no hover: the pill hover highlight is never rendered"
    );
});

if (failures.length) {
    console.error("\n" + failures.length + " bugsweep red test(s) failing:");
    for (const f of failures) console.error(" - " + f);
    process.exit(1);
}
console.log("\nAll bugsweep tests passed.");
