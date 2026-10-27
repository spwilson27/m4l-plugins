#!/usr/bin/env node
/**
 * Sweep 2 RED tests for Cepstra (sweep/cepstra.md). Every check here fails on current code for the stated reason
 * and passes once the finding is fixed. Do not loosen them.
 *
 *   CEP-S2-01  device reports no latency to Live (patcher "latency" attribute missing) although the audio path
 *              is N + N/8 samples late (1152 / 2304 / 4608)
 *   CEP-S2-02  display assumes 44.1 kHz forever (srNow constant): the cutoff bar sits at the wrong place at any
 *              other sample rate while audio runs, because the gen never publishes its sample rate
 *   CEP-S2-03  MIDI cutoff mode is unreachable in Live: the audio effect has a midiin, but nothing ever sets
 *              this_device midi_inputs 0 routing (Live shows no chooser for it), so notes never arrive
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "cepstra_config.js"));
const raw = fs.readFileSync(path.join(ROOT, "devices", "Cepstra.amxd"));
const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
const genSrc = fs.readFileSync(path.join(ROOT, "src", "cepstra_core.genexpr"), "utf8");
const dispSrc = fs.readFileSync(path.join(ROOT, "src", "cepstra_display.js"), "utf8");
const faceBox = patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-viz-disp");
const faceText = faceBox.textfile.text;

let checks = 0, failed = 0;
function t(name, fn) {
    checks++;
    try { fn(); } catch (e) { failed++; console.log("RED " + name + ": " + e.message.split("\n")[0]); }
}

// ---- CEP-S2-01 -------------------------------------------------------------------------------
t("CEP-S2-01 patcher reports the device latency to Live", () => {
    // Live's PDC reads the static patcher "latency". Default quality 2k = 2304; a constant pad to the largest size = 4608.
    assert.ok(typeof patcher.latency === "number", "patcher has no \"latency\" attribute (Live assumes 0 samples)");
    assert.ok(patcher.latency === cfg.latencySamples(2048) || patcher.latency === cfg.latencySamples(4096),
        "latency " + patcher.latency + " matches neither the 2k latency nor the constant 4k pad");
});

// ---- CEP-S2-02 -------------------------------------------------------------------------------
function makeFace(scope) {
    const sb = { rgba: [] };
    const mg = {
        size: [faceBox.presentation_rect[2], faceBox.presentation_rect[3]], init() {}, redraw() {},
        set_source_rgba() {}, set_line_width() {}, rectangle() {}, rectangle_rounded() {}, arc() {}, move_to() {}, line_to() {},
        curve_to() {}, close_path() {}, fill() {}, stroke() {}, select_font_face() {}, set_font_size() {}, show_text() {},
    };
    const Buf = function (name) { this.name = name; this.peek = (c, s, n) => scope.slice(s, s + n); this.poke = () => {}; };
    const Task = function (fn) { this.fn = fn; this.repeat = () => {}; this.schedule = () => {}; this.cancel = () => {}; };
    const fn = new Function("mgraphics", "Buffer", "Task", "outlet", "notifyclients",
        faceText + "\nreturn { setbuffer, pullScope, barAxis01, set_res };");
    return fn(mg, Buf, Task, () => {}, () => {});
}
t("CEP-S2-02 cutoff bar uses the real sample rate (48 kHz)", () => {
    const sr = 48000, ms = 7.2;
    const scope = new Array(272).fill(0);
    for (let b = 0; b < 192; b++) scope[b] = 0.01 * Math.sin(b);
    scope[256] = ms * 0.001 * sr; // lifter lag in samples, as the gen writes it
    scope[258] = 0.4; scope[259] = 3; scope[260] = 2048;
    scope[265] = sr; // contract of the fix: the gen publishes its sample rate in scope slot 265
    const f = makeFace(scope);
    f.setbuffer("1001-cepscope");
    for (let i = 0; i < 20; i++) f.pullScope();
    const want = ms / cfg.QUEF_MAX_MS;
    assert.ok(Math.abs(f.barAxis01() - want) < 0.002, "bar at " + (f.barAxis01() * 20).toFixed(3) + " ms, true cutoff " + ms + " ms");
});
t("CEP-S2-02b gen publishes samplerate in scope slot 265", () => {
    assert.ok(/poke\(\s*scope\s*,\s*sr\s*,\s*265/.test(genSrc), "no poke(scope, sr, 265, ...) in src/cepstra_core.genexpr");
    assert.ok(/\b265\b/.test(dispSrc), "display never reads scope slot 265");
});

// ---- CEP-S2-03 -------------------------------------------------------------------------------
t("CEP-S2-03 face sets up the midi_inputs routing of the device", () => {
    const hasMidiin = patcher.boxes.some((b) => b.box.text === "midiin");
    assert.ok(hasMidiin, "precondition: device has a midiin");
    assert.ok(/midi_inputs/.test(faceText), "no code touches this_device midi_inputs (routing_type): the DeviceIO defaults to No Input, MIDI mode never receives a note");
});

console.log(failed ? `cepstra sweep2 RED: ${failed}/${checks} checks fail` : `cepstra sweep2: ${checks} checks pass`);
process.exit(failed ? 1 : 0);
