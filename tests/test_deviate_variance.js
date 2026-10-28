"use strict";
// Deviate variance regression: renders through the Node sim (scripts/deviate_variance_report.js, child process) and checks
//  (a) Classic is bit-identical to tests/data/deviate_variance_classic.json (per-render hash),
//  (b) Wonky / Glitch really deviate: correlation with the dry is not an inverted drum (the dry replacement subtracts only the dry the
//      effects have not already replaced), residual is large, the wet tail rings, the spectrum moves, nothing is non-finite or loud.
const path = require("path");
const fs = require("fs");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT = path.join(ROOT, "scripts", "deviate_variance_report.js");
let checks = 0, fails = 0;
function ok(c, msg) { checks++; if (!c) { fails++; console.log("FAIL: " + msg); } }
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };

function run(args) {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dvvar-")), "r.json");
    cp.execFileSync(process.execPath, [REPORT].concat(args, ["--workers", "4", "--json", out]), { stdio: "ignore", cwd: ROOT, timeout: 120000 });
    return JSON.parse(fs.readFileSync(out, "utf8"));
}

// (a) Classic bit-identity
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "data", "deviate_variance_classic.json"), "utf8"));
const cl = run(["--modes", "0", "--archs", "0,37,417,913", "--draws", "2", "--stims", "kick,snare", "--window", "3"]);
const key = (r) => `${r.mode}/${r.arch}/${r.draw}/${r.stim}`;
const gold = {};
golden.results.forEach((r) => { gold[key(r)] = r; });
ok(cl.results.length === golden.results.length && cl.results.length === 16, `Classic: 16 renders (${cl.results.length})`);
let bad = 0;
cl.results.forEach((r) => { if (!gold[key(r)] || gold[key(r)].hash !== r.hash) bad++; });
ok(bad === 0, `Classic: every render hash equals the golden file (${bad} differ)`);

// (b) Wonky / Glitch (kick only), bounds = measured (2026-10-27) with margin
const clKick = cl.results.filter((r) => r.stim === "kick");
const clResid = median(clKick.map((r) => r.resid));
const clFlux = median(clKick.map((r) => r.specFlux));
const wg = run(["--modes", "1,3", "--archs", "37,417,913", "--draws", "2", "--stims", "kick", "--window", "3"]);
// measured NCC medians: Wonky -0.235, Glitch +0.030 (the Wonky negative part comes from phase-shifting filters / tape, not from the dry replacement)
const NCC = { Wonky: [-0.39, -0.08], Glitch: [-0.12, 0.18] };
for (const mode of ["Wonky", "Glitch"]) {
    const rs = wg.results.filter((r) => r.modeName === mode);
    ok(rs.length === 6, `${mode}: 6 renders (${rs.length})`);
    ok(rs.every((r) => r.finite && r.hits >= 1), `${mode}: every render finite and hit`);
    ok(rs.every((r) => r.peak < 4), `${mode}: peak < 4 (max ${Math.max(...rs.map((r) => r.peak)).toFixed(2)})`);
    const ncc = median(rs.map((r) => r.ncc));
    ok(ncc >= NCC[mode][0] && ncc <= NCC[mode][1], `${mode}: dry NCC median ${ncc.toFixed(3)} within [${NCC[mode]}]`);
    const rz = median(rs.map((r) => r.resid));
    ok(rz >= 1.5 * clResid, `${mode}: residual median ${rz.toFixed(2)} >= 1.5 x Classic ${clResid.toFixed(2)}`);
    const wt = median(rs.map((r) => r.wetTail));
    ok(wt >= -45, `${mode}: wet tail median ${wt.toFixed(1)} dB >= -45`);
    const fx = median(rs.map((r) => r.specFlux));
    ok(fx >= clFlux + 0.05, `${mode}: spectral flux median ${fx.toFixed(3)} >= Classic ${clFlux.toFixed(3)} + 0.05`);
}

console.log(`deviate variance: ${checks - fails} passed, ${fails} failed`);
if (fails) process.exit(1);
