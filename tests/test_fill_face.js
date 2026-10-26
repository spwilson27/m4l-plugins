"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makeRecorder, loadFace, checkRecording } = require("./paint_bounds_lib.js");

const amxd = fs.readFileSync(path.join(__dirname, "..", "devices", "Fill.amxd"));
const doc = JSON.parse(amxd.slice(32).toString("utf8"));
const boxes = doc.patcher.boxes.map((b) => b.box);
const byId = {};
for (const b of boxes) byId[b.id] = b;

function rect(id) {
    const r = byId[id].presentation_rect;
    return { x: r[0], y: r[1], w: r[2], h: r[3], id };
}

function overlaps(a, b) {
    return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
}

function valueof(id) {
    return byId[id].saved_attribute_attributes.valueof;
}

const open = doc.patcher.openrect;
assert.strictEqual(open[2], 400, "width");
assert.strictEqual(open[3], 169, "height");
assert.strictEqual(doc.patcher.devicewidth, 400);
assert.strictEqual(doc.patcher.latency, 1536);

const viz = rect("obj-viz");
assert.deepStrictEqual([viz.x, viz.y, viz.w, viz.h], [164, 22, 232, 147]);
assert.notStrictEqual(byId["obj-viz"].ignoreclick, 1, "picture stays clickable");

const presented = boxes.filter((b) => b.presentation === 1 && !b.hidden && b.maxclass !== "panel");
for (const b of presented) {
    const r = b.presentation_rect;
    assert.ok(r[0] >= -0.1 && r[1] >= -0.1 && r[0] + r[2] <= 400.1 && r[1] + r[3] <= 169.1, b.id + " inside the device");
}
for (let i = 0; i < presented.length; i++) {
    for (let j = i + 1; j < presented.length; j++) {
        const a = presented[i].presentation_rect;
        const b = presented[j].presentation_rect;
        assert.ok(!overlaps({ x: a[0], y: a[1], w: a[2], h: a[3] }, { x: b[0], y: b[1], w: b[2], h: b[3] }),
            presented[i].id + " overlaps " + presented[j].id);
    }
}
for (const b of presented) {
    if (!String(b.maxclass).startsWith("live.")) continue;
    const r = b.presentation_rect;
    assert.ok(!overlaps({ x: r[0], y: r[1], w: r[2], h: r[3] }, viz), b.id + " overlaps the picture");
}

const normal = ["tune", "tuner", "strike", "striker", "damp", "dampr", "beater", "beaterr", "metal", "metalr", "space", "spacer", "bmodel", "amodel"];
const experimental = ["mass", "massr", "scatter", "scatterr", "decay", "decayr", "couple", "coupler", "bite", "biter", "air", "airr"];
for (const key of normal) assert.notStrictEqual(byId["obj-ctrl-" + key].hidden, 1, key + " visible on Normal");
for (const key of experimental) assert.strictEqual(byId["obj-ctrl-" + key].hidden, 1, key + " hidden until Experimental");
for (const key of ["tune", "strike", "damp", "beater", "metal", "space"]) {
    assert.notStrictEqual(byId["obj-lbl-" + key].hidden, 1);
}
for (const key of ["mass", "scatter", "decay", "couple", "bite", "air"]) {
    assert.strictEqual(byId["obj-lbl-" + key].hidden, 1);
}

assert.strictEqual(byId["obj-ctrl-tune"].appearance, 3, "Tune fills from the center");
assert.strictEqual(byId["obj-ctrl-strike"].appearance, 2, "Strike fills from the left");
assert.strictEqual(byId["obj-ctrl-bcolor"].appearance, 3);
assert.deepStrictEqual(byId["obj-ctrl-tune"].textcolor, [0.93, 0.94, 0.96, 1]);
const tuneBg = byId["obj-ctrl-tune"].activebgcolor;
const tuneBar = byId["obj-ctrl-tune"].activeslidercolor;
const accent = [1, 0.678, 0.337];
for (let i = 0; i < 3; i++) {
    const expect = Math.round((tuneBg[i] * 0.62 + accent[i] * 0.38) * 10000) / 10000;
    assert.strictEqual(tuneBar[i], expect, "preblended slider fill");
}
assert.strictEqual(tuneBar[3], 1);

