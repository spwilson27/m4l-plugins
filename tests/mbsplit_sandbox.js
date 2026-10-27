"use strict";
// Minimal vm sandbox for src/mbsplit_ui.js (sweep2 tests). Mirrors createUiInstance in test_mbsplit.js.
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const code = ["mbsplit_config.js", "spectral_theme.js"].map((f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8")).join("\n\n") +
    "\n\nvar GEN_DSP_TEXT = \"{}\";\nvar GEN_DSP_HASH = \"test\";\n" +
    ["mbsplit_dsp.js", "mbsplit_ui.js"].map((f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8")).join("\n\n");
function create(lomPath, bus) {
    const e0 = [], e1 = [];
    const sb = {
        Math, Date, Number, String, Boolean, Array, Object, parseInt, isNaN, JSON,
        liveLomPath: lomPath || "",
        max: { hidecursor() {}, showcursor() {} },
        global: {}, Global: function () { return bus || (bus = { groups: {}, peers: {} }); },
        LiveAPI: function (cb, t0) { const t = (typeof cb === "string" && t0 === undefined) ? cb : t0;
            if (t === "this_device") { this.path = sb.liveLomPath; this.id = sb.liveLomPath ? "42" : "0"; } else { this.path = t || ""; this.id = this.path ? "10" : "0"; } },
        Buffer: function () { this.peek = function () { return new Array(64).fill(0.1); }; },
        Task: function () { this.interval = 40; this.repeat = function () {}; this.schedule = function () {}; this.cancel = function () {}; },
        mgraphics: { size: [252, 102], relative_coords: 1, autofill: 1, init() {}, redraw() {}, set_source_rgba() {}, set_line_width() {}, rectangle() {}, rectangle_rounded() {},
            move_to() {}, line_to() {}, close_path() {}, arc() {}, fill() {}, stroke() {}, select_font_face() {}, set_font_size() {}, text_measure(t) { return [String(t).length * 5, 9]; }, show_text() {}, curve_to() {}, translate() {}, save() {}, restore() {}, clip() {}, set_font_size() {} },
        inlets: 1, outlets: 2,
        outlet(i, m) { (i === 0 ? e0 : e1).push(m); },
        notifyclients() { sb.notified = (sb.notified || 0) + 1; },
        patcher: { latency: 0, setattr(k, v) { if (k === "latency") sb.patcher.latency = v; }, getnamed() { return null; }, newdefault() { return null; }, connect() {}, remove() {} },
    };
    vm.createContext(sb); vm.runInContext(code, sb);
    sb.setbuffer("---mbsplitscope"); sb.loadbang();
    sb.e0 = e0; sb.e1 = e1;
    return sb;
}
module.exports = { create };
