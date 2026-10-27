// Sweep 2 red tests for Envelope Trigger (see sweep/envtrig.md). Each block names its finding id.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const buf = fs.readFileSync(path.join(root, "devices", "Envelope Trigger.amxd"));
const patcher = JSON.parse(buf.slice(32).toString("utf8")).patcher;
const boxes = patcher.boxes.map((b) => b.box);
let failures = 0;
function fail(msg) { failures++; console.log("FAIL " + msg); }

// E-01: Live short names must be unique (parameter_shortname).
{
    const seen = {};
    for (const b of boxes) {
        const v = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
        if (!v || !v.parameter_shortname) continue;
        (seen[v.parameter_shortname] = seen[v.parameter_shortname] || []).push(b.id);
    }
    for (const [name, ids] of Object.entries(seen)) {
        if (ids.length > 1) fail(`E-01 duplicate short name '${name}': ${ids.join(", ")}`);
    }
}

// E-02: the knobs sit on the device's own dark panel, but live.dial text (label + value) takes
// Live's theme colour (dark grey in the default theme: unreadable in the Live smoke shot).
// Every live.dial on that panel needs an explicit light textcolor.
for (const b of boxes.filter((x) => x.maxclass === "live.dial")) {
    const c = b.textcolor;
    const lum = c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : -1;
    if (!(lum > 0.55)) fail(`E-02 ${b.id} (${b.varname}) has no light textcolor (${JSON.stringify(c)}): label/value read dark-on-dark in Live`);
}

// E-03: scripts/run_envtrig_ui_tests.py reads PANEL_NAMES from the strip script with a literal
// prefix; the embed minifier writes `var PANEL_NAMES=[...]` (no spaces), so the runner crashes.
{
    const src = fs.readFileSync(path.join(root, "scripts", "run_envtrig_ui_tests.py"), "utf8");
    const m = src.match(/len\("(var PANEL_NAMES[^"]*)"\)/);
    const strip = boxes.find((b) => b.id === "obj-strip").textfile.text;
    const first = strip.split("\n", 1)[0];
    let ok = false;
    if (m && first.startsWith(m[1])) {
        try { JSON.parse(first.slice(m[1].length).replace(/;+$/, "")); ok = true; } catch (e) {}
    }
    if (!ok) fail(`E-03 run_envtrig_ui_tests.py cannot parse PANEL_NAMES (runner prefix ${JSON.stringify(m && m[1])}, built line starts ${JSON.stringify(first.slice(0, 24))})`);
}

if (failures) { console.log(`test_envtrig_sweep2: ${failures} failure(s)`); process.exit(1); }
console.log("test_envtrig_sweep2: ok");
