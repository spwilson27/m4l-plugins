#!/usr/bin/env node
/**
 * sweep2 red tests for Mega Modulator (see sweep/megamod.md). Each check names its finding id.
 *   MM-S2-02  scripts/vm_megamod_keys.sh sources vm_common.sh through $ROOT before ROOT is assigned (set -u: "ROOT: parameter not set")
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
let failed = 0;
function check(id, cond, msg) { if (!cond) { failed++; console.error("FAIL " + id + ": " + msg); } else console.log("ok   " + id); }

// ---- MM-S2-02: ROOT must be assigned before it is used
{
    const sh = fs.readFileSync(path.join(ROOT, "scripts", "vm_megamod_keys.sh"), "utf8").split("\n");
    const firstUse = sh.findIndex((l) => !/^\s*#/.test(l) && /\$ROOT|\$\{ROOT/.test(l));
    const assign = sh.findIndex((l) => /^ROOT=/.test(l));
    check("MM-S2-02/root-order", assign >= 0 && assign < firstUse, `ROOT is first used on line ${firstUse + 1} but assigned on line ${assign + 1} (set -u aborts: ROOT: parameter not set)`);
}
process.exit(failed ? 1 : 0);
