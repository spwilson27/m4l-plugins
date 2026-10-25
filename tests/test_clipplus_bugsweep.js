"use strict";
// Clip+ bug sweep, pass 1: red tests only (no fixes), in the style of tests/test_clipplus.js.
// Each test pins a real bug found by inspection; see BUGS.md at the repo root of this worktree.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CORE = fs.readFileSync(path.join(ROOT, "src/clipplus_core.genexpr"), "utf8");
const UI = fs.readFileSync(path.join(ROOT, "src/clipplus_ui.js"), "utf8");

// ---- Bug 1: True Peak is implemented everywhere except the one place that can turn it on ----
// The gen declares Param tpeak and runs a full true-peak stage (cp_tp_store: 4x peak read,
// tpHold, ceiling/peak gain on the 24-sample-delayed signal), the JS reference engine in
// src/clipplus_curve.js implements tpeak, and the face has set_tpeak plus a cpResend that
// sends "tpeak" out of the viz. But the built device has no path that can ever deliver a
// tpeak message to the gen: every other gen parameter is fed by a live control through an
// obj-prep-* object ("prepend <param>"), and there is no obj-prep-tpeak. The only related
// control, "Peak" (obj-ctrl-hlim), sends gen message "hlim" only and its help text is the
// brickwall sample clip, so it is Hard Limit, not True Peak. set_tpeak is never called by
// anything in the patcher either (no obj-ui-tpeak). True Peak is unreachable in the device.
{
    // The DSP and face side of the feature exist (these assertions pass today):
    assert.ok(/Param tpeak\(0\)/.test(CORE), "gen declares Param tpeak");
    assert.ok(CORE.indexOf("cp_tp_store(ch, tmpIn, tmpOut, tpUp, fir)") >= 0, "gen main loop runs the true-peak stage");
    assert.ok(/function set_tpeak\(v\)/.test(UI), "face implements set_tpeak");
    assert.ok(UI.indexOf("\"tpeak\", cpTp") >= 0, "face cpResend sends tpeak");

    // The device wiring does not (red today):
    const amxd = path.join(ROOT, "devices/Clip+.amxd");
    const buf = fs.readFileSync(amxd);
    assert.strictEqual(buf.slice(0, 4).toString(), "ampf");
    const n = buf.readUInt32LE(28);
    const patcher = JSON.parse(buf.slice(32, 32 + n).toString("utf8")).patcher;
    const boxes = patcher.boxes.map((b) => b.box);
    const prep = boxes.find((b) => String(b.text || "") === "prepend tpeak");
    assert.ok(prep, "BUG: Clip+.amxd has no obj-prep-tpeak (\"prepend tpeak\") — no control can send the gen its tpeak parameter, so True Peak can never be enabled in the shipped device");
    const lines = (patcher.lines || []).map((l) => l.patchline);
    const fed = lines.some((l) => l.destination && l.destination[0] === prep.id);
    assert.ok(fed, "BUG: obj-prep-tpeak exists but no patchline feeds it, so tpeak still cannot be set");
    console.log("[bugsweep] true peak is reachable from a device control");
}

console.log("test_clipplus_bugsweep: ok");
