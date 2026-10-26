// Delay+ bug-sweep tests (Pass 1: red tests only, no fixes).
// Each test fails because of the bug named in it; see BUGS.md at the worktree root.
// Run: node tests/test_delayplus_bugsweep.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

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

// The Filter Display scripts as the build concatenates them (config + spectrum), in a vm
// context like tests/test_delayplus.js's loadFilterDisplay, minus the filter display itself.
function loadSpectrum() {
    const ctx = { Math, Number, String, Array, JSON, isNaN };
    vm.createContext(ctx);
    const src = ["delayplus_config.js", "delayplus_spectrum.js"]
        .map((f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8")).join("\n");
    vm.runInContext(src, ctx);
    return ctx;
}

// dB bins of a perfectly flat spectrum: a single impulse at the centre of the Hann window
// (window value ~1 there) has the same magnitude at every bin, so every difference between
// neighbouring bins is the tilt's doing, not the signal's.
function flatDb(sr) {
    const S = loadSpectrum();
    const frame = new Array(S.DP_FFT_N).fill(0);
    frame[S.DP_FFT_N / 2] = 1;
    return { db: S.dpFftDbBins(frame, sr), n: S.DP_FFT_N };
}

// ---- Bug 1: the spectrogram tilt steps down ~4.3 dB at 60 Hz --------------------------------
// src/delayplus_spectrum.js: `tilt = f > 60 ? 2.2 * Math.log(f / 250) / Math.LN2 : 0`.
// log(60 / 250) is not 0, so the tilt jumps from 0 dB at 60 Hz to about -4.5 dB just above it
// (one FFT bin at 48 kHz: -4.30 dB), instead of starting at its 250 Hz pivot. A "gentle pink
// tilt" (the function's own doc) must be continuous: with a flat input spectrum, no two
// neighbouring bins may differ by anything like that step.
test("spectrum tilt: no step at 60 Hz (flat spectrum, neighbouring bins within 1 dB)", () => {
    for (const sr of [48000, 44100]) {
        const { db, n } = flatDb(sr);
        let worst = 0, worstK = -1;
        for (let k = 2; k <= 120; k++) {
            const step = Math.abs(db[k] - db[k - 1]);
            if (step > worst) { worst = step; worstK = k; }
        }
        assert(worst <= 1.0,
            `sr ${sr}: worst neighbouring-bin step ${worst.toFixed(2)} dB at bin ${worstK} (${(worstK * sr / n).toFixed(1)} Hz)`);
    }
});

// The same wrong pivot also sinks the whole 60..250 Hz band below the un-tilted level (down to
// -4.5 dB just above 60 Hz, climbing back to 0 dB only at 250 Hz): a dip, not a tilt. Bins in
// that band must read at the low band's level or above (the tilt only ever lifts the top end).
test("spectrum tilt: 60..250 Hz band is not dipped below the low band", () => {
    for (const sr of [48000, 44100]) {
        const { db, n } = flatDb(sr);
        const ref = db[8]; // ~47 Hz at 48k: below the tilt threshold, the flat level itself
        let low = 0, lowK = -1;
        for (let k = 1; k < db.length; k++) {
            const f = k * sr / n;
            if (f > 60 && f <= 250 && db[k] - ref < low) { low = db[k] - ref; lowK = k; }
        }
        assert(low >= -0.5,
            `sr ${sr}: band dips ${low.toFixed(2)} dB below the low band at bin ${lowK} (${(lowK * sr / n).toFixed(1)} Hz)`);
    }
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
