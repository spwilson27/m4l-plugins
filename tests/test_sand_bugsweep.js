#!/usr/bin/env node
"use strict";

/**
 * RED suite for Sand bugsweep (bugsweep/sand).
 * Red on baseline 69699f7; green after fix 056efe3 (set_outmode clamp, onidleout ends drag).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const UI_PATH = path.join(ROOT, "src", "sand_ui.js");
const uiSrc = fs.readFileSync(UI_PATH, "utf8");

let checks = 0;
function ok(cond, msg) {
    checks++;
    assert.ok(cond, msg);
}

// ---------------------------------------------------------------------------
// Bug A: set_outmode allows 3; Out enum / GenExpr / face comment are 0..2
// ---------------------------------------------------------------------------
ok(
    /var curOutMode\s*=\s*0\s*;\s*\/\/\s*0=Off,\s*1=Hard,\s*2=Limit/.test(uiSrc),
    "Bug A setup: face comment documents Out as 0..2"
);
ok(
    /function set_outmode\s*\([\s\S]*?clamp\s*\(\s*Math\.round\s*\(\s*Number\s*\(\s*v\s*\)\s*\|\|\s*0\s*\)\s*,\s*0\s*,\s*2\s*\)/.test(uiSrc),
    "Bug A RED: set_outmode must clamp to 0..2 matching Out enum Off/Hard/Limit (not 0..3)"
);

const mg = {
    size: [192, 114],
    relative_coords: 1,
    autofill: 1,
    init() {},
    redraw() {},
    set_source_rgba() {},
    set_line_width() {},
    rectangle() {},
    rectangle_rounded() {},
    arc() {},
    close_path() {},
    fill() {},
    stroke() {},
    move_to() {},
    line_to() {},
    select_font_face() {},
    set_font_size() {},
    show_text() {},
};
const emitted = [];
const mockOutlet = (idx, msg) => emitted.push([idx, msg]);
const fn = new Function(
    "mgraphics",
    "inlets",
    "outlets",
    "outlet",
    uiSrc +
        "\nreturn { set_outmode, sandDspResend, onclick, ondrag, onidleout: (typeof onidleout === 'function' ? onidleout : undefined) };"
);
const ui = fn(mg, 1, 2, mockOutlet);

ui.set_outmode(3);
emitted.length = 0;
ui.sandDspResend();
const outmodeMsg = emitted.find((e) => e[1] && e[1][0] === "outmode");
ok(outmodeMsg, "Bug A setup: sandDspResend must emit outmode");
ok(
    outmodeMsg[1][1] >= 0 && outmodeMsg[1][1] <= 2,
    "Bug A RED: after set_outmode(3), sandDspResend must emit outmode in 0..2 (got " +
        (outmodeMsg && outmodeMsg[1][1]) +
        ")"
);

ui.set_outmode(2);
emitted.length = 0;
ui.sandDspResend();
const outmodeOk = emitted.find((e) => e[1] && e[1][0] === "outmode");
ok(
    outmodeOk && outmodeOk[1][1] === 2,
    "Bug A control: set_outmode(2) must still resend outmode 2"
);

// ---------------------------------------------------------------------------
// Bug B: onclick arms dragActive forever; no onidleout to end the gesture
// ---------------------------------------------------------------------------
ok(
    /function\s+onidleout\s*\(/.test(uiSrc),
    "Bug B RED: sand_ui must define onidleout to finish the XY Amount/Freq drag"
);
ok(
    /function\s+onidleout\s*\([\s\S]*?dragActive\s*=\s*false/.test(uiSrc),
    "Bug B RED: onidleout must clear dragActive (onclick sets it true; otherwise it sticks)"
);
ok(
    typeof ui.onidleout === "function",
    "Bug B RED: onidleout must be present on the loaded face"
);

// ---------------------------------------------------------------------------
// Bug C: scope ring is displayed rotated by one frame (newest sample first).
// gen writer order (sand_core.genexpr:297-305): poke sample at wpos, then
// poke(wave, wpos, 259, 0), THEN wpos = wrap(wpos + 1, 0, 128) — so frame 259
// holds the LAST-WRITTEN index. (Contrast mbsplit, which pokes its ringPos
// telemetry after incrementing, making it next-write/oldest.) pullWave
// (sand_ui.js:205,212) starts the trace at (wpos + n) & 127, i.e. at the newest
// frame, so the waveform is rotated: newest at x=0, oldest at x=1.
// The fake Buffer encodes each ring frame index as its sample value; the
// expected display order is derived from the gen source order, so the test
// enforces the reader/writer contract whichever side a fix lands on.
// ---------------------------------------------------------------------------
const GEN_PATH_C = path.join(ROOT, "src", "sand_core.genexpr");
const genSrcC = fs.readFileSync(GEN_PATH_C, "utf8");
const poke259C = genSrcC.indexOf("poke(wave, wpos, 259, 0)");
const incWposC = genSrcC.indexOf("wpos = wrap(wpos + 1, 0, 128)");
ok(
    poke259C >= 0 && incWposC >= 0,
    "Bug C setup: gen pokes wpos telemetry at frame 259 and increments wpos"
);
const telemetryLastWrittenC = poke259C < incWposC;

const RealBufferC = global.Buffer;
const TELE_C = 5;
function FakeBufferC() {}
FakeBufferC.prototype.peek = function (ch, start, count) {
    const a = [];
    for (let i = 0; i < count; i++) a.push(0);
    if (ch === 1) {
        for (let f = 0; f < 128; f++) a[f] = f / 128;
        a[259] = TELE_C;
    }
    return a;
};
function FakeTaskC() {
    this.interval = 0;
}
FakeTaskC.prototype.repeat = function () {};
FakeTaskC.prototype.schedule = function () {};
global.Buffer = FakeBufferC;
global.Task = FakeTaskC;
let displayedC = null;
try {
    const fnC = new Function(
        "mgraphics",
        "inlets",
        "outlets",
        "outlet",
        uiSrc +
            "\nreturn { setbuffer, pullWave, getLeft: function () { return left.slice(); } };"
    );
    const uiC = fnC(mg, 1, 2, mockOutlet);
    uiC.setbuffer("#0-sandwave");
    uiC.pullWave();
    displayedC = uiC.getLeft().map((v) => Math.round(v * 128));
} finally {
    global.Buffer = RealBufferC;
    delete global.Task;
}
ok(
    !!displayedC && displayedC.length === 128,
    "Bug C setup: pullWave must fill the 128-frame trace"
);
const expectFirstC = telemetryLastWrittenC ? (TELE_C + 1) & 127 : TELE_C;
let orderOkC = !!displayedC;
if (displayedC) {
    for (let n = 0; n < 128; n++) {
        if (displayedC[n] !== ((expectFirstC + n) & 127)) {
            orderOkC = false;
            break;
        }
    }
}
ok(
    orderOkC,
    "Bug C RED: scope trace must run oldest-to-newest starting at frame " +
        expectFirstC +
        " (gen telemetry is " +
        (telemetryLastWrittenC ? "last-written" : "next-write") +
        "), got first frame " +
        (displayedC && displayedC[0])
);

// ---------------------------------------------------------------------------
// Bug D: Soft / Debrick slider fills are not pre-blended (AGENTS.md section 8).
// Live paints activeslidercolor opaque, so it must be pre-blended
// (38% accent + 62% dark activebgcolor) or the near-white value text washes
// out over the fill. build_delayplus.py / build_reverbplus.py blend() and the
// build_sampler.py recipe do this; build_sand.py make_value_bar (line 93)
// sets the raw accent at alpha 1.
// ---------------------------------------------------------------------------
const AMXD_PATH_D = path.join(ROOT, "devices", "Sand.amxd");
const rawD = fs.readFileSync(AMXD_PATH_D);
const docD = JSON.parse(rawD.slice(32).toString("utf8"));
const boxByIdD = new Map(docD.patcher.boxes.map((b) => [b.box.id, b.box]));
function expectBlendD(id, accent) {
    const box = boxByIdD.get(id);
    ok(box, "Bug D setup: " + id + " exists in the built device");
    if (!box) return;
    const bg = box.activebgcolor;
    const want = accent.map((c, i) => 0.38 * c + 0.62 * bg[i]);
    const got = box.activeslidercolor;
    const close =
        !!got &&
        got.length >= 3 &&
        want.every((w, i) => Math.abs(got[i] - w) <= 0.01);
    ok(
        close,
        "Bug D RED: " +
            id +
            " activeslidercolor must be pre-blended 38% accent + 62% activebgcolor (want ~[" +
            want.map((w) => w.toFixed(3)).join(", ") +
            "], got [" +
            (got || []).slice(0, 3).join(", ") +
            "])"
    );
}
expectBlendD("obj-soft", [0.98, 0.7, 0.26]);
expectBlendD("obj-debrick", [0.96, 0.48, 0.44]);

console.log("sand bugsweep RED: " + checks + " checks (expected FAIL on current code until PASS 3 fixes)");
