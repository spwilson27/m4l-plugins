"use strict";
// Aggregator for the Deviate DSP-side Node tests: config/draw/hidden/blob contract, IR bank, and the gen core (lint, draw and hidden
// parity through the GenExpr transpiler, contract checks, whole-core simulation).
const { spawnSync } = require("child_process");
const path = require("path");
const parts = ["test_deviate_config.js", "test_deviate_ir.js", "test_deviate_gen.js"];
let bad = 0;
for (const f of parts) {
    const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8", cwd: path.resolve(__dirname, "..") });
    const out = (r.stdout || "") + (r.stderr || "");
    const tail = out.trim().split("\n").slice(-3).join("\n");
    const fails = out.split("\n").filter((l) => /^FAIL/.test(l));
    console.log(`${r.status === 0 ? "ok  " : "FAIL"} ${f}\n   ${tail.replace(/\n/g, "\n   ")}`);
    if (r.status !== 0) { bad++; fails.slice(0, 15).forEach((l) => console.log("   " + l)); }
}
console.log(bad ? `\n${bad} Deviate DSP test file(s) failed` : "\nall Deviate DSP tests passed");
process.exit(bad ? 1 : 0);
