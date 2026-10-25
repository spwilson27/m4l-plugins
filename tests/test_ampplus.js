"use strict";

// Amp+: NAM captures in the layout of Ableton's Amp.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { load, functionsOf } = require("./genexpr_functions");
const { AMP_MODELS, ampStep } = require("../src/ampplus_models");

const ROOT = path.join(__dirname, "..");
const AMXD = path.join(ROOT, "devices", "Amp+.amxd");
const CORE = path.join(ROOT, "src", "ampplus_core.genexpr");
const MODELS = path.join(ROOT, "devices", "ampplus_models");

function readAmxd(file) {
    const raw = fs.readFileSync(file);
    return { raw, doc: JSON.parse(raw.slice(32).toString("utf8")) };
}

function magAt(b0, b1, b2, a1, a2, freq, sr) {
    const w = 2 * Math.PI * freq / sr;
    const c1 = Math.cos(w);
    const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2;
    const ni = -(b1 * s1 + b2 * s2);
    const dr = 1 + a1 * c1 + a2 * c2;
    const di = -(a1 * s1 + a2 * s2);
    return Math.hypot(nr, ni) / Math.hypot(dr, di);
}

function coeffs(g, kind, freq, q, db, sr) {
    return [0, 1, 2, 3, 4].map((c) => g.filt(kind, freq, q, db, sr, c));
}

const coreSrc = fs.readFileSync(CORE, "utf8");
const g = load(coreSrc);
const SR = 48000;

for (const fn of functionsOf(coreSrc)) {
    const returns = fn.body.filter((line) => /^\s*return\b/.test(line));
    assert.strictEqual(returns.length, 1, `${fn.name} should return once`);
    const last = fn.body.filter((line) => line.trim()).pop();
    assert.ok(/^\treturn\b/.test(last), `${fn.name} return should be the last line`);
}
assert.ok(!/(^|[^A-Za-z0-9_])e[0-9]/.test(coreSrc), "gen identifiers must not look like Euler's constant");

assert.strictEqual(g.toneDb(50, 0.24), 0);
assert.strictEqual(g.toneDb(100, 0.24), 12);
assert.strictEqual(g.toneDb(0, 0.16), -8);
assert.strictEqual(g.volCurve(0), 0);
assert.strictEqual(g.volCurve(100), 1);
assert.ok(g.volCurve(50) < g.volCurve(80) && g.volCurve(80) < 1);

for (const kind of [0, 1, 2]) {
    const c = coeffs(g, kind, kind === 2 ? 750 : 110, 0.707, 0, SR);
    for (const freq of [40, 200, 1000, 6000]) {
        const m = magAt(c[0], c[1], c[2], c[3], c[4], freq, SR);
        assert.ok(Math.abs(m - 1) < 0.002, `flat kind ${kind} at ${freq} Hz was ${m}`);
    }
}

const bassUp = coeffs(g, 0, 110, 0.707, 12, SR);
assert.ok(magAt(...bassUp, 30, SR) > 3.2, "low shelf +12 dB should lift the bass");
assert.ok(Math.abs(magAt(...bassUp, 4000, SR) - 1) < 0.15, "low shelf should leave the highs");
const trebleUp = coeffs(g, 1, 2200, 0.707, 12, SR);
assert.ok(magAt(...trebleUp, 8000, SR) > 3.2, "high shelf +12 dB should lift the top");
assert.ok(Math.abs(magAt(...trebleUp, 80, SR) - 1) < 0.15, "high shelf should leave the bass");

assert.ok(g.cabLpHz(3, 0, 0) < g.cabLpHz(0, 0, 0), "4x12 is darker than 1x12");
assert.ok(g.cabLpHz(0, 1, 0) > g.cabLpHz(0, 0, 0), "a condenser is brighter than a dynamic mic");
assert.ok(g.cabLpHz(0, 0, 1) < g.cabLpHz(0, 0, 0), "the cone edge is darker than the center");
assert.ok(g.cabHpHz(4, 0) < g.cabHpHz(0, 0), "a 1x15 passes more bass than a 1x12");
assert.ok(g.cabPeakDb(0, 0, 1) < g.cabPeakDb(0, 0, 0), "the edge loses the presence peak");

{
    const c = coeffs(g, 0, 110, 0.707, 0, SR);
    let peak = 0;
    for (let n = 0; n < 2000; n++) {
        const x = 0.2 * Math.sin((2 * Math.PI * 440 * n) / SR);
        const y = g.biq(x, c[0], c[1], c[2], c[3], c[4]);
        assert.ok(Number.isFinite(y), "biquad produced a non-finite sample");
        peak = Math.max(peak, Math.abs(y));
    }
    assert.ok(peak > 0.15 && peak < 0.25, `flat biquad peak ${peak}`);
}

{
    const first = g.slew(40, 20, SR);
    const second = g.slew(80, 20, SR);
    assert.strictEqual(first, 40);
    assert.ok(second > 40 && second < 41, `slew should ease off the first value, got ${second}`);
}

