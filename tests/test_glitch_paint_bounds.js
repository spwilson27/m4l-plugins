#!/usr/bin/env node
"use strict";
/**
 * Paint bounds for the Glitch face: nothing a tile, the pad or the editor draws may leave its own panel, whatever the telemetry or the
 * parameters are (this is the "MIRROR's pivot line and SCRAM's bars shoot out of their tile" bug: raw cepstrum values and unclamped heights).
 *
 * Uses the recording mgraphics mock of tests/paint_bounds_lib.js (the one the splitter faces use): every fill / stroke / text is recorded as
 * its bounding box (stroke widths and the text box included), and each must lie inside the rect of the thing being painted:
 *   - every tile glyph (paintTileBody) inside its body rect, and the whole tile (title, badge, motion pill, lock, readout, bar) inside the tile
 *     rect, for all 42 tiles at every size class (big, compact 4 x 2, small 4 x 3, paged) and the first / last tile of a page;
 *   - the XY pad inside the pad rect (corner glows, puck, lines) in Working / Morph / Seq;
 *   - the editor inside the editor panel (PARAMS and MOTION tabs, every movement type) and every param row's bar: label and value text
 *     plus a fill that matches the value;
 *   - the rail (EDIT / SLOTS / SEQ / gear) inside the rail, its rotated labels fit their buttons.
 * Scenarios: telemetry zero / one / half / random / +-50 / 1e9 / negative / NaN / sparse spikes / raw cepstra up to +-80; parameters at
 * their defaults, minimum, maximum, random, beyond the range and NaN; locked and moving tiles.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeRecorder, loadFace } = require("./paint_bounds_lib");

const SRC = path.join(__dirname, "..", "src");
const code = fs.readFileSync(path.join(SRC, "glitch_config.js"), "utf8") + "\n" + fs.readFileSync(path.join(SRC, "glitch_ui.js"), "utf8");
const W = 896, H = 169; // the widest state (everything open)
const rec = makeRecorder(W, H);
const sb = loadFace(code, rec, { Date });
const S = sb.GL_SCOPE;
const TOL = 0.51;
// GLITCH_NOCLIP=1: switch the clamping off and the cepstrum auto-gain back to the raw values (the old behaviour) to see this test catch it
if (process.env.GLITCH_NOCLIP) { sb.clipSet = () => null; sb.cepHeight = (v) => Number(v) || 0; }

// deterministic random numbers
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const failures = [];
let paints = 0;
function inside(s, r) { return s.x0 >= r.x - TOL && s.y0 >= r.y - TOL && s.x1 <= r.x + r.w + TOL && s.y1 <= r.y + r.h + TOL; }
function fail(msg) { if (failures.length < 40) failures.push(msg); else if (failures.length === 40) failures.push("... more"); }
function checkShapes(label, shapes, region, what) {
    for (const s of shapes) {
        if (!inside(s, region)) fail(`${label}: ${what} ${s.kind}${s.text ? ` "${s.text}"` : ""} box [${s.x0.toFixed(1)}, ${s.y0.toFixed(1)}, ${s.x1.toFixed(1)}, ${s.y1.toFixed(1)}] leaves [${region.x.toFixed(1)}, ${region.y.toFixed(1)}, ${(region.x + region.w).toFixed(1)}, ${(region.y + region.h).toFixed(1)}]`);
    }
}

// ----- instrumentation: which shapes belong to which tile / body / pad / editor -----
let sections = []; // { kind, region, from, to, tile }
const origBody = sb.paintTileBody;
sb.paintTileBody = function (tile, x, y, w, h) {
    const n0 = rec.shapes.length;
    const r = origBody.apply(this, arguments);
    sections.push({ kind: "body", region: { x, y, w, h }, from: n0, to: rec.shapes.length, tile });
    return r;
};
const origPad = sb.paintPad;
sb.paintPad = function (r) {
    const n0 = rec.shapes.length;
    const res = origPad.apply(this, arguments);
    sections.push({ kind: "pad", region: { x: r.x, y: r.y, w: r.w, h: r.h }, from: n0, to: rec.shapes.length });
    return res;
};
const origEditor = sb.paintEditor;
sb.paintEditor = function (ed) {
    const n0 = rec.shapes.length;
    const res = origEditor.apply(this, arguments);
    sections.push({ kind: "editor", region: { x: ed.x, y: ed.y, w: ed.w, h: ed.h }, from: n0, to: rec.shapes.length });
    return res;
};
const origRail = sb.paintRail;
sb.paintRail = function (L) {
    const n0 = rec.shapes.length;
    const res = origRail.apply(this, arguments);
    sections.push({ kind: "rail", region: L.rail, from: n0, to: rec.shapes.length });
    return res;
};
// a tile starts at tileColor(tile) (the first call of each loop turn in paintView); the ribbon ends the last one
let tileMarks = [];
const origColor = sb.tileColor;
sb.tileColor = function () { if (!ribbonOpen) tileMarks.push(rec.shapes.length); return origColor.apply(this, arguments); };
const origRibbon = sb.paintRibbon;
let ribbonOpen = false;
sb.paintRibbon = function () { tileMarks.push(rec.shapes.length); ribbonOpen = true; try { return origRibbon.apply(this, arguments); } finally { ribbonOpen = false; } };

function paintOnce(label) {
    sections = [];
    tileMarks = [];
    rec.begin(label);
    sb.paint();
    rec.end();
    paints++;
    for (const b of rec.bad.splice(0)) fail(b);
    for (const s of rec.shapes) if (!isFinite(s.x0 + s.y0 + s.x1 + s.y1)) fail(`${label}: non-finite shape ${JSON.stringify(s)}`);
}

// ----- telemetry -----
function fillTele(kind) {
    const a = new Array(S.END).fill(0);
    const set = (i, v) => { a[i] = v; };
    for (let i = 0; i < S.END; i++) {
        let v = 0;
        switch (kind) {
            case "zero": v = 0; break;
            case "one": v = 1; break;
            case "half": v = 0.5; break;
            case "rand": v = rnd(); break;
            case "wide": v = (rnd() * 2 - 1) * 50; break;
            case "huge": v = 1e9; break;
            case "neg": v = -5; break;
            case "nan": v = NaN; break;
            case "spikes": v = rnd() < 0.05 ? (rnd() * 2 - 1) * 1e4 : 0.1 * rnd(); break;
            case "cep": v = rnd(); break;
        }
        a[i] = v;
    }
    if (kind === "cep") {
        // raw cepstra: a big pitch peak and the rest small, some columns huge, some negative
        for (const base of [S.CEP_IN, S.CEP_OUT]) for (let q = 0; q < sb.GL_CEP_BINS; q++) a[base + q] = (rnd() * 2 - 1) * (q % 17 === 3 ? 80 : (q % 5 === 0 ? 9 : 0.4));
    }
    if (kind !== "nan" && kind !== "huge") set(S.SR, 48000);
    return a;
}
const TELE = process.env.GLITCH_TELE ? process.env.GLITCH_TELE.split(",") : ["zero", "one", "half", "rand", "wide", "huge", "neg", "nan", "spikes", "cep"];

// ----- glitches -----
const layout = sb.glitchLayout();
function allTileKeys() {
    const g = sb.defaultGlitch();
    for (const inst of sb.GL_INSTANCES) sb.glitchSetValue(g, inst.id, "wet", 0.8);
    for (const ty of sb.GL_TYPES) if (ty.amountKey) sb.glitchSetValue(g, ty.id, ty.amountKey, 0.8);
    sb.gState.working = g;
    sb.gModelDirty = true;
    sb.refreshModel();
    return sb.gTiles.map((t) => t.key);
}
function setTileOn(g, key, i) {
    const info = sb.glitchTileInfo(key);
    sb.glitchSetValue(g, key, "wet", 0.5 + 0.4 * ((i * 7) % 10) / 10);
    if (info.sub) sb.glitchSetValue(g, key, info.sub, 0.5 + 0.4 * ((i * 3) % 10) / 10);
}
function buildGlitch(target, n, variant) {
    const keys = ALL.filter((k) => k !== target);
    // the n - 1 fillers: spread over the chain so the target lands in different spots of the page
    const pick = [];
    const start = (variant * 5) % keys.length;
    for (let i = 0; i < n - 1 && i < keys.length; i++) pick.push(keys[(start + i) % keys.length]);
    pick.push(target);
    const g = sb.defaultGlitch();
    pick.forEach((k, i) => setTileOn(g, k, i));
    pick.forEach((k, i) => {
        if (sb.glitchMainParam(k) && (i + variant) % 2 === 0) {
            sb.glitchSetMoveType(g, k, 1 + ((i + variant) % 3));
            sb.glitchSetMove(g, k, "depth", ((i + variant) % 4 < 2) ? 1 : -1);
        }
        if ((i + variant) % 4 === 1) sb.glitchToggleLock(g, k);
    });
    return g;
}
function mutateVector(mode) {
    const v = sb.gVec;
    for (const inst of sb.GL_INSTANCES) {
        for (let j = 0; j < inst.params.length; j++) {
            const ps = inst.params[j];
            const idx = layout.base[inst.id] + j;
            const span = ps.max - ps.min;
            switch (mode) {
                case "default": break;
                case "min": v[idx] = ps.min; break;
                case "max": v[idx] = ps.max; break;
                case "rand": v[idx] = ps.min + rnd() * span; break;
                case "beyond": v[idx] = rnd() < 0.5 ? ps.min - span * 0.7 - 1 : ps.max + span * 2 + 1; break;
                case "nan": v[idx] = NaN; break;
            }
        }
    }
}
const PARAM_MODES = ["default", "min", "max", "rand", "beyond", "nan"];

const ALL = allTileKeys();
assert.strictEqual(ALL.length, 42, "42 tiles with everything on");

sb.gHaveTele = true;
sb.gDemo = false;
sb.gState.ui = sb.normalizeUi({ editor: 0, slots: 0, seq: 0, options: 0 });
sb.gLayout = sb.glitchFaceLayout(sb.gState.ui);

// ----- A: every tile at every size class -----
let tileCases = 0;
const SIZES = [1, 2, 4, 5, 8, 9, 12, 13, 24, 42];
for (const key of ALL) {
    for (const n of SIZES) {
        for (let combo = 0; combo < Math.max(TELE.length, 6); combo++) {
            const pmode = PARAM_MODES[(combo + n) % PARAM_MODES.length];
            const tele = TELE[combo % TELE.length];
            const g = buildGlitch(key, n, combo);
            sb.gState.working = g;
            sb.gState.audition = "working";
            sb.gModelDirty = true;
            sb.refreshModel();
            mutateVector(pmode);
            sb.gTele = fillTele(tele);
            const idx = sb.gTiles.findIndex((t) => t.key === key);
            assert.ok(idx >= 0, `tile ${key} present (n = ${n})`);
            sb.gTilePage = Math.floor(idx / sb.GL_FACE.PAGE_CAP);
            const label = `tile ${key} n=${n} params=${pmode} tele=${tele}`;
            paintOnce(label);
            tileCases++;
            // bodies: every glyph inside its own body rect
            const V = sb.glitchViewLayout(sb.gTiles.length, sb.gLayout.view, sb.gTilePage);
            for (const sec of sections.filter((q) => q.kind === "body")) checkShapes(label + ` (${sec.tile.key})`, rec.shapes.slice(sec.from, sec.to), sec.region, "glyph");
            // whole tiles: marks[i] .. marks[i + 1] belong to tile i of the page
            assert.strictEqual(tileMarks.length, V.rects.length + 1, "one mark per tile and one for the ribbon");
            for (let i = 0; i < V.rects.length; i++) checkShapes(label + ` (${sb.gTiles[V.first + i].key})`, rec.shapes.slice(tileMarks[i], tileMarks[i + 1]), V.rects[i], "tile");
        }
    }
}

// ----- B: the pad (Working / Morph / Seq, corners and centre) -----
sb.gState.ui = sb.normalizeUi({ editor: 0, slots: 1, seq: 0, options: 0 });
sb.gLayout = sb.glitchFaceLayout(sb.gState.ui);
let padCases = 0;
for (const aud of ["working", "morph", "seq"]) {
    for (const xy of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [-3, 7], [NaN, 0.3]]) {
        for (const tele of ["zero", "one", "rand", "huge", "nan", "neg"]) {
            const g = buildGlitch("freeze", 8, padCases);
            sb.gState.working = g;
            for (let s = 0; s < 8; s++) sb.gState.slots[s] = s % 3 === 2 ? null : sb.randomizeGlitch(s + 3, 0.8, sb.gState.allow);
            sb.gState.audition = aud;
            sb.gState.xy = xy.slice();
            sb.gModelDirty = true;
            sb.gTele = fillTele(tele);
            if (aud === "seq") { sb.gTele[S.SEQ_ON] = 1; sb.gTele[S.SEQ_PLAY] = 1; for (let s = 0; s < 8; s++) sb.gTele[S.WEIGHTS + s] = tele === "huge" ? 1e9 : (tele === "nan" ? NaN : rnd()); }
            paintOnce(`pad ${aud} xy=${xy} tele=${tele}`);
            padCases++;
            for (const sec of sections.filter((q) => q.kind === "pad")) checkShapes(`pad ${aud} xy=${xy} tele=${tele}`, rec.shapes.slice(sec.from, sec.to), sec.region, "pad");
        }
    }
}
sb.gState.audition = "working";
sb.gState.xy = [0.5, 0.5];

// ----- C: the editor, every tile, both tabs, every movement type, extreme parameters and telemetry -----
sb.gState.ui = sb.normalizeUi({ editor: 1, slots: 1, seq: 0, options: 0 });
sb.gLayout = sb.glitchFaceLayout(sb.gState.ui);
let edCases = 0, barCases = 0;
for (const key of ALL) {
    for (const tab of [0, 1]) {
        for (let combo = 0; combo < 8; combo++) {
            const pmode = PARAM_MODES[(combo + tab) % PARAM_MODES.length];
            const tele = TELE[(combo * 3 + tab) % TELE.length];
            const g = buildGlitch(key, 6, combo);
            sb.glitchSetMoveType(g, key, sb.glitchMainParam(key) ? combo % 4 : 0);
            if (sb.glitchGetMove(g, key)) sb.glitchSetMove(g, key, "depth", combo % 2 ? 1 : -1);
            sb.gState.working = g;
            sb.gState.audition = combo % 3 === 0 ? "morph" : "working";
            sb.gState.ui.sel = key;
            sb.gState.ui.edTab = tab;
            sb.gModelDirty = true;
            sb.refreshModel();
            mutateVector(pmode);
            sb.gTele = fillTele(tele);
            const label = `editor ${key} tab=${tab} params=${pmode} tele=${tele}`;
            paintOnce(label);
            edCases++;
            const secs = sections.filter((q) => q.kind === "editor");
            for (const sec of secs) checkShapes(label, rec.shapes.slice(sec.from, sec.to), sec.region, "editor");
            if (tab === 0 && pmode !== "nan" && secs.length) {
                // every param bar: a label and a value text inside its row, and a fill that matches the value
                const rows = sb.glitchEditorRows(key);
                const mvt = sb.editorMove(key);
                const E = sb.glitchEditorLayout(secs[0].region, rows.length);
                const shapes = rec.shapes.slice(secs[0].from, secs[0].to);
                rows.forEach((row, i) => {
                    const r = E.rows[i];
                    const inRow = shapes.filter((s) => inside(s, r));
                    const texts = inRow.filter((s) => s.kind === "text");
                    if (!row.spec.patterns) {
                        if (texts.length < 2) fail(`${label}: row ${i} "${row.name}" shows ${texts.length} text(s), want a label and a value`);
                        else {
                            const left = texts.reduce((a, b) => (a.x0 < b.x0 ? a : b)), right = texts.reduce((a, b) => (a.x0 > b.x0 ? a : b));
                            if (left === right || left.x1 > right.x0 + 0.5) fail(`${label}: row ${i} "${row.name}" label "${left.text}" touches the value "${right.text}"`);
                        }
                    }
                    if (row.spec.kind !== "disc" && !row.spec.patterns && !(mvt && mvt.target === row.id)) { // (the movement target also draws its live band)
                        const v = sb.editorValue(key, row.id);
                        let n = sb.glParamToNorm(row.spec, v);
                        if (row.id === "wet" || row.spec.kind === "wet") n = Math.min(1, Math.max(0, v));
                        n = Math.min(1, Math.max(0, n));
                        const fills = inRow.filter((s) => s.kind === "fill" && s.x0 > r.x + 0.5 && s.x0 <= r.x + 1.6 && s.y0 <= r.y + 1.6 && s.y1 >= r.y + r.h - 1.6);
                        const want = n > 0.0005 ? Math.max(2, (r.w - 2) * n) : 0;
                        const best = fills.reduce((m, s) => Math.max(m, s.x1 - s.x0), 0);
                        if (want > 0 && Math.abs(best - want) > 1.2) fail(`${label}: row ${i} "${row.name}" fill ${best.toFixed(1)} px, want ${want.toFixed(1)} (value ${v}, norm ${n.toFixed(3)})`);
                        if (want === 0 && best > 0.5) fail(`${label}: row ${i} "${row.name}" fill ${best.toFixed(1)} px for an empty value`);
                        barCases++;
                    }
                });
            }
        }
    }
}

// ----- D: the rail, every collapse state, Options open / closed -----
let railCases = 0;
for (const editor of [0, 1]) for (const slots of [0, 1]) for (const seq of [0, 1]) for (const options of [0, 1]) {
    sb.gState.ui = sb.normalizeUi({ editor, slots, seq, options, sel: ALL[0] });
    sb.gLayout = sb.glitchFaceLayout(sb.gState.ui);
    paintOnce(`rail e${editor} s${slots} q${seq} o${options}`);
    railCases++;
    const sec = sections.find((q) => q.kind === "rail");
    // the rotated labels draw at their local origin in this recorder (it ignores translate / rotate): only the shapes are checked here
    checkShapes(`rail e${editor} s${slots} q${seq} o${options}`, rec.shapes.slice(sec.from, sec.to).filter((s) => s.kind !== "text"), sec.region, "rail");
    const Lo = sb.gLayout;
    for (const [name, r] of [["EDIT", Lo.toggles.editor], ["SLOTS", Lo.toggles.slots], ["SEQ", Lo.toggles.seq]]) {
        const room = r.h - 16 - 2; // label span: from below the glyph to the bottom of the button
        if (sb.tw(name, 6.5) > room) fail(`rail label ${name}: ${sb.tw(name, 6.5).toFixed(1)} px does not fit the ${room} px under the glyph`);
        if (sb.tw(name, 6.5) < 6) fail(`rail label ${name} suspiciously short`);
    }
}

console.log(`test_glitch_paint_bounds: ${paints} paints (${tileCases} tile cases, ${padCases} pad, ${edCases} editor with ${barCases} param bars, ${railCases} rail)`);
if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log("test_glitch_paint_bounds: every tile glyph, tile, pad, editor row and rail stays inside its rect");
