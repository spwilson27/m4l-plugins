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
let prevActive = 0;
for (let seed = 0; seed <= cfg.SEED_MAX; seed++) {
    const c = cfg.buildConfig(seed);
    assert.ok(c.activeCount >= 4 && c.activeCount <= 20, `activeCount ${c.activeCount}`);
    assert.strictEqual(c.activeCount % 2, 0, "active count stays even so L/R match");
    assert.ok(c.activeCount >= prevActive, `seed ${seed} activeCount (${c.activeCount}) must not decrease from ${prevActive}`);
    prevActive = c.activeCount;
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
assert.strictEqual(cfg.SEED_MAX, 1000, "Expected 1000 max seed");
assert.deepStrictEqual(
    cfg.CHAR_MODES,
    ["COMB", "HYBRID", "ROOM", "PLATE", "TANK", "BOX", "SPRING", "BOUNCE"],
    "Expected all 8 room models in CHAR_MODES"
);
for (let m = 0; m < cfg.CHAR_MODES.length; m++) {
    const cm = cfg.buildConfig(350, m);
    assert.strictEqual(cm.model, m);
    const fl = cfg.configToFloats(cm);
    assert.strictEqual(fl[cfg.CFG_MODEL], m);
    assert.ok(cm.lens.every((l) => l >= 0.8 && l <= 48));
    assert.ok(cm.apGain.every((g) => g >= 0 && g <= 0.7));
}
assert.strictEqual(cfg.buildConfig(0).activeCount, 4, "Lowest seeds start at 4 lines");
assert.strictEqual(cfg.buildConfig(cfg.SEED_MAX).activeCount, 20, "Highest seeds reach the 20-line cap");
assert.ok(cfg.buildConfig(100).activeCount < cfg.buildConfig(900).activeCount, "Smaller seeds have fewer lines than larger seeds");
assert.ok(sawShort, "Expected a comb seed whose low Size setting is under 1 ms");
assert.ok(sawLong, "Expected a room seed whose high Size setting passes 90 ms");
assert.strictEqual(counts.size, 9, "Seeds 0..1000 should step through all 9 even densities (4..20)");
assert.ok(cfg.feedbackGain(0, 10) === 0, "zero feedback is silent");
assert.ok(cfg.feedbackGain(1, 10) < 1, "full feedback stays below unity");
assert.ok(cfg.feedbackGain(1, 5) > cfg.feedbackGain(1, 40), "short lines use a higher loop gain");
assert.ok(cfg.feedbackGain(2, 10) === cfg.feedbackGain(1, 10), "feedback gain clamps");
assert.ok(Math.pow(0.001, 10 / 80) > 0.4, "full feedback is still up at 10 seconds");
{
    const gMs = cfg.feedbackGain(1, 1);
    const rtMs = 0.001 * Math.log(0.001) / Math.log(gMs);
    assert.ok(rtMs > 70, "a 1 ms comb at full feedback rings about twice as long as before");
}
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

// --- Device & Layout Variants ---
const VARIANT_SPECS = [
    [AMXD_PATH, 292.0],
    [path.join(ROOT_DIR, "devices", "Tiny Space Modules.amxd"), 292.0],
    [path.join(ROOT_DIR, "devices", "Tiny Space Compact.amxd"), 300.0],
    [path.join(ROOT_DIR, "devices", "Tiny Space Split.amxd"), 284.0],
];

let mainBoxMap = null;
for (const [devPath, expectedW] of VARIANT_SPECS) {
    const raw = fs.readFileSync(devPath);
    assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected an audio effect");
    assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
    const ptchLen = raw.readUInt32LE(28);
    assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

    const doc = JSON.parse(raw.slice(32).toString("utf8"));
    const p = doc.patcher;
    assert.strictEqual(p.devicewidth, expectedW);
    assert.deepStrictEqual(p.openrect, [0.0, 0.0, expectedW, 169.0]);
    assert.strictEqual(p.openinpresentation, 1);

    const boxMap = validatePatcherBoxesAndLines(p, path.basename(devPath));
    if (devPath === AMXD_PATH) mainBoxMap = boxMap;
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

    const expectedControls = ["Size", "Damp", "Width", "Mix", "Feedback", "PreDly", "Mod", "XFeed", "HP", "LP"];
    for (const name of expectedControls) {
        const ctrl = [...boxMap.values()].find(
            (b) => (b.maxclass === "live.dial" || b.maxclass === "live.numbox") && b.varname === name
        );
        assert.ok(ctrl, `Missing control ${name} in ${path.basename(devPath)}`);
        assert.strictEqual(ctrl.presentation, 1);
    }
    const seed = boxMap.get("obj-seed");
    assert.strictEqual(seed.maxclass, "live.numbox");
    assert.deepStrictEqual(seed.saved_attribute_attributes.valueof.parameter_mmax, 1000);
    assert.strictEqual(seed.saved_attribute_attributes.valueof.parameter_type, 1);

    const charBox = boxMap.get("obj-char");
    assert.ok(charBox, "Missing Character selection box");
    assert.strictEqual(charBox.maxclass, "live.menu");
    assert.deepStrictEqual(
        charBox.saved_attribute_attributes.valueof.parameter_enum,
        ["COMB", "HYBRID", "ROOM", "PLATE", "TANK", "BOX", "SPRING", "BOUNCE"],
        "Character selector should expose all 8 room models"
    );

    const viz = boxMap.get("obj-viz").presentation_rect;
    for (const [id, box] of boxMap.entries()) {
        if (id === "obj-viz" || box.maxclass === "panel" || !box.presentation || !box.presentation_rect) continue;
        const r = box.presentation_rect;
        const overlapsX = r[0] < (viz[0] + viz[2]) && (r[0] + r[2]) > viz[0];
        const overlapsY = r[1] < (viz[1] + viz[3]) && (r[1] + r[3]) > viz[1];
        assert(!(overlapsX && overlapsY), `Presentation widget ${id} overlaps the v8ui canvas in ${path.basename(devPath)}`);
    }

    const boxOrder = p.boxes.map((b) => b.box.id);
    const firstCtrl = boxOrder.findIndex((id) => id.startsWith("obj-dial-"));
    for (const [id, box] of boxMap.entries()) {
        if (box.maxclass === "panel") {
            assert.strictEqual(box.background, 1, `${id} must sit behind the controls`);
            assert.ok(boxOrder.indexOf(id) > firstCtrl, `${id} must be listed after the controls`);
        }
    }
}
const boxMap = mainBoxMap;

// --- UI script from the device ---
const jsCode = boxMap.get("obj-viz").textfile.text;
assert.ok(jsCode.includes("function buildConfig"));
assert.ok(jsCode.includes("function paint"));

const shownTexts = [];
const mg = {
    size: [152, 58],
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
    show_text(t) { shownTexts.push(t); }
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
assert.strictEqual(shownTexts.length, 0, "Visualizer must not draw read-only line counter or L/R text labels");
setbuffer("cfg", "meters");
set_seed(3);
assert.strictEqual(bangs, 0, "First seed apply should not duck");
assert.ok(lastPoke && lastPoke.length === cfg.CFG_FLOATS, "Config poke length");
assert.strictEqual(lastPoke[0], cfg.buildConfig(3, 0).activeCount);
set_seed(9);
assert.strictEqual(bangs, 1, "Later seed changes duck the tank");
assert.strictEqual(lastPoke[0], cfg.buildConfig(9, 0).activeCount);
set_character(0);
assert.strictEqual(bangs, 1, "First character apply should not duck");
assert.ok(lastPoke[1] < 0.34, "COMB mode keeps character in comb range");
set_character(2);
assert.strictEqual(bangs, 2, "Changing character mode ducks the tank");
assert.ok(lastPoke[1] > 0.66, "ROOM mode puts character in room range");
for (let m = 3; m < cfg.CHAR_MODES.length; m++) {
    set_character(m);
    assert.strictEqual(lastPoke[cfg.CFG_MODEL], m, `Model ${m} poked into CFG_MODEL`);
}
set_viz_mode(0);
paint();
set_viz_mode(1);
loadbang();
paint();
assert.strictEqual(shownTexts.length, 0, "Neither overlay nor split mode should draw text labels");

console.log("test_tinyspace: ok");
