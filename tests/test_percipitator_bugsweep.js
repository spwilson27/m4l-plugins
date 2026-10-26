#!/usr/bin/env node
/**
 * Percipitator bug-sweep — Pass 1 RED tests.
 *
 * Each check below documents a suspected REAL bug and is EXPECTED TO FAIL on
 * the pre-fix baseline (that failure is the pass-1 deliverable; fixes are
 * pass 3). Harness mirrors tests/test_percipitator.js: evaluate the same
 * config + ui + dsp concatenation the build embeds in the v8ui, with stubbed
 * Max globals, so no .amxd rebuild is needed to run these.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const readSrc = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const GEN_TEXT = "{\"patcher\":{}}";
const PRELUDE =
    "var GEN_DSP_TEXT = " + JSON.stringify(GEN_TEXT) + ";\n" +
    "var GEN_DSP_HASH = \"0123456789ab\";\n";
const FACE_SRC =
    PRELUDE +
    readSrc("src/percipitator_config.js") + "\n" +
    readSrc("src/percipitator_ui.js") + "\n" +
    readSrc("src/percipitator_dsp.js");

function loadFace() {
    let nowMs = 1000000;
    const frameVal = 7; // scope frame counter never advances: gen never comes up
    const pending = [];
    const emitted = [];
    const sharedGlobal = {};
    const host = {
        genCreates: 0,
        _gen: null,
        getnamed(name) { return name === "pcp_gen" ? this._gen : { name }; },
        newdefault() { this.genCreates++; this._gen = { varname: "" }; return this._gen; },
        connect() {},
        remove() { this._gen = null; },
    };
    const mgraphicsStub = {
        size: [204, 134],
        init() {}, redraw() {},
        set_source_rgba() {}, set_line_width() {}, rectangle() {}, rectangle_rounded() {},
        arc() {}, move_to() {}, line_to() {}, close_path() {}, fill() {}, stroke() {},
        select_font_face() {}, set_font_size() {}, show_text() {},
    };
    function BufferStub(name) { this.name = name; }
    BufferStub.prototype.peek = function (_ch, off, len) {
        if (off === 35) return [frameVal];
        return new Array(len || 1).fill(0);
    };
    BufferStub.prototype.poke = function () {};
    function TaskStub(fn) { this.fn = fn; }
    TaskStub.prototype.schedule = function () { pending.push(this.fn); };
    TaskStub.prototype.repeat = function () {};
    function FileStub(_p, mode) {
        this.isopen = true;
        this.eof = mode === "read" ? GEN_TEXT.length : 0;
    }
    FileStub.prototype.close = function () {};
    FileStub.prototype.writestring = function () {};
    const fakeDate = { now: () => nowMs };
    const fn = new Function(
        "mgraphics", "Buffer", "Task", "outlet", "notifyclients", "Global", "File", "Date",
        FACE_SRC +
        "\nreturn { set_gate, set_vol, getvalueof, setvalueof, volVisualScale, init_dsp, pcpDsp," +
        " gateDb: function () { return curGateDb; } };"
    );
    const api = fn.call(
        { patcher: host },
        mgraphicsStub, BufferStub, TaskStub,
        (_i, msg) => emitted.push(msg), () => {},
        function () { return sharedGlobal; }, FileStub, fakeDate
    );
    return {
        api, host, pending, emitted,
        advance(ms) { nowMs += ms; },
        stepScheduled() { const due = pending.splice(0, pending.length); for (const f of due) f(); },
    };
}

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log("ok   - " + name);
    } catch (e) {
        failures++;
        console.log("FAIL - " + name + ": " + e.message);
    }
}

// Bug 1: gate state saved below -60 dB is silently raised to -60 dB on restore.
// set_gate (ui.js) and the gen core both accept gate down to -66 dB, and
// getvalueof() returns the value verbatim, but setvalueof() clamps the
// restored gate to -60..-6 dB — a save/load round-trip is lossy.
check("gate setvalueof round-trip preserves -63 dB", () => {
    const f = loadFace();
    f.api.set_gate(-63);
    assert.strictEqual(f.api.gateDb(), -63, "sanity: set_gate must store -63 dB");
    const saved = f.api.getvalueof();
    assert.deepStrictEqual(saved, [2, 2741, -63], "sanity: getvalueof must return the stored gate");
    f.api.set_gate(-42);
    f.api.setvalueof(saved);
    assert.strictEqual(f.api.gateDb(), -63,
        "gate round-trip is lossy: saved -63 dB, restored " + f.api.gateDb() + " dB");
});

// Bug 2: volVisualScale is discontinuous at -35.5 dB. Its contract is a
// "smooth visual height multiplier (0 at -36 dB, 1.0 at 0 dB)", but just
// above the -35.5 dB cutoff the pow() branch already yields ~0.13, so the
// bars pop from 0 to 13% height over a 0.2 dB Vol change.
check("volVisualScale is continuous across -35.5 dB", () => {
    const f = loadFace();
    f.api.set_vol(-35.6);
    const below = f.api.volVisualScale();
    f.api.set_vol(-35.4);
    const above = f.api.volVisualScale();
    assert.ok(Math.abs(above - below) <= 0.05,
        "volVisualScale jumps " + below + " -> " + above + " between -35.6 and -35.4 dB");
});

// Bug 3: after the deferred-DSP confirm loop exhausts its retries, the face
// can never load the DSP again. The final timeout branch in
// percipitator_dsp.js sets the error and releases the queue claim but leaves
// pcpDsp.createdAt non-zero (and the dead gen~ in the patcher); both
// pcpDspSchedule() and pcpDspLoad() refuse to run while createdAt is set, so
// even a fresh init_dsp (live.thisdevice) starts no new attempt.
check("init_dsp can retry after final DSP load timeout", () => {
    const f = loadFace();
    f.api.init_dsp();
    f.stepScheduled();            // load attempt 1 created
    assert.strictEqual(f.host.genCreates, 1, "sanity: first load creates one gen~");
    f.advance(3600); f.stepScheduled();  // confirm timeout 1 -> retry, attempt 2
    f.advance(6100); f.stepScheduled();  // confirm timeout 2 -> retry, attempt 3
    assert.strictEqual(f.host.genCreates, 3, "sanity: two retries create three gen~ total");
    f.advance(6100); f.stepScheduled();  // final timeout -> error, no more retries
    assert.strictEqual(f.api.pcpDsp.error, "not running", "sanity: final timeout records the error");
    f.api.init_dsp();             // user/device re-triggers DSP load
    const scheduled = f.pending.length;
    f.stepScheduled();
    assert.ok(scheduled > 0 || f.host.genCreates > 3,
        "DSP load is permanently dead after final timeout: init_dsp scheduled " +
        scheduled + " task(s), gen~ creates still " + f.host.genCreates);
});

console.log("test_percipitator_bugsweep: " + failures + " of 3 checks failing (RED pass 1)");
process.exit(failures ? 1 : 0);
