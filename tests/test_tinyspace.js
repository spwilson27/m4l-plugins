#!/usr/bin/env node
/**
 * Tiny Space: config invariants and devices/Tiny Space.amxd structure.
 * Run with: node tests/test_tinyspace.js
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const cfg = require("../src/tinyspace_config.js");

const ROOT_DIR = path.dirname(__dirname);
const AMXD_PATH = path.join(ROOT_DIR, "devices", "Tiny Space.amxd");
const GEN_PATH = path.join(ROOT_DIR, "src", "tinyspace_core.genexpr");

function validatePatcherBoxesAndLines(patcher, label) {
    const map = new Map();
    for (const b of patcher.boxes) {
        const box = b.box;
        assert(!map.has(box.id), `[${label}] Duplicate box id: ${box.id}`);
        map.set(box.id, box);
    }
    for (const l of patcher.lines) {
        const pl = l.patchline;
        const [srcId, srcOut] = pl.source;
        const [dstId, dstIn] = pl.destination;
        assert(map.has(srcId), `[${label}] Missing source box: ${srcId}`);
        assert(map.has(dstId), `[${label}] Missing destination box: ${dstId}`);
        assert(srcOut < map.get(srcId).numoutlets, `[${label}] Outlet ${srcOut} out of range on ${srcId}`);
        assert(dstIn < map.get(dstId).numinlets, `[${label}] Inlet ${dstIn} out of range on ${dstId}`);
    }
    return map;
}

// --- Config ---
{
    const a = cfg.buildConfig(17);
    const b = cfg.buildConfig(17);
    assert.deepStrictEqual(a, b, "Same seed must rebuild the same space");
    assert.notDeepStrictEqual(cfg.buildConfig(1), cfg.buildConfig(2), "Different seeds should differ");
}

const counts = new Set();
let sawShort = false;
let sawLong = false;
for (let seed = 0; seed < 400; seed++) {
    const c = cfg.buildConfig(seed);
    assert.ok(c.activeCount >= 4 && c.activeCount <= 20, `activeCount ${c.activeCount}`);
    assert.strictEqual(c.activeCount % 2, 0, "active count stays even so L/R match");
    assert.ok(c.character >= 0 && c.character <= 1, "character out of range");
    assert.strictEqual(c.lens.length, cfg.LINE_COUNT);
    let active = 0;
    for (let i = 0; i < cfg.LINE_COUNT; i++) {
        if (cfg.isLineActive(i, c.activeCount)) active++;
        assert.ok(c.lens[i] >= 0.8 && c.lens[i] <= 48, `nominal length ${c.lens[i]}`);
        assert.ok(c.dampOffset[i] >= 0 && c.dampOffset[i] <= 0.35);
        assert.ok(c.modHz[i] > 0 && c.modHz[i] < 5);
        const atLow = cfg.delayMs(c.lens[i], 0);
        const atHigh = cfg.delayMs(c.lens[i], 1);
        if (atLow < 1) sawShort = true;
        if (atHigh > 90) sawLong = true;
    }
    assert.strictEqual(active, c.activeCount, "active mask must match activeCount");
    assert.ok(c.apGain.every((g) => g >= 0 && g <= 0.7));
    const floats = cfg.configToFloats(c);
    assert.strictEqual(floats.length, cfg.CFG_FLOATS);
    assert.strictEqual(floats[cfg.CFG_ACTIVE], c.activeCount);
    assert.strictEqual(floats[cfg.CFG_CHARACTER], c.character);
    assert.strictEqual(floats[cfg.CFG_LEN], c.lens[0]);
    assert.strictEqual(floats[cfg.CFG_MOD + 19], c.modHz[19]);
    counts.add(c.activeCount);
}
assert.ok(sawShort, "Expected a comb seed whose low Size setting is under 1 ms");
assert.ok(sawLong, "Expected a room seed whose high Size setting passes 90 ms");
assert.ok(counts.size >= 4, "Seed should cover several densities");
assert.ok(cfg.feedbackGain(0, 10) === 0, "zero feedback is silent");
assert.ok(cfg.feedbackGain(1, 10) < 1, "full feedback stays below unity");
assert.ok(cfg.feedbackGain(1, 5) > cfg.feedbackGain(1, 40), "short lines use a higher loop gain");
assert.ok(cfg.feedbackGain(2, 10) === cfg.feedbackGain(1, 10), "feedback gain clamps");
assert.ok(Math.pow(0.001, 10 / 40) > 0.15, "full feedback is still up at 10 seconds");
assert.ok(Math.abs(cfg.sizeScale(0) - 0.22) < 1e-9);
assert.ok(Math.abs(cfg.sizeScale(1) - 2.15) < 1e-9);

const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(gen.includes("ringGain"), "gen loop gain should match feedbackGain");
assert.ok(gen.includes("-6.90775527898"), "gen RT60 constant should match feedbackGain");
assert.ok(!gen.match(/\be\d/), "e0 is Euler's number in GenExpr, not an envelope");
const fnAt = gen.indexOf("\nslew(target, coef)");
const paramAt = gen.indexOf("\nParam ");
const bufferAt = gen.indexOf("\nBuffer ");
assert.ok(fnAt > 0 && fnAt < paramAt && fnAt < bufferAt, "GenExpr functions must precede Param and Buffer");
assert.ok(gen.indexOf("peek(cfg, 0)") > bufferAt, "config peeks must follow the Buffer declaration");
assert.ok(gen.includes("clip(d0, -2, 2)"), "feedback path clips only when it would overload");
assert.ok(gen.includes("Householder") || gen.includes("house("), "character blend uses a Householder mix");
assert.strictEqual((gen.match(/delay\(/g) || []).length, 0, "delay() is not valid GenExpr");
assert.strictEqual((gen.match(/^Delay /gm) || []).length, 22, "top-level Delay objects: 2 predelay + 20 tank");
assert.strictEqual((gen.match(/^\tDelay /gm) || []).length, 1, "allpass body declares its own Delay");
assert.ok((gen.match(/\.read\(/g) || []).length >= 23, "each delay line is read");
assert.ok((gen.match(/\.write\(/g) || []).length >= 23, "each delay line is written");
assert.strictEqual((gen.match(/allpass\((tone|[aA])/g) || []).length, 8, "4 allpasses per channel");

// --- Device ---
const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected an audio effect");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
const ptchLen = raw.readUInt32LE(28);
assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.devicewidth, 700.0);
assert.deepStrictEqual(p.openrect, [0.0, 0.0, 700.0, 169.0]);
assert.strictEqual(p.openinpresentation, 1);

const boxMap = validatePatcherBoxesAndLines(p, "root");
assert.ok(boxMap.get("obj-cfg").text.includes("#0-tsconfig"));
assert.ok(boxMap.get("obj-meters").text.includes("#0-tsmeters"));
assert.strictEqual(
    boxMap.get("obj-msg-genbufs").text,
    "cfg #0-tsconfig, meters #0-tsmeters",
    "gen binds Buffer variables cfg and meters to the #0 buffers"
);
assert.strictEqual(boxMap.get("obj-gen").maxclass, "gen.codebox~");
assert.ok(boxMap.get("obj-gen").code.includes("Buffer cfg"), "genexpr embedded");
assert.ok(boxMap.get("obj-gen").code.includes(gen.slice(0, 80)));

const expectedDials = ["Size", "Damp", "Width", "Mix", "Feedback", "PreDly", "Mod", "XFeed", "HP", "LP"];
for (const name of expectedDials) {
    const dial = [...boxMap.values()].find((b) => b.maxclass === "live.dial" && b.varname === name);
    assert.ok(dial, `Missing dial ${name}`);
    assert.strictEqual(dial.presentation, 1);
}
const seed = boxMap.get("obj-seed");
assert.strictEqual(seed.maxclass, "live.numbox");
assert.deepStrictEqual(seed.saved_attribute_attributes.valueof.parameter_mmax, 9999);
assert.strictEqual(seed.saved_attribute_attributes.valueof.parameter_type, 1);

const viz = boxMap.get("obj-viz").presentation_rect;
for (const [id, box] of boxMap.entries()) {
    if (id === "obj-viz" || box.maxclass === "panel" || !box.presentation || !box.presentation_rect) continue;
    const r = box.presentation_rect;
    const overlapsX = r[0] < (viz[0] + viz[2]) && (r[0] + r[2]) > viz[0];
    const overlapsY = r[1] < (viz[1] + viz[3]) && (r[1] + r[3]) > viz[1];
    assert(!(overlapsX && overlapsY), `Presentation widget ${id} overlaps the v8ui canvas`);
}

const boxOrder = p.boxes.map((b) => b.box.id);
const firstDial = boxOrder.findIndex((id) => id.startsWith("obj-dial-"));
for (const panelId of ["obj-panel-viz", "obj-panel-dials"]) {
    assert.strictEqual(boxMap.get(panelId).background, 1, `${panelId} must sit behind the controls`);
    assert.ok(boxOrder.indexOf(panelId) > firstDial, `${panelId} must be listed after the dials`);
}

// --- UI script from the device ---
const jsCode = boxMap.get("obj-viz").textfile.text;
assert.ok(jsCode.includes("function buildConfig"));
assert.ok(jsCode.includes("function paint"));

const mg = {
    size: [344, 132],
    init() {},
    redraw() {},
    set_source_rgba() {},
    set_line_width() {},
    rectangle() {},
    fill() {},
    stroke() {},
    move_to() {},
    line_to() {},
    select_font_face() {},
    set_font_size() {},
    show_text() {}
};
global.mgraphics = mg;
global.inlets = 1;
global.outlets = 1;
let bangs = 0;
global.outlet = () => { bangs++; };
global.notifyclients = () => {};
let lastPoke = null;
global.Buffer = function () {
    this.poke = (_ch, _off, arr) => { lastPoke = arr; };
    this.peek = () => [0.25];
};
global.Task = function () {
    this.interval = 0;
    this.repeat = () => {};
};

eval(jsCode);
assert.strictEqual(mg.relative_coords, 0, "v8ui must draw in pixels or Live clips the strings");
assert.strictEqual(mg.autofill, 0);
paint();
setbuffer("cfg", "meters");
set_seed(3);
assert.strictEqual(bangs, 0, "First seed apply should not duck");
assert.ok(lastPoke && lastPoke.length === cfg.CFG_FLOATS, "Config poke length");
assert.strictEqual(lastPoke[0], cfg.buildConfig(3).activeCount);
set_seed(9);
assert.strictEqual(bangs, 1, "Later seed changes duck the tank");
assert.strictEqual(lastPoke[0], cfg.buildConfig(9).activeCount);
loadbang();
paint();

console.log("test_tinyspace: ok");