assert.strictEqual(valueof("obj-ctrl-picture").parameter_invisible, 1, "Picture is stored only");
assert.deepStrictEqual(valueof("obj-ctrl-picture").parameter_enum, ["Matter", "Ring", "Scar", "Dust"]);
assert.strictEqual(valueof("obj-ctrl-picture").parameter_initial[0], 0);
assert.strictEqual(byId["obj-ctrl-picture"].hidden, 1, "Picture parameter is not a live widget on the canvas");
assert.strictEqual(valueof("obj-ctrl-seed").parameter_invisible, 1);
assert.strictEqual(valueof("obj-ctrl-seed").parameter_type, 0, "Seed is float so it can pass 255");
assert.strictEqual(valueof("obj-ctrl-seed").parameter_unitstyle, 0);
assert.strictEqual(valueof("obj-ctrl-seed").parameter_mmax, 1000);
assert.strictEqual(byId["obj-ctrl-mode"].hidden, 1, "Tune Mode stays off the header");
assert.deepStrictEqual(valueof("obj-ctrl-page").parameter_enum, ["Normal", "Experimental"]);
assert.strictEqual(valueof("obj-ctrl-sens").parameter_initial[0], 45);
assert.strictEqual(valueof("obj-ctrl-rand").parameter_initial[0], 0);
assert.strictEqual(valueof("obj-ctrl-mix").parameter_initial[0], 100);
assert.strictEqual(valueof("obj-ctrl-beater").parameter_initial[0], 100);
assert.strictEqual(valueof("obj-ctrl-mass").parameter_initial[0], 35);
assert.strictEqual(valueof("obj-ctrl-bdecay").parameter_initial[0], 40);
assert.strictEqual(byId["obj-ctrl-bdecay"].hidden, 1, "IR centers stay off the six-wide column");

for (const b of boxes) {
    const id = String(b.id || "");
    const vn = String(b.varname || "");
    const longn = String((b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_longname) || "");
    assert.ok(!/phrase|length|step|link/i.test(id + " " + vn), id + " is a removed clock/link box");
    assert.ok(!/\b(start|end)\b/i.test(longn), longn + " still says start/end");
}

assert.ok(byId["obj-scope-buf"].text.includes("@samps 64"));
assert.ok(byId["obj-bank-buf"].text.includes("@samps 832"));
assert.strictEqual(byId["obj-bank-buf"].varname, "fill_bank");
for (const key of normal.concat(experimental).concat(["page", "sens", "rand", "mix", "picture", "seed"])) {
    assert.strictEqual(byId["obj-ctrl-" + key].varname, "obj-ctrl-" + key);
}

const last = boxes[boxes.length - 1];
assert.strictEqual(last.id, "obj-panel-body");
assert.strictEqual(last.maxclass, "panel");
assert.strictEqual(last.background, 1);

const outs = [];
const sets = [];
function fake(name) {
    return {
        valid: 1,
        message(m, v) { sets.push([name, m, v]); },
    };
}
const patcher = {
    getnamed(n) { return fake(n); },
    setattr() {},
    newdefault() { return null; },
    connect() {},
    remove() {},
};
const rec = makeRecorder(232, 147);
const face = loadFace(byId["obj-viz"].textfile.text, rec, {
    outlet(i, msg) { outs.push([i, msg]); },
    patcher,
});

assert.strictEqual(face.fillP.page, 0);
assert.strictEqual(face.fillP.picture, 0);
function genMsg(key, raw) {
    outs.length = 0;
    face["set_" + key](raw);
    assert.strictEqual(outs.length, 1, key);
    assert.strictEqual(outs[0][0], 0, key);
    assert.strictEqual(outs[0][1][0], { strike: "strike", beater: "beater", tuner: "tuner", rand: "randamt", mix: "wet", bmodel: "bmodel", amodel: "amodel" }[key]);
    return outs[0][1][1];
}
assert.ok(Math.abs(genMsg("strike", 50) - 0.5) < 1e-9);
assert.ok(Math.abs(genMsg("beater", 200) - 2) < 1e-9);
assert.strictEqual(genMsg("tuner", 12), 12);
assert.ok(Math.abs(genMsg("rand", 25) - 0.25) < 1e-9);
assert.ok(Math.abs(genMsg("mix", 50) - 0.5) < 1e-9);
assert.strictEqual(genMsg("bmodel", 2), 2, "Body menu reaches the gen");
assert.strictEqual(genMsg("amodel", 3), 3, "Air menu reaches the gen");

