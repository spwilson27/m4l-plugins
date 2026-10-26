// Delay+ bugsweep reds (Pass 1). Pure-Node cases that fail on baseline 69699f7 and
// should pass once the MIDI notedial Fine (cents) contract is finished.
// Run: node tests/test_delayplus_bugsweep.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
let failures = 0;
let passes = 0;

function test(name, fn) {
    try {
        fn();
        passes++;
        console.log("PASS " + name);
    } catch (err) {
        failures++;
        console.log("FAIL " + name + ": " + err.message);
    }
}

test("MIDI notedial paint shows Fine (ndCents) with the note name", () => {
    // File contract (src/delayplus_notedial.js): set_cents_<side> is "the side's fine tune,
    // shown with the note". anything() stores ndCents and redraws, but paint() only draws
    // dpNoteName(ndNote) / "MIDI" — Fine never appears. Without this, MIDI mode hides the
    // cents offset that Pitch mode shows on the Note dial row.
    const src = fs.readFileSync(path.join(ROOT, "src", "delayplus_notedial.js"), "utf8");
    assert(/var\s+ndCents\b/.test(src), "ndCents state missing");
    assert(/set_cents_/.test(src), "set_cents_ handler missing");
    const paintStart = src.indexOf("function paint");
    const paintEnd = src.indexOf("function onclick");
    assert(paintStart >= 0 && paintEnd > paintStart, "paint()/onclick() bounds");
    const paint = src.slice(paintStart, paintEnd);
    assert(
        /\bndCents\b/.test(paint),
        "paint() must use ndCents so Fine is shown with the note (e.g. A2 +12)"
    );
});

test("layout/build routes Fine (cents) into the MIDI notedial as set_cents_<side>", () => {
    // Repo-wide, set_cents_ exists only inside notedial.js today: echo.py wires
    // obj-midi-note -> obj-notedial-<side> but never prepends Fine (obj-ctrl-cents_*) into
    // the notedial. Without that route, ndCents stays 0 even after paint is fixed.
    const blobs = [
        path.join(ROOT, "scripts", "delayplus_layouts", "echo.py"),
        path.join(ROOT, "scripts", "build_delayplus.py"),
    ].map((p) => fs.readFileSync(p, "utf8"));
    const blob = blobs.join("\n");
    assert(
        /set_cents_/.test(blob),
        "Fine must be prepended as set_cents_<side> into obj-notedial (shown with the note)"
    );
});

test("Delay+ End own xfer buffer is RING-sized (65536), not 64", () => {
    // build_end (scripts/build_delayplus.py) declares End local xfer buffer at 64 samples, but
    // both gen cores wrap xfer indices at RING=65536 (End: wi/di = wrap(cn, 0, RING), poke/peek
    // xfer ch0-3) and Start xfer is @samps 65536. Until the link binds End gen to Start xfer
    // (and whenever Start is missing), End gen pokes/peeks its 64-sample buffer at indices up
    // to 65535, so the dry read and the feedback return are out of range / broken.
    const build = fs.readFileSync(path.join(ROOT, "scripts", "build_delayplus.py"), "utf8");
    const endStart = build.indexOf("def build_end");
    assert(endStart >= 0, "build_end missing");
    const m = build.slice(endStart).match(/buffer~ ---dpxferE @samps ([^ ]+)/);
    assert(m, "End obj-buf-xfer line missing");
    assert(m[1] === "{RING}" || m[1] === "65536",
        "End xfer must be RING (65536) like Start, got @samps " + m[1]);
});

test("LFO display Noise shape holds one value per cycle, like the gen", () => {
    // Gen: lfoshape_val shape 5 returns lfoNz, re-rolled only when the phase wraps
    // (delayplus_start.genexpr: if (lfo < lfoWrapL) lfoNzL = noise();) — one held random
    // value per cycle. The display lfoWave (src/delayplus_lfo.js) instead returns
    // lfoHash(Math.floor(p * 4)): four different steps per cycle, so the Modulation page
    // shows modulation that never happens.
    const src = fs.readFileSync(path.join(ROOT, "src", "delayplus_lfo.js"), "utf8");
    const start = src.indexOf("function lfoWave");
    const end = src.indexOf("function lfoAmp");
    assert(start >= 0 && end > start, "lfoWave()/lfoAmp() bounds");
    const wave = src.slice(start, end);
    assert(!/Math\.floor\(p \* 4\)/.test(wave),
        "lfoWave Noise must not step 4x per cycle (gen holds one value per cycle)");
    assert(/lfoHash\(Math\.floor\(p\)\)/.test(wave),
        "lfoWave Noise should hash the cycle index: lfoHash(Math.floor(p))");
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
