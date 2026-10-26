#!/usr/bin/env node
"use strict";
// Sand bug sweep — pass 1 red tests. Each test fails BECAUSE of the bug it
// names (see BUGS.md). No src/ fixes belong in this pass.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const gen = fs.readFileSync(path.join(ROOT, "src", "sand_core.genexpr"), "utf8");
const uiCode = fs.readFileSync(path.join(ROOT, "src", "sand_ui.js"), "utf8");

const failures = [];
function test(name, fn) {
    try {
        fn();
        console.log("[bugsweep] PASS " + name);
    } catch (err) {
        failures.push(name + ": " + err.message);
        console.log("[bugsweep] FAIL " + name + " — " + err.message);
    }
}

// --- UI harness (same mocking style as tests/test_sand.js) -----------------
function makeUi(extra) {
    const mg = {
        size: [192, 114], relative_coords: 1, autofill: 1,
        init() {}, redraw() {}, set_source_rgba() {}, set_line_width() {},
        rectangle() {}, rectangle_rounded() {}, arc() {}, close_path() {},
        fill() {}, stroke() {}, move_to() {}, line_to() {},
        select_font_face() {}, set_font_size() {}, show_text() {},
    };
    const sent = [];
    const mockOutlet = (idx, msg) => sent.push([idx, msg]);
    const opts = Object.assign({ Buffer: undefined, Task: undefined }, extra || {});
    const fn = new Function(
        "mgraphics", "inlets", "outlets", "outlet", "Buffer", "Task",
        uiCode + "\nreturn { set_amount, set_soft, set_debrick, set_stages, set_outmode, compandEval, sandDspResend, setbuffer, pullWave, getLeft: () => left };"
    );
    const ui = fn(mg, 1, 2, mockOutlet, opts.Buffer, opts.Task);
    return { ui, sent };
}

// --- Bug 1: set_outmode clamps to 0..3, but only modes 0..2 exist ----------
test("set_outmode clamps to the three real output modes (0..2)", () => {
    const { ui, sent } = makeUi();
    ui.set_outmode(99);
    ui.sandDspResend();
    const om = sent.filter(([i, m]) => i === 1 && m[0] === "outmode");
    assert.ok(om.length, "DSP resend should send outmode");
    assert.strictEqual(om[om.length - 1][1][1], 2,
        "outmode resend must clamp to Limit (2); the gen, the Out enum (Off/Hard/Limit) and the UI comment all define only 0..2");
});

// --- Bug 2: compandEval does not model the gen compand() -------------------
// Gen steady state for a constant input: the envelope settles to |x|, so
// quiet = knee / (knee + |x|) and g = 1 + (maxG - 1) * quiet, per stage.
function mix(a, b, t) { return a + (b - a) * t; }
function clip(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function genStage(x, amountDb, soft01, brick01) {
    const maxG = Math.exp(clip(amountDb / 140, 0, 1) * 16.11809565095832);
    const knee = mix(0.03, 0.45, soft01);
    const quiet = knee / Math.max(knee + Math.abs(x), 1e-8);
    const y = x * (1 + (maxG - 1) * quiet);
    const shaped = mix(clip(y, -1.2, 1.2), Math.tanh(y), soft01);
    const mild = Math.tanh(x * mix(8, 1.5, soft01));
    return mix(shaped, mild, clip(brick01, 0, 1));
}
function genEval(x, amt, softPct, brickPct, stages) {
    let v = x;
    for (let s = 0; s < stages; s++) v = genStage(v, amt, softPct / 100, brickPct / 100);
    return v;
}
test("transfer curve (compandEval) matches the gen compand steady state", () => {
    const { ui } = makeUi();
    const cases = [
        [0.01, 140, 35, 0, 1], // quiet input at max Amount: gen lifts it near full scale
        [0.2, 18, 35, 0, 1],
        [0.5, 60, 0, 0, 1],    // Soft 0: gen hard path clips at 1.2, not 1.0
        [0.1, 80, 50, 0, 2],
    ];
    for (const [x, amt, soft, brick, stg] of cases) {
        ui.set_amount(amt); ui.set_soft(soft); ui.set_debrick(brick); ui.set_stages(stg);
        const want = genEval(x, amt, soft, brick, stg);
        const got = ui.compandEval(x);
        assert.ok(Math.abs(got - want) < 0.05,
            "x=" + x + " amount=" + amt + " soft=" + soft + " stages=" + stg +
            ": gen compand gives " + want.toFixed(3) + " but the scope transfer curve draws " + got.toFixed(3));
    }
});

// --- Bug 3: scope ring read starts on the newest frame ---------------------
// Gen pokes the frame at wpos, THEN pokes that same wpos into frame 259,
// THEN increments wpos (sand_core.genexpr hop block). So frame 259 holds the
// LAST WRITTEN index; the oldest frame in the ring is (259-value + 1) & 127.
test("scope ring starts at the oldest frame, not the last written one", () => {
    const ringL = new Array(260).fill(0);
    const ringR = new Array(256).fill(0);
    for (let i = 0; i < 128; i++) { ringL[i] = i / 1000; ringR[i] = i / 1000; }
    ringL[259] = 5; // last written frame index = 5, so oldest = 6
    function MockBuffer() { return { peek(ch, start, count) { return (ch === 1 ? ringL : ringR).slice(start, start + count); } }; }
    function MockTask() { return { interval: 0, repeat() {}, schedule() {} }; }
    const { ui } = makeUi({ Buffer: MockBuffer, Task: MockTask });
    ui.setbuffer("mockwave");
    ui.pullWave();
    const left = ui.getLeft();
    assert.ok(Math.abs(left[0] - 0.006) < 1e-9 && Math.abs(left[1] - 0.007) < 1e-9,
        "first drawn frames should be the oldest (6, 7, ...); got " +
        left.slice(0, 3).map((v) => Math.round(v * 1000)).join(", ") +
        " — the trace starts on the newest frame and then jumps back 127 frames");
});

// --- Bug 4: inactive derivative stages keep stale History ------------------
// In channel(), pN (previous input) and qN (startup guard) are only touched
// inside `if (ord > N - 0.5)`. Drop Order from 15 to 1 and raise it again and
// every reactivated stage differentiates against a sample from before the
// drop (qN is already 1, so the guard does not suppress it): a one-sample
// click per stage, cascaded and then companded. A stage must refresh pN or
// re-arm qN while it is inactive.
test("inactive derivative stages refresh or re-guard their history", () => {
    const chan = gen.slice(gen.indexOf("\nchannel("), gen.indexOf("\nBuffer "));
    for (let n = 2; n <= 15; n++) {
        const re = new RegExp("if \\(ord > " + (n - 0.5) + "\\) \\{[^}]*\\} else \\{[^}]*[pq]" + n + "\\b");
        assert.ok(re.test(chan),
            "stage " + n + " has no else path refreshing p" + n + "/q" + n +
            " while ord <= " + (n - 1) + "; its History goes stale");
    }
});

if (failures.length) {
    console.log("test_sand_bugsweep: " + failures.length + " failing");
    process.exit(1);
}
console.log("test_sand_bugsweep: ok");
