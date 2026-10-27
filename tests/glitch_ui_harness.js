"use strict";
// shared sandbox for the v8ui face (same as tests/test_glitch_bugsweep.js)
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
function makeUi(extra) {
    const sent = [];
    const pokes = [];
    const calls = { notify: 0 };
    const drawLog = [];
    const gm = {
        size: [486, 169],
        init() {},
        redraw() {},
        text_measure(t) { return [String(t).length * 6, 8]; },
    };
    for (const fn of [
        "set_source_rgba", "set_line_width", "rectangle", "rectangle_rounded",
        "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse",
        "fill", "fill_preserve", "stroke", "select_font_face", "set_font_size",
        "show_text", "save", "restore", "translate", "rotate",
    ]) {
        gm[fn] = (...a) => {
            drawLog.push(fn + ":" + a.map((x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x)).join(","));
        };
    }
    const sandbox = {
        mgraphics: gm,
        outlet: (...a) => sent.push(a.slice(1)),
        notifyclients: () => { calls.notify++; },
        Buffer: function () {
            this.poke = (ch, off, arr) => pokes.push(arr.slice());
            this.peek = () => 0;
        },
        post() {},
        Date, Math, JSON, console,
    };
    const code =
        fs.readFileSync(path.join(ROOT, "src", "glitch_config.js"), "utf8") +
        "\n" +
        fs.readFileSync(path.join(ROOT, "src", "glitch_ui.js"), "utf8") +
        (extra || "");
    const ctx = vm.createContext(sandbox);
    vm.runInContext(code, ctx);
    const run = (src) => {
        const v = vm.runInContext(src, ctx);
        return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
    };
    return { run, sent, pokes, calls, ctx, drawLog, params: () => sent.filter((m) => m[0] === "param") };
}


module.exports = { makeUi };
