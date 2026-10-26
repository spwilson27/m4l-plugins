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

console.log("sand bugsweep RED: " + checks + " checks (expected FAIL on current code until PASS 3 fixes)");
