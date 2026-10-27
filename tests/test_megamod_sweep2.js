#!/usr/bin/env node
/**
 * sweep2 red tests for Mega Modulator (see sweep/megamod.md). Each check names its finding id.
 *   MM-S2-01  XY pad: a click on a painted position stores a different value (hit mapping ignores the 2 px paint inset)
 *   MM-S2-02  scripts/vm_megamod_keys.sh sources vm_common.sh through $ROOT before ROOT is assigned (set -u: "ROOT: parameter not set")
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
let failed = 0;
function check(id, cond, msg) { if (!cond) { failed++; console.error("FAIL " + id + ": " + msg); } else console.log("ok   " + id); }

// ---- MM-S2-01: round trip paint position -> click -> stored value
{
    const src = fs.readFileSync(path.join(ROOT, "src", "megamod_ui_newmods.js"), "utf8");
    const paintSrc = src.slice(src.indexOf("const px = pd[0] + 2"));
    const m = /const px = (pd\[0\] \+ 2 \+ x \* \(pd\[2\] - 4\)), py = (pd\[1\] \+ 2 \+ \(1 - y\) \* \(pd\[3\] - 4\));/.exec(paintSrc);
    check("MM-S2-01/paint-inset", !!m, "the puck paint formula was not found (test needs updating)");
    const fn = /function ubXyDrag\(d, x, y\) \{[\s\S]*?\n\}/.exec(src);
    const sent = {};
    const ctx = { clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), MM: { setParam: (s, k, v) => { sent[k] = v; } } };
    vm.createContext(ctx);
    vm.runInContext(fn[0] + "; this.ubXyDrag = ubXyDrag;", ctx);
    const pd = [10, 20, 48, 48];
    for (const [x, y] of [[0.25, 0.75], [0, 1], [1, 0], [0.5, 0.5]]) {
        const cx = pd[0] + 2 + x * (pd[2] - 4), cy = pd[1] + 2 + (1 - y) * (pd[3] - 4); // where the puck is painted for (x, y)
        ctx.ubXyDrag({ slot: 0, rect: pd }, cx, cy);
        check("MM-S2-01/x=" + x + ",y=" + y, Math.abs(sent.x - x) < 1e-9 && Math.abs(sent.y - y) < 1e-9, `click on the puck of (${x}, ${y}) stores (${sent.x}, ${sent.y})`);
    }
}

// ---- MM-S2-02: ROOT must be assigned before it is used
{
    const sh = fs.readFileSync(path.join(ROOT, "scripts", "vm_megamod_keys.sh"), "utf8").split("\n");
    const firstUse = sh.findIndex((l) => !/^\s*#/.test(l) && /\$ROOT|\$\{ROOT/.test(l));
    const assign = sh.findIndex((l) => /^ROOT=/.test(l));
    check("MM-S2-02/root-order", assign >= 0 && assign < firstUse, `ROOT is first used on line ${firstUse + 1} but assigned on line ${assign + 1} (set -u aborts: ROOT: parameter not set)`);
}
process.exit(failed ? 1 : 0);
