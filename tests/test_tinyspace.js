#!/usr/bin/env node
/**
 * Tiny Space: config invariants and devices/Tiny Space.amxd structure.
 * Run with: node tests/test_tinyspace.js
 */

const fs = require("fs");
const path = require("path");
const { minifyGen } = require("./minify_gen.js");
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
{
    const bands = [
        [0, 0, 0],
        [0.25, 0.15, 0.25],
        [0.5, 0.6, 0.8],
        [0.75, 2.5, 3.8],
        [0.9, 6.5, 9],
        [1, 24, 30],
    ];
    let prev = -1;
    for (const [k, lo, hi] of bands) {
        const rt = cfg.feedbackRt60(k);
        assert.ok(rt >= lo && rt <= hi, `RT60 at ${k * 100}% is ${rt}, expected ${lo}..${hi}`);
        assert.ok(rt > prev, "RT60 must rise with the feedback knob");
        prev = rt;
    }
    assert.strictEqual(cfg.feedbackRt60(0), 0);
    assert.ok(cfg.tailAmplitude(0.5, 0.25) > 0.05, "50% is still a slap at 250 ms");
    assert.ok(cfg.tailAmplitude(0.5, 1) < 0.002, "50% is silent by 1 second");
    const amp8 = cfg.tailAmplitude(1, 8);
    const amp10 = cfg.tailAmplitude(1, 10);
    assert.ok(amp8 > 0.08 && amp8 < 0.16, `full feedback at 8 s is ${amp8}`);
    assert.ok(amp10 > 0.04 && amp10 < amp8, "full feedback is still up at 10 seconds and falling");
    const gMs = cfg.feedbackGain(1, 1);
    const rtFromGain = 0.001 * Math.log(0.001) / Math.log(gMs);
    assert.ok(Math.abs(rtFromGain - cfg.feedbackRt60(1)) < 0.05, "loop gain matches feedbackRt60");
}
{
    const sr = 44100;
    assert.strictEqual(cfg.dampPole(8, 0, 0, sr), 0, "damp 0 is a bypass");
    assert.strictEqual(cfg.dampPole(1.5, 0, 0.35, 48000), 0, "damp 0 stays a bypass on a short line");
    const p20 = cfg.dampPole(8, 0.2, 0, sr);
    const p50 = cfg.dampPole(8, 0.5, 0, sr);
    const p100 = cfg.dampPole(8, 1, 0, sr);
    assert.ok(p20 > 0.4 && p20 < 0.6, `20% damp pole ${p20} should warm the top`);
    assert.ok(p50 > 0.7 && p50 < 0.86, `50% damp pole ${p50} should clearly darken`);
    assert.ok(p100 > 0.92 && p100 < 0.98, `100% damp pole ${p100} should be a deep lowpass`);
    assert.ok(p20 < p50 && p50 < p100, "more damp means a lower cutoff");
    const short = cfg.dampPole(1.5, 1, 0, sr);
    const long = cfg.dampPole(15, 1, 0, sr);
    assert.ok(short > 0.85 && short < 0.93, `1.5 ms full damp pole ${short}`);
    assert.ok(long > 0.94 && long < 0.98, `15 ms full damp pole ${long}`);
    assert.ok(short < long, "a short comb keeps a higher cutoff than a long line");
    assert.ok(cfg.dampPole(8, 1, 0.35, sr) > p100, "per-line offset can darken a line further");
    assert.ok(p100 < 0.995, "the damping pole stays stable");
}
assert.ok(Math.abs(cfg.sizeScale(0) - 0.22) < 1e-9);
assert.ok(Math.abs(cfg.sizeScale(1) - 2.15) < 1e-9);

