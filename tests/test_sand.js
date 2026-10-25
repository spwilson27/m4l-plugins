#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { minifyGen } = require("./minify_gen.js");
const ROOT = path.join(__dirname, "..");
const AMXD_PATH = path.join(ROOT, "devices", "Sand.amxd");
const GEN_PATH = path.join(ROOT, "src", "sand_core.genexpr");

const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(gen.includes("channel("), "wet path is the differential compander");
assert.ok(gen.includes("compand("), "compander function is present");
assert.ok(gen.includes("History p15(0)"), "fifteen separate derivative memories");
assert.ok(gen.includes("History q15(0)"), "fifteen startup impulse guards");
assert.ok(gen.includes("nrm = 0.5;"), "differentiators must be Nyquist-normalized (nrm = 0.5)");
assert.ok(!gen.includes("1e6"), "differentiators must clip tightly to +-8, never 1e6");
assert.ok(gen.includes("integ("), "order -1 integrates");
assert.ok(!gen.match(/\be\d/), "e-digits are Euler's number in GenExpr");
assert.strictEqual((gen.match(/delay\(/g) || []).length, 0, "delay() is not valid GenExpr");
const fnAt = gen.indexOf("\nslew(");
const paramAt = gen.indexOf("\nParam ");
const bufferAt = gen.indexOf("\nBuffer ");
assert.ok(fnAt > 0 && fnAt < paramAt && fnAt < bufferAt, "GenExpr functions must precede Param and Buffer");
// Two call sites keep per-channel History. exp/sin/cos stay outside channel.
assert.ok(/^channel\(/m.test(gen), "channel is defined once at function scope");
assert.ok(gen.includes("wetL = channel(") && gen.includes("wetR = channel("), "L and R are separate channel call sites");
const integFn = gen.slice(gen.indexOf("\ninteg("), gen.indexOf("\ncompand("));
const compFn = gen.slice(gen.indexOf("\ncompand("), gen.indexOf("\nfilt("));
const filtFn = gen.slice(gen.indexOf("\nfilt("), gen.indexOf("\nlimit("));
const chanFn = gen.slice(gen.indexOf("\nchannel("), gen.indexOf("\nBuffer "));
assert.ok(!integFn.includes("exp("), "integrator coefficient is hoisted");
assert.ok(!compFn.includes("exp("), "compander gain is hoisted");
assert.ok(!filtFn.includes("exp("), "filter coefficient is hoisted");
assert.ok(!chanFn.includes("exp(") && !chanFn.includes("sin(") && !chanFn.includes("cos("), "channel() does not recompute transcendentals");
assert.ok(gen.includes("coefOk"), "coefficient cache sentinel");
assert.ok(gen.includes("if (ord > 0.5)"), "unused differentiator stages are skipped");
assert.ok(gen.includes("if (preOn > 0.5)"), "inactive pre filter is skipped");
assert.ok(gen.includes("if (midOn > 0.5)"), "inactive mid filter is skipped");
assert.ok(gen.includes("if (postOn > 0.5)"), "inactive post filter is skipped");
assert.ok(gen.includes("poke(wave, out1, wpos, 0)"), "scope ring map unchanged");
assert.ok(gen.includes("poke(wave, pkIn, 256, 0)"), "peak telemetry map unchanged");
assert.ok(gen.includes("poke(wave, wpos, 259, 0)"), "wpos at frame 259 is the DSP-alive counter");
assert.ok(gen.includes("wrap(hop + 1, 0, 32)"), "counter advances every 32 samples");

const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected an audio effect");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
const ptchLen = raw.readUInt32LE(28);
assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.devicewidth, 296);
assert.deepStrictEqual(p.openrect, [0, 0, 296, 169]);
assert.strictEqual(p.openinpresentation, 1);

const boxMap = new Map(p.boxes.map((b) => [b.box.id, b.box]));
assert.ok(boxMap.get("obj-wave").text.includes("#0-sandwave"));
assert.strictEqual(boxMap.get("obj-msg-genbufs").text, "wave #0-sandwave");
assert.strictEqual(boxMap.get("obj-msg-uibufs").text, "setbuffer #0-sandwave");
assert.strictEqual(boxMap.get("obj-gen"), undefined, "Sand ships without a static gen~");
assert.ok(![...boxMap.values()].some((b) => b.maxclass === "gen.codebox~" || b.maxclass === "gen~"), "no gen object in the patcher");
const hub = boxMap.get("obj-gen-in");
assert.ok(hub, "missing gen message hub");
assert.strictEqual(hub.text, "gate 1 1");
assert.strictEqual(hub.varname, "sand_genin");
assert.strictEqual(hub.numinlets, 2);
assert.strictEqual(boxMap.get("obj-plugin").varname, "sand_plugin");
assert.strictEqual(boxMap.get("obj-plugout").varname, "sand_plugout");
assert.strictEqual(boxMap.get("obj-msg-initdsp").text, "init_dsp");
assert.strictEqual(boxMap.get("obj-thisdevice").text, "live.thisdevice");

// Only Mix remains as a radial dial on the right column
for (const name of ["Mix"]) {
    const dial = [...boxMap.values()].find((b) => b.maxclass === "live.dial" && b.varname === name);
    assert.ok(dial, `Missing dial ${name}`);
    assert.strictEqual(dial.presentation, 1);
}
for (const removed of ["Amount", "Freq", "Soft", "Debrick", "Dry", "Wet"]) {
    const dial = [...boxMap.values()].find((b) => b.maxclass === "live.dial" && b.varname === removed);
    assert.strictEqual(dial, undefined, `Radial dial ${removed} should be removed`);
}
assert.strictEqual(boxMap.get("obj-route"), undefined, "Mix/Split selector should be removed");

// Soft and Debrick are horizontal percentage value bars (live.numbox with appearance=2, unitstyle=5)
for (const [id, name] of [["obj-soft", "Soft"], ["obj-debrick", "Debrick"]]) {
    const bar = boxMap.get(id);
    assert.ok(bar && bar.maxclass === "live.numbox", `${name} should be a live.numbox value bar`);
    assert.strictEqual(bar.appearance, 2, `${name} should use appearance=2 (Slider value bar)`);
    assert.strictEqual(bar.saved_attribute_attributes.valueof.parameter_unitstyle, 5, `${name} should be a percentage (%)`);
    assert.strictEqual(bar.saved_attribute_attributes.valueof.parameter_mmax, 100);
}

// Amount, Freq, and Out are automatable value/selection boxes in the main graphic header strip
const amountBox = boxMap.get("obj-amount");
assert.ok(amountBox && amountBox.maxclass === "live.numbox", "Amount should be an automatable value box");
assert.strictEqual(amountBox.saved_attribute_attributes.valueof.parameter_mmax, 140);

const freqBox = boxMap.get("obj-freq");
assert.ok(freqBox && freqBox.maxclass === "live.numbox", "Freq should be an automatable value box");
assert.strictEqual(freqBox.saved_attribute_attributes.valueof.parameter_mmax, 18000);

const outBox = boxMap.get("obj-out");
assert.ok(outBox && outBox.maxclass === "live.numbox", "Out should be a selection value box");
assert.strictEqual(outBox.appearance, 1, "Out should use appearance=1 (Triangle selector)");
assert.deepStrictEqual(
    outBox.saved_attribute_attributes.valueof.parameter_enum,
    ["Off", "Hard", "Limit"]
);

const filtTab = boxMap.get("obj-filt");
assert.strictEqual(filtTab.usepicture, 1, "Filter tab should use SVG filter icons");
assert.strictEqual(filtTab.remapsvgcolors, 1, "Filter tab should remap SVG colors");
assert.deepStrictEqual(filtTab.pictures, ["highcut.svg", "bandpass.svg", "lowcut.svg"]);

const placeTab = boxMap.get("obj-place");
assert.deepStrictEqual(
    placeTab.saved_attribute_attributes.valueof.parameter_enum,
    ["Pre", "Diff", "Post"]
);

const order = boxMap.get("obj-order");
assert.strictEqual(order.saved_attribute_attributes.valueof.parameter_mmin, -1);
assert.strictEqual(order.saved_attribute_attributes.valueof.parameter_mmax, 15);
assert.strictEqual(boxMap.get("obj-stages").saved_attribute_attributes.valueof.parameter_mmax, 4);

// Verify right-column controls all stay inside the right panel [210..290] and are sorted top-to-bottom
const rightColIds = ["obj-filt", "obj-place", "obj-soft-lbl", "obj-soft", "obj-debrick-lbl", "obj-debrick", "obj-dial-mix"];
let prevY = 0;
for (const id of rightColIds) {
    const r = boxMap.get(id).presentation_rect;
    assert.ok(r[0] >= 210 && (r[0] + r[2]) <= 290, `${id} must sit inside the right column [210..290]`);
    assert.ok(r[1] >= prevY, `${id} must be stacked top-to-bottom in the single column`);
    prevY = r[1];
}

// Verify no presentation widget overlaps the v8ui canvas, and no two interactive widgets overlap each other
const viz = boxMap.get("obj-viz").presentation_rect;
const interactiveBoxes = [];
for (const [id, box] of boxMap.entries()) {
    if (id === "obj-viz" || box.maxclass === "panel" || !box.presentation || !box.presentation_rect) continue;
    const r = box.presentation_rect;
    const overlapsX = r[0] < (viz[0] + viz[2]) && (r[0] + r[2]) > viz[0];
    const overlapsY = r[1] < (viz[1] + viz[3]) && (r[1] + r[3]) > viz[1];
    assert.ok(!(overlapsX && overlapsY), `Presentation widget ${id} overlaps the v8ui canvas`);
    if (box.maxclass.startsWith("live.") && box.maxclass !== "live.comment") {
        interactiveBoxes.push([id, r]);
    }
}
for (let i = 0; i < interactiveBoxes.length; i++) {
    for (let j = i + 1; j < interactiveBoxes.length; j++) {
        const [idA, a] = interactiveBoxes[i];
        const [idB, b] = interactiveBoxes[j];
        const ox = a[0] < (b[0] + b[2]) && (a[0] + a[2]) > b[0];
        const oy = a[1] < (b[1] + b[3]) && (a[1] + a[3]) > b[1];
        assert.ok(!(ox && oy), `Interactive controls ${idA} and ${idB} overlap`);
    }
}

// Verify patchline routing for all controls and bidirectional XY scope drag
const lineSet = new Set(
    p.lines.map((l) => `${l.patchline.source[0]}:${l.patchline.source[1]}->${l.patchline.destination[0]}:${l.patchline.destination[1]}`)
);
for (const expectedLine of [
    "obj-order:0->obj-prep-order:0",
    "obj-prep-order:0->obj-gen-in:1",
    "obj-stages:0->obj-prep-stages:0",
    "obj-prep-stages:0->obj-gen-in:1",
    "obj-amount:0->obj-prep-amount:0",
    "obj-prep-amount:0->obj-gen-in:1",
    "obj-freq:0->obj-prep-freq:0",
    "obj-prep-freq:0->obj-gen-in:1",
    "obj-out:0->obj-prep-out:0",
    "obj-prep-out:0->obj-gen-in:1",
    "obj-filt:0->obj-prep-filt:0",
    "obj-prep-filt:0->obj-gen-in:1",
    "obj-place:0->obj-prep-place:0",
    "obj-prep-place:0->obj-gen-in:1",
    "obj-soft:0->obj-prep-soft:0",
    "obj-prep-soft:0->obj-gen-in:1",
    "obj-debrick:0->obj-prep-debrick:0",
    "obj-prep-debrick:0->obj-gen-in:1",
    "obj-dial-mix:0->obj-prep-mix:0",
    "obj-prep-mix:0->obj-gen-in:1",
    "obj-msg-genbufs:0->obj-gen-in:1",
    "obj-thisdevice:0->obj-msg-initdsp:0",
    "obj-msg-initdsp:0->obj-viz:0",
    "obj-viz:1->obj-gen-in:1",
    "obj-viz:0->obj-route-viz:0",
    "obj-route-viz:0->obj-set-amount:0",
    "obj-set-amount:0->obj-amount:0",
    "obj-route-viz:1->obj-set-freq:0",
    "obj-set-freq:0->obj-freq:0",
]) {
    assert.ok(lineSet.has(expectedLine), `Missing patchline ${expectedLine}`);
}
assert.ok(![...lineSet].some((l) => l.includes("obj-plugout") && l.startsWith("obj-plugin:")), "plugin~ must not bypass to plugout~");
assert.ok(![...lineSet].some((l) => l.includes("obj-gen:")), "no cord touches a static gen~");
for (const l of p.lines) {
    if (l.patchline.destination[0] === "obj-gen-in") {
        assert.strictEqual(l.patchline.destination[1], 1, "gen-bound cords go into the hub data inlet");
    }
}

const boxOrder = p.boxes.map((b) => b.box.id);
const firstDial = boxOrder.findIndex((id) => id.startsWith("obj-dial-"));
for (const panelId of ["obj-panel-hud", "obj-panel-viz", "obj-panel-dials"]) {
    assert.strictEqual(boxMap.get(panelId).background, 1, `${panelId} must sit behind the controls`);
    assert.ok(boxOrder.indexOf(panelId) > firstDial, `${panelId} must be listed after the dials`);
}

const jsCode = boxMap.get("obj-viz").textfile.text;
assert.ok(jsCode.includes("function paint"));
const genHeader = jsCode.match(/var GEN_DSP_TEXT\s*=\s*("(?:\\.|[^"\\])*")\s*;\s*var GEN_DSP_HASH\s*=\s*"([0-9a-f]{12})"\s*;/);
assert.ok(genHeader, "face script must embed GEN_DSP_TEXT and GEN_DSP_HASH");
const genDspText = JSON.parse(genHeader[1]);
assert.strictEqual(genHeader[2], crypto.createHash("sha1").update(genDspText).digest("hex").slice(0, 12));
const gendsp = JSON.parse(genDspText);
const codeBox = gendsp.patcher.boxes.find((b) => b.box.id === "obj-code");
assert.ok(codeBox && codeBox.box.maxclass === "codebox", "gendsp wraps a codebox");
assert.strictEqual(codeBox.box.code, minifyGen(gen), "GEN_DSP_TEXT codebox is the mangled src/sand_core.genexpr");
assert.strictEqual(codeBox.box.numinlets, 2);
assert.strictEqual(codeBox.box.numoutlets, 2);
const uiPart = jsCode.slice(genHeader[0].length);
assert.ok(uiPart.includes('new Global("sand_dspq")'), "instances create gen~ one at a time");
assert.ok(uiPart.includes("function sandDspPillOn"));
assert.ok(/sandDsp\.createdAt\s*>\s*0\s*\|\|\s*sandDsp\.error/.test(uiPart));
assert.ok(uiPart.includes("DSP loading..."));
assert.ok(uiPart.includes("DSP failed:"));
assert.ok(uiPart.includes("ensureTransferCurve"));
assert.ok(uiPart.includes("sandScopeActive"));
assert.ok(uiPart.includes('["wave"') && uiPart.includes('"#0-sandwave"'), "resend binds the scope buffer from JS");
assert.ok(uiPart.includes('["outmode"'), "resend sends gen params from JS state");
assert.ok(!/message\(\s*"bang"\s*\)/.test(uiPart), "resend must not bang controls (a live.text toggle would flip)");

const mg = {
    size: [192, 114],
    relative_coords: 1,
    autofill: 1,
    init() {},
    redraw() {},
    set_source_rgba() {},
    set_line_width() {},
    rectangle() {},
    rectangle_rounded() {},
    arc() {},
    close_path() {},
    fill() {},
    stroke() {},
    move_to() {},
    line_to() {},
    select_font_face() {},
    set_font_size() {},
    show_text() {},
};
const emitted = [];
const mockOutlet = (idx, msg) => emitted.push([idx, msg]);
const fn = new Function(
    "mgraphics",
    "inlets",
    "outlets",
    "outlet",
    jsCode + "\nreturn { paint, onclick, ondrag, set_amount, set_soft, set_debrick, set_freq, set_order, set_stages, set_ftype, set_fpos, set_outmode, set_mix, compandEval, ensureTransferCurve, sandDspPillOn, mgraphics };"
);
const ui = fn(mg, 1, 1, mockOutlet);
ui.paint();
assert.strictEqual(mg.relative_coords, 0);
assert.strictEqual(mg.autofill, 0);
assert.ok(!ui.sandDspPillOn(), "static preview has no DSP pill");

// Verify compander transfer curve responds to Amount and Debrick
const lowLift = ui.compandEval(0.2);
ui.set_amount(120);
const highLift = ui.compandEval(0.2);
assert.ok(highLift > lowLift, "Transfer curve must rise when Amount increases");
ui.set_debrick(100);
const debricked = ui.compandEval(0.2);
assert.ok(debricked < highLift, "Transfer curve must ease back when Debrick is 100%");

// Verify interactive XY scope drag emits ["amount", db] and ["freq", hz]
ui.onclick(80, 30);
assert.strictEqual(emitted.length, 2, "Scope click/drag should emit amount and freq");
assert.strictEqual(emitted[0][1][0], "amount");
assert.ok(emitted[0][1][1] >= 0 && emitted[0][1][1] <= 140);
assert.strictEqual(emitted[1][1][0], "freq");
assert.ok(emitted[1][1][1] >= 20 && emitted[1][1][1] <= 18000);

// The amount and frequency reticles are the values. A click on their crossing has to
// leave both numbers where they were (within the 0.1 dB / 1 Hz rounding).
const reticleStrokes = [];
let reticleRgba = [0, 0, 0, 1];
let reticlePen = null;
mg.set_source_rgba = (r, g, b, a) => { reticleRgba = [r, g, b, a]; };
mg.move_to = (x, y) => { reticlePen = [x, y]; };
mg.line_to = (x, y) => {
    if (reticlePen) reticleStrokes.push({ x0: reticlePen[0], y0: reticlePen[1], x1: x, y1: y, rgba: reticleRgba.slice() });
    reticlePen = [x, y];
};
mg.stroke = () => { reticlePen = null; };
function sandReticleClick(db, hz) {
    ui.set_amount(db);
    ui.set_freq(hz);
    reticleStrokes.length = 0;
    ui.paint();
    const horiz = reticleStrokes.filter((s) => Math.abs(s.y0 - s.y1) < 0.01 && s.rgba[0] > 0.9 && s.rgba[1] > 0.6 && s.rgba[1] < 0.75);
    const vert = reticleStrokes.filter((s) => Math.abs(s.x0 - s.x1) < 0.01 && s.rgba[2] > 0.9 && s.rgba[0] < 0.4);
    assert.ok(horiz.length && vert.length, "amount and freq reticles were painted");
    const amt = horiz[0];
    const fr = vert.slice().sort((a, b) => Math.abs(b.y1 - b.y0) - Math.abs(a.y1 - a.y0))[0];
    emitted.length = 0;
    ui.onclick(fr.x0, amt.y0);
    const gotA = emitted.find((e) => e[1][0] === "amount");
    const gotF = emitted.find((e) => e[1][0] === "freq");
    return { amount: gotA[1][1], freq: gotF[1][1] };
}
const reticleJumps = [];
for (const [db, hz] of [[18, 14000], [0, 20], [140, 18000], [70, 600]]) {
    const got = sandReticleClick(db, hz);
    if (Math.abs(got.amount - db) > 0.1 || Math.abs(got.freq - hz) > 1) {
        reticleJumps.push(`${db} dB/${hz} Hz -> ${got.amount} dB/${got.freq} Hz`);
    }
}
assert.strictEqual(reticleJumps.length, 0, "Sand reticle click moved " + reticleJumps.join("; "));

console.log("test_sand: ok");
