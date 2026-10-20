#!/usr/bin/env node
/**
 * Verification suite for devices/Mega Modulator A/B/C.amxd (shared core).
 *  1. Build output: header, amxdtype, 169 px, presentation, #0- names, blob param, overlap & z-order rules
 *  2. State model: round trip (v2), legacy v1 fallback, sanitizing, chunking of big states
 *  3. Curve / transfer tables, MSEG, LFO / steps / random / envelope reference math
 *  4. Learn / target helpers (dedupe, self exclusion, resolve by path then by name)
 *  5. cfg / mseg / steps / scope layouts vs src/megamod_engine.genexpr
 *  6. Every UI script in a VM with mocked mgraphics / LiveAPI / patcher / Buffer: loads, paints, and the mapper
 *     allocates, retargets, binds and frees slots of the saved 256-slot mapping pool (no runtime scripting)
 * Audio behaviour of the engine: scripts/run_megamod_audio_tests.py (real Max).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "src", "megamod_config.js"));
const GEN = fs.readFileSync(path.join(ROOT, "src", "megamod_engine.genexpr"), "utf8");
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); passed++; }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); passed++; }

// ---------------------------------------------------------------- 1. build output
function readAmxd(file) {
    const raw = fs.readFileSync(file);
    return { raw, doc: JSON.parse(raw.slice(32).toString("utf8")) };
}
const variants = ["A", "B", "C"];
for (const v of variants) {
    const file = path.join(ROOT, "devices", `Mega Modulator ${v}.amxd`);
    const { raw, doc } = readAmxd(file);
    const p = doc.patcher;
    eq(raw.slice(0, 8).toString("latin1"), "ampf\u0004\u0000\u0000\u0000", `${v}: header magic`);
    eq(raw.slice(8, 12).toString("latin1"), "aaaa", `${v}: Audio Effect type`);
    eq(raw.slice(24, 28).toString("latin1"), "ptch", `${v}: ptch`);
    eq(raw.readUInt32LE(28), raw.length - 32, `${v}: payload length`);
    eq(p.openrect[3], 169, `${v}: openrect height`);
    eq(p.openinpresentation, 1, `${v}: openinpresentation`);
    eq(p.rect[3], 169, `${v}: rect height`);
    eq(p.devicewidth, p.openrect[2], `${v}: devicewidth matches openrect`);
    const boxes = p.boxes.map((b) => b.box);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    for (const b of boxes) {
        if (b.presentation === 1) {
            const [x, y, w, h] = b.presentation_rect;
            ok(y >= 0 && y + h <= 169.01 && x >= 0 && x + w <= p.devicewidth + 0.01, `${v}: ${b.id} inside the device`);
        }
        const t = String(b.text || "");
        // `receive megamod-test` is the deliberately global test hook (one message reaches every instance)
        if (/^(buffer~|send|receive|s |r )/.test(t) && t !== "receive megamod-test") {
            ok(t.includes("#0-"), `${v}: ${b.id} "${t}" must be #0- prefixed`);
        }
    }
    ok(byId["obj-engine"] && byId["obj-engine"].numoutlets === 16 && byId["obj-engine"].maxclass === "gen.codebox~", `${v}: 16-outlet gen`);
    eq(byId["obj-engine"].varname, "megamod_engine", `${v}: engine varname used by the mapper`);
    eq(byId["obj-engine"].code, GEN, `${v}: embedded engine is current`);
    const viz = byId["obj-viz"];
    eq(viz.maxclass, "v8ui", `${v}: main v8ui`);
    eq(viz.saved_attribute_attributes.valueof.parameter_type, 3, `${v}: blob parameter`);
    eq(viz.saved_attribute_attributes.valueof.parameter_longname, "MegaModState", `${v}: blob name`);
    const code = viz.textfile.text;
    ok(code.startsWith("mgraphics.init();\nmgraphics.relative_coords = 0;\nmgraphics.autofill = 0;"), `${v}: pixel coords header first`);
    ok(code.includes("function getvalueof") && code.includes("function setvalueof") && code.includes("function paint"), `${v}: script entry points`);
    ok(!code.includes("require("), `${v}: no Node-only requires`);
    // bindings
    const msgs = boxes.filter((b) => b.maxclass === "message").map((b) => b.text);
    ok(msgs.some((t) => t === "cfg #0-megamodcfg, mseg #0-megamodmseg, steps #0-megamodsteps, scope #0-megamodscope"), `${v}: gen binding message`);
    ok(msgs.some((t) => t.startsWith("setnames #0-megamodcfg") && t.endsWith("#0-mmcurve #0-megamodroute")), `${v}: setnames message`);
    ok(msgs.some((t) => t === "route #0-megamodroute, curve #0-mmcurve"), `${v}: router binding message`);
    for (const n of ["#0-megamodcfg @samps 384", "#0-megamodmseg @samps 16384", "#0-megamodsteps @samps 512", "#0-megamodscope @samps 128", "#0-mmcurve @samps 65536", "#0-megamodroute @samps 512"]) {
        ok(boxes.some((b) => b.text === `buffer~ ${n}`), `${v}: buffer ${n}`);
    }
    // wiring: plugin~ -> plugout~ pass-through, width route, plugsync~ params
    const lines = p.lines.map((l) => l.patchline);
    const has = (s, so, d, di) => lines.some((l) => l.source[0] === s && l.source[1] === so && l.destination[0] === d && l.destination[1] === di);
    ok(has("obj-plugin", 0, "obj-plugout", 0) && has("obj-plugin", 1, "obj-plugout", 1), `${v}: zero-latency pass-through`);
    ok(has("obj-route", 0, "obj-prep-setwidth", 0) && has("obj-prep-setwidth", 0, "obj-thisdevice", 0), `${v}: width -> live.thisdevice setwidth`);
    ok(has("obj-thisdevice", 0, "obj-msg-init-lom", 0), `${v}: live.thisdevice -> init_lom (not loadbang)`);
    ok(has("obj-sync", 6, "obj-ppq-prep", 0) && has("obj-ppq-prep", 0, "obj-engine", 0), `${v}: plugsync~ ppq -> engine`);
    // panels last with background
    const lastNonPanel = boxes.map((b) => b.maxclass).lastIndexOf(boxes.find((b) => b.maxclass !== "panel").maxclass);
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    ok(firstPanel > 0 && boxes.slice(firstPanel).every((b) => b.maxclass === "panel" && b.background === 1), `${v}: panels last with background 1`);
    ok(boxes.slice(0, firstPanel).every((b) => b.maxclass !== "panel"), `${v}: no panel before widgets`);
    // no live.* over an interactive v8ui
    const pres = boxes.filter((b) => b.presentation === 1 && b.maxclass !== "panel");
    const inter = pres.filter((b) => b.maxclass === "v8ui" && !b.ignoreclick);
    for (const lv of pres.filter((b) => /^live\./.test(b.maxclass))) {
        for (const iv of inter) {
            const [ax, ay, aw, ah] = lv.presentation_rect;
            const [bx, by, bw, bh] = iv.presentation_rect;
            ok(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay, `${v}: ${lv.id} overlaps interactive ${iv.id}`);
        }
    }
    checkPool(v, p, boxes, byId, lines);
}


// ---------------------------------------------------------------- 1b. saved mapping pool
function checkPool(v, p, boxes, byId, lines) {
    const N = C.MAX_MAPPINGS;
    eq(N, 256, `${v}: MAX_MAPPINGS`);
    const cls = (re) => boxes.filter((b) => re.test(String(b.text || "")));
    eq(cls(/^live\.modulate~$/).length, N, `${v}: 256 live.modulate~`);
    eq(cls(/^live\.remote~ @normalized 1$/).length, N, `${v}: 256 live.remote~`);
    eq(cls(/^prepend id$/).length, 2 * N, `${v}: 512 prepend id`);
    for (const b of boxes.filter((x) => /^live\.(modulate|remote)~/.test(String(x.text || "")) || /^prepend id$/.test(String(x.text || "")))) {
        ok(b.presentation !== 1 && b.presentation_rect === undefined, `${v}: ${b.id} outside presentation`);
        ok(b.patching_rect[0] >= 1000, `${v}: ${b.id} off-screen in patching view`);
    }
    for (const b of boxes.filter((x) => /^live\./.test(x.maxclass) || /^live\.(modulate|remote)~/.test(String(x.text || "")))) {
        if (/^live\.(modulate|remote)~/.test(String(b.text || ""))) ok(b.presentation !== 1, `${v}: ${b.id} not in presentation`);
    }
    const idx = {};
    lines.forEach((l) => { (idx[l.source[0] + ":" + l.source[1]] = idx[l.source[0] + ":" + l.source[1]] || []).push(l.destination.join(":")); });
    const routers = boxes.filter((b) => b.maxclass === "gen.codebox~" && /^obj-router-/.test(b.id));
    eq(routers.length, 8, `${v}: 8 routers`);
    ok(boxes.indexOf(byId["obj-engine"]) < boxes.indexOf(routers[0]), `${v}: routers after engine`);
    for (let r = 0; r < 8; r++) {
        const rb = byId[`obj-router-${r}`];
        eq(rb.numinlets, 16, `${v}: router ${r} 16 inlets`);
        eq(rb.numoutlets, 32, `${v}: router ${r} 32 outlets`);
        for (let i = 0; i < 16; i++) ok((idx[`obj-engine:${i}`] || []).includes(`obj-router-${r}:${i}`), `${v}: engine out ${i} -> router ${r}`);
        ok((idx["obj-msg-router-bind:0"] || []).includes(`obj-router-${r}:0`), `${v}: router ${r} bind message`);
        const code = rb.code;
        ok(code.indexOf('Buffer route("megamodroute");') >= 0 && code.indexOf('Buffer curve("mmcurve");') >= 0, `${v}: router ${r} buffers`);
        ok(code.indexOf("Buffer curve") < code.indexOf("sel0 ="), `${v}: router ${r} Buffers before statements`);
        ok(!/\be\d/.test(code), `${v}: router ${r} has no e<digit> identifier`);
        for (let j = 0; j < 32; j++) {
            const k = r * 32 + j;
            ok(code.includes(`sel${j} = peek(route, ${2 * k}) + 1;`), `${v}: router ${r} slot ${k} route index`);
            ok(code.includes(`peek(curve, ${k * 256} + ia${j})`) && code.includes(`peek(curve, ${k * 256} + ib${j})`), `${v}: router ${r} slot ${k} table base`);
            ok(new RegExp(`xv${j} = selector\\(sel${j}, in1, in2, in3, in4, in5, in6, in7, in8, in9, in10, in11, in12, in13, in14, in15, in16\\);`).test(code), `${v}: slot ${k} selector`);
            ok(code.includes(`out${j + 1} = yv${j};`), `${v}: slot ${k} output`);
            const dests = idx[`obj-router-${r}:${j}`] || [];
            ok(dests.includes(`obj-mm-mod-${k}:0`) && dests.includes(`obj-mm-rem-${k}:0`), `${v}: slot ${k} router -> both live.* inlet 0`);
            eq(byId[`obj-mm-mod-${k}`].varname, `mm_mod_${k}`, `${v}: mm_mod_${k}`);
            eq(byId[`obj-mm-rem-${k}`].varname, `mm_rem_${k}`, `${v}: mm_rem_${k}`);
            eq(byId[`obj-mm-pmid-${k}`].varname, `mm_mid_${k}`, `${v}: mm_mid_${k}`);
            eq(byId[`obj-mm-prid-${k}`].varname, `mm_rid_${k}`, `${v}: mm_rid_${k}`);
            ok((idx[`obj-mm-pmid-${k}:0`] || []).join() === `obj-mm-mod-${k}:1`, `${v}: mm_mid_${k} -> live.modulate~ inlet 1`);
            ok((idx[`obj-mm-prid-${k}:0`] || []).join() === `obj-mm-rem-${k}:1`, `${v}: mm_rid_${k} -> live.remote~ inlet 1`);
        }
    }
    eq(byId["obj-mm-mod-0"].saved_object_attributes.smoothing, 1, `${v}: live.modulate~ smoothing 1`);
    eq(byId["obj-mm-rem-0"].saved_object_attributes.normalized, 1, `${v}: live.remote~ normalized 1`);
    // router convention, evaluated: idx = clip((x+1)*128, 0, 256), linear interpolation, clamped to the last sample
    const m = C.defaultMapping(1, 0, { path: "p" });
    m.curve = C.CURVE_S; m.curveAmt = 0.6; m.amount = 0.8;
    const tbl = C.mappingTable(m);
    const routerEval = (x) => { const f = Math.min(Math.max((x + 1) * 128, 0), 256); const a = Math.min(Math.floor(f), 255); const b = Math.min(a + 1, 255); return tbl[a] + (tbl[b] - tbl[a]) * (f - a); };
    for (let x = -1; x <= 1; x += 0.01) near(routerEval(x), C.mappingOutput(m, x), 0.02, `${v}: router convention ~ mappingOutput`);
    near(routerEval(-1), C.mappingOutput(m, -1), 1e-12, `${v}: router start exact`);
    near(routerEval(1), C.mappingOutput(m, 1), 1e-12, `${v}: router end exact`);
}

// ---------------------------------------------------------------- 2. state
{
    const s = C.defaultState();
    s.mods[0] = C.makeModSlot(C.MOD_LFO, 0);
    s.mods[3] = C.makeModSlot(C.MOD_MSEG, 3);
    s.mods[3].points = [{ x: 0, y: 0.2, curve: 0.5, sCurve: 1 }, { x: 0.4, y: 1, curve: -0.3, sCurve: 0 }, { x: 1, y: 0, curve: 0, sCurve: 0 }];
    s.mods[3].name = "Wobble éè \"quoted\" ;,";
    s.mods[0].p.rate = 3.25;
    s.mappings.push(C.defaultMapping(5, 3, { path: "live_set tracks 1 devices 0 parameters 4", paramName: "Cutoff", deviceName: "Auto Filter", trackName: "Bass" }));
    s.nextMapId = 6;
    s.ui = { expanded: 3, inspector: true, list: [1, 2, 3] };
    const wire = C.serializeState(s);
    eq(wire[0], 2, "wire version 2");
    ok(wire.slice(2).every((c) => /^[A-Za-z0-9+/=]+$/.test(c) && c.length <= C.BLOB_CHUNK), "chunks are safe symbols");
    const back = C.deserializeState(wire);
    eq(back.mods[3].name, s.mods[3].name, "unicode / quote name round trip");
    eq(back.mods[0].p.rate, 3.25, "param round trip");
    eq(back.mappings[0].target.paramName, "Cutoff", "mapping target round trip");
    eq(back.nextMapId, 6, "nextMapId");
    assert.deepStrictEqual(back.ui, s.ui); passed++;
    near(back.mods[3].points[0].curve, 0.5, 1e-9, "MSEG point curve");
    eq(back.mods[3].points[0].sCurve, 1, "MSEG S flag");
    // legacy v1
    const v1 = C.serializeState(s, 1);
    eq(v1[0], 1, "v1 wire");
    eq(C.deserializeState(v1).mods[3].name, s.mods[3].name.replace(/ /g, " "), "v1 fallback parses");
    // unknown / corrupt
    eq(C.deserializeState([99, 1, "x"]), null, "unknown version rejected");
    eq(C.deserializeState([2, 1, "@@@"]), null, "corrupt rejected");
    eq(C.deserializeState([]), null, "empty rejected");
    // sanitizing
    const dirty = C.normalizeState({ mods: [{ type: 99, p: { rate: -5, steps: 500, syncDiv: 77 } }], mappings: [{ id: 1, mod: 0, amount: 9, curve: 12 }, { id: 1, mod: 0 }, { id: 2, mod: 7 }] });
    eq(dirty.mods[0].type, 5, "type clamped");
    eq(dirty.mods[0].p.rate, 0.01, "rate clamped");
    eq(dirty.mods[0].p.steps, 32, "steps clamped");
    eq(dirty.mods[0].p.syncDiv, 15, "syncDiv clamped");
    eq(dirty.mappings.length, 1, "duplicate ids / orphan mappings dropped");
    eq(dirty.mappings[0].amount, 1, "amount clamped");
    eq(dirty.mappings[0].curve, 4, "curve clamped");
    // big state: 16 MSEG mods with 200 points and 300 mappings
    const big = C.defaultState();
    for (let i = 0; i < 16; i++) {
        big.mods[i] = C.makeModSlot(C.MOD_MSEG, i);
        big.mods[i].points = Array.from({ length: 200 }, (_, k) => ({ x: k / 199, y: (k * 37 % 100) / 100, curve: 0.1, sCurve: 0 }));
    }
    for (let k = 0; k < 300; k++) big.mappings.push(C.defaultMapping(k + 1, k % 16, { path: `live_set tracks ${k} devices 0 parameters 1`, paramName: "P" }));
    big.nextMapId = 301;
    const bw = C.serializeState(big);
    ok(bw.length > 10, "big state is chunked");
    eq(C.deserializeState(bw).mappings.length, 300, "big state round trip");
    eq(C.deserializeState(bw).mods[15].points.length, 200, "big MSEG round trip");
    eq(C.base64Decode(C.base64Encode("héllo \u{1F600}")), "héllo \u{1F600}", "base64 utf8");
}

// ---------------------------------------------------------------- 3. math
{
    const base = C.defaultMapping(1, 0, { path: "p" });
    for (const type of [C.CURVE_LINEAR, C.CURVE_EXP, C.CURVE_LOG, C.CURVE_S, C.CURVE_STEPPED]) {
        for (const amt of [0, 0.3, 1]) {
            let prev = -1;
            for (let j = 0; j <= 100; j++) {
                const v = C.shapeCurve(j / 100, type, amt, 5);
                ok(v >= prev - 1e-12 && v >= 0 && v <= 1, `curve ${type}/${amt} monotonic in range`);
                prev = v;
            }
            near(C.shapeCurve(0, type, amt, 5), 0, 1e-12, `curve ${type} start`);
            near(C.shapeCurve(1, type, amt, 5), 1, 1e-12, `curve ${type} end`);
        }
    }
    near(C.shapeCurve(0.5, C.CURVE_EXP, 0.5, 4), 0.0625, 1e-9, "exp amt 0.5 -> power 4");
    eq(new Set(Array.from({ length: 200 }, (_, j) => C.shapeCurve(j / 199, C.CURVE_STEPPED, 0, 4))).size, 4, "stepped 4 -> 4 levels");
    const t = C.mappingTable(Object.assign({}, base, { amount: 1, bipolar: 1 }));
    eq(t.length, C.CURVE_REGION, "table size");
    near(t[0], -1, 1e-12, "mod bipolar table start");
    near(t[255], 1, 1e-12, "mod bipolar table end");
    const inv = C.mappingTable(Object.assign({}, base, { amount: 1, bipolar: 1, invert: 1 }));
    near(inv[0], 1, 1e-12, "invert start"); near(inv[255], -1, 1e-12, "invert end");
    const uni = C.mappingTable(Object.assign({}, base, { amount: 0.5, bipolar: 0 }));
    near(uni[0], 0, 1e-12, "unipolar start"); near(uni[255], 0.5, 1e-12, "unipolar end");
    const rem = C.mappingTable(Object.assign({}, base, { mode: "remote", min: 0.2, max: 0.8 }));
    near(rem[0], 0.2, 1e-12, "remote min"); near(rem[255], 0.8, 1e-12, "remote max");
    const rem2 = C.mappingOutput(Object.assign({}, base, { mode: "remote", min: 0.2, max: 0.8, invert: 1 }), -1);
    near(rem2, 0.8, 1e-12, "remote invert");
    near(C.mappingOutput(Object.assign({}, base, { amount: -0.5, bipolar: 1 }), 1), -0.5, 1e-12, "negative amount");

    // modulators
    const lfo = C.makeModSlot(C.MOD_LFO, 0);
    lfo.p.sync = 0; lfo.p.rate = 2;
    near(C.evalModulator(lfo, 0).out, 0, 1e-9, "sine starts at centre");
    near(C.evalModulator(lfo, 0.25).out, 1, 1e-9, "sine peak");
    lfo.p.shape = 4;
    eq(C.evalModulator(lfo, 0.1).out, 1, "square high"); eq(C.evalModulator(lfo, 0.6).out, -1, "square low");
    lfo.p.shape = 2; lfo.p.bipolar = 0; lfo.p.depth = 0.5;
    near(C.evalModulator(lfo, 0.999999).out, 0, 1e-5, "unipolar depth 0.5 tops at 0");
    near(C.evalModulator(lfo, 0).out, -1, 1e-9, "unipolar rests at -1");
    near(C.cycleAccumulator({ sync: 1, syncDiv: 9, rate: 1 }, 99, 2), 2, 1e-12, "sync 1/4: 2 beats = 2 cycles");
    near(C.cycleAccumulator({ sync: 0, syncDiv: 9, rate: 2 }, 1.5, 99), 3, 1e-12, "free 2 Hz");
    const stp = C.makeModSlot(C.MOD_STEPS, 1);
    stp.p.steps = 4; stp.p.bipolar = 0; stp.p.glide = 0; stp.stepVals[0] = 0; stp.stepVals[1] = 1; stp.stepVals[2] = 0.25; stp.stepVals[3] = 0.75;
    near(C.evalModulator(stp, 1.5).out, 1, 1e-12, "step 1");
    near(C.evalModulator(stp, 6.5).out, 2 * 0.25 - 1, 1e-12, "step wraps (6 % 4 = 2)");
    stp.p.glide = 1;
    near(C.evalModulator(stp, 1.5).u, 0.5, 1e-12, "glide mid-step blends neighbours");
    stp.p.oneshot = 1;
    near(C.evalModulator(stp, 50).u, 0.75, 1e-6, "one-shot Steps holds the last step");
    const rnd = C.makeModSlot(C.MOD_RANDOM, 2);
    rnd.p.smooth = 0;
    const r1 = C.evalModulator(rnd, 3.4).u;
    eq(C.evalModulator(rnd, 3.9).u, r1, "S&H holds within a cycle");
    ok(r1 >= 0 && r1 <= 1, "random in range");
    rnd.p.smooth = 1;
    near(C.evalModulator(rnd, 4.0).u, C.randHash01(1, 3), 1e-9, "smooth reaches the previous value at the cycle start");
    const ms = C.makeModSlot(C.MOD_MSEG, 3);
    ms.p.bipolar = 0;
    near(C.evalModulator(ms, 0.5).u, 1, 1e-3, "MSEG tent peak");
    near(C.evalModulator(ms, 0.25).u, 0.5, 2e-3, "MSEG tent half");
    ms.p.oneshot = 1;
    near(C.evalModulator(ms, 5).u, 0, 1e-9, "MSEG one-shot holds the end value");
    ms.p.oneshot = 0; ms.p.loopOn = 1; ms.p.loopStart = 0; ms.p.loopEnd = 0.5;
    near(C.evalModulator(ms, 0.999).u, 1, 5e-3, "MSEG loop window 0..0.5 ends at the peak");
    const tbl = C.msegTable(C.defaultMsegPoints());
    eq(tbl.length, C.MSEG_TABLE, "MSEG table size");
    near(tbl[0], 0, 1e-12, "table start"); near(tbl[C.MSEG_TABLE - 1], 0, 1e-12, "table end");
    near(C.evalSegmentT(0.5, 0.5, 0), 1 - Math.pow(0.5, Math.pow(2, 1.8)), 1e-12, "segment curve matches mseg_editor");
    const burst = Array.from({ length: 4800 }, (_, i) => (i > 1000 && i < 2000 ? 0.5 : 0));
    const ef = C.envelopeFollow(burst, 48000, { attack: 5, release: 120, gain: 0, bipolar: 0, depth: 1 });
    near(ef.out[500], -1, 1e-9, "env silent = -1");
    ok(ef.u[1999] > 0.4 && ef.u[3999] < ef.u[2000], "env rises then releases");
}

// ---------------------------------------------------------------- 4. learn / targets
{
    const own = "live_set tracks 2 devices 1";
    ok(C.isSelfTarget(own + " parameters 3", own), "own parameter excluded");
    ok(C.isSelfTarget(`"${own} parameters 3"`, own), "quoted path excluded");
    ok(!C.isSelfTarget("live_set tracks 2 devices 10 parameters 3", own), "devices 10 is not devices 1");
    ok(!C.isSelfTarget("live_set tracks 2 devices 0 parameters 3", own), "sibling not excluded");
    const ms = [C.defaultMapping(1, 0, { path: "a" })];
    ok(C.findDuplicateMapping(ms, 0, { path: "a" }), "dup same mod + target");
    eq(C.findDuplicateMapping(ms, 1, { path: "a" }), null, "other mod ok");
    eq(C.findDuplicateMapping(ms, 0, { path: "b" }), null, "other target ok");
    const tree = mockLom();
    const iface = tree.iface();
    let r = C.resolveTarget({ path: "live_set tracks 1 devices 0 parameters 1", paramName: "Decay", deviceName: "Reverb", trackName: "Bass" }, iface);
    ok(r.ok && r.how === "path", "resolve by path");
    r = C.resolveTarget({ path: "live_set tracks 0 devices 0 parameters 1", paramName: "Decay", deviceName: "Reverb", trackName: "Bass" }, iface);
    ok(r.ok && r.how === "name" && r.path === "live_set tracks 1 devices 0 parameters 1", "name fallback finds moved parameter");
    r = C.resolveTarget({ path: "live_set tracks 1 devices 0 parameters 1", paramName: "Nope", deviceName: "Reverb", trackName: "Bass" }, iface);
    ok(!r.ok, "missing target");
    eq(C.clampWidth(5), 120, "width clamp lo"); eq(C.clampWidth(9999), 1600, "width clamp hi");
    const g = C.gridLayout(5, 300, 100, 90, 40);
    eq(g.length, 5, "grid cells");
    ok(g.every((c) => c.x >= 0 && c.x + c.w <= 300.01), "grid inside width");
}

// ---------------------------------------------------------------- 5. engine layout
{
    const strideOk = (re, msg) => ok(re.test(GEN), msg);
    strideOk(new RegExp(`Data cf\\(${C.CFG_FLOATS}\\)`), "cfg cache size");
    strideOk(new RegExp(`cb = i \\* ${C.CFG_STRIDE};`), "slot stride in the evaluator");
    strideOk(new RegExp(`rs \\* ${C.CFG_STRIDE} \\+ k`), "cfg refresh stride");
    strideOk(new RegExp(`k < ${C.CFG_STRIDE};`), "cfg refresh count");
    strideOk(new RegExp(`i \\* ${C.MSEG_TABLE} \\+ i0`), "mseg table stride");
    strideOk(new RegExp(`i \\* ${C.STEPS_MAX} \\+ idxs`), "steps stride");
    strideOk(new RegExp(`min\\(${C.MSEG_TABLE - 1}, i0 \\+ 1\\)`), "mseg last index");
    const fields = {
        CF_ENABLED: "cb + 1", CF_RATE: "cb + 2", CF_SYNC: "cb + 3", CF_SYNCDIV: "cb + 4", CF_SHAPE: "cb + 5", CF_PHASE: "cb + 6",
        CF_RETRIG: "cb + 7", CF_BIPOLAR: "cb + 8", CF_DEPTH: "cb + 9", CF_ATTACK: "cb + 10", CF_RELEASE: "cb + 11", CF_GAIN: "cb + 12",
        CF_SMOOTH: "cb + 13", CF_STEPS: "cb + 14", CF_GLIDE: "cb + 15", CF_ONESHOT: "cb + 16", CF_SEED: "cb + 17",
        CF_LOOPON: "cb + 18", CF_LOOPSTART: "cb + 19", CF_LOOPEND: "cb + 20",
    };
    for (const [k, expr] of Object.entries(fields)) {
        ok(GEN.includes(`peek(cf, ${expr})`), `engine reads ${k} at ${expr}`);
        eq(expr, `cb + ${C[k]}`, `${k} index matches the genexpr offset`);
    }
    ok(GEN.includes("typ = peek(cf, cb);") && C.CF_TYPE === 0, "type at 0");
    ok(GEN.includes(`poke(scope, frameCount, ${C.SCOPE_FRAME}, 0)`) && GEN.includes(`poke(scope, sr, ${C.SCOPE_SR}, 0)`) &&
       GEN.includes(`poke(scope, beat, ${C.SCOPE_BEAT}, 0)`) && GEN.includes(`poke(scope, hbpm, ${C.SCOPE_BPM}, 0)`) &&
       GEN.includes(`, ${C.SCOPE_PLAYING}, 0)`), "scope header indices");
    ok(GEN.includes("sl * 4"), "scope slot stride 4");
    eq(C.SCOPE_STRIDE, 4, "scope stride");
    ok(C.SCOPE_HEADER + 5 <= C.SCOPE_SAMPS && C.MAX_MODS * C.SCOPE_STRIDE <= C.SCOPE_HEADER, "scope fits");
    ok(C.CF_LOOPEND < C.CFG_STRIDE, "cfg fields fit the stride");
    eq(C.cfgBufferFloats(C.defaultState()).length, C.CFG_FLOATS, "cfg writer length");
    for (let i = 0; i < 16; i++) ok(GEN.includes(`out${i + 1} = peek(outv, ${i});`), `outlet ${i + 1}`);
    ok(/^Buffer cfg\("megamodcfg"\);/m.test(GEN) && /^Buffer mseg\("megamodmseg"\);/m.test(GEN) &&
       /^Buffer steps\("megamodsteps"\);/m.test(GEN) && /^Buffer scope\("megamodscope"\);/m.test(GEN), "buffer names");
    ok(!/\be[0-9]\b/.test(GEN.replace(/\/\/.*$/gm, "")), "no e<digit> identifiers");
    // helper functions must precede the first declaration
    const firstDecl = GEN.search(/^(Buffer|Param|History|Data) /m);
    const lastFn = Math.max(...["frac01(", "hash01(", "lfoShape(", "glideVal(", "syncBeats("].map((n) => GEN.lastIndexOf("\n" + n + "", firstDecl) ));
    ok(firstDecl > 0 && GEN.slice(firstDecl).search(/^[a-zA-Z0-9_]+\([^)]*\) \{/m) < 0, "helpers before declarations");
    const decls = [...GEN.matchAll(/^(Buffer|Param|History|Data) /gm)].map((m) => m.index);
    const firstExpr = GEN.search(/^sr = /m);
    ok(decls.every((d) => d < firstExpr), "declarations before expressions");
    for (const pr of ["hbpm", "hppq", "hplay", "rtrg"]) ok(new RegExp(`^Param ${pr}\\(`, "m").test(GEN), `Param ${pr}`);
    ok(!/Param hold/.test(GEN), "no Param named hold");
}

// ---------------------------------------------------------------- 6. VM: UI scripts + mapper
function mockLom() {
    // tracks: Drums (Reverb: Dry/Wet, Decay), Bass (Reverb: Dry/Wet, Decay; Auto Filter: Freq, Res), master: this device
    const tree = {
        tracks: [
            { name: "Drums", devices: [{ name: "Reverb", params: ["Dry/Wet", "Decay"] }] },
            { name: "Bass", devices: [{ name: "Reverb", params: ["Dry/Wet", "Decay"] }, { name: "Auto Filter", params: ["Freq", "Res"] }] },
        ],
        returns: [],
        master: { name: "Master", devices: [{ name: "Mega Modulator", params: ["MegaModState", "Foo"] }] },
    };
    const ids = {};
    let next = 100;
    const idOf = (p) => (ids[p] = ids[p] || next++);
    function node(p) {
        let m;
        if (p === "live_set") return { name: "Set", children: { tracks: tree.tracks.length, return_tracks: 0 } };
        if ((m = /^live_set tracks (\d+)$/.exec(p))) { const t = tree.tracks[m[1]]; return t && { name: t.name, children: { devices: t.devices.length } }; }
        if (p === "live_set master_track") return { name: tree.master.name, children: { devices: tree.master.devices.length } };
        let tr;
        if ((m = /^live_set (tracks (\d+)|master_track) devices (\d+)$/.exec(p))) {
            tr = m[2] !== undefined ? tree.tracks[m[2]] : tree.master;
            const d = tr && tr.devices[m[3]];
            return d && { name: d.name, children: { parameters: d.params.length } };
        }
        if ((m = /^live_set (tracks (\d+)|master_track) devices (\d+) parameters (\d+)$/.exec(p))) {
            tr = m[2] !== undefined ? tree.tracks[m[2]] : tree.master;
            const d = tr && tr.devices[m[3]];
            return d && d.params[m[4]] !== undefined && d.params[m[4]] !== null ? { name: d.params[m[4]], children: {} } : null;
        }
        if (p === "this_device") return node("live_set master_track devices 0") && { name: "Mega Modulator", path: "live_set master_track devices 0", children: {} };
        return null;
    }
    return {
        tree, idOf,
        pathOfId: (id) => Object.keys(ids).find((k) => ids[k] === id),
        node,
        iface() {
            return {
                exists: (p) => !!node(p),
                name: (p) => (node(p) ? node(p).name : ""),
                count: (p, c) => (node(p) && node(p).children[c]) || 0,
            };
        },
    };
}

function makeEnv(lom) {
    const log = { outlets: [], notify: 0, seq: [], posts: [] };
    const bufs = {};
    class Buffer {
        constructor(name) { this.name = name; if (!bufs[name]) bufs[name] = { data: new Float64Array(name.endsWith("mmcurve") ? 65536 : name.endsWith("route") ? 512 : name.endsWith("scope") ? 128 : 1 << 15) }; this.b = bufs[name]; }
        poke(ch, off, arr) { const a = Array.isArray(arr) ? arr : [arr]; for (let i = 0; i < a.length; i++) this.b.data[off + i] = a[i]; }
        peek(ch, off, n) { return Array.from(this.b.data.slice(off, off + n)); }
        framecount() { return this.b.data.length; }
        send(m, v) { throw new Error("curve buffer must never be resized: " + m); }
    }
    const observers = [];
    class LiveAPI {
        constructor(a, b) {
            this.cb = typeof a === "function" ? a : null;
            this.p = typeof a === "function" ? b : a;
            this._set();
            this._prop = null;
            observers.push(this);
        }
        _set() {
            let p = this.p;
            const m = /^id (\d+)$/.exec(p || "");
            if (m) p = lom.pathOfId(Number(m[1]));
            this.cur = p;
            this.n = p ? lom.node(p) : null;
            this.id = this.n ? String(lom.idOf(p)) : "0";
            this.unquotedpath = this.n ? (this.n.path || p) : "";
            this.path = '"' + this.unquotedpath + '"';
        }
        goto(p) { this.p = p; this._set(); }
        get(k) { return k === "name" && this.n ? [this.n.name] : []; }
        getcount(c) { return (this.n && this.n.children[c]) || 0; }
        set property(v) { this._prop = v; }
    }
    const engine = { cls: "gen.codebox~", id: "engine" };
    // The saved pool: boxes are created lazily by name (mm_mid_k / mm_rid_k / mm_mod_k / mm_rem_k); every message is logged in order.
    const pool = {};
    let seq = 0;
    const patcher = {
        getnamed(n) {
            if (n === "megamod_engine") return engine;
            const m = /^mm_(mid|rid|mod|rem)_(\d+)$/.exec(n);
            if (!m || Number(m[2]) >= 256) return null;
            if (!pool[n]) {
                pool[n] = { name: n, maxclass: m[1] === "mod" ? "live.modulate~" : m[1] === "rem" ? "live.remote~" : "prepend", messages: [] };
                pool[n].message = function (...a) { this.messages.push(a); log.seq.push([n, a]); };
            }
            return pool[n];
        },
        newdefault() { throw new Error("runtime scripting is forbidden (newdefault)"); },
        connect() { throw new Error("runtime scripting is forbidden (connect)"); },
        disconnect() { throw new Error("runtime scripting is forbidden (disconnect)"); },
        remove() { throw new Error("runtime scripting is forbidden (remove)"); },
    };
    class Task {
        constructor(fn) { this.fn = fn; this.interval = 0; }
        repeat() {} schedule() { this.fn(); } cancel() {}
    }
    const mg = { size: [292, 161], init() {}, redraw() {}, relative_coords: 0, autofill: 0 };
    for (const f of ["set_source_rgba", "set_line_width", "rectangle", "rectangle_rounded", "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse", "fill", "fill_preserve", "stroke", "select_font_face", "set_font_size", "show_text", "save", "restore", "translate", "rotate"]) mg[f] = () => {};
    mg.text_measure = (t) => [String(t).length * 5, 9];
    const ctx = {
        mgraphics: mg, Buffer, LiveAPI, Task, patcher, console,
        outlet: (...a) => log.outlets.push(a),
        notifyclients: () => { log.notify++; },
        post: (s) => { log.posts.push(s); if (process.env.MMDBG) console.log(s); },
        arrayfromargs: (a) => Array.prototype.slice.call(a),
        inlets: 1, outlets: 2,
    };
    vm.createContext(ctx);
    return { ctx, log, bufs, observers, patcher, engine, pool };
}

function loadScript(variant, env) {
    const out = execFileSync("python3", ["-c",
        "import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script(sys.argv[1]))", variant.toLowerCase()],
        { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(out, env.ctx, { filename: `megamod_ui_${variant}.js` });
    return out;
}

const NAMES = ["#0-megamodcfg", "#0-megamodmseg", "#0-megamodsteps", "#0-megamodscope", "#0-mmcurve", "#0-megamodroute"];

for (const v of variants) {
    const lom = mockLom();
    const env = makeEnv(lom);
    loadScript(v, env);
    const run = (code) => vm.runInContext(code, env.ctx);
    // loads + paints with an empty state, before any setup
    run("paint()");
    eq(run("typeof MM"), "object", `${v}: MM exists`);
    // names + LOM
    env.ctx.setnames(...NAMES);
    ok(env.observers.length === 0, `${v}: no LiveAPI before init_lom`);
    env.ctx.init_lom();
    ok(run("MM._test.lomReady()"), `${v}: LOM ready`);
    ok(env.observers.some((o) => o._prop === "selected_parameter"), `${v}: selected_parameter observer`);
    eq(run("MM._test.selfPath()"), "live_set master_track devices 0", `${v}: own device path captured`);
    // modulators write the engine buffers
    const s0 = run("MM.addModulator(MOD_LFO)");
    eq(s0, 0, `${v}: first slot`);
    const cfg = env.bufs["#0-megamodcfg"].data;
    eq(cfg[C.CF_TYPE], 1, `${v}: cfg type written`);
    eq(cfg[C.CF_ENABLED], 1, `${v}: cfg enabled written`);
    run("MM.setParam(0, 'rate', 3.5)");
    eq(cfg[C.CF_RATE], 3.5, `${v}: setParam writes cfg`);
    const s1 = run("MM.addModulator(MOD_MSEG)");
    near(env.bufs["#0-megamodmseg"].data[s1 * C.MSEG_TABLE + 512], 1, 5e-3, `${v}: MSEG table written`);
    run("MM.setStep(0, 2, 0.6)");
    near(env.bufs["#0-megamodsteps"].data[2], 0.6, 1e-9, `${v}: step written`);
    // learn (single): select a parameter
    const pid = (p) => lom.idOf(p);
    const P_FREQ = "live_set tracks 1 devices 1 parameters 0";
    const P_RES = "live_set tracks 1 devices 1 parameters 1";
    const P_DECAY = "live_set tracks 0 devices 0 parameters 1";
    const P_SELF = "live_set master_track devices 0 parameters 1";
    const sel = (p) => { const o = env.observers.find((x) => x._prop === "selected_parameter"); o.cb(["selected_parameter", "id", p ? pid(p) : 0]); };
    run("MM.armLearn(0, false)");
    ok(run("MM.learn.armed"), `${v}: armed`);
    sel(P_FREQ);
    eq(run("MM.allMappings().length"), 1, `${v}: single learn added one mapping`);
    ok(!run("MM.learn.armed"), `${v}: single learn disarms`);
    const m1 = run("MM.allMappings()[0]");
    eq(m1.target.path, P_FREQ, `${v}: target path`);
    eq(m1.target.paramName, "Freq", `${v}: target name`);
    eq(m1.target.deviceName, "Auto Filter", `${v}: device name`);
    eq(m1.target.trackName, "Bass", `${v}: track name`);
    sel(P_RES);
    eq(run("MM.allMappings().length"), 1, `${v}: disarmed ignores selections`);
    // pool slot 0: route, table, ids go to the right box
    const route = env.bufs["#0-megamodroute"].data;
    const tbl = env.bufs["#0-mmcurve"].data;
    const lastMsg = (n) => { const o = env.pool[n]; return o && o.messages.length ? o.messages[o.messages.length - 1] : null; };
    const nonzero = (n) => !!env.pool[n] && env.pool[n].messages.some((a) => a[1] !== 0);
    eq(run(`MM.mappingSlot(${m1.id})`), 0, `${v}: first mapping takes slot 0`);
    eq(route[0], 0, `${v}: route[0] = source modulator index`);
    eq(route[2], -1, `${v}: free slot route is off (-1)`);
    eq(route[2 * 255], -1, `${v}: last slot route is off`);
    assert.deepStrictEqual(lastMsg("mm_mid_0"), ["int", pid(P_FREQ)]); passed++;
    ok(!nonzero("mm_rid_0"), `${v}: live.remote~ id box never bound in mod mode`);
    near(tbl[0], -0.5, 1e-9, `${v}: mapping table start (bipolar amount 0.5)`);
    near(tbl[255], 0.5, 1e-9, `${v}: mapping table end`);
    // edit range/curve only rewrites the table (no id traffic)
    const nSeq = env.log.seq.length;
    run(`MM.updateMapping(${m1.id}, {amount: 1, invert: 1})`);
    eq(env.log.seq.length, nSeq, `${v}: editing a mapping sends no ids`);
    near(tbl[0], 1, 1e-9, `${v}: inverted table`);
    // mode switch: unbind the old box first, then bind the other one
    run(`MM.updateMapping(${m1.id}, {mode: 'remote', min: 0.1, max: 0.9})`);
    const tail = env.log.seq.slice(nSeq);
    assert.deepStrictEqual(tail, [["mm_mid_0", ["int", 0]], ["mm_rid_0", ["int", pid(P_FREQ)]]]); passed++;
    near(tbl[255], 0.1, 1e-9, `${v}: remote table end (inverted -> min)`);
    eq(route[0], 0, `${v}: route kept across mode switch`);
    // switching back unbinds remote first
    run(`MM.updateMapping(${m1.id}, {mode: 'mod'})`);
    assert.deepStrictEqual(env.log.seq.slice(-2), [["mm_rid_0", ["int", 0]], ["mm_mid_0", ["int", pid(P_FREQ)]]]); passed++;
    run(`MM.updateMapping(${m1.id}, {amount: 0.5, invert: 0})`);
    // multi learn, dedupe, self exclusion
    run("MM.armLearn(1, true)");
    sel(P_RES); sel(P_DECAY); sel(P_RES); sel(0); sel(P_SELF);
    ok(run("MM.learn.armed"), `${v}: multi learn stays armed`);
    eq(run("MM.mappingsFor(1).length"), 2, `${v}: multi learn added two (dup + self + id 0 ignored)`);
    run("MM.disarmLearn()");
    eq(run("MM.addMapping(1, {path: '" + P_RES + "', paramName: 'Res'})"), null, `${v}: addMapping dedupe`);
    eq(run("MM.addMapping(1, {path: '" + P_SELF + "', paramName: 'Foo'})"), null, `${v}: addMapping self exclusion`);
    // same target on a different mod is allowed
    ok(run("MM.addMapping(0, {path: '" + P_RES + "', paramName: 'Res', id: " + pid(P_RES) + "})"), `${v}: same target on another mod`);
    // modulator disable releases ids, re-enable restores
    const mapsOf0 = run("MM.mappingsFor(0)").map((m) => m.id);
    run("MM.setParam(0, 'enabled', 0)");
    const slot0 = run(`MM.mappingSlot(${mapsOf0[0]})`);
    eq(route[2 * slot0], -1, `${v}: disabled modulator -> route off`);
    eq(lastMsg((run(`MM.getMapping(${mapsOf0[0]})`).mode === "mod" ? "mm_mid_" : "mm_rid_") + slot0)[1], 0, `${v}: disabled modulator -> id released`);
    const other = run("MM.mappingsFor(1)")[0];
    eq(route[2 * run(`MM.mappingSlot(${other.id})`)], 1, `${v}: other modulator's mapping keeps its route`);
    eq(run(`MM.mappingStatus(${mapsOf0[0]})`), "disabled", `${v}: status disabled`);
    run("MM.setParam(0, 'enabled', 1)");
    eq(run(`MM.mappingStatus(${mapsOf0[0]})`), "ok", `${v}: status ok again`);
    eq(route[2 * slot0], 0, `${v}: re-enabled modulator -> route restored`);
    // target deletion: parameter vanishes -> missing, mapping kept, id released
    lom.tree.tracks[1].devices[1].params[1] = null;
    run("MM._test.validate()");
    const resMap = run("MM.allMappings()").find((m) => m.target.path === P_RES && m.mod === 1);
    eq(run(`MM.mappingStatus(${resMap.id})`), "missing", `${v}: deleted target marked missing`);
    ok(run("MM.allMappings()").some((m) => m.id === resMap.id), `${v}: missing mapping kept`);
    lom.tree.tracks[1].devices[1].params[1] = "Res";
    run("MM._test.validate()");
    eq(run(`MM.mappingStatus(${resMap.id})`), "ok", `${v}: target revived`);
    // delete mapping: both id boxes get 0, route off, slot reused by the next mapping (lowest free)
    const delSlot = run(`MM.mappingSlot(${resMap.id})`);
    const nSeq2 = env.log.seq.length;
    run(`MM.deleteMapping(${resMap.id})`);
    const delTail = env.log.seq.slice(nSeq2);
    ok(delTail.some((e) => e[0] === "mm_mid_" + delSlot && e[1][1] === 0) && delTail.some((e) => e[0] === "mm_rid_" + delSlot && e[1][1] === 0), `${v}: delete unbinds both boxes`);
    eq(route[2 * delSlot], -1, `${v}: delete -> route off`);
    const reuse = run("MM.addMapping(1, {path: 'live_set tracks 0 devices 0 parameters 0', paramName: 'Dry/Wet', id: " + pid("live_set tracks 0 devices 0 parameters 0") + "})");
    eq(run(`MM.mappingSlot(${reuse.id})`), delSlot, `${v}: freed slot is reused`);
    eq(route[2 * delSlot], 1, `${v}: reused slot routed from its modulator`);
    // width + aux
    env.log.outlets.length = 0;
    run("MM.requestWidth(5)");
    assert.deepStrictEqual(env.log.outlets[0], [0, "width", 120]); passed++;
    run("MM.retrigger(3)");
    eq(env.log.outlets[1][1], "gen", `${v}: retrigger via gen message`);
    eq(env.log.outlets[1][3] % 16, 3, `${v}: retrigger slot encoded`);
    // telemetry
    run("MM.readTelemetry()");
    const scope = env.bufs["#0-megamodscope"].data;
    scope[0] = 0.5; scope[C.SCOPE_FRAME] = 7; scope[C.SCOPE_BPM] = 128;
    const tel = run("MM.readTelemetry()");
    eq(tel.mods[0].out, 0.5, `${v}: telemetry out`); eq(tel.bpm, 128, `${v}: telemetry bpm`);
    // state round trip into a fresh device instance (path resolves, then name fallback after reorder)
    const saved = run("MM.save()");
    const lom2 = mockLom();
    lom2.tree.tracks[1].devices[1].params = ["Res", "Freq"]; // reordered: stored path now points at the wrong name
    const env2 = makeEnv(lom2);
    loadScript(v, env2);
    env2.ctx.setvalueof(...saved);
    env2.ctx.setnames(...NAMES);
    env2.ctx.init_lom();
    const maps2 = vm.runInContext("MM.allMappings()", env2.ctx);
    eq(maps2.length, vm.runInContext("1", env2.ctx) * run("MM.allMappings().length"), `${v}: mappings restored`);
    const freq2 = maps2.find((m) => m.target.paramName === "Freq");
    eq(freq2.target.path, "live_set tracks 1 devices 1 parameters 1", `${v}: name fallback re-resolved the moved parameter`);
    eq(vm.runInContext(`MM.mappingStatus(${freq2.id})`, env2.ctx), "ok", `${v}: restored mapping live`);
    for (const m2 of maps2) {
        const sl = vm.runInContext(`MM.mappingSlot(${m2.id})`, env2.ctx);
        ok(sl >= 0 && sl < maps2.length, `${v}: restored mapping ${m2.id} has a pool slot`);
        eq(env2.bufs["#0-megamodroute"].data[2 * sl], m2.mod, `${v}: restored mapping ${m2.id} routed`);
    }
    eq(env2.bufs["#0-megamodcfg"].data[C.CF_TYPE], 1, `${v}: engine buffers rewritten on load`);
    // load before names / LOM (Live restores the blob first)
    const lom3 = mockLom();
    lom3.tree.tracks[1].devices[1].params = null;
    lom3.tree.tracks[1].devices[1].params = ["Res"]; // Freq gone
    const env3 = makeEnv(lom3);
    loadScript(v, env3);
    env3.ctx.setvalueof(saved);
    env3.ctx.init_lom();
    env3.ctx.setnames(...NAMES);
    const maps3 = vm.runInContext("MM.allMappings()", env3.ctx);
    const gone = maps3.find((m) => m.target.paramName === "Freq");
    eq(vm.runInContext(`MM.mappingStatus(${gone.id})`, env3.ctx), "missing", `${v}: missing target kept as missing on load`);
    // capacity: 256 mappings fill the pool, the 257th is refused (and a learn reports "full")
    const lom4 = mockLom();
    const env4 = makeEnv(lom4);
    loadScript(v, env4);
    env4.ctx.setnames(...NAMES);
    env4.ctx.init_lom();
    const run4 = (c) => vm.runInContext(c, env4.ctx);
    run4("MM.addModulator(MOD_LFO)");
    run4("var __kinds = []; MM.on('change', function (e) { __kinds.push(e.kind); });");
    eq(run4("MM.MAX_MAPPINGS"), 256, `${v}: MM.MAX_MAPPINGS`);
    for (let k = 0; k < 256; k++) ok(run4(`!!MM.addMapping(0, {path: 'live_set tracks 0 devices 0 parameters ${k}', paramName: 'p${k}', id: ${1000 + k}})`), `${v}: mapping ${k} accepted`);
    eq(run4("MM.allMappings().length"), 256, `${v}: 256 mappings`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(run4("MM.mappingCapacity()"))), { used: 256, max: 256, free: 0 }); passed++;
    eq(run4("MM.addMapping(0, {path: 'live_set tracks 0 devices 0 parameters 999', paramName: 'x', id: 5000})"), null, `${v}: 257th mapping refused`);
    ok(run4("__kinds.indexOf('full') >= 0"), `${v}: refusal fires change kind "full"`);
    run4("__kinds.length = 0");
    run4("MM.armLearn(0, false)");
    const sel4 = env4.observers.find((o) => o._prop === "selected_parameter");
    sel4.cb(["selected_parameter", "id", lom4.idOf("live_set tracks 1 devices 1 parameters 0")]);
    eq(run4("MM.allMappings().length"), 256, `${v}: learn at capacity adds nothing`);
    ok(run4("__kinds.indexOf('full') >= 0"), `${v}: learn at capacity fires "full"`);
    const r4 = env4.bufs["#0-megamodroute"].data;
    for (let k = 0; k < 256; k++) if (r4[2 * k] !== 0) { ok(false, `${v}: slot ${k} routed`); }
    const mid4 = run4("MM.allMappings()[255].id");
    eq(run4(`MM.mappingSlot(${mid4})`), 255, `${v}: slots are 0..255 in order`);
    run4(`MM.deleteMapping(${run4("MM.allMappings()[10].id")})`);
    eq(r4[20], -1, `${v}: deleted slot 10 off`);
    ok(run4("!!MM.addMapping(0, {path: 'live_set tracks 0 devices 0 parameters 999', paramName: 'x', id: 5000})"), `${v}: refused mapping accepted after a delete`);
    eq(r4[20], 0, `${v}: reused slot 10 routed`);
    // paint with content + demo
    run("MM.demo()");
    run("paint()");
    env.ctx.preview && env.ctx.preview();
    run("paint()");
    eq(env.log.notify > 0, true, `${v}: notifyclients called`);
}

console.log(`megamod tests passed (${passed} checks)`);
