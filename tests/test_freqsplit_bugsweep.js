#!/usr/bin/env node
"use strict";
/**
 * Freq Split bug sweep — reviewed reds (pass 2).
 *
 * Kept / rewritten after review:
 *
 * 1) Mix dry share consistency (rewritten direction).
 *    Shipped gen (spectral_split_rack_main.genexpr) and Loud Split correctly use
 *    role-gated kShare: standalone (role SELF/0) single-channel keeps full dry.
 *    Stale are fsDryShare(sel-only -> 1/4) and tests/test_freqsplit.js asserting
 *    `kShare = selH > 0.5 ? 0.25 : 1;`. Fix updates the reference + suite, not the gen.
 *
 * 2) Limiter paint vs hit / grab jump (kept).
 *    fvLimLabel clamps handle py into the plot; fvHit tests unclamped fvLimY();
 *    fvDragTo clamps to plot dB range on mousedown, so out-of-plot thresholds jump.
 *
 * 3) Invisible limiter steals hits while limon=0 (added).
 *    fvPaintLimiter returns early when off, but fvHit still returns "limiter"
 *    within 4px of fvLimY(), stealing Spin / plot gestures (default limthr=0).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "freqsplit_config.js"));
const { builderGen } = require("./minify_gen.js");
const { makeRecorder, loadFace } = require("./paint_bounds_lib.js");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log("[bugsweep] ok: " + name);
    } catch (e) {
        failures++;
        console.log("[bugsweep] RED: " + name + "\n    " + String(e && e.message ? e.message : e).split("\n").join("\n    "));
    }
}

// ----------------------------------------------------------------------
// Bug 1 (rewritten): reference + suite must match role-gated gen
// ----------------------------------------------------------------------
check("mix dry share: fsDryShare and suite agree with role-gated gen", () => {
    const GEN_CODE = builderGen("build_freqsplit");
    const kLine = (GEN_CODE.match(/kShare = [^;]+;/) || ["<none>"])[0];
    assert.ok(
        /kShare = \(selH > 0\.5 && roleH > 0\.5\) \?/.test(kLine),
        "shipped gen keeps role-gated kShare (loudsplit contract); got " + kLine
    );
    const refFn = (read("src/freqsplit_config.js").match(/function fsDryShare[\s\S]*?\n\}/) || [""])[0];
    assert.ok(
        /role/i.test(refFn),
        "fsDryShare must account for rack role (standalone single-channel keeps full dry; got sel-only helper)"
    );
    const suite = read("tests/test_freqsplit.js");
    assert.ok(
        !suite.includes("kShare = selH > 0.5 ? 0.25 : 1;"),
        "test_freqsplit.js must not demand the obsolete selH-only kShare form"
    );
});

// ----------------------------------------------------------------------
// Bug 2: limiter paint vs hit / grab jump
// ----------------------------------------------------------------------
const header = 'var GEN_DSP_TEXT = ""; var GEN_DSP_HASH = "test"; var SS_PREFIX = "freqsplit";';
const faceCode = [header, read("src/freqsplit_config.js").trimEnd(), read("src/spectral_link.js").trimEnd(),
    read("src/spectral_theme.js").trimEnd(), read("src/spectral_dsp.js").trimEnd(), read("src/freqsplit_ui.js")].join("\n\n");
const vmGet = (sb, name) => require("vm").runInContext(name, sb);
function loadMainFace() {
    const rec = makeRecorder(328, 100);
    const outs = [];
    const sb = loadFace(faceCode, rec, { outlet() { outs.push(Array.from(arguments)); } });
    return { sb, outs, PL: vmGet(sb, "FV_PLOT") };
}

check("limiter handle at -120 dB is grabbable at its painted position", () => {
    const { sb, PL } = loadMainFace();
    sb.set_limon(1);
    sb.set_limthr(-120);
    const lb = sb.fvLimLabel();
    assert.ok(lb, "limiter label geometry exists while the limiter is on");
    sb.onclick(PL.x + PL.w - 9, lb.py);
    assert.ok(sb.fvDrag && sb.fvDrag.kind === "limiter",
        `clicking the painted limiter handle at limthr -120 starts a limiter drag (got drag kind: ${sb.fvDrag && sb.fvDrag.kind})`);
});

check("grabbing the limiter line at +12 dB does not jump the threshold", () => {
    const { sb, outs, PL } = loadMainFace();
    sb.set_limon(1);
    sb.set_limthr(12);
    outs.length = 0;
    sb.onclick(PL.x + 10, sb.fvLimY());
    const edits = outs.filter((a) => a[1] === "limthr");
    assert.strictEqual(edits.length, 0,
        `grabbing the limiter line at +12 dB emits no limthr edit (got ${JSON.stringify(edits)})`);
});

// ----------------------------------------------------------------------
// Bug 3: invisible limiter hit-steal while limon=0
// ----------------------------------------------------------------------
check("limon=0: invisible limiter does not steal plot hits", () => {
    const { sb, PL } = loadMainFace();
    sb.set_limon(0);
    sb.set_limthr(0);
    sb.set_bend(0);
    sb.set_pinch(0);
    const midX = PL.x + PL.w * 0.5;
    const y = sb.fvLimY();
    assert.ok(y > PL.y && y < PL.y + PL.h, "fvLimY for limthr=0 sits inside the plot");
    assert.strictEqual(
        sb.fvHit(midX, y),
        "plot",
        "limon=0: hit at threshold Y must be plot (Spin), not invisible limiter"
    );
});

assert.strictEqual(failures, 0, failures + " bugsweep check(s) red");
console.log("test_freqsplit_bugsweep: ok");
