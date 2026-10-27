"use strict";
// sweep2 (spectral lane) red tests. Each block names its finding id in sweep/spectral.md.
// Run: node tests/test_spectral_sweep2.js   (exit 1 while any finding is open)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let failed = 0;
function check(id, name, fn) {
    try { fn(); console.log("ok   " + id + " " + name); }
    catch (e) { failed++; console.log("FAIL " + id + " " + name + "\n     " + String(e.message).split("\n").join("\n     ")); }
}
function readDevice(name) {
    const b = fs.readFileSync(path.join(ROOT, "devices", name + ".amxd"));
    return JSON.parse(b.slice(32).toString("utf8"));
}

// ---- Live draws values in Ableton Sans Medium ~9 px: about 5.6 px per character plus 4 px padding (measured: "-30.0 dB" in a 38 px numbox
// showed "-30.0 d"; a 4-cell tab of 70 px (17.5 px per cell) showed "51" for "512"). The preview renderer has no unit text, so only a
// width model can catch this on the host.
const CH = 5.6, PAD = 4;
function fmtUnit(fmt, v) {
    // Max unit strings: %.Nf / %i / %d followed by literal text; a lone "%" after a space is a literal percent sign
    const m = /%\.?(\d*)f/.exec(fmt);
    const d = m ? Number(m[1] || 0) : 0;
    return fmt.replace(/%\.?\d*f/, Number(v).toFixed(d));
}
function numboxText(v, val) {
    if (v.parameter_unitstyle === 9 && v.parameter_units) return fmtUnit(v.parameter_units, val);
    const unit = { 5: " %", 4: " dB", 3: " Hz", 8: "", 0: "" }[v.parameter_unitstyle];
    const dec = v.parameter_unitstyle === 0 ? 0 : (v.parameter_unitstyle === 5 ? 0 : 1);
    return Number(val).toFixed(dec) + (unit || "");
}
for (const dev of ["Transient Split", "Loud Split", "Harmonic Split", "Freq Split"]) {
    const p = readDevice(dev).patcher;
    check("S3-fit", dev + ": every presented numbox shows its longest value untruncated", () => {
        const bad = [];
        for (const b of p.boxes.map((x) => x.box)) {
            if (b.maxclass !== "live.numbox" || !b.presentation || !b.presentation_rect) continue;
            const v = (b.saved_attribute_attributes || {}).valueof || {};
            const w = b.presentation_rect[2];
            for (const val of [v.parameter_mmin, v.parameter_mmax]) {
                if (typeof val !== "number") continue;
                const t = numboxText(v, val);
                if (t.length * CH + PAD > w) bad.push(`${b.id} (${w}px) "${t}" needs ${(t.length * CH + PAD).toFixed(0)}px`);
            }
        }
        if (bad.length) throw new Error(bad.join("\n"));
    });
    check("S3-fit", dev + ": every presented tab cell fits its label", () => {
        const bad = [];
        for (const b of p.boxes.map((x) => x.box)) {
            if (b.maxclass !== "live.tab" || !b.presentation || !b.presentation_rect) continue;
            const v = (b.saved_attribute_attributes || {}).valueof || {};
            const en = v.parameter_enum || [];
            if (!en.length) continue;
            const cell = b.presentation_rect[2] / en.length;
            for (const lab of en) if (lab.length * CH + PAD > cell) bad.push(`${b.id} cell ${cell.toFixed(1)}px "${lab}" needs ${(lab.length * CH + PAD).toFixed(0)}px`);
        }
        if (bad.length) throw new Error(bad.join("\n"));
    });
}

// ---- F3: the Mix dry share must not depend on the role an in-rack instance happens to have.
// Role 0 is also what an instance in a rack gets before a leader exists, and when its own input differs (fb 1) or it fell back (spectral_link.js
// rackDesired). With kShare gated on roleH > 0.5 such an instance outputs the FULL dry at Mix < 100 % and the rack sum is up to K x too loud
// (and the audio cases mix_0 / mix_50 / rack_mix_* of all four runners fail, AGENTS 23..26 "each chain carries dry / K").
check("F3", "kShare is not gated on the follower/leader role", () => {
    const t = fs.readFileSync(path.join(ROOT, "src", "spectral_split_rack_main.genexpr"), "utf8");
    const m = /kShare\s*=\s*([^;]+);/.exec(t);
    if (!m) throw new Error("no kShare line");
    if (/roleH/.test(m[1])) throw new Error("kShare depends on roleH: " + m[0]);
});

// ---- F2 (S1): the minified gen text the device embeds. Bisected in the VM (real Max, standalone gen.codebox~): the same code with comments
// stripped and renames off still compiles to a gen that outputs only zeros (no telemetry) once `exp(0 - 1 / clip(..))` is minified to
// `exp(0-1/clip(..))` (variant "E" keeps everything else readable and fails; comments-only / indentation-only variants pass). Transient Split and
// Loud Split are the only devices with this expression, and they are exactly the ones whose deferred gen~ never runs in Live.
function embeddedGen(dev) {
    const j = readDevice(dev);
    let t = null;
    (function w(o) { if (o && typeof o === "object") for (const k in o) { if (typeof o[k] === "string" && o[k].startsWith("var GEN_DSP_TEXT") && !t) t = o[k]; w(o[k]); } })(j);
    const st = t.indexOf('"'); let e = st + 1;
    while (t[e] !== '"') { if (t[e] === "\\") e++; e++; }
    const gd = JSON.parse(JSON.parse(t.slice(st, e + 1)));
    return gd.patcher.boxes.map((x) => x.box).find((x) => x.code).code;
}
for (const dev of ["Transient Split", "Loud Split", "Harmonic Split", "Freq Split"]) {
    check("F2", dev + ": embedded gen has no `0-<number>/` idiom (compiles to a silent gen in Max)", () => {
        const code = embeddedGen(dev);
        const m = code.match(/[(,=*+<>?:]0-\d+(?:\.\d+)?\/[^;\n]{0,30}/g);
        if (m) throw new Error("minified gen contains " + m.slice(0, 3).join(" | ") + " (write the source so the minifier keeps a space, or fix scripts/minify_gen.py)");
    });
}

// ---- F1: the shipped rack presets must not carry the builder's checkout path (three of four point into pruned /private/tmp worktrees).
const zlib = require("zlib");
for (const dev of ["Transient Split", "Loud Split", "Harmonic Split", "Freq Split"]) {
    check("F1", dev + ".adg has no absolute builder path", () => {
        const x = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "devices", dev + ".adg"))).toString("utf8");
        const m = [...x.matchAll(/<Path Value="(\/[^"]*)"/g)].map((r) => r[1]);
        if (m.length) throw new Error(`${m.length} absolute <Path> entries, e.g. ${m[0]}`);
    });
}

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
