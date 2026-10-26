#!/usr/bin/env node
/**
 * Every live control ships a sentence for Ableton's Info View.
 * Parameters store it in parameter_info and repeat it as the Max annotation.
 * A presented control that is not a parameter uses the annotation.
 * Run after the device builds.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const LIVE = new Set(["live.dial", "live.numbox", "live.slider", "live.tab", "live.menu", "live.text", "live.gain~"]);
const MIN = 12;
const root = path.join(__dirname, "..", "devices");
const files = fs.readdirSync(root).filter((n) => n.endsWith(".amxd")).sort();
let checked = 0;

for (const name of files) {
    const raw = fs.readFileSync(path.join(root, name));
    assert.strictEqual(raw.slice(0, 4).toString(), "ampf", name);
    const n = raw.readUInt32LE(28);
    const doc = JSON.parse(raw.slice(32, 32 + n).toString("utf8"));
    for (const wrap of doc.patcher.boxes) {
        const b = wrap.box;
        if (!LIVE.has(b.maxclass)) continue;
        const valueof = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
        const isParam = valueof && Object.prototype.hasOwnProperty.call(valueof, "parameter_longname");
        if (isParam) {
            const info = String(valueof.parameter_info || "").trim();
            const longName = String(valueof.parameter_longname || "").trim();
            assert.ok(info.length >= MIN && info.toLowerCase() !== longName.toLowerCase(),
                `${name} ${b.id} (${longName}) has no Info View sentence`);
            assert.strictEqual(String(b.annotation || "").trim(), info, `${name} ${b.id} annotation matches the Info View`);
            checked++;
        } else if (b.presentation === 1 && !b.hidden) {
            const ann = String(b.annotation || "").trim();
            const label = String(b.text || b.id || "").trim();
            assert.ok(ann.length >= MIN && ann.toLowerCase() !== label.toLowerCase(),
                `${name} ${b.id} (${label}) has no hover sentence`);
            checked++;
        }
    }
}

assert.ok(checked > 400, "the scan saw the device controls (" + checked + ")");
console.log("parameter info: " + checked + " controls have an Info View sentence");