// Unitary room mixes: M^T M = I, common mode stays audible, RT60 matches ringGain.
{
    function gramError(model, n, character) {
        let worst = 0;
        const cols = [];
        for (let i = 0; i < n; i++) {
            const basis = new Array(n).fill(0);
            basis[i] = 1;
            cols.push(cfg.fdnMix(model, n, character, basis).slice(0, n));
        }
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                let dot = 0;
                for (let k = 0; k < n; k++) dot += cols[i][k] * cols[j][k];
                worst = Math.max(worst, Math.abs(dot - (i === j ? 1 : 0)));
            }
        }
        const ones = new Array(n).fill(1);
        const img = cfg.fdnMix(model, n, character, ones);
        let sum = 0;
        for (let i = 0; i < n; i++) sum += img[i];
        return { worst, common: Math.abs(sum) / n };
    }

    const characters = [0, 0.15, 0.5, 0.85, 1];
    for (let model = 0; model < 8; model++) {
        for (let n = 1; n <= 10; n++) {
            for (const character of characters) {
                const g = gramError(model, n, character);
                assert.ok(
                    g.worst < 1e-8,
                    `model ${model} n ${n} ch ${character} is not orthogonal (${g.worst})`
                );
                assert.ok(
                    Math.abs(g.common - 1) < 1e-8,
                    `model ${model} n ${n} ch ${character} common-mode gain ${g.common}`
                );
            }
        }
    }

    const probe = [0.7, -0.4, 0.25, 0.1, -0.55, 0.33];
    const images = [];
    for (let model = 0; model < 8; model++) {
        images.push(cfg.fdnMix(model, 6, 0.5, probe).slice(0, 6).map((v) => Math.round(v * 1e6)));
    }
    for (let a = 0; a < 8; a++) {
        for (let b = a + 1; b < 8; b++) {
            assert.notDeepStrictEqual(
                images[a],
                images[b],
                `models ${a} and ${b} collapsed to the same mix`
            );
        }
    }

    // Energy in a unitary FDN with per-line ringGain decays as amplitude^2.
    function energyRatio(model, character, knob, tStart, tEnd) {
        const sr = 48000;
        const n = 6;
        const nominal = [1.15, 1.7, 2.4, 3.2, 4.3, 5.6];
        const delays = nominal.map((ms) => Math.max(1, Math.round(ms * cfg.sizeScale(0) * sr / 1000)));
        const gains = delays.map((samples) => cfg.feedbackGain(knob, samples * 1000 / sr));
        const maxD = Math.max.apply(null, delays);
        const state = [];
        const wp = [];
        for (let i = 0; i < n; i++) {
            state.push(new Float64Array(maxD + 2));
            wp.push(0);
        }
        const inv = 1 / Math.sqrt(n);
        const span = Math.floor(sr * tEnd);
        let eStart = 0;
        let eEnd = 0;
        const t0 = Math.floor(sr * tStart);
        const t1 = Math.floor(sr * tEnd);
        for (let t = 0; t < span; t++) {
            const o = new Array(n);
            let energy = 0;
            for (let i = 0; i < n; i++) {
                const buf = state[i];
                const rp = (wp[i] - delays[i] + buf.length) % buf.length;
                o[i] = buf[rp];
                // Only the live delay, not the unused tail of the circular buffer.
                for (let s = 0; s < delays[i]; s++) {
                    const idx = (wp[i] - 1 - s + buf.length) % buf.length;
                    energy += buf[idx] * buf[idx];
                }
            }
            if (t === t0) eStart = energy;
            if (t === t1 - 1) eEnd = energy;
            const mixed = cfg.fdnMix(model, n, character, o);
            const inj = t === 0 ? 0.25 * inv : 0;
            for (let i = 0; i < n; i++) {
                state[i][wp[i]] = mixed[i] * gains[i] + inj;
                wp[i] = (wp[i] + 1) % state[i].length;
            }
        }
        return { eStart, eEnd, ratio: eEnd / eStart };
    }

    const curveChecks = [
        [1, 0.2, 1.2],
        [0.9, 0.15, 0.85],
        [0.75, 0.08, 0.4],
        [0.5, 0.04, 0.18],
        [0.25, 0.015, 0.06],
    ];
    for (const [knob, tStart, tEnd] of curveChecks) {
        const dt = tEnd - tStart;
        const theoryEnergy = Math.pow(cfg.tailAmplitude(knob, dt), 2);
        const ratios = [];
        for (let model = 0; model < 8; model++) {
            const sim = energyRatio(model, 0.5, knob, tStart, tEnd);
            ratios.push(sim.ratio);
            assert.ok(sim.eStart > 1e-8, `model ${model} at ${knob} stored no energy`);
            assert.ok(sim.eEnd < sim.eStart, `model ${model} at ${knob} grew after the impulse`);
            const err = Math.abs(sim.ratio - theoryEnergy) / theoryEnergy;
            assert.ok(
                err < 0.08,
                `model ${model} at ${knob} energy ratio ${sim.ratio} vs theory ${theoryEnergy}`
            );
        }
        const lo = Math.min.apply(null, ratios);
        const hi = Math.max.apply(null, ratios);
        assert.ok(hi / lo < 1.08, `model RT60 spread at ${knob}: ${lo} .. ${hi}`);
    }
}

