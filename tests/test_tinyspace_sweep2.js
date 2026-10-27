#!/usr/bin/env node
/** Sweep 2 red tests for Tiny Space (expected to FAIL until the fixes land). */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const ROOT = path.resolve(__dirname, "..");
let fails = 0;
function check(id, cond, msg) {
    if (!cond) { fails++; console.log("FAIL " + id + ": " + msg); } else console.log("ok   " + id);
}

// patcher JSON from the built device
const buf = fs.readFileSync(path.join(ROOT, "devices", "Tiny Space.amxd"));
const patcher = JSON.parse(buf.slice(32).toString("utf8")).patcher;
const boxes = patcher.boxes.map((b) => b.box);

// TS-S3-01: dial name / value text follows Live's theme text colour, which is dark on the
// forced-dark section panels (Live smoke screenshot: HP / LP / Size / Fbk / XFeed / Width / Mix
// labels and values are near invisible). Every live.dial must set a light textcolor.
{
    const dials = boxes.filter((b) => b.maxclass === "live.dial");
    const bad = dials.filter((b) => {
        const c = b.textcolor;
        return !(Array.isArray(c) && (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) > 0.55 && c[3] > 0.5);
    });
    check("TS-S3-01", dials.length >= 7 && bad.length === 0,
        bad.length + " of " + dials.length + " live.dial boxes have no light textcolor (" + bad.map((b) => b.varname).join(",") + ")");
}

// TS-S2-01: a seed / character change must duck BEFORE the new config reaches the gen, and the
// gen must smooth the duck gain. Current code pokes the config first, then bangs the duck, and
// duckG = clip(duck) is an unsmoothed step (hard cut of the ringing tail = click).
{
    const events = [];
    const ctx = {
        console, Math, Date, Array, Number, String, Object, Float32Array,
        post() {}, outlet(i, m) { events.push("outlet:" + m); },
        mgraphics: { init() {}, redraw() {}, size: [152, 74] },
        Buffer: function () { this.poke = function () { events.push("poke"); }; this.peek = function () { return 0; }; },
        Task: function () { this.schedule = function () {}; this.repeat = function () {}; },
        Global: function () {}, File: function () {}, module: undefined,
    };
    vm.createContext(ctx);
    const src = fs.readFileSync(path.join(ROOT, "src", "tinyspace_config.js"), "utf8") +
        "\nvar GEN_DSP_TEXT='';var GEN_DSP_HASH='x';\n" + fs.readFileSync(path.join(ROOT, "src", "tinyspace_ui.js"), "utf8");
    vm.runInContext(src, ctx);
    vm.runInContext("setbuffer('a','b');set_seed(100);events_marker=1;", ctx);
    events.length = 0;
    vm.runInContext("set_seed(700)", ctx);
    const iPoke = events.indexOf("poke"), iBang = events.indexOf("outlet:bang");
    check("TS-S2-01a", iBang >= 0 && (iPoke < 0 || iBang < iPoke),
        "seed change order was " + events.join(",") + " (config poked before the duck started)");
    const core = fs.readFileSync(path.join(ROOT, "src", "tinyspace_core.genexpr"), "utf8");
    check("TS-S2-01b", /duckG\s*=\s*slew\(/.test(core),
        "gen duck gain is not slewed: duckG = clip(duck, 0, 1) steps to 0 and cuts the tail");
}
process.exit(fails ? 1 : 0);