assert.strictEqual(AMP_MODELS.length, 7);
assert.deepStrictEqual(AMP_MODELS.map((m) => m.type), ["Clean", "Boost", "Blues", "Rock", "Lead", "Heavy", "Bass"]);
assert.strictEqual(ampStep(0, -1, 7), 6);
assert.strictEqual(ampStep(6, 1, 7), 0);

const notice = JSON.parse(fs.readFileSync(path.join(MODELS, "NOTICE.json"), "utf8"));
assert.strictEqual(notice.license, "GPL-3.0-only");
assert.ok(fs.readFileSync(path.join(MODELS, "COPYING"), "utf8").includes("GNU GENERAL PUBLIC LICENSE"));
for (const model of AMP_MODELS) {
    const hit = notice.models.find((row) => row.file === path.basename(model.file));
    assert.ok(hit, model.file);
    assert.strictEqual(hit.source, model.source);
    assert.strictEqual(hit.credit, model.credit);
    const nam = JSON.parse(fs.readFileSync(path.join(ROOT, "devices", model.file), "utf8"));
    assert.strictEqual(nam.architecture, "WaveNet");
    assert.ok(nam.weights.length > 1000, model.file);
}

{
    const { raw, doc } = readAmxd(AMXD);
    const p = doc.patcher;
    assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf");
    assert.strictEqual(raw.slice(8, 12).toString("latin1"), "aaaa");
    assert.strictEqual(p.openrect[2], 496);
    assert.strictEqual(p.openrect[3], 169);
    assert.strictEqual(p.devicewidth, 496);
    assert.strictEqual(p.openinpresentation, 1);
    assert.strictEqual(p.latency, 0);

    const boxes = p.boxes.map((b) => b.box);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const neural = byId.get("obj-neural");
    assert.ok(neural.text.startsWith("neural~"), neural.text);
    assert.ok(neural.text.includes("@quality 1"));
    const gen = byId.get("obj-gen");
    assert.ok(gen.code.includes("Param bass"), "tone stack param");
    assert.ok(gen.code.includes("dcblock"), "dc block");
    assert.strictEqual(gen.numinlets, 1);
    assert.strictEqual(gen.numoutlets, 2);

    const amp = byId.get("obj-ctrl-amp");
    const enumNames = amp.saved_attribute_attributes.valueof.parameter_enum;
    assert.deepStrictEqual(enumNames, AMP_MODELS.map((m) => m.type));

    const viz = byId.get("obj-viz");
    const vr = viz.presentation_rect;
    for (const box of boxes) {
        if (!box.presentation || !box.presentation_rect) continue;
        const r = box.presentation_rect;
        assert.ok(r[0] >= -0.1 && r[1] >= -0.1 && r[0] + r[2] <= 496.1 && r[1] + r[3] <= 169.1, `${box.id} is outside the device`);
        if (box.id === "obj-viz" || box.maxclass === "panel") continue;
        const overlapsX = r[0] < vr[0] + vr[2] && r[0] + r[2] > vr[0];
        const overlapsY = r[1] < vr[1] + vr[3] && r[1] + r[3] > vr[1];
        assert.ok(!(overlapsX && overlapsY), `${box.id} overlaps the amp head`);
    }

    const linked = p.lines.map((l) => l.patchline);
    function wired(src, outlet, dst, inlet) {
        assert.ok(linked.some((l) => l.source[0] === src && l.source[1] === outlet && l.destination[0] === dst && l.destination[1] === inlet),
            `${src} outlet ${outlet} should reach ${dst} inlet ${inlet}`);
    }
    wired("obj-plugin", 0, "obj-half-l", 0);
    wired("obj-plugin", 1, "obj-half-r", 0);
    wired("obj-drive", 0, "obj-neural", 0);
    wired("obj-neural", 0, "obj-gen", 0);
    wired("obj-gen", 0, "obj-plugout", 0);
    wired("obj-gen", 1, "obj-plugout", 1);
    wired("obj-viz", 0, "obj-neural", 0);
    wired("obj-ctrl-gain", 0, "obj-gain-scale", 0);

    const text = boxes.map((b) => b.text || "").join("\n");
    for (const file of AMP_MODELS.map((m) => m.file)) assert.ok(text.includes(file) || fs.existsSync(path.join(ROOT, "devices", file)));
    const ui = viz.textfile.text;
    for (const model of AMP_MODELS) assert.ok(ui.includes(model.file), model.file);
    const uiSrc = fs.readFileSync(path.join(ROOT, "src", "ampplus_ui.js"), "utf8");
    assert.ok(uiSrc.includes("mgraphics.relative_coords = 0"));
    assert.ok(uiSrc.includes("mgraphics.autofill = 0"));
    assert.ok(!/\bvar\s+box\b/.test(uiSrc) && !/\bvar\s+patcher\b/.test(uiSrc));
}

console.log("ampplus ok");