const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(gen.includes("ringGain"), "gen loop gain should match feedbackGain");
assert.ok(gen.includes("-6.90775527898"), "gen RT60 constant should match feedbackGain");
assert.ok(gen.includes("2.90663"), "gen feedback curve should match feedbackRt60");
assert.ok(gen.includes("19.9526"), "gen full-feedback term should match feedbackRt60");
assert.ok(!gen.match(/\be\d/), "e0 is Euler's number in GenExpr, not an envelope");
const fnAt = gen.indexOf("\nslew(target, coef)");
const paramAt = gen.indexOf("\nParam ");
const bufferAt = gen.indexOf("\nBuffer ");
assert.ok(fnAt > 0 && fnAt < paramAt && fnAt < bufferAt, "GenExpr functions must precede Param and Buffer");
assert.ok(gen.indexOf("peek(cfg, 0)") > bufferAt, "config peeks must follow the Buffer declaration");
assert.ok(gen.includes("clip(x0, -2, 2)"), "feedback path clips only when it would overload");
assert.ok(gen.includes("1e-7"), "silence threshold stays under the ring-tail floor");
assert.ok(gen.includes("32768"), "silence sleep waits more than 32768 samples");
assert.ok(gen.includes("poke(meters, frame, 20, 0)"), "frame counter is written even while the tank sleeps");
assert.ok(gen.includes("for (li = 0; li < 20; li += 1)"), "per-line coefficients refresh in one loop");
assert.ok(gen.includes("lp(del0.read"), "damping filters the delay tap, including the first reflection");
assert.ok(gen.includes("16000"), "damp cutoff should match dampPole");
assert.ok(!gen.includes("d0 = lp("), "damping is not applied only on the feedback write");
assert.ok(gen.includes("Householder"), "room model keeps a Householder reflection");
assert.ok(gen.includes("spin3"), "hybrid and spring rotate inside an orthogonal plane");
assert.ok(gen.includes("0.40824829046386302"), "spin plane should match fdnMix");
assert.ok(gen.includes("1.5707963267948966"), "crossfeed should be a half-turn rotation");
assert.ok(!gen.includes("* 0.72"), "plate mix should not scale by 0.72");
assert.ok(!gen.includes("* 0.84"), "tank mix should not scale by 0.84");
assert.ok(!gen.includes("* 0.16"), "tank mix should not scale by 0.16");
assert.strictEqual((gen.match(/delay\(/g) || []).length, 0, "delay() is not valid GenExpr");
assert.strictEqual((gen.match(/^Delay /gm) || []).length, 22, "top-level Delay objects: 2 predelay + 20 tank");
assert.strictEqual((gen.match(/^\tDelay /gm) || []).length, 1, "allpass body declares its own Delay");
assert.ok((gen.match(/\.read\(/g) || []).length >= 23, "each delay line is read");
assert.ok((gen.match(/\.write\(/g) || []).length >= 23, "each delay line is written");
assert.strictEqual((gen.match(/allpass\((tone|[aA])/g) || []).length, 8, "4 allpasses per channel");

// --- Device ---
for (const oldVariant of ["Tiny Space Modules.amxd", "Tiny Space Compact.amxd", "Tiny Space Split.amxd"]) {
    assert.ok(!fs.existsSync(path.join(ROOT_DIR, "devices", oldVariant)), `${oldVariant} should be deleted`);
}

const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected an audio effect");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
const ptchLen = raw.readUInt32LE(28);
assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.devicewidth, 292.0);
assert.deepStrictEqual(p.openrect, [0.0, 0.0, 292.0, 169.0]);
assert.strictEqual(p.openinpresentation, 1);

const boxMap = validatePatcherBoxesAndLines(p, "Tiny Space.amxd");
assert.ok(boxMap.get("obj-cfg").text.includes("#0-tsconfig"));
assert.ok(boxMap.get("obj-meters").text.includes("#0-tsmeters"));
assert.ok(
    /@samps (2[4-9]|[3-9]\d|\d{3,})/.test(boxMap.get("obj-meters").text),
    "meter buffer must hold envelopes 0..19 and the frame counter at slot 20"
);
assert.strictEqual(
    boxMap.get("obj-msg-genbufs").text,
    "cfg #0-tsconfig, meters #0-tsmeters",
    "gen binds Buffer variables cfg and meters to the #0 buffers"
);
assert.strictEqual(boxMap.get("obj-msg-genbufs").varname, "ts_genbufs");
assert.ok(!boxMap.has("obj-gen"), "device ships without a static gen~ / gen.codebox~");
const hub = boxMap.get("obj-gen-in");
assert.ok(hub, "missing obj-gen-in hub");
assert.strictEqual(hub.text, "gate 1 1");
assert.strictEqual(hub.varname, "ts_genin");
assert.strictEqual(hub.numinlets, 2);
assert.strictEqual(boxMap.get("obj-plugin").varname, "ts_plugin");
assert.strictEqual(boxMap.get("obj-plugout").varname, "ts_plugout");
assert.strictEqual(boxMap.get("obj-thisdevice").text, "live.thisdevice");
assert.strictEqual(boxMap.get("obj-msg-dsp").text, "init_dsp");
assert.strictEqual(boxMap.get("obj-msg-duck1").text, "duck 1");
assert.strictEqual(boxMap.get("obj-msg-duck1").varname, "ts_duck1");
function wired(src, dst, inlet) {
    return p.lines.some((l) => {
        const pl = l.patchline;
        return pl.source[0] === src && pl.destination[0] === dst && (inlet === undefined || pl.destination[1] === inlet);
    });
}
assert.ok(!wired("obj-plugin", "obj-plugout"), "no static plugin~ -> plugout~ bypass");
assert.ok(!p.lines.some((l) => l.patchline.source[0] === "obj-plugin" || l.patchline.destination[0] === "obj-plugout"),
    "plugin~ and plugout~ stay unconnected until gen~ is created");
assert.ok(wired("obj-msg-genbufs", "obj-gen-in", 1));
assert.ok(wired("obj-prep-duck", "obj-gen-in", 1));
assert.ok(wired("obj-msg-duck1", "obj-gen-in", 1));
assert.ok(wired("obj-thisdevice", "obj-msg-dsp", 0));
assert.ok(wired("obj-msg-dsp", "obj-viz", 0));
for (const key of ["size", "damp", "width", "mix", "feedback", "predly", "mod", "xfeed", "hp", "lp"]) {
    assert.ok(wired(`obj-prep-${key}`, "obj-gen-in", 1), `${key} must enter the hub's right inlet`);
}
for (const l of p.lines) {
    const [dst, inlet] = l.patchline.destination;
    if (dst === "obj-gen-in") assert.strictEqual(inlet, 1, "gen messages use gate inlet 1");
}

const expectedControls = ["Size", "Damp", "Width", "Mix", "Feedback", "PreDly", "Mod", "XFeed", "HP", "LP"];
for (const name of expectedControls) {
    const ctrl = [...boxMap.values()].find(
        (b) => (b.maxclass === "live.dial" || b.maxclass === "live.numbox") && b.varname === name
    );
    assert.ok(ctrl, `Missing control ${name}`);
    assert.strictEqual(ctrl.presentation, 1);
}
const seed = boxMap.get("obj-seed");
assert.strictEqual(seed.maxclass, "live.numbox");
assert.deepStrictEqual(seed.saved_attribute_attributes.valueof.parameter_mmax, 1000);
assert.strictEqual(
    seed.saved_attribute_attributes.valueof.parameter_type,
    0,
    "Seed must use parameter_type 0 (Float) with parameter_unitstyle 0 (Int) because M4L Int parameters clamp at 255 in Live"
);
assert.strictEqual(seed.saved_attribute_attributes.valueof.parameter_unitstyle, 0);

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
    assert(!(overlapsX && overlapsY), `Presentation widget ${id} overlaps the v8ui canvas`);
}

const boxOrder = p.boxes.map((b) => b.box.id);
const firstCtrl = boxOrder.findIndex((id) => id.startsWith("obj-dial-"));
for (const [id, box] of boxMap.entries()) {
    if (box.maxclass === "panel") {
        assert.strictEqual(box.background, 1, `${id} must sit behind the controls`);
        assert.ok(boxOrder.indexOf(id) > firstCtrl, `${id} must be listed after the controls`);
    }
}

// --- UI script from the device ---
const jsCode = boxMap.get("obj-viz").textfile.text;
assert.ok(jsCode.includes("function buildConfig"));
assert.ok(jsCode.includes("function paint"));
assert.ok(jsCode.includes("function init_dsp"));
assert.ok(jsCode.includes('Global("tinyspace_dspq")'));
const genDsp = jsCode.match(/var GEN_DSP_TEXT\s*=\s*("(?:\\.|[^"\\])*")\s*;\s*var GEN_DSP_HASH\s*=\s*"([0-9a-f]{12})"\s*;/);
assert.ok(genDsp, "face script must embed GEN_DSP_TEXT and GEN_DSP_HASH");
const genPatch = JSON.parse(JSON.parse(genDsp[1]));
const codebox = genPatch.patcher.boxes.find((b) => b.box.id === "obj-code");
assert.ok(codebox, "gendsp wrapper must contain the codebox");
assert.strictEqual(codebox.box.code, minifyGen(gen), "embedded genexpr is the mangled src/tinyspace_core.genexpr");
assert.strictEqual(codebox.box.numinlets, 2);
assert.strictEqual(codebox.box.numoutlets, 2);
const genIns = genPatch.patcher.boxes.filter((b) => String(b.box.text || "").startsWith("in "));
const genOuts = genPatch.patcher.boxes.filter((b) => String(b.box.text || "").startsWith("out "));
assert.strictEqual(genIns.length, 2);
assert.strictEqual(genOuts.length, 2);

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
