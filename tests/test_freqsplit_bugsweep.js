#!/usr/bin/env node
"use strict";
/**
 * Freq Split bug sweep, pass 1 (red tests only, no fixes).
 *
 * Bug 1: the Mix dry share. fsDryShare() in src/freqsplit_config.js is the device reference for the dry
 * share one instance adds: 1 when it outputs everything, 1 / 4 whenever it outputs one channel. The gen
 * the build actually ships (src/spectral_split_rack_main.genexpr, as expanded by scripts/build_freqsplit.py)
 * instead keys the share on the rack ROLE as well as the selection, so a standalone instance (role 0) with
 * Output = Ch 1..4 gets the FULL dry share where the reference says 1 / 4. The two disagree for exactly the
 * standalone single-channel case, and the main suite is already red over it (tests/test_freqsplit.js:619).
 *
 * Bug 2: the limiter handle. The orange T handle is PAINTED at the clamped position fvLimLabel().py (the
 * handle stays inside the plot), but fvHit() hit-tests the limiter against the UNclamped fvLimY(). Near the
 * ends of the threshold range the two are up to 8 px apart, so clicking the painted handle starts a Spin
 * drag instead of grabbing the limiter; and because fvDragTo() clamps to the plot range (-80..+6 dB) rather
 * than the parameter range (-120..+12 dB), merely grabbing the line at an out-of-plot threshold rewrites it
 * (+12 dB becomes +6 dB on mousedown, -120 dB becomes -80 dB).
 *
 * Each check is run and reported independently; the file exits red while any check fails.
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
// Bug 1: gen dry share vs the config reference (standalone single channel)
// ----------------------------------------------------------------------
check("mix dry share: gen matches fsDryShare for standalone single-channel output", () => {
    assert.strictEqual(cfg.fsDryShare(1), 0.25, "reference: one channel -> dry share 1/4");
    assert.strictEqual(cfg.fsDryShare(0), 1, "reference: Output All -> dry share 1");
    const GEN_CODE = builderGen("build_freqsplit");
    assert.ok(
        GEN_CODE.includes("kShare = selH > 0.5 ? 0.25 : 1;"),
        "gen dry share follows the config reference (1/4 whenever one channel is selected); actual gen line: " + (GEN_CODE.match(/kShare = [^;]+;/) || ["<none>"])[0]
    );
});

// ----------------------------------------------------------------------
// Bug 2: limiter handle paint position vs hit position / grab jump
// ----------------------------------------------------------------------
const header = `var GEN_DSP_TEXT = ""; var GEN_DSP_HASH = "test"; var SS_PREFIX = "freqsplit";`;
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

assert.strictEqual(failures, 0, failures + " bugsweep check(s) red");
console.log("test_freqsplit_bugsweep: ok");