sets.length = 0;
outs.length = 0;
face.set_page(1);
assert.strictEqual(face.fillP.page, 1);
assert.ok(sets.some((s) => s[0] === "obj-ctrl-tune" && s[1] === "hidden" && s[2] === 1), "Normal wings hide");
assert.ok(sets.some((s) => s[0] === "obj-ctrl-mass" && s[1] === "hidden" && s[2] === 0), "Experimental wings show");
assert.ok(sets.some((s) => s[0] === "obj-ctrl-bmodel" && s[1] === "hidden" && s[2] === 1));
const pageMsg = outs[0];
if (pageMsg[1][0] !== "page" || pageMsg[1][1] !== 1 || pageMsg[0] !== 0) {
    throw new Error("page message " + JSON.stringify(pageMsg) + " types " + pageMsg.map((x) => typeof x).join(",") + " inner " + (pageMsg[1] && typeof pageMsg[1][1]));
}

outs.length = 0;
face.onclick(20, 140);
face.onclick(80, 140);
face.onclick(140, 140);
face.onclick(200, 140);
assert.deepStrictEqual(outs.map((o) => o[1]), [0, 1, 2, 3], "picture strip sends the index");
assert.ok(outs.every((o) => o[0] === 1));
assert.strictEqual(face.fillP.picture, 3, "the click updates the picture without waiting for the menu");
outs.length = 0;
face.onclick(20, 40);
assert.strictEqual(outs.length, 0, "a click in the plot does not change the picture");
assert.strictEqual(face.fillClickPicture(0.125, 0.96), 0, "normalized Matter click");
assert.strictEqual(face.fillClickPicture(0.875, 0.96), 3, "normalized Dust click");
face.set_picture(2);
assert.strictEqual(face.fillP.picture, 2);

face.fillBufScope = {
    peek() {
        const raw = [0.2, 0.4, 0.7, 6, 0, 1, 1, 40];
        for (let i = 0; i < 32; i++) raw.push(i === 0 ? 0.05 : 0);
        return raw;
    },
};
face.fillPullScope();
assert.strictEqual(face.fillTele.hit, 6, "scope hit reaches the picture");
assert.ok(face.fillTele.slots[7] > 1, "scope frame is read");
assert.ok(face.fillEnergyAt(0) > 0.4, "the output envelope moves the picture when mode energy is quiet");

const poked = [];
const bankMem = {};
face.fillBufBank = {
    poke(ch, index, arr) {
        poked.push([ch, index, arr.length, arr[0]]);
        if (index === 16 && arr.length > 8) bankMem.phase = arr[0];
    },
    peek() { return [0]; },
};
face.fillP.page = 1;
face.fillP.seed = 1;
face.fillP.mass = 0;
face.fillP.massr = 0;
face.fillP.rand = 0;
face.fillBankGen = 0;
face.fillBankSig = "";
face.fillTele.hit = 0;
outs.length = 0;
face.fillPublishBank();
const lowPhase = bankMem.phase;
assert.ok(face.fillBankGen >= 1, "experimental page writes a generation");
assert.ok(poked.some((p) => p[0] === 1 && p[1] === 16 && p[2] === 408), "the coefficient page is poked on channel 1");
assert.ok(outs.some((o) => o[0] === 0 && o[1][0] === "bankgen" && o[1][1] >= 1), "bankgen is sent to the gen");
face.fillP.mass = 100;
face.fillPublishBank();
assert.ok(bankMem.phase > lowPhase * 4, "Mass rewrites the page the gen is playing, not the spare slot");
assert.ok(poked.filter((p) => p[1] === 0).every((p) => p[3] === 0), "the gen keeps reading page 0");
face.fillP.mass = 50;
face.fillP.massr = 100;
face.fillP.rand = 100;
face.fillTele.hit = 1;
face.fillPublishBank();
const hitA = bankMem.phase;
face.fillTele.hit = 2;
face.fillPublishBank();
assert.notStrictEqual(hitA, bankMem.phase, "a new hit with range and Rand rewrites the sounding page");

for (const name of ["normal-matter", "exp-matter", "ring", "scar", "dust"]) {
    face.previewState(name);
    rec.begin(name);
    face.paint();
    rec.end();
    const bad = checkRecording(rec, { regions: [{ x: 0, y: 0, w: 232, h: 147 }] });
    assert.deepStrictEqual(bad, [], name + " paint bounds " + bad.join("; "));
}
face.previewState("exp-matter");
rec.begin("coeffs");
face.paint();
rec.end();
assert.ok(rec.shapes.some((s) => s.text && s.text.indexOf("408") >= 0), "experimental strip names the coefficient count");

console.log("fill face ok");
