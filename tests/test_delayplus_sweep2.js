// Delay+ sweep 2 red tests (lane delayplus). Run: node tests/test_delayplus_sweep2.js
const assert = require("assert");
const C = require("../src/delayplus_config.js");
let failed = 0;
function test(id, name, fn) {
    try { fn(); console.log("PASS " + id + " " + name); } catch (e) { failed++; console.log("FAIL " + id + " " + name + ": " + e.message); }
}

// DP-S2-01 (S3): the tank is DP_TANK = 524288 samples, but the face's range warning (and dpSideMs) assume a
// fixed 8000 ms. At 96 kHz the tank holds 5.46 s, at 192 kHz 2.73 s: a Sync time of 5.6 s is clamped by the gen
// (tmax = TANK - 8) with no "MAX x" warning on the face.
test("DP-S2-01", "Sync warning knows the tank length at 96 kHz (5.6 s does not fit 524288 samples)", () => {
    const side = { tmode: C.DP_TM.SYNC, div: C.DP_DIV_NAMES.indexOf("1"), mult: 2.8, offs: 0 }; // 4 beats x 2.8 = 5600 ms at 120 bpm
    const w = C.dpSideWarn(side, 120, { tminMs: 20, sr: 96000 });
    assert(w && /^MAX x/.test(w), "expected a MAX warning at 96 kHz, got " + w);
    // and it must still be silent at 48 kHz (10.9 s tank)
    assert.strictEqual(C.dpSideWarn(side, 120, { tminMs: 20, sr: 48000 }), null);
});

test("DP-S2-01b", "dpSideMs clamps to the tank at 96 kHz", () => {
    const side = { tmode: C.DP_TM.SYNC, div: C.DP_DIV_NAMES.indexOf("1"), mult: 2.8, offs: 0 };
    const ms = C.dpSideMs(side, 120, { tminMs: 20, sr: 96000 });
    assert(ms <= (524288 - 8) / 96000 * 1000 + 1e-6, "time " + ms + " ms exceeds what the 524288-sample tank holds at 96 kHz");
});

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
