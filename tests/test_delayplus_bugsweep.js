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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
