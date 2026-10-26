#!/usr/bin/env node
"use strict";
/**
 * Bugsweep red cases for devices/Transient Split.amxd (slug `transplit`).
 *
 * Pass 1 — Size Live-help still claims constant latency 4096 while the device
 * reports / delays / footnotes 5120 (RACK_LATENCY). Sibling suite builds already
 * advertise 5120. make_theme_tab -> make_tab bakes ENUM_HELP into parameter_info.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "transplit_config.js"));

// --- source: ENUM_HELP + module docstring must match TS_LATENCY / RACK_LATENCY ---
{
    const buildSrc = fs.readFileSync(path.join(ROOT, "scripts", "build_transplit.py"), "utf8");
    const m = /"size":\s*"([^"]*(?:\\.[^"]*)*)"/.exec(buildSrc);
    assert.ok(m, "ENUM_HELP size entry present in build_transplit.py");
    const sizeHelp = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    assert.ok(
        sizeHelp.includes(String(cfg.TS_LATENCY)),
        `BUG (pass 1, red): Size ENUM_HELP must mention TS_LATENCY=${cfg.TS_LATENCY} (got ${JSON.stringify(sizeHelp)})`
    );
    assert.ok(
        !/stays 4096 samples/.test(sizeHelp) && !/\blatency stays 4096\b/i.test(sizeHelp),
        `BUG (pass 1, red): Size ENUM_HELP still claims latency 4096 (got ${JSON.stringify(sizeHelp)})`
    );
    assert.ok(
        !/\("latency":\s*4096\)/.test(buildSrc),
        'BUG (pass 1, red): build_transplit.py module docstring still claims ("latency": 4096) while LATENCY = RACK_LATENCY (5120)'
    );
    console.log("[bugsweep] source Size-help checks");
}

// --- built device: Live-facing Size help must match patcher latency ---
{
    const amxd = path.join(ROOT, "devices", "Transient Split.amxd");
    const raw = fs.readFileSync(amxd);
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.strictEqual(p.latency, cfg.TS_LATENCY, "patcher latency attribute = TS_LATENCY");
    const box = p.boxes.map((b) => b.box).find((b) => b.id === "obj-ctrl-size");
    assert.ok(box, "obj-ctrl-size exists");
    const v = (box.saved_attribute_attributes && box.saved_attribute_attributes.valueof) || {};
    const info = v.parameter_info || "";
    const ann = box.annotation || "";
    const help = info || ann;
    assert.ok(help.length > 0, "Size control carries Live help (parameter_info / annotation)");
    assert.ok(
        help.includes(String(cfg.TS_LATENCY)),
        `BUG (pass 1, red): Size Live help must mention latency ${cfg.TS_LATENCY} (parameter_info=${JSON.stringify(info)}, annotation=${JSON.stringify(ann)})`
    );
    assert.ok(
        !/stays 4096 samples/.test(help),
        `BUG (pass 1, red): Size Live help still claims latency 4096 (parameter_info=${JSON.stringify(info)}, annotation=${JSON.stringify(ann)})`
    );
    console.log("[bugsweep] built-device Size-help checks");
}

console.log("[bugsweep] all cases passed");
