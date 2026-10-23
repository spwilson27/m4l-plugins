#!/usr/bin/env node
/**
 * Verification suite for devices/Mega Modulator.amxd (shared core).
 *  1. Build output: header, amxdtype, 169 px, presentation, --- names (never #0), blob param, overlap & z-order rules
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
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); passed++; };
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); passed++; }

// ---------------------------------------------------------------- 1. build output
function readAmxd(file) {
    const raw = fs.readFileSync(file);
    return { raw, doc: JSON.parse(raw.slice(32).toString("utf8")) };
}
const variants = [""]; // one device; `v` only prefixes assertion messages
for (const v of variants) {
    const file = path.join(ROOT, "devices", "Mega Modulator.amxd");
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
    // resizeFace finds the v8ui by scripting name: the main v8ui box must carry exactly that varname, and "obj-viz" must NOT be what it looks up
    {
        const viz = p.boxes.map((b) => b.box).find((b) => b.id === "obj-viz");
        eq(viz.varname, "MegaModState", `${v}: main v8ui varname is what resizeFace looks up`);
        ok(/MM_UI_VARNAME\s*=\s*"MegaModState"/.test(fs.readFileSync(path.join(ROOT, "src", "megamod_mapper.js"), "utf8")), `${v}: resizeFace looks the v8ui up by MegaModState`);
        ok(!/getnamed\("obj-viz"\)/.test(fs.readFileSync(path.join(ROOT, "src", "megamod_mapper.js"), "utf8")), `${v}: no getnamed("obj-viz") (the varname is MegaModState)`);
    }
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
            ok(t.includes("---"), `${v}: ${b.id} "${t}" must be --- prefixed`);
        }
    }
    // Live expands `---` per device but leaves `#0` literal in a device's own patcher (shared across instances)
    ok(!JSON.stringify(p.boxes).includes("#0"), `${v}: no #0 names (not expanded by Live in a device patcher)`);
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
    ok(msgs.some((t) => t === "cfg ---megamodcfg, mseg ---megamodmseg, steps ---megamodsteps, scope ---megamodscope, ibuf ---megamodint, icurve ---megamodicurve, route ---megamodroute"), `${v}: gen binding message`);
    ok(msgs.some((t) => t.startsWith("setnames ---megamodcfg") && t.endsWith("---mmcurve ---megamodroute ---megamodint ---megamodicurve")), `${v}: setnames message`);
    ok(msgs.some((t) => t === "route ---megamodroute, curve ---mmcurve"), `${v}: router binding message`);
    for (const n of ["---megamodcfg @samps 384", "---megamodmseg @samps 16384", "---megamodsteps @samps 512", "---megamodscope @samps 640", "---mmcurve @samps 65536", "---megamodroute @samps 1024", "---megamodint @samps 512", "---megamodicurve @samps 16384"]) {
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
        ok(code.includes("Param smooth(0);"), `${v}: router ${r} has Param smooth (default 0)`);
        ok(code.includes("smCoef = (smooth > 0.0001) ? exp(-1000 / (smooth * smSr)) : 0;"), `${v}: router ${r} one-pole coefficient from smooth ms at the sample rate, bypass at 0`);
        ok(code.indexOf("Param smooth") < code.indexOf("smCoef =") && code.lastIndexOf("History ys") < code.indexOf("smSr ="), `${v}: router ${r} declarations before statements`);
        ok((idx["obj-route:2"] || []).includes(`obj-router-${r}:0`), `${v}: smooth route outlet -> router ${r}`);
        for (let j = 0; j < 32; j++) {
            const k = r * 32 + j;
            ok(code.includes(`sel${j} = peek(route, ${2 * k}) + 1;`), `${v}: router ${r} slot ${k} route index`);
            ok(code.includes(`peek(curve, ${k * 256} + ia${j})`) && code.includes(`peek(curve, ${k * 256} + ib${j})`), `${v}: router ${r} slot ${k} table base`);
            ok(new RegExp(`xv${j} = selector\\(sel${j}, in1, in2, in3, in4, in5, in6, in7, in8, in9, in10, in11, in12, in13, in14, in15, in16\\);`).test(code), `${v}: slot ${k} selector`);
            ok(code.includes(`ys${j} = yv${j} + (ys${j} - yv${j}) * smCoef;`) && code.includes(`out${j + 1} = ys${j};`), `${v}: slot ${k} output goes through the smoothing one-pole`);
            ok(code.includes(`History ys${j}(0);`), `${v}: slot ${k} smoothing history`);
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
    m.shape = C.curveToShape(C.CURVE_S, 0.6, 4); m.range = 0.8;
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
    eq(dirty.mappings[0].range, 1, "legacy amount 9 clamps to 1 and folds into range");
    eq(dirty.mappings[0].amount, undefined, "mappings carry no amount any more");
    eq(dirty.mappings[0].curve, undefined, "legacy curve fields are not kept");
    eq(dirty.mappings[0].shape.length, 8, "legacy curve 12 clamps to Stepped (4 steps = 8 points) and becomes a shape");
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
    // ---- mapping shape (MSEG transfer curve) ----
    eq(C.MEGAMOD_VERSION, 10, "schema version 10 (depth routes)");
    eq(C.defaultState().schema, 10, "new states are schema 10");
    {
        const d = C.defaultMapping(1, 0, {});
        eq(JSON.stringify([d.polarity, d.range, d.amount, d.invert, d.bipolar, d.min, d.max]), JSON.stringify([0, 0.5, null, null, null, 0, 1]), "default mapping: ± , range 0.5, no amount, min 0, max 1, no legacy invert / bipolar");
        const s4 = C.sanitizeMapping({ id: 1, mod: 0, polarity: -1, range: 0.4, amount: -0.3, invert: 1, min: 0.5 }, 4);
        eq(JSON.stringify([s4.polarity, s4.amount, s4.invert, s4.min]), JSON.stringify([1, null, null, 0.5]), "schema 4 mod mapping with a negative amount swaps - to +, drops amount and the legacy invert key");
        near(s4.range, 0.12, 1e-12, "schema 4 range' = |amount| * range");
        eq(C.sanitizeMapping({ id: 1, mod: 0, polarity: 7, range: 9 }, 6).polarity + "," + C.sanitizeMapping({ id: 1, mod: 0, polarity: 7, range: 9 }, 6).range, "1,1", "polarity / range clamped");
        eq(C.sanitizeMapping({ id: 1, mod: 0, polarity: 1, range: 0.6, amount: 0.1 }, 6).range, 0.6, "schema 6 ignores a stray amount");
        // polarity x mode: o = amount * range * (± ? 2y-1 : pol*y); remote anchors on the polarity's zero
        const linear = [{ x: 0, y: 0, curve: 0, sCurve: 0 }, { x: 1, y: 1, curve: 0, sCurve: 0 }];
        for (const pol of [1, 0, -1]) {
            for (const range of [1, 0.5, 0.8, 0.25, 0]) {
                for (const x of [-1, -0.5, 0, 0.3, 1]) {
                    const y = (x + 1) / 2;
                    const o = range * (pol === 0 ? 2 * y - 1 : pol * y);
                    const m = { mode: "mod", polarity: pol, range, shape: linear };
                    near(C.mappingOutput(m, x), o, 1e-12, `mod pol ${pol} rng ${range} x ${x}`);
                    // an amount key is no longer used
                    near(C.mappingOutput(Object.assign({}, m, { amount: -0.7 }), x), o, 1e-12, `amount ignored pol ${pol} rng ${range} x ${x}`);
                    // Remote ignores polarity / range: only min / max (defaults 0 / 1) apply
                    near(C.mappingOutput(Object.assign({}, m, { mode: "remote" }), x), y, 1e-12, `remote ignores pol ${pol} rng ${range} x ${x}`);
                }
            }
        }
        // Remote (schema 5): clamp(min + (max - min) * y), independent limits, min > max inverts
        const rm = (min, max) => ({ mode: "remote", polarity: 1, range: 0.3, min, max, shape: linear });
        for (const x of [-1, -0.5, 0, 0.3, 1]) {
            const y = (x + 1) / 2;
            near(C.mappingOutput(rm(0.2, 0.8), x), 0.2 + 0.6 * y, 1e-12, `remote min/max x ${x}`);
            near(C.mappingOutput(rm(0.8, 0.2), x), 0.8 - 0.6 * y, 1e-12, `remote min > max inverts x ${x}`);
            near(C.mappingOutput(rm(0.8, 0.2), x), C.mappingOutput(rm(0.2, 0.8), -x), 1e-12, `inverted = mirrored x ${x}`);
        }
        ok(C.mappingTable(rm(0.9, 0.1))[0] > C.mappingTable(rm(0.9, 0.1))[255], "min > max: falling table");
        // switching mode keeps both sets of fields
        {
            const st = C.defaultState();
            st.mods[0] = C.makeModSlot(C.MOD_LFO, 0);
            const mp = C.defaultMapping(1, 0, { path: "p" });
            Object.assign(mp, { polarity: -1, range: 0.6, min: 0.3, max: 0.7 });
            st.mappings.push(mp); st.nextMapId = 2;
            const modOut = C.mappingOutput(mp, 0.4);
            const remOut = C.mappingOutput(Object.assign({}, mp, { mode: "remote" }), 0.4);
            const back = C.deserializeState(C.serializeState(st)).mappings[0];
            const flipped = C.sanitizeMapping(Object.assign({}, back, { mode: "remote" }));
            const home = C.sanitizeMapping(Object.assign({}, flipped, { mode: "mod" }));
            eq(JSON.stringify([flipped.polarity, flipped.range, flipped.min, flipped.max]), JSON.stringify([-1, 0.6, 0.3, 0.7]), "Remote keeps polarity / range and min / max");
            eq(JSON.stringify([home.polarity, home.range, home.min, home.max]), JSON.stringify([-1, 0.6, 0.3, 0.7]), "back to Mod: everything restored");
            near(C.mappingOutput(home, 0.4), modOut, 1e-12, "Mod output restored after a Remote round trip");
            near(C.mappingOutput(flipped, 0.4), remOut, 1e-12, "Remote output uses min / max only");
        }
        // schema 4 -> 5: remote polarity / range / amount become min / max, exactly (clamped to 0..1)
        {
            // NOTE: when amount * range leaves 0..1 (or amount is negative on + / -), the old output was clamped per sample
            // while min / max can only clamp the endpoints; those cases (marked clamped) are checked at the limits only.
            let worst = 0; let n = 0;
            const shape4 = [{ x: 0, y: 0.1, curve: 0.4, sCurve: 0 }, { x: 0.4, y: 0.9, curve: -0.5, sCurve: 1 }, { x: 1, y: 0.3, curve: 0, sCurve: 0 }];
            for (const pol of [1, 0, -1]) {
                for (const [amount, range] of [[1, 1], [0.5, 1], [0.8, 0.5], [0.3, 0.6], [1, 0.25]]) {
                    const old = { id: 1, mod: 0, mode: "remote", polarity: pol, range, amount, shape: shape4, target: { path: "p" } };
                    const st = C.normalizeState({ schema: 4, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [old], nextMapId: 2 });
                    const m = st.mappings[0];
                    const ar = amount * range;
                    const want = pol > 0 ? [0, ar] : pol < 0 ? [1, 1 - ar] : [0.5 - ar / 2, 0.5 + ar / 2];
                    near(m.min, want[0], 1e-12, `schema 4 remote pol ${pol} a ${amount} r ${range}: min`);
                    near(m.max, want[1], 1e-12, `schema 4 remote pol ${pol} a ${amount} r ${range}: max`);
                    near(m.range, amount * range, 1e-12, "amount folded into range (kept for a later switch back to Mod)"); eq(m.polarity, pol, "positive amount keeps polarity");
                    const tNew = C.mappingTable(m);
                    for (let j = 0; j < 256; j++) {
                        const u = j === 255 ? 1 : j / 256;
                        const y = C.evalMseg(shape4, u);
                        const o = amount * range * (pol === 0 ? 2 * y - 1 : pol * y);
                        const v4 = Math.min(1, Math.max(0, pol > 0 ? o : pol < 0 ? 1 + o : 0.5 + o / 2));
                        worst = Math.max(worst, Math.abs(tNew[j] - v4)); n++;
                    }
                }
            }
            ok(worst < 1e-9 && n > 0, `schema 4 remote tables reproduced within 1e-9 for every polarity (${worst.toExponential(1)} over ${n})`);
            // clamped case: + with amount * range = 1.5 clamps max to 1 (the old output clamped per sample, the new response is a straight 0..1 ramp)
            const big = C.normalizeState({ schema: 4, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [{ id: 1, mod: 0, mode: "remote", polarity: 1, range: 1, amount: 1.5 }], nextMapId: 2 });
            ok(big.mappings[0].max <= 1 && big.mappings[0].min === 0, "schema 4 remote: amount is clamped to 1 first, limits stay in 0..1");
            const neg = C.normalizeState({ schema: 4, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [{ id: 1, mod: 0, mode: "remote", polarity: 1, range: 1, amount: -0.5 }], nextMapId: 2 });
            eq(neg.mappings[0].max, 0, "schema 4 remote + with negative amount: max clamps to 0 (old output was a constant 0, same response)");
            // schema 4 mod mappings are untouched and get min 0 / max 1
            const modm = C.normalizeState({ schema: 4, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [{ id: 1, mod: 0, mode: "mod", polarity: -1, range: 0.5, amount: 0.7 }], nextMapId: 2 }).mappings[0];
            eq(JSON.stringify([modm.polarity, modm.range, modm.amount, modm.min, modm.max]), JSON.stringify([-1, 0.35, null, 0, 1]), "schema 4 mod mapping: range' = 0.7 * 0.5, min 0 max 1");
            // schema 5 states are read as-is (not re-derived)
            const five = C.normalizeState({ schema: 5, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [{ id: 1, mod: 0, mode: "remote", polarity: -1, range: 0.5, amount: 0.7, min: 0.25, max: 0.9 }], nextMapId: 2 }).mappings[0];
            eq(JSON.stringify([five.min, five.max]), JSON.stringify([0.25, 0.9]), "schema 5 remote keeps min / max");
        }
        const tb = C.mappingTable({ mode: "mod", polarity: 0, range: 0.7, shape: linear });
        eq(tb.length, 256, "table keeps its 256-sample layout");
        near(tb[0], -0.7, 1e-12, "± table start = -range"); near(tb[255], 0.7, 1e-12, "± table end = +range");
    }
    // ---- migration schema 4 / 5 -> 6: Mod amount folded into range (positive and negative amounts, every polarity) ----
    {
        const shape = [{ x: 0, y: 0.1, curve: 0.4, sCurve: 0 }, { x: 0.3, y: 0.9, curve: -0.5, sCurve: 1 }, { x: 0.65, y: 0.25, curve: 0.7, sCurve: 0 }, { x: 1, y: 0.8, curve: -0.3, sCurve: 1 }];
        let worst = 0; let n = 0;
        for (const schema of [4, 5]) {
            for (const pol of [1, 0, -1]) {
                for (const amount of [1, 0.5, 0.2, -0.2, -0.5, -1]) {
                    for (const range of [1, 0.6, 0.15, 0]) {
                        const old = { id: 1, mod: 0, mode: "mod", polarity: pol, range, amount, shape, target: { path: "p" } };
                        const st = C.normalizeState({ schema, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [old], nextMapId: 2 });
                        const m = st.mappings[0];
                        eq(st.schema, 10, "migrated state is schema 10");
                        eq(m.amount, undefined, "amount dropped");
                        near(m.range, Math.abs(amount) * range, 1e-12, `schema ${schema} pol ${pol} a ${amount} r ${range}: range'`);
                        eq(m.polarity, amount < 0 && pol !== 0 ? -pol : pol, `schema ${schema} pol ${pol} a ${amount}: polarity swap`);
                        const t = C.mappingTable(m);
                        for (let j = 0; j < 256; j++) {
                            const u = j === 255 ? 1 : j / 256;
                            const y = C.evalMseg(shape, u);
                            const o = amount * range * (pol === 0 ? 2 * y - 1 : pol * y);
                            worst = Math.max(worst, Math.abs(t[j] - o)); n++;
                        }
                        // Remote mappings: min / max untouched, table the same; switching back to Mod matches the old Mod output
                        if (schema === 5) {
                            const rold = Object.assign({}, old, { mode: "remote", min: 0.2, max: 0.7 });
                            const rm = C.normalizeState({ schema, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [rold], nextMapId: 2 }).mappings[0];
                            eq(rm.min + "," + rm.max, "0.2,0.7", "schema 5 remote min / max untouched");
                            const back = C.mappingTable(Object.assign({}, rm, { mode: "mod" }));
                            for (let j = 0; j < 256; j++) {
                                const u = j === 255 ? 1 : j / 256;
                                const y = C.evalMseg(shape, u);
                                worst = Math.max(worst, Math.abs(back[j] - amount * range * (pol === 0 ? 2 * y - 1 : pol * y))); n++;
                            }
                        }
                    }
                }
            }
        }
        ok(worst < 1e-9 && n > 0, `schema 4 / 5 Mod tables reproduced within 1e-9 for every polarity and amount sign (${worst.toExponential(2)} over ${n})`);
        console.log(`migration 4/5 -> 6: max table error ${worst.toExponential(2)}`);
        // the vertical flip is exact against evalMseg (bends and S-curves keep their parameters)
        const flipped = shape.map((p) => ({ x: p.x, y: 1 - p.y, curve: p.curve, sCurve: p.sCurve }));
        let fe = 0;
        for (let i = 0; i <= 500; i++) fe = Math.max(fe, Math.abs(C.evalMseg(flipped, i / 500) - (1 - C.evalMseg(shape, i / 500))));
        ok(fe < 1e-12, `y -> 1 - y commutes with evalMseg incl. bends / S-curves (${fe.toExponential(1)})`);
        // schema 1-3 negative amounts also migrate exactly
        const o3 = { id: 1, mod: 0, mode: "mod", amount: -0.6, bipolar: 1, invert: 0, min: 0, max: 1, shape, target: { path: "p" } };
        const m3 = C.normalizeState({ schema: 3, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [o3], nextMapId: 2 }).mappings[0];
        const t3 = C.mappingTable(m3);
        let w3 = 0;
        for (let j = 0; j < 256; j++) { const y = C.evalMseg(shape, j === 255 ? 1 : j / 256); w3 = Math.max(w3, Math.abs(t3[j] - (-0.6) * (2 * y - 1))); }
        ok(w3 < 1e-9, `schema 3 negative amount bipolar migrates exactly (${w3.toExponential(1)})`);
    }
    // ---- migration schema 1 / 2 / 3 -> 4: the old formulas are reproduced by the baked shape ----
    {
        const sShape = [{ x: 0, y: 0.1, curve: 0.4, sCurve: 0 }, { x: 0.35, y: 0.9, curve: -0.6, sCurve: 1 }, { x: 0.7, y: 0.3, curve: 0.2, sCurve: 1 }, { x: 1, y: 0.8, curve: 0, sCurve: 0 }];
        let worst = 0; let n = 0;
        const oldOut = (om, schema, y) => {
            let c = om.invert ? 1 - y : y;
            const useRange = om.mode === "remote" || schema === 3;
            const lo = useRange ? om.min : 0; const hi = useRange ? om.max : 1;
            c = lo + (hi - lo) * c;
            return om.mode === "remote" ? Math.min(1, Math.max(0, c)) : om.amount * (om.bipolar ? 2 * c - 1 : c);
        };
        for (const schema of [1, 2, 3]) {
            for (const mode of ["mod", "remote"]) {
                for (const invert of [0, 1]) {
                    for (const bipolar of [0, 1]) for (const amount of [0.6, -0.6]) {
                        for (const [min, max] of [[0, 1], [0.2, 0.7], [0.35, 0.6]]) {
                            const om = { id: 1, mod: 0, mode, amount, bipolar, invert, min, max, target: { path: "p" } };
                            let yAt;
                            if (schema === 1) { Object.assign(om, { curve: C.CURVE_S, curveAmt: 0.7, curveSteps: 4 }); yAt = (u) => C.shapeCurve(u, C.CURVE_S, 0.7, 4); }
                            else { om.shape = sShape; yAt = (u) => C.evalMseg(sShape, u); }
                            const st = C.normalizeState({ schema, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [om], nextMapId: 2 });
                            const m = st.mappings[0];
                            eq(JSON.stringify([m.invert, m.bipolar, m.min, m.max]), JSON.stringify([null, null, 0, 1]), "legacy keys dropped by the migration (the old limits live in the shape; min 0 max 1)");
                            near(m.range, mode === "remote" ? 1 : Math.abs(amount), 1e-12, "migrated range = |amount| (remote: 1)");
                            eq(m.polarity, mode === "remote" ? 1 : (bipolar ? 0 : amount < 0 ? -1 : 1), "migrated polarity (negative unipolar amount swaps to -)");
                            const t = C.mappingTable(m);
                            for (let j = 0; j < 256; j++) {
                                const u = j === 255 ? 1 : j / 256;
                                worst = Math.max(worst, Math.abs(t[j] - oldOut(om, schema, yAt(u)))); n++;
                            }
                        }
                    }
                }
            }
        }
        ok(worst < 0.02 && n > 0, `schema 1/2/3 states reproduce the old tables (max error ${worst.toExponential(2)} over ${n} samples)`);
        console.log(`migration: max table error ${worst.toExponential(2)}`);
        // the affine bake is exact against evalMseg, S-curve flag included
        const lo = 0.2; const hi = 0.7;
        const baked = sShape.map((p) => ({ x: p.x, y: lo + (hi - lo) * (1 - p.y), curve: p.curve, sCurve: p.sCurve }));
        let aff = 0;
        for (let i = 0; i <= 400; i++) aff = Math.max(aff, Math.abs(C.evalMseg(baked, i / 400) - (lo + (hi - lo) * (1 - C.evalMseg(sShape, i / 400)))));
        ok(aff < 1e-12, `affine y transform commutes with evalMseg incl. S-curves (${aff.toExponential(1)})`);
        // schema 2 mod range is ignored (old behaviour), schema 3 keeps it
        const mk = (schema) => C.normalizeState({ schema, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [{ id: 1, mod: 0, mode: "mod", amount: 1, bipolar: 0, min: 0.3, max: 0.6 }] }).mappings[0];
        near(C.mappingOutput(mk(2), 1), 1, 1e-9, "schema 2 mod: range ignored");
        near(C.mappingOutput(mk(3), 1), 0.6, 1e-9, "schema 3 mod: range baked in");
        // a raw legacy object (no polarity) handed straight to the helpers uses the old formula (audio-test fixtures)
        near(C.mappingOutput({ mode: "remote", min: 0.2, max: 0.8, invert: 1, curve: 0 }, -1), 0.8, 1e-12, "raw legacy remote");
    }
    eq(JSON.stringify(base.shape.map((p) => [p.x, p.y])), "[[0,0],[1,1]]", "default shape is the linear two-point MSEG");
    {
        const m = Object.assign({}, base, { range: 1, polarity: 0 });
        m.shape = [{ x: 0, y: 0, curve: 0, sCurve: 0 }, { x: 0.5, y: 1, curve: 0, sCurve: 0 }, { x: 1, y: 0, curve: 0, sCurve: 0 }];
        near(C.mappingOutput(m, 0), 1, 1e-12, "shape peak at the middle (x=0 -> u 0.5 -> y 1 -> bipolar +1)");
        near(C.mappingOutput(m, -1), -1, 1e-12, "shape start");
        near(C.mappingOutput(m, 1), -1, 1e-12, "shape end");
        near(C.mappingOutput(m, -0.5), 0, 1e-12, "evaluates at u = (x+1)/2");
        const mi = Object.assign({}, m, { polarity: -1 });
        near(C.mappingOutput(mi, 0), -1, 1e-12, "minus polarity: -y");
        const mr = Object.assign({}, m, { mode: "remote", polarity: 1, min: 0, max: 0.8 });
        near(C.mappingOutput(mr, 0), 0.8, 1e-12, "remote: min + (max - min) * y");
        const mu = Object.assign({}, m, { range: 0.5, polarity: 1 });
        near(C.mappingOutput(mu, 0), 0.5, 1e-12, "mod unipolar: range * y");
        const tb = C.mappingTable(m);
        eq(tb.length, 256, "table keeps its 256-sample layout");
        near(tb[255], -1, 1e-12, "last sample = u 1");
        near(tb[128], 1, 1e-12, "table follows the shape");
        // bent segment
        const mb = Object.assign({}, base, { range: 1, polarity: 1 });
        mb.shape = [{ x: 0, y: 0, curve: -0.5, sCurve: 0 }, { x: 1, y: 1, curve: 0, sCurve: 0 }];
        near(C.mappingOutput(mb, 0), Math.pow(0.5, Math.pow(2, 1.8)), 1e-12, "segment curve uses the MSEG power law");
        // pinned ends + sanitising
        const sh = C.sanitizeShape([{ x: 0.2, y: 2 }, { x: 0.8, y: -1 }]);
        eq(sh[0].x, 0, "first point pinned to x 0"); eq(sh[1].x, 1, "last point pinned to x 1");
        eq(sh[0].y, 1, "y clamped"); eq(sh[1].y, 0, "y clamped low");
        eq(C.sanitizeShape([{ x: 0.5, y: 0.5 }]).length, 2, "fewer than 2 points -> linear");
        eq(C.sanitizeMapping({ id: 1, mod: 0, shape: [] }).shape.length, 2, "empty shape -> linear");
    }
    // ---- migration: schema 1 states (curve / curveAmt / curveSteps) give near-identical tables ----
    {
        let worst = 0;
        for (const type of [C.CURVE_LINEAR, C.CURVE_EXP, C.CURVE_LOG, C.CURVE_S, C.CURVE_STEPPED]) {
            for (const amt of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
                for (const steps of (type === C.CURVE_STEPPED ? [2, 3, 4, 5, 7, 8, 11, 16] : [4])) {
                    for (const inv of [0, 1]) {
                        for (const [mode, bip] of [["mod", 1], ["mod", 0], ["remote", 1]]) {
                            const old = { id: 1, mod: 0, mode, amount: 0.9, bipolar: bip, min: 0.1, max: 0.9, invert: inv, curve: type, curveAmt: amt, curveSteps: steps, target: { path: "p" } };
                            const v1 = { schema: 1, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [old], nextMapId: 2, ui: {} };
                            // through the real wire format (v1 blob), like a Live set saved by the previous release
                            const loaded = C.deserializeState(C.serializeState(v1)).mappings[0];
                            eq(loaded.curve, undefined, "old curve field dropped after migration");
                            ok(Array.isArray(loaded.shape) && loaded.shape.length >= 2, "migrated mapping has a shape");
                            eq(loaded.shape[0].x, 0, "migrated shape starts at 0"); eq(loaded.shape[loaded.shape.length - 1].x, 1, "migrated shape ends at 1");
                            const tbl = C.mappingTable(loaded);
                            for (let j = 0; j < 256; j++) {
                                const u = j === 255 ? 1 : j / 256;
                                let c = C.shapeCurve(u, type, amt, steps);
                                if (inv) c = 1 - c;
                                const want = mode === "remote" ? Math.min(1, Math.max(0, 0.1 + 0.8 * c)) : 0.9 * (bip ? 2 * c - 1 : c);
                                worst = Math.max(worst, Math.abs(tbl[j] - want));
                            }
                        }
                    }
                }
            }
        }
        ok(worst < 0.02, `migrated tables match the old formula (max error ${worst.toFixed(4)} < 0.02)`);
        const v1 = { schema: 1, mods: [C.makeModSlot(C.MOD_LFO, 0)], mappings: [{ id: 3, mod: 0, curve: C.CURVE_STEPPED, curveSteps: 3, amount: 1, target: { path: "p" } }], nextMapId: 4 };
        const st = C.normalizeState(v1);
        eq(st.schema, 10, "migrated state is the current schema");
        eq(st.mappings[0].shape.length, 6, "stepped(3) = 3 hard steps = 6 points");
        eq(st.mappings[0].shape.map((p) => p.y).join(), "0,0,0.5,0.5,1,1", "stepped levels 0, 0.5, 1");
        near(C.mappingTable(st.mappings[0])[128], 0.0, 1e-9, "stepped middle step is flat");
        // exact one-segment conversions
        eq(C.curveToShape(C.CURVE_EXP, 0.5, 4).length, 2, "exp is a single bent segment");
        eq(C.curveToShape(C.CURVE_S, 0.5, 4)[0].sCurve, 1, "S is a single S-flag segment");
        eq(C.curveToShape(C.CURVE_LINEAR, 0.5, 4).length, 2, "linear is two points");
        // a schema-2 state round-trips its shape untouched
        const s2 = C.defaultState();
        s2.mods[0] = C.makeModSlot(C.MOD_LFO, 0);
        const m2 = C.defaultMapping(1, 0, { path: "p" });
        m2.shape = [{ x: 0, y: 0.1, curve: 0.3, sCurve: 0 }, { x: 0.4, y: 0.9, curve: -0.2, sCurve: 1 }, { x: 1, y: 0.2, curve: 0, sCurve: 0 }];
        s2.mappings.push(m2); s2.nextMapId = 2;
        const back = C.deserializeState(C.serializeState(s2));
        eq(JSON.stringify(back.mappings[0].shape), JSON.stringify(m2.shape), "shape round trip");
        eq(back.schema, 10, "current schema stays");
        // a legacy-field mapping handed straight to the table helpers still resolves (audio-test fixtures)
        const legacy = { mode: "mod", amount: 0.8, bipolar: 1, invert: 0, curve: C.CURVE_S, curveAmt: 0.6, curveSteps: 4 };
        near(C.mappingOutput(legacy, 0.3), C.mappingOutput(Object.assign({}, legacy, { shape: C.curveToShape(C.CURVE_S, 0.6, 4) }), 0.3), 1e-12, "legacy fields fall back to the converted shape");
    }
    eq(new Set(Array.from({ length: 200 }, (_, j) => C.shapeCurve(j / 199, C.CURVE_STEPPED, 0, 4))).size, 4, "stepped 4 -> 4 levels");
    const t = C.mappingTable(Object.assign({}, base, { range: 1 }));
    eq(t.length, C.CURVE_REGION, "table size");
    near(t[0], -1, 1e-12, "mod bipolar table start");
    near(t[255], 1, 1e-12, "mod bipolar table end");
    const inv = C.mappingTable(Object.assign({}, base, { range: 1, polarity: -1 }));
    near(inv[0], 0, 1e-12, "minus start"); near(inv[255], -1, 1e-12, "minus end");
    const uni = C.mappingTable(Object.assign({}, base, { range: 0.5, polarity: 1 }));
    near(uni[0], 0, 1e-12, "unipolar start"); near(uni[255], 0.5, 1e-12, "unipolar end");
    const rem = C.mappingTable(Object.assign({}, base, { mode: "remote", min: 0, max: 0.8 }));
    near(rem[0], 0, 1e-12, "remote start = min"); near(rem[255], 0.8, 1e-12, "remote end = max");
    const rem2 = C.mappingOutput(Object.assign({}, base, { mode: "remote", min: 1, max: 0.2 }), -1);
    near(rem2, 1, 1e-12, "remote min > max: starts at min");
    near(C.mappingOutput(Object.assign({}, base, { range: 0.5 }), 1), 0.5, 1e-12, "default ±, range 0.5: full-scale output is +range");

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
        ok(GEN.includes(`peek(cm, ${expr})`), `engine reads ${k} (modulated copy) at ${expr}`);
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

// ---------------------------------------------------------------- 5b. settings (schema 7), engine ratemul
{
    eq(C.MEGAMOD_VERSION, 10, "schema 10");
    const d = C.defaultState();
    eq(d.schema, 10, "default state is schema 10");
    assert.deepStrictEqual(d.settings, { defaultMode: "mod", smoothMs: 0, rateMul: 1, selfMod: "internal" }); passed++;
    // sanitize: clamps, bad values -> defaults
    assert.deepStrictEqual(C.sanitizeSettings({ defaultMode: "remote", smoothMs: 9999, rateMul: 100 }), { defaultMode: "remote", smoothMs: 500, rateMul: 4, selfMod: "internal" }); passed++;
    assert.deepStrictEqual(C.sanitizeSettings({ defaultMode: "x", smoothMs: -3, rateMul: 0 }), { defaultMode: "mod", smoothMs: 0, rateMul: 0.25, selfMod: "internal" }); passed++;
    assert.deepStrictEqual(C.sanitizeSettings(null), C.defaultSettings()); passed++;
    assert.deepStrictEqual(C.sanitizeSettings({ smoothMs: "abc" }), C.defaultSettings()); passed++;
    // an old saved `tooltips` key is ignored (no schema bump) and not carried forward
    eq(C.sanitizeSettings({ tooltips: false }).tooltips, undefined, "tooltips key dropped by sanitize");
    {
        const t = C.defaultState();
        t.settings.tooltips = false;
        const back0 = C.deserializeState(C.serializeState(t));
        eq("tooltips" in back0.settings, false, "old tooltips key dropped on load");
        assert.deepStrictEqual(back0.settings, C.defaultSettings()); passed++;
    }
    // round trip through the blob
    const s = C.defaultState();
    s.mods[0] = C.makeModSlot(C.MOD_LFO, 0);
    s.settings = { defaultMode: "remote", smoothMs: 47.5, rateMul: 1.5, selfMod: "internal" };
    const back = C.deserializeState(C.serializeState(s));
    assert.deepStrictEqual(back.settings, { defaultMode: "remote", smoothMs: 47.5, rateMul: 1.5, selfMod: "internal" }); passed++;
    eq(back.schema, 10, "round trip is schema 10");
    // old states (schema 1..6, no settings) get the defaults and keep everything else
    for (const sc of [1, 2, 3, 4, 5, 6]) {
        const old = JSON.parse(C.stateToJson(s));
        delete old.settings;
        old.schema = sc;
        const n = C.normalizeState(old);
        assert.deepStrictEqual(n.settings, { defaultMode: "mod", smoothMs: 0, rateMul: 1, selfMod: "internal" }); passed++;
        eq(n.schema, 10, `schema ${sc} state normalizes to 10`);
        ok(!!n.mods[0], `schema ${sc}: modulators kept`);
    }
    // default mapping per mode
    const mm = C.defaultMapping(1, 0, { path: "p" }, "mod");
    deq([mm.mode, mm.polarity, mm.range], ["mod", 0, 0.5], "Mod default stays +-, range 0.5");
    const mr = C.defaultMapping(2, 0, { path: "p" }, "remote");
    deq([mr.mode, mr.min, mr.max], ["remote", 0, 1], "Remote default is min 0, max 1");
    eq(C.defaultMapping(3, 0, { path: "p" }).mode, "mod", "no mode argument = Mod");
    // helpers: smoothing log feel, rate dial snapping
    eq(C.smoothFromPos(0), 0, "smooth pos 0 = off");
    near(C.smoothFromPos(1), 500, 1e-9, "smooth pos 1 = 500 ms");
    for (let p = 0; p <= 1.0001; p += 0.05) near(C.smoothToPos(C.smoothFromPos(p)), Math.min(p, 1), 1e-9, "smooth pos round trip");
    ok(C.smoothFromPos(0.5) < 60 && C.smoothFromPos(0.5) > 30, "smoothing slider is log-ish (half travel ~45 ms)");
    for (const st of C.RATE_MUL_STEPS) {
        near(C.rateFromPos(C.rateToPos(st)), st, 1e-9, `rate step ${st} round trip`);
        near(C.rateSnap(st * 1.02), st, 1e-12, `rate ${st}*1.02 snaps to the step`);
        near(C.rateSnap(st * 0.98), st, 1e-12, `rate ${st}*0.98 snaps to the step`);
    }
    near(C.rateFromPos(0.5), 1, 1e-12, "dial centre = x1");
    near(C.rateSnap(1.25), 1.25, 1e-12, "between steps the value is free (fine drag)");
    near(C.rateSnap(2.5), 2.5, 1e-12, "2.5 is between 2 and 3");
    eq(C.rateText(1.5), "\u00d71.5", "rate text x1.5");
    eq(C.rateText(1), "\u00d71", "rate text x1");
    eq(C.rateText(2), "\u00d72", "rate text x2");
    eq(C.rateText(1.25), "\u00d71.25", "rate text of a free value");
    eq(C.smoothText(0), "Off", "smoothing 0 reads Off");
    eq(C.smoothText(50), "50 ms", "smoothing text");
    // engine: Param ratemul used in every rate path
    ok(/Param ratemul\(1\);/.test(GEN), "engine has Param ratemul (default 1)");
    ok(GEN.includes("accFree = accFree + rate * rmul / sr;"), "free-running phase increment uses ratemul");
    ok(GEN.includes("(beat - anchored) / divBeats * rmul + syncOff"), "synced phase uses ratemul with a continuity offset");
    ok(GEN.includes("syncOff = syncOff + (beat - anchored) / divBeats * (prevMul - rmul);"), "ratemul change keeps the synced phase continuous");
    ok(/History prevMul\(1\);/.test(GEN) && GEN.includes("prevMul = rmul;"), "previous multiplier tracked");
    ok(GEN.indexOf("Param ratemul") < GEN.indexOf("rmul = clip(ratemul"), "ratemul declared before use");
    const envBranch = GEN.slice(GEN.indexOf("} else if (typ < 2.5) {"), GEN.indexOf("} else if (typ < 3.5) {"));
    ok(!envBranch.includes("rmul") && !envBranch.includes("ratemul"), "the envelope follower ignores ratemul");
}


const mcPy = {
    router: (r) => execFileSync("python3", ["-c", `import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.router_gen_code(${r}))`], { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8"),
};

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
        tree, idOf, ids,
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
        constructor(name) { this.name = name; if (!bufs[name]) bufs[name] = { data: new Float64Array(name.endsWith("mmcurve") ? 65536 : name.endsWith("route") ? 1024 : name.endsWith("scope") ? 640 : name.endsWith("megamodint") ? 512 : name.endsWith("icurve") ? 16384 : 1 << 15) }; this.b = bufs[name]; }
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
    // The saved automatable parameter pool (ap_<i>, ad_<k>, ap_marker): a mock live.* object holds a value, records setattr / message
    // calls and (echo on, like Live) outputs a messaged value straight back through the script's autop / autod / autom entry points.
    const live = {};
    const liveCfg = { echo: true, canRead: true, ctx: null };
    function liveObj(n) {
        if (!live[n]) {
            const o = { name: n, attrs: {}, attrLog: [], messages: [], value: 0 };
            o.maxclass = /^ap_\d+$/.test(n) && Number(n.slice(3)) % 6 === 5 ? "live.text" : "live.numbox";
            o.setattr = function (k, v) { this.attrs[k] = v; this.attrLog.push([k, v]); };
            o.getattr = function (k) { return this.attrs[k]; };
            o.message = function (t, v) { this.messages.push([t, v]); this.value = v; if (liveCfg.echo) emitLive(n, v); };
            o.getvalueof = function () { if (!liveCfg.canRead) throw new Error("no getvalueof"); return this.value; };
            live[n] = o;
        }
        return live[n];
    }
    function emitLive(n, v) {
        const m = /^(ap|ad|at)_(\d+)$/.exec(n);
        if (n === "ap_marker") liveCfg.ctx.autom(v);
        else if (m[1] === "ap") liveCfg.ctx.autop(Number(m[2]), v);
        else if (m[1] === "at") liveCfg.ctx.autot(Number(m[2]), v);
        else liveCfg.ctx.autod(Number(m[2]), v);
    }
    // obj-viz / obj-panel-<i>: presentation_rect holders for the resizeFace checks (the saved builder rects)
    const faceBoxes = {
        "MegaModState": { attrs: { presentation_rect: [4, 4, 580, 161] } },
        "obj-panel-0": { attrs: { presentation_rect: [0, 0, 588, 169] } },
    };
    for (const k of Object.keys(faceBoxes)) {
        faceBoxes[k].setattr = function (name, ...v) { this.attrs[name] = v; this.log = (this.log || []).concat([[name, v]]); };
        faceBoxes[k].getattr = function (name) { return this.attrs[name]; };
    }
    const patcher = {
        faceBoxes,
        getnamed(n) {
            if (faceBoxes[n]) return faceBoxes[n];
            if (n === "megamod_engine") return engine;
            if ((/^ap_\d+$/.test(n) && Number(n.slice(3)) < 96) || (/^at_\d+$/.test(n) && Number(n.slice(3)) < 96) || (/^ad_\d+$/.test(n) && Number(n.slice(3)) < 64) || n === "ap_marker") return liveObj(n);
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
    liveCfg.ctx = ctx;
    return { ctx, log, bufs, observers, patcher, engine, pool, live, liveCfg, liveObj, emitLive };
}

function loadScript(variant, env) {
    const out = execFileSync("python3", ["-c",
        "import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script())"],
        { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(out, env.ctx, { filename: "megamod_ui.js" });
    return out;
}

const NAMES = ["---megamodcfg", "---megamodmseg", "---megamodsteps", "---megamodscope", "---mmcurve", "---megamodroute", "---megamodint", "---megamodicurve"];

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
    const cfg = env.bufs["---megamodcfg"].data;
    eq(cfg[C.CF_TYPE], 1, `${v}: cfg type written`);
    eq(cfg[C.CF_ENABLED], 1, `${v}: cfg enabled written`);
    run("MM.setParam(0, 'rate', 3.5)");
    eq(cfg[C.CF_RATE], 3.5, `${v}: setParam writes cfg`);
    const s1 = run("MM.addModulator(MOD_MSEG)");
    near(env.bufs["---megamodmseg"].data[s1 * C.MSEG_TABLE + 512], 1, 5e-3, `${v}: MSEG table written`);
    run("MM.setStep(0, 2, 0.6)");
    near(env.bufs["---megamodsteps"].data[2], 0.6, 1e-9, `${v}: step written`);
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
    const route = env.bufs["---megamodroute"].data;
    const tbl = env.bufs["---mmcurve"].data;
    const lastMsg = (n) => { const o = env.pool[n]; return o && o.messages.length ? o.messages[o.messages.length - 1] : null; };
    const nonzero = (n) => !!env.pool[n] && env.pool[n].messages.some((a) => a[1] !== 0);
    eq(run(`MM.mappingSlot(${m1.id})`), 0, `${v}: first mapping takes slot 0`);
    eq(route[0], 0, `${v}: route[0] = source modulator index`);
    eq(route[2], -1, `${v}: free slot route is off (-1)`);
    eq(route[2 * 255], -1, `${v}: last slot route is off`);
    assert.deepStrictEqual(lastMsg("mm_mid_0"), ["int", pid(P_FREQ)]); passed++;
    ok(!nonzero("mm_rid_0"), `${v}: live.remote~ id box never bound in mod mode`);
    near(tbl[0], -0.5, 1e-9, `${v}: mapping table start (default ± range 0.5)`);
    near(tbl[255], 0.5, 1e-9, `${v}: mapping table end`);
    // edit range/curve only rewrites the table (no id traffic)
    const nSeq = env.log.seq.length;
    run(`MM.updateMapping(${m1.id}, {range: 1, polarity: -1})`);
    eq(env.log.seq.length, nSeq, `${v}: editing a mapping sends no ids`);
    near(tbl[255], -1, 1e-9, `${v}: minus-polarity table`);
    // an edited shape rewrites only the table (peak shape: 0 -> 1 -> 0, inverted, amount 1, bipolar)
    const nSeqShape = env.log.seq.length;
    run(`MM.updateMapping(${m1.id}, {shape: [{x: 0, y: 0, curve: 0, sCurve: 0}, {x: 0.5, y: 1, curve: 0, sCurve: 0}, {x: 1, y: 0, curve: 0, sCurve: 0}]})`);
    eq(env.log.seq.length, nSeqShape, `${v}: editing the shape sends no ids`);
    near(tbl[0], 0, 1e-9, `${v}: shape table start (minus, y 0 -> 0)`);
    near(tbl[128], -1, 1e-9, `${v}: shape table peak (minus, y 1 -> -1)`);
    eq(run(`MM.getMapping(${m1.id}).shape.length`), 3, `${v}: mapping stores the shape`);
    run(`MM.updateMapping(${m1.id}, {shape: [{x: 0, y: 0, curve: 0, sCurve: 0}, {x: 1, y: 1, curve: 0, sCurve: 0}]})`);
    // mode switch: unbind the old box first, then bind the other one
    run(`MM.updateMapping(${m1.id}, {mode: 'remote'})`);
    const tail = env.log.seq.slice(nSeq);
    assert.deepStrictEqual(tail, [["mm_mid_0", ["int", 0]], ["mm_rid_0", ["int", pid(P_FREQ)]]]); passed++;
    near(tbl[255], 1, 1e-9, `${v}: remote table end (default max 1, polarity ignored)`);
    run(`MM.updateMapping(${m1.id}, {min: 0.8, max: 0.2})`);
    near(tbl[0], 0.8, 1e-9, `${v}: remote min > max table start`); near(tbl[255], 0.2, 1e-9, `${v}: remote min > max table end (inverted)`);
    eq(run(`MM.getMapping(${m1.id}).min + ',' + MM.getMapping(${m1.id}).max`), "0.8,0.2", `${v}: mapper stores min / max`);
    run(`MM.updateMapping(${m1.id}, {min: 0, max: 1})`);
    eq(route[0], 0, `${v}: route kept across mode switch`);
    // switching back unbinds remote first
    run(`MM.updateMapping(${m1.id}, {mode: 'mod'})`);
    assert.deepStrictEqual(env.log.seq.slice(-2), [["mm_rid_0", ["int", 0]], ["mm_mid_0", ["int", pid(P_FREQ)]]]); passed++;
    run(`MM.updateMapping(${m1.id}, {range: 0.5, polarity: 0})`);
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
    // resizeFace gets the very value that goes out to setwidth, on every request, up to the maximum (1600): the v8ui is
    // device width - 2 * its left inset wide and the full-width background panel is the device width
    for (const w of [300, 732, 1200, 1600, 5000, 588]) {
        env.log.outlets.length = 0;
        run(`MM.requestWidth(${w})`);
        const sent = env.log.outlets[0][2];
        eq(sent, Math.min(1600, Math.max(120, w)), `${v}: setwidth value for ${w}`);
        const vr = env.patcher.faceBoxes["MegaModState"].attrs.presentation_rect, pr = env.patcher.faceBoxes["obj-panel-0"].attrs.presentation_rect;
        eq(vr[2], sent - 2 * vr[0], `${v}: v8ui width = setwidth ${sent} - 2 * margin`);
        eq(pr[2], sent, `${v}: background panel width = setwidth ${sent}`);
        eq(pr[0], 0, `${v}: background panel stays at x 0`);
    }
    run("MM.retrigger(3)");
    eq(env.log.outlets[1][1], "gen", `${v}: retrigger via gen message`);
    eq(env.log.outlets[1][3] % 16, 3, `${v}: retrigger slot encoded`);
    // telemetry
    run("MM.readTelemetry()");
    const scope = env.bufs["---megamodscope"].data;
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
        ok(sl >= 0 && sl < C.MAX_MAPPINGS, `${v}: restored mapping ${m2.id} has a pool slot`);
        eq(env2.bufs["---megamodroute"].data[2 * sl], m2.mod, `${v}: restored mapping ${m2.id} routed`);
    }
    eq(env2.bufs["---megamodcfg"].data[C.CF_TYPE], 1, `${v}: engine buffers rewritten on load`);
    // stable pool slots: deleting a mapping never moves the others, and a reload gives every mapping its saved slot
    // back (so a "Depth <k>" automation lane keeps following its mapping); a new mapping fills the lowest gap
    {
        const r2 = (c) => vm.runInContext(c, env2.ctx);
        const ids = r2("MM.allMappings().map((m) => m.id)");
        if (ids.length >= 2) {
            const before = {};
            for (const id of ids) before[id] = r2(`MM.mappingSlot(${id})`);
            const victim = ids.reduce((a, b) => (before[a] <= before[b] ? a : b)); // the lowest slot
            r2(`MM.deleteMapping(${victim})`);
            for (const id of ids) if (id !== victim) eq(r2(`MM.mappingSlot(${id})`), before[id], `${v}: delete keeps mapping ${id} in slot ${before[id]}`);
            const blob = r2("MM.save()");
            const env3 = makeEnv(mockLom());
            loadScript(v, env3);
            env3.ctx.setvalueof(...blob);
            env3.ctx.setnames(...NAMES);
            env3.ctx.init_lom();
            const r3 = (c) => vm.runInContext(c, env3.ctx);
            for (const id of ids) if (id !== victim) {
                eq(r3(`MM.mappingSlot(${id})`), before[id], `${v}: reload restores mapping ${id} to its saved slot ${before[id]}`);
                eq(r3(`MM.getMapping(${id}).slot`), before[id], `${v}: mapping ${id} slot is in the saved state`);
            }
            const fresh = r3("MM.addMapping(1, {path: 'live_set tracks 0 devices 0 parameters 0', paramName: 'Dry/Wet', id: 1})");
            if (fresh) eq(r3(`MM.mappingSlot(${fresh.id})`), before[victim], `${v}: a new mapping fills the freed slot ${before[victim]}`);
            // a corrupt / duplicate saved slot falls back to the lowest free one instead of sharing a slot
            const dup = JSON.parse(JSON.stringify(r3("MM.state")));
            if (dup.mappings.length >= 2) {
                dup.mappings[1].slot = dup.mappings[0].slot;
                const env4 = makeEnv(mockLom());
                loadScript(v, env4);
                env4.ctx.setvalueof(...vm.runInContext(`serializeState(${JSON.stringify(dup)})`, env4.ctx));
                env4.ctx.setnames(...NAMES);
                env4.ctx.init_lom();
                const sl = vm.runInContext("MM.allMappings().map((m) => MM.mappingSlot(m.id))", env4.ctx);
                eq(new Set(sl).size, sl.length, `${v}: duplicate saved slots never share a pool slot`);
            }
        }
    }
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
    const r4 = env4.bufs["---megamodroute"].data;
    for (let k = 0; k < 256; k++) if (r4[2 * k] !== 0) { ok(false, `${v}: slot ${k} routed`); }
    const mid4 = run4("MM.allMappings()[255].id");
    eq(run4(`MM.mappingSlot(${mid4})`), 255, `${v}: slots are 0..255 in order`);
    run4(`MM.deleteMapping(${run4("MM.allMappings()[10].id")})`);
    eq(r4[20], -1, `${v}: deleted slot 10 off`);
    ok(run4("!!MM.addMapping(0, {path: 'live_set tracks 0 devices 0 parameters 999', paramName: 'x', id: 5000})"), `${v}: refused mapping accepted after a delete`);
    eq(r4[20], 0, `${v}: reused slot 10 routed`);
    // ---- undo / redo of modulator and mapping deletes (exact snapshot round trips)
    {
        const lomU = mockLom();
        const envU = makeEnv(lomU);
        loadScript(v, envU);
        envU.ctx.setnames(...NAMES);
        envU.ctx.init_lom();
        const rU = (c) => vm.runInContext(c, envU.ctx);
        rU("MM.addModulator(MOD_LFO); MM.addModulator(MOD_ENV); MM.addModulator(MOD_RANDOM);");
        const ids = [];
        const addU = (mod, k, extra) => { const m = rU(`MM.addMapping(${mod}, {path: 'live_set tracks 0 devices 0 parameters ${k}', paramName: 'p${k}', trackName: 'T', deviceName: 'D', id: ${500 + k}})`); ids.push(m.id); if (extra) rU(`MM.updateMapping(${m.id}, ${JSON.stringify(extra)})`); return m.id; };
        const a = addU(0, 1, { mode: "remote", min: 0.2, max: 0.7 });
        const b = addU(0, 2, { polarity: -1, range: 0.3 });
        const c3 = addU(1, 3);
        const d = addU(0, 4, { shape: [{ x: 0, y: 0, curve: 0, sCurve: 0 }, { x: 0.4, y: 0.9, curve: 0.3, sCurve: 0 }, { x: 1, y: 0.2, curve: 0, sCurve: 0 }] });
        const routeU = envU.bufs["---megamodroute"].data;
        const curveU = envU.bufs["---mmcurve"].data;
        const snap = () => JSON.stringify({
            st: rU("MM.state"), slots: rU("MM._test.slotOf()"), bound: rU("MM._test.bound()"),
            route: Array.from(routeU.slice(0, 16)), curve: Array.from(curveU.slice(0, 4 * 256)),
            cfg: Array.from(envU.bufs["---megamodcfg"].data.slice(0, 3 * C.CFG_STRIDE)),
            pids: ids.map((i) => rU(`MM._test.pid(${i})`)),
        });
        const s0 = snap();
        eq(rU("MM.undoInfo().undo"), 0, `${v}: undo stack starts empty`);
        eq(rU("MM.undo()"), null, `${v}: undo with nothing is a no-op`);
        // delete modulator 0 with its three mappings
        const slotsBefore = JSON.parse(JSON.stringify(rU("MM._test.slotOf()")));
        rU("MM.removeModulator(0)");
        eq(rU("MM.state.mods[0]"), null, `${v}: modulator deleted`);
        eq(rU("MM.mappingsFor(0).length"), 0, `${v}: its mappings are gone`);
        for (const id of [a, b, d]) eq(routeU[2 * slotsBefore[id]], -1, `${v}: deleted mapping ${id} route off`);
        eq(rU("MM.undoInfo().undo"), 1, `${v}: delete is on the undo stack`);
        const r1 = rU("MM.undo()");
        eq(r1.kind, "mod", `${v}: undo reports a modulator restore`);
        eq(snap(), s0, `${v}: delete modulator then undo leaves an identical state (mapping ids, targets, slots, route, tables, ids)`);
        eq(rU("MM.undoInfo().redo"), 1, `${v}: undone entry moved to redo`);
        // redo deletes again, undo restores again
        ok(rU("MM.redo()"), `${v}: redo`);
        eq(rU("MM.state.mods[0]"), null, `${v}: redo deletes the modulator again`);
        rU("MM.undo()");
        eq(snap(), s0, `${v}: redo + undo round trip`);
        // single mapping delete / undo
        rU(`MM.deleteMapping(${b})`);
        ok(!rU(`MM.getMapping(${b})`), `${v}: mapping deleted`);
        eq(routeU[2 * slotsBefore[b]], -1, `${v}: mapping route off`);
        rU("MM.undo()");
        eq(snap(), s0, `${v}: delete mapping then undo leaves an identical state`);
        eq(JSON.stringify(rU("MM.allMappings().map((m) => m.id)")), JSON.stringify([a, b, c3, d]), `${v}: mapping list order restored`);
        // two deletes undo in LIFO order
        rU(`MM.deleteMapping(${a})`); rU(`MM.deleteMapping(${c3})`);
        rU("MM.undo()");
        ok(rU(`!!MM.getMapping(${c3})`) && !rU(`MM.getMapping(${a})`), `${v}: LIFO: the last delete is undone first`);
        rU("MM.undo()");
        eq(snap(), s0, `${v}: both undone`);
        // a new delete clears redo
        rU(`MM.deleteMapping(${a})`); rU("MM.undo()"); eq(rU("MM.undoInfo().redo"), 1, `${v}: redo available`);
        rU(`MM.deleteMapping(${b})`);
        eq(rU("MM.undoInfo().redo"), 0, `${v}: a new delete clears redo`);
        rU("MM.undo()");
        // slot taken meanwhile: the modulator comes back in the next free slot with its mappings routed from it
        rU("MM.removeModulator(0)");
        eq(rU("MM.addModulator(MOD_STEPS)"), 0, `${v}: freed slot reused by a new modulator`);
        const r2 = rU("MM.undo()");
        eq(r2.slot, 3, `${v}: undo restores into the next free slot when the old one is taken`);
        eq(rU(`MM.getMapping(${a}).mod`), 3, `${v}: restored mappings follow the modulator`);
        eq(routeU[2 * rU(`MM.mappingSlot(${a})`)], 3, `${v}: restored mapping routed from its new slot`);
        // the stack keeps 16 entries
        for (let k = 0; k < 20; k++) { const m = rU(`MM.addMapping(2, {path: 'live_set tracks 3 devices 0 parameters ${k}', paramName: 'q${k}', id: ${900 + k}})`); rU(`MM.deleteMapping(${m.id})`); }
        eq(rU("MM.undoInfo().undo"), 16, `${v}: undo stack is capped at 16`);
        eq(rU("MM.undoInfo().max"), 16, `${v}: undo stack max`);
        // loading a state clears the history
        rU("MM.load(MM.save())");
        eq(rU("MM.undoInfo().undo"), 0, `${v}: load clears the undo history`);
    }
    // device-global settings: gen messages, default mapping mode for learn / addMapping, load
    {
        const lomS = mockLom();
        const envS = makeEnv(lomS);
        loadScript(v, envS);
        const runS = (c) => vm.runInContext(c, envS.ctx);
        envS.ctx.setnames(...NAMES);
        envS.ctx.init_lom();
        runS("MM.addModulator(MOD_LFO)");
        envS.log.outlets.length = 0;
        runS("MM.setSettings({ smoothMs: 50 })");
        assert.deepStrictEqual(envS.log.outlets.filter((o) => o[1] === "smooth"), [[0, "smooth", 50]]); passed++;
        runS("MM.setSettings({ rateMul: 2 })");
        assert.deepStrictEqual(envS.log.outlets.filter((o) => o[1] === "gen" && o[2] === "ratemul"), [[0, "gen", "ratemul", 2]]); passed++;
        const n0 = envS.log.outlets.length;
        runS("MM.setSettings({ rateMul: 2, smoothMs: 50 })");
        eq(envS.log.outlets.length, n0, `${v}: unchanged settings send nothing`);
        runS("MM.setSettings({ smoothMs: 9999, rateMul: 0 })");
        eq(runS("MM.getSettings().smoothMs"), 500, `${v}: smoothing clamped`);
        eq(runS("MM.getSettings().rateMul"), 0.25, `${v}: rate multiplier clamped`);
        // default mapping mode: addMapping and learn, both modes
        const selS = (p) => envS.observers.find((x) => x._prop === "selected_parameter").cb(["selected_parameter", "id", lomS.idOf(p)]);
        runS("MM.setSettings({ defaultMode: 'remote' })");
        runS("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 0', paramName: 'Dry/Wet' })");
        let mp = runS("MM.allMappings()[0]");
        deq([mp.mode, mp.min, mp.max], ["remote", 0, 1], `${v}: addMapping uses the Remote default`);
        runS("MM.armLearn(0, false)");
        selS("live_set tracks 1 devices 1 parameters 0");
        mp = runS("MM.allMappings()[1]");
        deq([mp.mode, mp.min, mp.max], ["remote", 0, 1], `${v}: learn uses the Remote default`);
        runS("MM.setSettings({ defaultMode: 'mod' })");
        runS("MM.armLearn(0, false)");
        selS("live_set tracks 1 devices 1 parameters 1");
        mp = runS("MM.allMappings()[2]");
        deq([mp.mode, mp.polarity, mp.range], ["mod", 0, 0.5], `${v}: learn uses the Mod default (+-, 0.5)`);
        eq(runS("MM.allMappings()[0].mode"), "remote", `${v}: existing mappings keep their mode`);
        // saved / restored, and re-sent to gen on load
        const savedS = runS("MM.save()");
        const envL = makeEnv(mockLom());
        loadScript(v, envL);
        envL.ctx.setvalueof(savedS);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext("MM.getSettings()", envL.ctx))), { defaultMode: "mod", smoothMs: 500, rateMul: 0.25, selfMod: "internal" }); passed++;
        ok(envL.log.outlets.some((o) => o[1] === "smooth" && o[2] === 500) && envL.log.outlets.some((o) => o[1] === "gen" && o[2] === "ratemul" && o[3] === 0.25), `${v}: loaded settings are sent to gen`);
    }
    // paint with content + demo
    run("MM.demo()");
    run("paint()");
    env.ctx.preview && env.ctx.preview();
    run("paint()");
    eq(env.log.notify > 0, true, `${v}: notifyclients called`);
}

// A parameter face: presentation 1, hidden 1, parked 1x1 outside the v8ui, every colour alpha 0, in front of the v8ui, before the panels
// the faces move (presentation_rect / hidden) but nothing is ever renamed
function isRename(a) { return a[0] !== "presentation_rect" && a[0] !== "hidden"; }
function checkFace(id, b, boxes) {
    eq(b.presentation, 1, `${id} face: presentation 1`);
    eq(b.hidden, 1, `${id} face: hidden 1`);
    deq(b.presentation_rect, [0, 0, 1, 1], `${id} face: parked 1x1`);
    const ui = boxes.find((x) => x.id === "obj-viz");
    const [bx, by, bw, bh] = ui.presentation_rect;
    const [ax, ay, aw, ah] = b.presentation_rect;
    ok(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay, `${id} face: parked outside the interactive v8ui`);
    ok(ax >= 0 && ay >= 0 && ax + aw <= p0Width(boxes) && ay + ah <= 169, `${id} face: parked inside the device`);
    ok(boxes.indexOf(b) > boxes.indexOf(ui), `${id} face: in front of the v8ui (later in boxes)`);
    const firstPanel = boxes.findIndex((x) => x.maxclass === "panel");
    ok(boxes.indexOf(b) < firstPanel, `${id} face: before the background panels`);
    const cols = Object.entries(b).filter(([k, v]) => /color/.test(k) && Array.isArray(v) && v.length === 4);
    ok(cols.length >= 6 && cols.every(([k, v]) => v[3] === 0), `${id} face: every colour alpha 0 (${cols.length} colours)`);
    ok(["live.dial", "live.text", "live.tab", "live.numbox"].includes(b.maxclass), `${id} face: ${b.maxclass} (no live.slider: its automation dot moves with the value)`);
    if (b.maxclass === "live.dial") { eq(b.showname, 0, `${id} face: showname 0`); eq(b.shownumber, 0, `${id} face: shownumber 0`); }
    else if (b.maxclass === "live.text") { eq(b.text, "", `${id} face: no text`); eq(b.texton, "", `${id} face: no texton`); }
}
function p0Width() { return 588; }

// ---------------------------------------------------------------- 7. automatable parameter pool + per-mapping depth
{
    // ---- 7a. builder output: the saved pool objects
    const { doc } = readAmxd(path.join(ROOT, "devices", "Mega Modulator.amxd"));
    const boxes = doc.patcher.boxes.map((b) => b.box);
    const byVar = Object.fromEntries(boxes.filter((b) => b.varname).map((b) => [b.varname, b]));
    const apIds = [];
    for (let i = 0; i < C.AUTO_COUNT; i++) apIds.push("ap_" + i);
    const adIds = [];
    for (let k = 0; k < C.AUTO_DEPTH_SLOTS; k++) adIds.push("ad_" + k);
    const atIds = [];
    for (let i = 0; i < C.AUTO_SW_COUNT; i++) atIds.push("at_" + i);
    eq(C.AUTO_COUNT, 96, "16 slots x (5 generic + On) = 96 modulator parameters");
    eq(C.AUTO_SW_COUNT, 96, "16 slots x (shape + 5 booleans) = 96 switch parameters");
    eq(C.AUTO_PARAMS, 5, "N = 5 generic controls per slot (the max over the types)");
    eq(C.AUTO_DEPTH_SLOTS, 64, "64 automatable mapping depths");
    const allAuto = apIds.concat(atIds, adIds, ["ap_marker"]);
    eq(new Set(allAuto).size, 257, "257 unique pool varnames (96 + 96 + 64 + marker)");
    const longnames = new Set();
    for (const id of allAuto) {
        const b = byVar[id];
        ok(b, `${id} exists`);
        eq(b.parameter_enable, 1, `${id} parameter_enable 1`);
        // parameter faces (AGENTS.md section 21): every pool object but the marker is a transparent, parked face; `hidden` does not
        // remove a parameter from Live's list (checked in Live)
        if (id === "ap_marker") ok(b.presentation === undefined && b.hidden === undefined, "the marker is not a face");
        else checkFace(id, b, boxes);
        const vo = b.saved_attribute_attributes.valueof;
        if (id === "ap_marker") eq(vo.parameter_invisible, 1, "the marker is the only invisible parameter");
        else ok(vo.parameter_invisible === undefined || vo.parameter_invisible === 0, `${id} visible in Live's parameter list`);
        eq(vo.parameter_linknames, 0, `${id}: renaming the long name never changes the varname`);
        eq(vo.parameter_longname, vo.parameter_shortname, `${id} long == short name`);
        ok(!longnames.has(vo.parameter_longname), `${id} unique long name ${vo.parameter_longname}`);
        longnames.add(vo.parameter_longname);
        // AGENTS.md: Int parameters are 8 bit; everything here is a Float 0..100 (or an enum / 0..1 marker), so no int range > 255
        if (b.maxclass === "live.text") { eq(vo.parameter_type, 2, `${id} toggle is an enum`); deq(vo.parameter_enum, ["Off", "On"], `${id} enum`); eq(b.mode, 1, `${id} Toggle mode`); }
        else if (b.maxclass === "live.tab") { eq(id.startsWith("at_"), true, `${id} tab is a switch`); eq(vo.parameter_type, 2, `${id} shape is an enum`); deq(vo.parameter_enum, C.LFO_SHAPES, `${id} enum = LFO shapes`); eq(vo.parameter_mmax, 4, `${id} 5 values`); }
        else if (id === "ap_marker") { eq(vo.parameter_type, 1, "marker int"); ok(vo.parameter_mmax <= 255, "marker int range"); eq(vo.parameter_mmax, 2, "marker 0 / 1 / 2"); }
        else { eq(b.maxclass, id.startsWith("ad_") ? "live.numbox" : "live.dial", `${id} dial / numbox face`); eq(vo.parameter_type, 0, `${id} float`); eq(vo.parameter_mmin, 0, `${id} min`); eq(vo.parameter_mmax, 100, `${id} max`); eq(vo.parameter_unitstyle, 5, `${id} percent`); }
    }
    eq(boxes.filter((b) => b.maxclass === "live.text" && /^ap_\d+$/.test(b.varname)).length, 16, "16 On toggles");
    eq(boxes.filter((b) => b.maxclass === "live.text" && /^at_\d+$/.test(b.varname)).length, 16 * 5, "80 boolean switch toggles");
    eq(boxes.filter((b) => b.maxclass === "live.tab" && /^at_\d+$/.test(b.varname)).length, 16, "16 shape tabs");
    eq(boxes.filter((b) => b.maxclass === "live.numbox").length, 64 + 1, "64 depth numbox faces + the marker");
    eq(boxes.filter((b) => b.maxclass === "live.dial" && b.presentation === 1).length, 80, "80 generic dial faces");
    eq(boxes.filter((b) => b.maxclass === "live.slider").length, 0, "no live.slider anywhere (its automation dot moves with the value)");
    eq(boxes.filter((b) => b.presentation === 1 && b.hidden === 1 && /^(ap|at|ad)_\d+$/.test(b.varname || "")).length, 96 + 96 + 64, "256 faces, all parked hidden");
    const nameOf = (v) => byVar[v].saved_attribute_attributes.valueof.parameter_longname;
    eq(nameOf("at_0"), "M1 Shape", "slot 1 shape switch name");
    deq([1, 2, 3, 4, 5].map((t) => nameOf("at_" + (2 * 6 + t))), ["M3 Sync", "M3 Bipolar", "M3 Retrig", "M3 1Shot", "M3 Loop"], "slot 3 toggle names");
    // the saved names ARE the Live names (fixed; a runtime rename does not reach Live): M<n> A..E / M<n> On, Depth <k>
    for (let sl = 0; sl < 16; sl++) {
        const nm = C.autoSlotNames(sl);
        for (let j = 0; j < 6; j++) eq(byVar["ap_" + (sl * 6 + j)].saved_attribute_attributes.valueof.parameter_longname, nm[j], `saved name ap_${sl * 6 + j}`);
    }
    for (let sl = 0; sl < 16; sl++) for (let t = 0; t < 6; t++) eq(nameOf("at_" + (sl * 6 + t)), C.autoSwitchName(sl, t), `saved name at_${sl * 6 + t}`);
    for (let k = 0; k < 64; k++) eq(byVar["ad_" + k].saved_attribute_attributes.valueof.parameter_longname, C.autoDepthName(k), `saved name ad_${k}`);
    // every object outputs through its own prepend into obj-viz (inlet 0), exactly once
    const lines = doc.patcher.lines.map((l) => l.patchline);
    const idOfVar = (v) => byVar[v].id;
    for (let i = 0; i < 96; i++) {
        const out = lines.filter((l) => l.source[0] === idOfVar("ap_" + i));
        eq(out.length, 1, `ap_${i} has one cord`);
        const pre = boxes.find((b) => b.id === out[0].destination[0]);
        eq(pre.text, `prepend autop ${i}`, `ap_${i} prepend`);
        ok(lines.some((l) => l.source[0] === pre.id && l.destination[0] === "obj-viz" && l.destination[1] === 0), `prepend autop ${i} -> obj-viz`);
    }
    for (let i = 0; i < 96; i++) {
        const out = lines.filter((l) => l.source[0] === idOfVar("at_" + i));
        eq(out.length, 1, `at_${i} has one cord`);
        const pre = boxes.find((b) => b.id === out[0].destination[0]);
        eq(pre.text, `prepend autot ${i}`, `at_${i} prepend`);
        ok(lines.some((l) => l.source[0] === pre.id && l.destination[0] === "obj-viz" && l.destination[1] === 0), `prepend autot ${i} -> obj-viz`);
    }
    for (let k = 0; k < 64; k++) {
        const out = lines.filter((l) => l.source[0] === idOfVar("ad_" + k));
        const pre = boxes.find((b) => b.id === out[0].destination[0]);
        eq(pre.text, `prepend autod ${k}`, `ad_${k} prepend`);
        ok(lines.some((l) => l.source[0] === pre.id && l.destination[0] === "obj-viz"), `prepend autod ${k} -> obj-viz`);
    }
    ok(boxes.find((b) => b.text === "prepend autom"), "marker prepend");
    // panels are still the last boxes
    const nPan = boxes.filter((b) => b.maxclass === "panel").length;
    ok(boxes.slice(-nPan).every((b) => b.maxclass === "panel" && b.background === 1), "background panels stay last");
    // every parameter long name in the device is unique (Live requires it)
    const allLong = boxes.filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_longname).map((b) => b.saved_attribute_attributes.valueof.parameter_longname);
    eq(new Set(allLong).size, allLong.length, "device parameter names are unique");
    ok(doc.patcher.boxes.length < 1700, `patch stays reasonable (${doc.patcher.boxes.length} boxes)`);
    // the engine slot keys the generic params map to exist as model controls with ranges
    for (let t = 1; t <= 5; t++) {
        const keys = C.AUTO_KEYS[t];
        eq(keys.length, 5, `type ${t} has 5 positions`);
        eq(keys[2] === "depth" || t === 2 && keys[2] === "depth", true, `type ${t}: Depth is position 3`);
        for (const k of keys) if (k) ok(C.MOD_PARAM_RANGE[k], `type ${t} key ${k} has a range`);
        eq(new Set(keys.filter(Boolean)).size, keys.filter(Boolean).length, `type ${t} keys unique`);
    }

    // ---- 7b. name tables (fixed Live names, per-type control labels)
    deq(C.autoSlotNames(2), ["M3 A", "M3 B", "M3 C", "M3 D", "M3 E", "M3 On"], "slot 3 Live names");
    deq(C.autoSlotNames(15), ["M16 A", "M16 B", "M16 C", "M16 D", "M16 E", "M16 On"], "slot 16 Live names");
    eq(C.autoDepthName(0), "Depth 1", "first depth name");
    eq(C.autoDepthName(63), "Depth 64", "last depth name");
    const allNames = [];
    for (let sl = 0; sl < 16; sl++) allNames.push(...C.autoSlotNames(sl));
    for (let sl = 0; sl < 16; sl++) for (let t = 0; t < 6; t++) allNames.push(C.autoSwitchName(sl, t));
    for (let k = 0; k < 64; k++) allNames.push(C.autoDepthName(k));
    eq(new Set(allNames).size, 256, "all 256 Live names are unique");
    const lab = (t) => [0, 1, 2, 3, 4].map((j) => C.autoControlLabel(t, j));
    deq(lab(C.MOD_LFO), ["Rate", "Div", "Depth", "Phase", ""], "LFO control labels (the shape is a switch parameter)");
    deq(lab(C.MOD_ENV), ["Attack", "Release", "Depth", "Gain", ""], "Envelope control labels (one unused)");
    deq(lab(C.MOD_RANDOM), ["Rate", "Div", "Depth", "Smooth", "Seed"], "Random control labels");
    deq(lab(C.MOD_STEPS), ["Rate", "Div", "Depth", "Steps", "Glide"], "Steps control labels");
    deq(lab(C.MOD_MSEG), ["Rate", "Div", "Depth", "Start", "End"], "MSEG control labels");
    deq(lab(0), ["", "", "", "", ""], "no type: no labels");
    eq(C.autoLiveName(C.MOD_LFO, 2, "rate"), "M3 A", "LFO rate is M3 A");
    eq(C.autoLiveName(C.MOD_ENV, 0, "release"), "M1 B", "Envelope release is M1 B");
    eq(C.autoLiveName(C.MOD_MSEG, 4, "loopEnd"), "M5 E", "MSEG end is M5 E");
    eq(C.autoLiveName(C.MOD_LFO, 2, "enabled"), "M3 On", "enable is On");
    eq(C.autoLiveName(C.MOD_LFO, 2, "gain"), "", "a control without a parameter has no name");
    // value curves = the UI knob curve (log for rate / attack / release)
    near(C.autoValue("rate", 0), 0.01, 1e-12, "rate lo");
    near(C.autoValue("rate", 1), 40, 1e-9, "rate hi");
    near(C.autoValue("rate", 0.5), Math.sqrt(0.01 * 40), 1e-9, "rate log midpoint");
    near(C.autoNorm("rate", Math.sqrt(0.4)), 0.5, 1e-9, "rate norm");
    eq(C.autoValue("syncDiv", 0.5), 8, "syncDiv rounds");
    eq(C.autoValue("shape", 1), 4, "shape hi");
    eq(C.autoValue("steps", 0), 1, "steps lo");
    eq(C.autoValue("seed", 1), 1000, "seed hi");
    for (const k of Object.keys(C.MOD_PARAM_RANGE)) {
        if (["enabled", "sync", "retrig", "bipolar", "oneshot", "loopOn"].includes(k)) continue;
        for (const n of [0, 0.13, 0.5, 0.97, 1]) {
            const v = C.autoValue(k, n);
            near(C.autoValue(k, C.autoNorm(k, v)), v, 1e-9 * Math.max(1, Math.abs(v)), `${k} value round trip at ${n}`);
        }
    }

    // ---- 7b2. UNIPOLAR depth-route factor m = range * dep * y (y = the route's shape at u = (B + 1) / 2, 0..1; NO polarity choice); eff = clamp(base * prod m, 0, 1)
    {
        const sh = C.linearShape();
        // `pol` is the STORED polarity of an old route: it must be ignored (the field is kept)
        const rt = (pol, range, depth) => ({ id: 1, mod: 0, mode: "mod", polarity: pol, range, depth: depth === undefined ? 1 : depth, min: 0, max: 1, shape: sh, target: C.makeDepthTarget(3) });
        for (const pol of [1, 0, -1]) for (const range of [0, 0.15, 0.5, 1]) for (const b of [-1, -0.5, 0, 0.5, 1]) {
            const y = (b + 1) / 2;  // the route's shape is linear, y = B's normalized output
            near(C.depthFactor(rt(pol, range), b), range * y, 1e-12, `m = range * y (stored pol ${pol}, range ${range}, B ${b})`);
            ok(C.depthFactor(rt(pol, range), b) >= 0, "m never negative");
            near(C.mappingOutput(rt(pol, range), b), range * y, 1e-12, "mappingOutput of a depth route is unipolar too");
            const tb = C.depthFactorTable(rt(pol, range)); near(tb[255], C.depthFactor(rt(pol, range), 1), 1e-12, "factor table end"); near(tb[0], C.depthFactor(rt(pol, range), -1), 1e-12, "factor table start");
            ok(tb.every((v) => v >= 0 && v <= range + 1e-12), "factor table within 0..range");
        }
        // an object without a depth target is still turned unipolar by depthFactor itself
        { const plain = Object.assign(rt(0, 0.5), { target: {} }); near(C.depthFactor(plain, -1), 0, 1e-12, "depthFactor ignores polarity even without a target (B min -> 0)"); near(C.depthFactor(plain, 1), 0.5, 1e-12, "...and B max -> range (a stored +- is not read as +-)"); near(C.depthFactor(plain, 0), 0.25, 1e-12, "...B = 0 -> range / 2"); }
        // B at its minimum -> 0, B at its maximum -> range
        for (const range of [0, 0.25, 0.5, 1]) { near(C.depthFactor(rt(1, range), -1), 0, 1e-12, "B min -> m = 0"); near(C.depthFactor(rt(1, range), 1), range, 1e-12, "B max -> m = range"); }
        // the route's own depth scales m (0 zeroes it)
        for (const b of [-1, 0, 1]) near(C.depthFactor(rt(1, 1, 0), b), 0, 1e-12, "route depth 0: m = 0");
        near(C.depthFactor(rt(1, 1, 0.5), 1), 0.5, 1e-12, "route depth 0.5: m = 0.5 range y");
        // eff: product, clamp, never negative
        near(C.effectiveDepth(1, []), 1, 1e-12, "no route: eff = base"); near(C.effectiveDepth(0.8, []), 0.8, 1e-12, "no route: eff = base 0.8");
        near(C.effectiveDepth(1, [C.depthFactor(rt(1, 1), -1)]), 0, 1e-12, "B min on a full-range route: eff = 0 (it does NOT invert)");
        near(C.effectiveDepth(1, [C.depthFactor(rt(1, 1), 1)]), 1, 1e-12, "B max on a full-range route: eff = 1");
        near(C.effectiveDepth(0.5, [C.depthFactor(rt(1, 1), 0.2)]), 0.5 * 0.6, 1e-12, "base 0.5 * m 0.6");
        near(C.effectiveDepth(0.5, [C.depthFactor(rt(1, 0.5), 1), C.depthFactor(rt(1, 1), -0.2)]), 0.5 * 0.5 * 0.4, 1e-12, "two routes multiply");
        near(C.effectiveDepth(0.5, [C.depthFactor(rt(1, 0.5), -1), C.depthFactor(rt(1, 1), 0.4)]), 0, 1e-12, "...and one factor at 0 zeroes it");
        near(C.effectiveDepth(1, [4, 3]), 1, 1e-12, "clamps at 1"); near(C.effectiveDepth(1, [-0.5, 2]), 0, 1e-12, "a stray negative factor is floored at 0 (never inverts)");
        near(C.effectiveDepth(1, [-3, -2]), 0, 1e-12, "two negative factors do not make a positive one");
        // end-to-end with a Mod mapping: o = range * eff * (...) with eff from the route (always >= 0)
        const modMap = { id: 2, mod: 0, mode: "mod", polarity: 0, range: 1, depth: 1, min: 0, max: 1, shape: sh };
        for (const b of [-1, 0, 0.5, 1]) near(C.mappingOutput(modMap, 0.7, C.effectiveDepth(1, [C.depthFactor(rt(1, 1), b)])), 0.7 * (b + 1) / 2, 1e-12, `Mod mapping value 0.7 with B = ${b}`);
        // THE USER'S CASES, re-derived (A = Remote mapping, B modulates A's depth; "range" = the depth route's range). A = c + (lookup - c) * eff.
        const remA = (min, max) => ({ id: 3, mod: 1, mode: "remote", polarity: 1, range: 0.5, depth: 1, min, max, shape: sh });
        const outA = (A, route, bOut, x) => C.mappingOutput(A, x, C.effectiveDepth(A.depth, [C.depthFactor(route, bOut)]));
        for (const x of [-1, -0.5, 0, 0.5, 1]) for (const bOut of [-1, -0.5, 0, 0.5, 1]) for (const pol of [1, 0, -1]) {
            near(outA(remA(0, 1), rt(pol, 0), bOut, x), 0.5, 1e-12, `case 1: A 0..100, route range 0: always 50 (x ${x}, B ${bOut}, stored pol ${pol})`);
            near(outA(remA(0.25, 1), rt(pol, 0), bOut, x), 0.625, 1e-12, `case 2: A 25..100, route range 0: always 62.5 (x ${x}, B ${bOut}, stored pol ${pol})`);
            const v = outA(remA(0, 1), rt(pol, 0.5), bOut, x);
            ok(v >= 0.25 - 1e-12 && v <= 0.75 + 1e-12, `case 3: A 0..100, route range 50, B swept: within 25..75 (x ${x}, B ${bOut}: ${v})`);
        }
        // case 3 in detail: B at its PEAK reaches both ends (25 / 75), B at its MINIMUM is centred (50 for every x)
        near(outA(remA(0, 1), rt(1, 0.5), 1, 1), 0.75, 1e-12, "case 3: A at its top, B at its peak: 75"); near(outA(remA(0, 1), rt(1, 0.5), 1, -1), 0.25, 1e-12, "case 3: A at its bottom, B at its peak: 25");
        for (const x of [-1, -0.3, 0, 0.6, 1]) near(outA(remA(0, 1), rt(0, 0.5), -1, x), 0.5, 1e-12, `case 3: B at its minimum: centred (50), x ${x}`);
        // a bipolar B swept over its full range: mid-point 0 is the half range
        near(outA(remA(0, 1), rt(1, 0.5), 0, 1), 0.5 + 0.5 * 0.25, 1e-12, "case 3: B at 0 -> eff 0.25 -> 62.5 at x = 1");
        // Mod mode equivalents: range 0 -> A's offset 0; range 0.5 -> A's offset scaled by 0.5 * (B + 1) / 2 (never inverted)
        const modA = { id: 4, mod: 1, mode: "mod", polarity: 0, range: 1, depth: 1, min: 0, max: 1, shape: sh };
        for (const bOut of [-1, 0, 1]) { near(outA(modA, rt(1, 0), bOut, 1), 0, 1e-12, "Mod A, route range 0: offset 0"); near(outA(modA, rt(1, 0.5), bOut, 1), 0.5 * (bOut + 1) / 2, 1e-12, "Mod A, route range 0.5: 0.5 * (B+1)/2"); }
        // two routes multiply: 0.5 y1 * 0.5 y2
        near(C.effectiveDepth(1, [C.depthFactor(rt(1, 0.5), 1), C.depthFactor(rt(1, 0.5), 1)]), 0.25, 1e-12, "two range-0.5 routes at B = 1: eff 0.25");
        // FUZZ: random configurations (several routes, any stored polarity, any mode / bounds / shape): eff in 0..1 always, Remote stays inside its bounds
        {
            let seed = 12345;
            const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
            const shapes = [C.linearShape(), C.curveToShape(C.CURVE_EXP, 0.5, 4), C.curveToShape(C.CURVE_LOG, 0.5, 4), C.curveToShape(C.CURVE_S, 0.5, 4), C.curveToShape(C.CURVE_STEPPED, 0.5, 4)];
            let nNeg = 0, nChecked = 0;
            for (let it = 0; it < 600; it++) {
                const nr = 1 + Math.floor(rnd() * 4);
                const routes = [];
                for (let r = 0; r < nr; r++) routes.push({ id: 10 + r, mod: 0, mode: "mod", polarity: [1, 0, -1][Math.floor(rnd() * 3)], range: rnd(), depth: rnd() < 0.2 ? 1 : rnd(), min: 0, max: 1, shape: shapes[Math.floor(rnd() * shapes.length)], target: C.makeDepthTarget(3) });
                const base = rnd() < 0.3 ? 1 : rnd();
                const bs = routes.map(() => rnd() * 2 - 1);
                const eff = C.effectiveDepth(base, routes.map((rr, i) => C.depthFactor(rr, bs[i])));
                if (!(eff >= 0 && eff <= 1)) nNeg++;
                ok(eff >= 0 && eff <= 1 && eff <= base + 1e-12, `fuzz ${it}: eff in 0..1 and never above base (${eff})`);
                const lo = rnd() * 0.5, hi = 0.5 + rnd() * 0.5;
                const A = { id: 3, mod: 1, mode: rnd() < 0.5 ? "remote" : "mod", polarity: [1, 0, -1][Math.floor(rnd() * 3)], range: rnd(), depth: base, min: lo, max: hi, shape: shapes[Math.floor(rnd() * shapes.length)] };
                const x = rnd() * 2 - 1;
                const v = C.mappingOutput(A, x, eff);
                if (A.mode === "remote") ok(v >= lo - 1e-9 && v <= hi + 1e-9, `fuzz ${it}: Remote stays inside its bounds (${v})`);
                else ok(Math.abs(v) <= A.range * eff + 1e-9, `fuzz ${it}: Mod offset scaled by eff (never beyond range * eff)`);
                nChecked++;
            }
            eq(nNeg, 0, "fuzz: no effective depth ever outside 0..1 over " + nChecked + " random configurations");
        }
    }
    // schema 10 stays: a saved depth route with polarity "+-" / "-" loads as it was (the field is kept) and behaves unipolar
    {
        const st = C.normalizeState({ schema: 10, mods: [{ type: 1 }, { type: 1 }], nextMapId: 4, mappings: [
            { id: 1, mod: 0, mode: "mod", polarity: 1, range: 0.5, depth: 1, target: { path: "live_set tracks 0 devices 0 parameters 3", name: "X", paramName: "X" } },
            { id: 2, mod: 1, mode: "mod", polarity: 0, range: 0.5, depth: 1, target: { internal: true, kind: "depth", mapId: 1 } },
            { id: 3, mod: 0, mode: "mod", polarity: -1, range: 0.8, depth: 1, target: { internal: true, kind: "depth", mapId: 1 } }] });
        eq(st.schema, C.MEGAMOD_VERSION, "schema version unchanged (no bump)"); eq(C.MEGAMOD_VERSION, 10, "still schema 10");
        const rs = st.mappings.filter((m) => C.isDepthRoute(m));
        eq(rs.length, 2, "both old depth routes survive");
        deq(rs.map((m) => m.polarity), [0, -1], "the stored polarity field is kept (and ignored)");
        for (const r of rs) for (const b of [-1, -0.5, 0, 0.5, 1]) ok(C.depthFactor(r, b) >= 0 && Math.abs(C.depthFactor(r, b) - r.range * (b + 1) / 2) < 1e-12, "old +- / - depth route is now unipolar: m = range * (B+1)/2");
        for (const r of rs) { const tb = C.depthFactorTable(r); ok(tb.every((v) => v >= 0), "baked table of an old route has no negative cell"); }
    }

    // ---- 7c. depth in the model: output, migration, save / load
    {
        const sh = C.linearShape();
        const modM = (depth, pol) => ({ id: 1, mod: 0, mode: "mod", polarity: pol, range: 0.8, depth, min: 0, max: 1, shape: sh });
        for (const pol of [1, 0, -1]) for (const x of [-1, -0.3, 0, 0.6, 1]) {
            near(C.mappingOutput(modM(1, pol), x), C.mappingOutput({ id: 1, mod: 0, mode: "mod", polarity: pol, range: 0.8, min: 0, max: 1, shape: sh }, x), 1e-12, `Mod depth 1 is 1:1 (pol ${pol}, x ${x})`);
            near(C.mappingOutput(modM(0.5, pol), x), 0.5 * C.mappingOutput(modM(1, pol), x), 1e-12, `Mod depth 0.5 halves the output (pol ${pol}, x ${x})`);
            near(C.mappingOutput(modM(0, pol), x), 0, 1e-12, "Mod depth 0 = no modulation");
        }
        const remM = (depth, mn = 0.2, mx = 0.8) => ({ id: 1, mod: 0, mode: "remote", polarity: 0, range: 1, depth, min: mn, max: mx, shape: sh });
        for (const x of [-1, -0.5, 0, 0.5, 1]) {
            const y = (x + 1) / 2;
            near(C.mappingOutput(remM(1), x), 0.2 + 0.6 * y, 1e-12, "Remote depth 1 is 1:1");
            near(C.mappingOutput(remM(0.5), x), 0.5 + (0.2 + 0.6 * y - 0.5) * 0.5, 1e-12, "Remote depth 0.5 shrinks the span toward the CENTRE");
            near(C.mappingOutput(remM(0), x), 0.5, 1e-12, "Remote depth 0 sits at the centre (min + max) / 2");
        }
        // Remote depth scales AROUND THE CENTRE of the bounds: depth 0 -> c (0.5 for 0..1, 0.625 for 0.25..1), depth 0.5 on 0..1 spans 0.25..0.75
        for (const x of [-1, -0.2, 0, 0.7, 1]) {
            near(C.mappingOutput(remM(0, 0, 1), x), 0.5, 1e-12, "Remote 0..1 depth 0 = 0.5");
            near(C.mappingOutput(remM(0, 0.25, 1), x), 0.625, 1e-12, "Remote 0.25..1 depth 0 = 0.625");
            near(C.mappingOutput(remM(0.5, 0, 1), x), 0.25 + 0.5 * (x + 1) / 2, 1e-12, "Remote 0..1 depth 0.5 spans 0.25..0.75");
            near(C.mappingOutput(remM(1, 0.25, 1), x), 0.25 + 0.75 * (x + 1) / 2, 1e-12, "Remote depth 1 unchanged");
            near(C.mappingOutput(remM(1, 0, 1), x, -1), 0.5, 1e-12, "an effective depth below 0 is floored at 0: centre, never a mirrored sweep");
            near(C.mappingOutput(remM(1, 0, 1), x, 0), 0.5, 1e-12, "effective depth override 0 = centre");
        }
        near(C.remoteCentre({ min: 0.25, max: 1 }), 0.625, 1e-12, "remoteCentre");
        near(C.remoteCentre({ min: 0.8, max: 0.2 }), 0.5, 1e-12, "remoteCentre of an inverted span");
        near(C.mappingOutput({ id: 1, mod: 0, mode: "remote", polarity: 0, range: 1, depth: 0.5, min: 0.8, max: 0.2, shape: sh }, 1), 0.5 + (0.2 - 0.5) * 0.5, 1e-12, "Remote inverted span (min > max) shrinks toward the centre");
        // Mod keeps its semantics (o *= depth), also with an effective-depth override (0..1)
        near(C.mappingOutput(modM(1, 0), 1, -0.5), 0, 1e-12, "Mod with an effective depth of -0.5: floored at 0 (never inverts)"); near(C.mappingOutput(modM(1, 0), 1, 0.5), 0.5 * 0.8, 1e-12, "Mod with an effective depth of 0.5");
        // tables follow
        const tb = C.mappingTable(modM(0.25, 1));
        near(tb[255], 0.8 * 0.25, 1e-12, "table end value scaled");
        // migration: a schema 7 mapping without depth loads at 100%
        const old = C.normalizeState({ schema: 7, mods: [{ type: 1 }], mappings: [{ id: 1, mod: 0, mode: "mod", polarity: 1, range: 0.6, shape: sh, target: {} }], nextMapId: 2 });
        eq(old.schema, 10, "schema 7 -> 10");
        eq(old.mappings[0].depth, 1, "migrated mapping depth defaults to 1");
        near(C.mappingOutput(old.mappings[0], 1), 0.6, 1e-12, "migrated output unchanged");
        const withD = C.normalizeState({ schema: 8, mods: [{ type: 1 }], mappings: [{ id: 1, mod: 0, depth: 0.37, target: {} }, { id: 2, mod: 0, depth: 7, target: {} }, { id: 3, mod: 0, depth: "x", target: {} }] });
        deq(withD.mappings.map((m) => m.depth), [0.37, 1, 1], "depth sanitized (clamped, junk -> 1)");
        const rt = C.deserializeState(C.serializeState(withD));
        eq(rt.mappings[0].depth, 0.37, "depth survives the blob round trip");
        eq(C.defaultMapping(1, 0, {}).depth, 1, "default mapping depth 1");
    }

    // ---- 7d. the runtime: renames, pushes, Live -> model, depth, load order
    const lomA = mockLom();
    function boot(opts) {
        const lom = mockLom();
        const e = makeEnv(lom);
        loadScript("", e);
        if (opts && opts.beforeReady) opts.beforeReady(e);
        e.ctx.setnames(...NAMES);
        e.ctx.init_lom();
        e.run = (c) => vm.runInContext(c, e.ctx);
        e.lom = lom;
        e.sel = (pth) => e.observers.find((x) => x._prop === "selected_parameter").cb(["selected_parameter", "id", lom.idOf(pth)]);
        return e;
    }
    const lastVal = (e, n) => e.live[n].value;
    const attr = (e, n) => e.live[n].attrs._parameter_longname;
    {
        const e = boot();
        // ready: the marker was pushed; no object is ever renamed (Live ignores runtime renames, names are fixed)
        eq(lastVal(e, "ap_marker"), 2, "a new device pushes the marker (2: values and switches stored)");
        const renamed = () => Object.keys(e.live).filter((n) => e.live[n].attrLog.some(isRename));
        deq(renamed(), [], "ready: nothing is renamed");
        // add / type change / delete / undo push the values of the right generic position (names stay)
        e.run("MM.addModulator(MOD_LFO)");
        near(lastVal(e, "ap_0"), 100 * C.autoNorm("rate", 1), 1e-9, "LFO rate value pushed (position A)");
        near(lastVal(e, "ap_1"), 100 * C.autoNorm("syncDiv", 9), 1e-9, "LFO syncDiv value pushed (B)");
        near(lastVal(e, "ap_2"), 100, 1e-9, "LFO depth pushed (1.0) at C");
        near(lastVal(e, "ap_3"), 100 * C.autoNorm("phase", 0), 1e-9, "LFO phase pushed (D)");
        eq(lastVal(e, "at_0"), 0, "LFO shape pushed to the Shape switch (M1 Shape)");
        const p0 = e.run("MM.state.mods[0].p");
        eq(lastVal(e, "at_1"), p0.sync, "LFO sync pushed (M1 Sync)");
        eq(lastVal(e, "at_2"), p0.bipolar, "LFO bipolar pushed (M1 Bipolar)");
        eq(lastVal(e, "at_3"), p0.retrig, "LFO retrig pushed (M1 Retrig)");
        ok(!e.live.at_4 && !e.live.at_5, "LFO has no 1Shot / Loop: those switches are never touched");
        eq(lastVal(e, "ap_5"), 1, "On pushed");
        e.run("MM.setModType(0, MOD_ENV)");
        near(lastVal(e, "ap_0"), 100 * C.autoNorm("attack", 5), 1e-9, "Envelope attack pushed on the type change (A)");
        near(lastVal(e, "ap_1"), 100 * C.autoNorm("release", 120), 1e-9, "Envelope release (B)");
        near(lastVal(e, "ap_2"), 100, 1e-9, "depth stays at C");
        near(lastVal(e, "ap_3"), 100 * C.autoNorm("gain", 0), 1e-9, "Envelope gain pushed (D)");
        e.run("MM.setModType(0, MOD_MSEG)");
        near(lastVal(e, "ap_3"), 100 * C.autoNorm("loopStart", 0), 1e-9, "MSEG start (D)");
        near(lastVal(e, "ap_4"), 100 * C.autoNorm("loopEnd", 1), 1e-9, "MSEG end (E)");
        e.run("MM.setModType(0, MOD_STEPS)");
        near(lastVal(e, "ap_3"), 100 * C.autoNorm("steps", 8), 1e-9, "Steps count (D)");
        e.run("MM.setModType(0, MOD_RANDOM)");
        near(lastVal(e, "ap_4"), 100 * C.autoNorm("seed", 1), 1e-9, "Random seed (E)");
        e.run("MM.setParam(0, 'smooth', 0.4)");
        e.run("MM.removeModulator(0)");
        e.run("MM.undo()");
        near(lastVal(e, "ap_3"), 100 * C.autoNorm("smooth", 0.4), 1e-9, "undo re-applies the values");
        e.run("MM.addModulator(MOD_LFO); MM.addModulator(MOD_ENV)");
        near(lastVal(e, "ap_12"), 100 * C.autoNorm("attack", 5), 1e-9, "third modulator = slot 3 (ap_12 = M3 A)");
        deq(renamed(), [], "no rename call in any flow (add / type change / delete / undo)");

        // UI drag -> param output (messaged, so Live records it); the echo does not change anything
        const n0 = e.live.ap_6.messages.length;
        const undo0 = e.run("MM.undoInfo().undo");
        e.run("MM.setParam(1, 'rate', 5)");
        eq(e.live.ap_6.messages.length, n0 + 1, "UI change messages the live object once");
        eq(e.live.ap_6.messages[n0][0], "float", "messaged as a float (not `set`)");
        near(e.live.ap_6.messages[n0][1], 100 * C.autoNorm("rate", 5), 1e-9, "UI value mapped with the knob curve");
        near(e.run("MM.state.mods[1].p.rate"), 5, 1e-12, "echo leaves the model value");
        e.run("MM.setParam(1, 'rate', 5)");
        eq(e.live.ap_6.messages.length, n0 + 1, "an unchanged value is not pushed again");
        eq(e.run("MM.undoInfo().undo"), undo0, "UI parameter change does not touch the undo stack");
        e.run("MM.setParam(1, 'bipolar', 0)");
        eq(e.live.ap_6.messages.length, n0 + 1, "controls outside the pool push nothing");
        e.run("MM.setParam(1, 'loopStart', 0.9)"); // not a mapped key for LFO: no push, still a model change
        e.run("MM.setParam(1, 'enabled', 0)");
        eq(lastVal(e, "ap_11"), 0, "On follows the strip enable button");
        e.run("MM.setParam(1, 'enabled', 1)");

        // param input -> model: automation / macro. No push back, no notifyclients, no undo, cfg + redraw
        const cfgBase = 1 * C.CFG_STRIDE;
        const msgs = e.live.ap_6.messages.length;
        const notify0 = e.log.notify;
        const undo1 = e.run("MM.undoInfo()");
        let changes = [];
        e.run("MM.on('change', function (ev) { globalThis.__ch = (globalThis.__ch || []).concat([ev.kind]); })");
        e.ctx.autop(6, 100 * C.autoNorm("rate", 12.5));
        near(e.run("MM.state.mods[1].p.rate"), 12.5, 1e-6, "param input updates the model");
        near(e.bufs["---megamodcfg"].data[cfgBase + C.CF_RATE], 12.5, 1e-6, "param input updates the engine cfg");
        eq(e.live.ap_6.messages.length, msgs, "param input is never pushed back");
        eq(e.log.notify, notify0, "param input does not mark the Set dirty");
        deq(e.run("MM.undoInfo()"), undo1, "param input does not touch the undo stack");
        ok(e.run("globalThis.__ch").includes("param"), "param input redraws through a `param` change");
        // syncDiv (integer) from a macro
        e.ctx.autop(7, 100 * 0.2);
        eq(e.run("MM.state.mods[1].p.syncDiv"), 3, "integer control rounds");
        // unused position and empty slot: nothing happens
        const before = JSON.stringify(e.run("MM.state.mods[2].p"));
        e.ctx.autop(12 + 4, 55); // Envelope has no 5th control
        eq(JSON.stringify(e.run("MM.state.mods[2].p")), before, "unused position does nothing");
        e.ctx.autop(5 * 6, 50);
        ok(true, "empty slot input is ignored without throwing"); 
        // On from Live
        e.ctx.autop(11, 0);
        eq(e.run("MM.state.mods[1].enabled"), 0, "On = 0 from Live bypasses the modulator");
        eq(e.bufs["---megamodcfg"].data[cfgBase + C.CF_ENABLED], 0, "engine sees the bypass");
        e.ctx.autop(11, 1);
        eq(e.run("MM.state.mods[1].enabled"), 1, "On = 1");
        // loop start / end coupling from Live
        e.run("MM.setModType(1, MOD_MSEG)");
        e.ctx.autop(6 + 4, 100 * C.autoNorm("loopEnd", 0.3));
        e.ctx.autop(6 + 3, 100 * C.autoNorm("loopStart", 0.5));
        ok(e.run("MM.state.mods[1].p.loopEnd") >= e.run("MM.state.mods[1].p.loopStart") + 0.05 - 1e-9, "loop window stays valid from Live input");
    }

    // ---- switch parameters (LFO shape + the boolean chips): UI <-> Live, engine, undo, no dirty / undo from Live
    {
        const e = boot();
        e.run("MM.addModulator(MOD_LFO); MM.addModulator(MOD_MSEG); MM.addModulator(MOD_ENV)");
        const cfg = (slot, off) => e.bufs["---megamodcfg"].data[slot * C.CFG_STRIDE + off];
        const swIdx = (slot, key) => slot * 6 + C.AUTO_SW_KEYS.indexOf(key);
        const swObj = (slot, key) => "at_" + swIdx(slot, key);
        // the MSEG (slot 1) shows all five booleans, the Envelope (slot 2) only Bipolar
        for (const k of ["sync", "bipolar", "oneshot", "loopOn", "retrig"]) eq(lastVal(e, swObj(1, k)), e.run(`MM.state.mods[1].p.${k}`), `MSEG ${k} pushed into its switch parameter`);
        eq(lastVal(e, swObj(2, "bipolar")), e.run("MM.state.mods[2].p.bipolar"), "Envelope bipolar pushed");
        ok(!e.live[swObj(2, "sync")] && !e.live[swObj(2, "retrig")], "Envelope has no Sync / Retrig switch: never touched");
        // UI -> Live: messaged once, echo ignored, unchanged value not pushed again
        const n0 = e.live[swObj(1, "oneshot")].messages.length;
        const undo0 = e.run("MM.undoInfo().undo");
        e.run("MM.setParam(1, 'oneshot', 1)");
        eq(e.live[swObj(1, "oneshot")].messages.length, n0 + 1, "UI chip click messages the switch once");
        eq(e.live[swObj(1, "oneshot")].messages[n0][1], 1, "...with 1");
        eq(e.run("MM.state.mods[1].p.oneshot"), 1, "the echo leaves the model value");
        eq(cfg(1, C.CF_ONESHOT), 1, "engine cfg: oneshot on");
        e.run("MM.setParam(1, 'oneshot', 1)");
        eq(e.live[swObj(1, "oneshot")].messages.length, n0 + 1, "an unchanged switch is not pushed again");
        e.run("MM.setParam(0, 'shape', 3)");
        eq(lastVal(e, swObj(0, "shape")), 3, "LFO shape chip -> Shape switch = 3");
        eq(e.run("MM.undoInfo().undo"), undo0, "UI switch changes are not on the undo stack");
        // Live -> model: no push back, no dirty, no undo, engine updated, redraw
        const notify0 = e.log.notify;
        const msgs = e.live[swObj(1, "sync")].messages.length;
        const undo1 = e.run("MM.undoInfo()");
        e.run("globalThis.__sw = []; MM.on('change', function (ev) { globalThis.__sw.push(ev.kind); })");
        const syncBefore = e.run("MM.state.mods[1].p.sync");
        e.ctx.autot(swIdx(1, "sync"), 1 - syncBefore);
        eq(e.run("MM.state.mods[1].p.sync"), 1 - syncBefore, "SYNC from Live flips the model");
        eq(cfg(1, C.CF_SYNC), 1 - syncBefore, "...and the engine");
        eq(e.live[swObj(1, "sync")].messages.length, msgs, "switch input is never pushed back");
        eq(e.log.notify, notify0, "switch input does not mark the Set dirty");
        deq(e.run("MM.undoInfo()"), undo1, "switch input does not touch the undo stack");
        ok(e.run("globalThis.__sw").includes("param"), "switch input redraws through a `param` change");
        e.ctx.autot(swIdx(0, "shape"), 4);
        eq(e.run("MM.state.mods[0].p.shape"), 4, "Shape from Live (a 5-way tab)");
        eq(cfg(0, C.CF_SHAPE), 4, "...reaches the engine");
        e.ctx.autot(swIdx(0, "shape"), 9);
        eq(e.run("MM.state.mods[0].p.shape"), 4, "an out-of-range shape is clamped (4)");
        e.ctx.autot(swIdx(1, "bipolar"), 0); e.ctx.autot(swIdx(1, "loopOn"), 1); e.ctx.autot(swIdx(1, "retrig"), 0);
        deq([0, 1, 0].map((v, i) => e.run(`MM.state.mods[1].p.${["bipolar", "loopOn", "retrig"][i]}`)), [0, 1, 0], "bipolar / loop / retrig from Live");
        eq(cfg(1, C.CF_BIPOLAR) + cfg(1, C.CF_LOOPON) * 10 + cfg(1, C.CF_RETRIG) * 100, 10, "...in the engine cfg");
        // a switch the type does not show, and an empty slot, do nothing
        const before = JSON.stringify(e.run("MM.state.mods[2].p"));
        e.ctx.autot(swIdx(2, "sync"), 1); e.ctx.autot(swIdx(2, "oneshot"), 1);
        eq(JSON.stringify(e.run("MM.state.mods[2].p")), before, "unused switches (Envelope Sync / 1Shot) do nothing");
        e.ctx.autot(7 * 6 + 1, 1);
        ok(true, "an empty slot's switch is ignored without throwing");
        // type change and undo push the switches of the new type / restore them
        e.run("MM.setParam(1, 'bipolar', 1)");
        e.run("MM.setModType(1, MOD_STEPS)");
        for (const k of ["sync", "bipolar", "oneshot", "retrig"]) eq(lastVal(e, swObj(1, k)), e.run(`MM.state.mods[1].p.${k}`), `type change pushes ${k}`);
        e.run("MM.setParam(1, 'retrig', 0); MM.setParam(1, 'oneshot', 1)");
        e.run("MM.removeModulator(1)");
        e.emitLive(swObj(1, "oneshot"), 0); // automation moved the (now unused) parameter meanwhile: the model has no modulator, so it is ignored
        e.run("MM.undo()");
        eq(lastVal(e, swObj(1, "oneshot")), 1, "undo re-applies the oneshot switch");
        eq(lastVal(e, swObj(1, "retrig")), 0, "undo re-applies the retrig switch");
        deq(Object.keys(e.live).filter((n) => e.live[n].attrLog.some(isRename)), [], "no switch object is ever renamed");
    }

    // ---- depth parameters
    {
        const e = boot();
        e.run("MM.addModulator(MOD_LFO)");
        const P_FREQ = "live_set tracks 1 devices 1 parameters 0";
        const P_RES = "live_set tracks 1 devices 1 parameters 1";
        const P_DRY = "live_set tracks 0 devices 0 parameters 0";
        const P_DRY2 = "live_set tracks 1 devices 0 parameters 0";
        e.run("MM.armLearn(0, false)"); e.sel(P_FREQ);
        near(lastVal(e, "ad_0"), 100, 1e-9, "depth 100% pushed");
        deq(Object.keys(e.live).filter((n) => e.live[n].attrLog.some(isRename)), [], "depth parameters are never renamed");
        e.run("MM.armLearn(0, false)"); e.sel(P_DRY);
        e.run("MM.armLearn(0, false)"); e.sel(P_DRY2);
        // UI -> param: updateMapping({depth}) pushes, rewrites the table, and the echo changes nothing
        const m = e.run("MM.allMappings()[0]");
        e.run(`MM.setSettings({ defaultMode: 'mod' }); MM.updateMapping(${m.id}, { range: 1, polarity: 1 })`);
        const msgs0 = e.live.ad_0.messages.length;
        e.run(`MM.updateMapping(${m.id}, { depth: 0.5 })`);
        near(lastVal(e, "ad_0"), 50, 1e-9, "UI depth pushed as percent");
        eq(e.live.ad_0.messages.length, msgs0 + 1, "one push");
        const slot0 = e.run(`MM.mappingSlot(${m.id})`);
        eq(slot0, 0, "first mapping is pool slot 0");
        near(e.bufs["---mmcurve"].data[slot0 * 256 + 255], 1, 1e-9, "pool slots < 64: the table is baked at depth 1 (the router applies the depth per sample)");
        near(e.bufs["---megamodroute"].data[C.ROUTE_DEPTH_BASE + slot0], 0.5, 1e-9, "the base depth is in the route buffer");
        eq(e.bufs["---megamodroute"].data[C.ROUTE_DEPTH_MIN + slot0], -1, "Mod mapping: Remote min cell is -1");
        near(e.run(`MM.getMapping(${m.id}).depth`), 0.5, 1e-12, "model depth");
        // Live -> model, throttled table rewrite (fake clock)
        let now = 1000;
        e.run("MM._test.setNow(function () { return globalThis.__now; })");
        e.ctx.__now = 1000;
        const tableAt = () => e.bufs["---megamodroute"].data[C.ROUTE_DEPTH_BASE + slot0];
        e.ctx.autod(0, 40);
        near(e.run(`MM.getMapping(${m.id}).depth`), 0.4, 1e-9, "Live depth input updates the model");
        near(tableAt(), 0.4, 1e-9, "first depth write is immediate");
        e.ctx.__now = 1010;
        const pokesBefore = tableAt();
        e.ctx.autod(0, 30);
        near(e.run(`MM.getMapping(${m.id}).depth`), 0.3, 1e-9, "model follows every Live value");
        // the mock Task runs a scheduled write at once, so a throttled write still lands (trailing edge); with a clock < 33 ms the
        // direct path is skipped and goes through the Task
        near(tableAt(), 0.3, 1e-9, "throttled depth write lands (trailing edge)");
        eq(e.live.ad_0.messages.length, msgs0 + 1, "Live depth input is never pushed back");
        const undoN = e.run("MM.undoInfo().undo");
        e.ctx.autod(0, 20);
        eq(e.run("MM.undoInfo().undo"), undoN, "depth input does not touch the undo stack");
        e.ctx.autod(7, 20); // unbound slot: ignored
        // delete releases: name + value
        e.run(`MM.deleteMapping(${m.id})`);
        near(lastVal(e, "ad_0"), 100, 1e-9, "a released depth goes back to 100%");
        e.run("MM.undo()");
        near(lastVal(e, "ad_0"), 20, 1e-6, "undo re-applies the depth value");
    }

    // ---- the 64-slot limit: a mapping beyond it keeps the UI depth but has no Live parameter
    {
        const e = boot();
        e.run("MM.addModulator(MOD_LFO)");
        for (let k = 0; k < 70; k++) e.run(`MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters ${k + 1}', paramName: 'P${k}', trackName: 'Drums', deviceName: 'Reverb', id: ${1000 + k} })`);
        eq(e.run("MM.allMappings().length"), 70, "70 mappings");
        ok(Object.keys(e.live).includes("ad_63"), "slot 63 is the last with a Live parameter");
        ok(!Object.keys(e.live).includes("ad_64"), "no ad_64 object is ever touched");
        const m69 = e.run("MM.allMappings()[69]");
        eq(e.run(`MM.mappingSlot(${m69.id})`), 69, "mapping 70 sits in slot 69");
        e.run(`MM.updateMapping(${m69.id}, { depth: 0.25 })`);
        near(e.run(`MM.getMapping(${m69.id}).depth`), 0.25, 1e-12, "depth stays editable beyond slot 64");
        near(e.bufs["---mmcurve"].data[69 * 256 + 255], 0.5, 1e-9, "table of slot 69 is baked at depth 1 (schema 10: every slot applies the depth in its router)");
        near(e.bufs["---megamodroute"].data[C.ROUTE_DEPTH_BASE + 69], 0.25, 1e-9, "the base depth of slot 69 is written to the route buffer (depth multiplier for slots >= 64)");
        eq(e.bufs["---megamodroute"].data[C.ROUTE_DEPTH_MIN + 69], -1, "slot 69 is a Mod mapping: Remote min cell -1");
        e.ctx.autod(64, 10); // not a Live object, ignored safely
        ok(true, "depth input beyond 64 is ignored");
    }

    // ---- load order
    {
        // a set saved by the first device: modulators + a mapping, params moved away from the blob afterwards (automation / macro)
        const src = boot();
        src.run("MM.addModulator(MOD_LFO); MM.addModulator(MOD_ENV)");
        src.run("MM.setParam(0, 'rate', 2); MM.setParam(1, 'attack', 10)");
        src.run("MM.armLearn(0, false)"); src.sel("live_set tracks 1 devices 1 parameters 0");
        const blob = src.run("MM.save()");
        const stored = {}; for (const n of Object.keys(src.live)) stored[n] = src.live[n].value;
        // (1) Live restored its values (marker stored) and they differ from the blob: Live wins
        const liveVals = Object.assign({}, stored, { ap_0: 100 * C.autoNorm("rate", 7), ap_6: 100 * C.autoNorm("attack", 300), ad_0: 35, at_2: 0, ap_marker: 2 });
        const eL = boot({ beforeReady: (e) => { e.ctx.setvalueof(blob); for (const n of Object.keys(liveVals)) { e.liveObj(n).value = liveVals[n]; e.emitLive(n, liveVals[n]); } } });
        near(eL.run("MM.state.mods[0].p.rate"), 7, 1e-6, "stored marker: Live's rate wins over the blob");
        near(eL.run("MM.state.mods[1].p.attack"), 300, 1e-6, "stored marker: Live's attack wins");
        near(eL.run("MM.allMappings()[0].depth"), 0.35, 1e-9, "stored marker: Live's depth wins");
        near(eL.bufs["---megamodcfg"].data[C.CF_RATE], 7, 1e-6, "adopted values reach the engine");
        const infoL = eL.run("MM.autoInfo().init");
        eq(infoL.stored, true, "init info: marker restored");
        ok(infoL.cached > 0 && infoL.missing === 0 || infoL.cached + infoL.read > 0, "init info: values came from the objects");
        eq(eL.run("MM.state.mods[0].p.bipolar"), 0, "stored marker 2: Live's Bipolar switch wins over the blob");
        eq(eL.live.ap_marker.messages.length, 0, "marker is not rewritten when stored");
        // (1b) a Set saved before the switches existed (marker 1): its switch objects hold their initial 0, the blob's values win
        const eS = boot({ beforeReady: (e) => { e.ctx.setvalueof(blob); for (const n of Object.keys(stored)) { e.liveObj(n).value = n.startsWith("at_") ? 0 : n === "ap_marker" ? 1 : stored[n]; e.emitLive(n, e.liveObj(n).value); } } });
        eq(eS.run("MM.state.mods[0].p.bipolar"), 1, "marker 1 (old Set): the switch parameters are not adopted, the blob's Bipolar is kept");
        eq(lastVal(eS, "at_2"), 1, "marker 1: the blob's switch values are pushed");
        eq(lastVal(eS, "ap_marker"), 2, "marker 1: upgraded to 2");
        deq(Object.keys(eL.live).filter((n) => eL.live[n].attrLog.some(isRename)), [], "load: nothing renamed");
        // (2) an old Set: no marker, no param values -> the blob's values are pushed once
        const eO = boot({ beforeReady: (e) => { e.ctx.setvalueof(blob); } });
        near(eO.run("MM.state.mods[0].p.rate"), 2, 1e-9, "no marker: the blob's rate is kept");
        near(lastVal(eO, "ap_0"), 100 * C.autoNorm("rate", 2), 1e-9, "no marker: the blob's value is pushed into the parameter");
        near(lastVal(eO, "ap_6"), 100 * C.autoNorm("attack", 10), 1e-9, "no marker: every parameter is pushed");
        eq(lastVal(eO, "ap_marker"), 2, "no marker: the marker is set (2)");
        eq(lastVal(eO, "at_2"), 1, "no marker: the switch values are pushed too");
        eq(eO.run("MM.autoInfo().init.stored"), false, "init info: no marker -> pushed");
        near(lastVal(eO, "ad_0"), 100, 1e-9, "no marker: depth pushed");
        // (3) Live restored params at their initial 0 but without the marker (it must not adopt them)
        const eZ = boot({ beforeReady: (e) => { e.ctx.setvalueof(blob); for (const n of Object.keys(stored)) if (n !== "ap_marker") e.emitLive(n, 0); } });
        near(eZ.run("MM.state.mods[0].p.rate"), 2, 1e-9, "initial-value outputs without a marker are not adopted");
        // (4) a preset / undo load after ready: the blob wins and the params follow
        const eP = boot();
        eP.ctx.setvalueof(blob);
        near(eP.run("MM.state.mods[0].p.rate"), 2, 1e-9, "post-ready load: the blob wins");
        near(lastVal(eP, "ap_0"), 100 * C.autoNorm("rate", 2), 1e-9, "post-ready load pushes the blob into the parameters");
        near(lastVal(eP, "ap_6"), 100 * C.autoNorm("attack", 10), 1e-9, "post-ready load pushes the second modulator too");
        // (5) the stored marker but an object that never output: fall back to reading it, else push
        const eR = boot({ beforeReady: (e) => { e.ctx.setvalueof(blob); e.liveObj("ap_marker").value = 1; e.liveObj("ap_0").value = 100 * C.autoNorm("rate", 9); } });
        near(eR.run("MM.state.mods[0].p.rate"), 9, 1e-6, "stored marker: values are read back from the object when it never output");
        eR.liveCfg.canRead = false;
        const eN = boot({ beforeReady: (e) => { e.liveCfg.canRead = false; e.ctx.setvalueof(blob); e.ctx.autom(1); } });
        near(eN.run("MM.state.mods[0].p.rate"), 2, 1e-9, "stored marker without readable values keeps the blob");
        near(lastVal(eN, "ap_0"), 100 * C.autoNorm("rate", 2), 1e-9, "...and pushes it");
        // nothing is pushed before ready
        const eB = makeEnv(mockLom());
        loadScript("", eB);
        eB.ctx.setvalueof(blob);
        eq(Object.keys(eB.live).length, 0, "no live object is touched before ready");
    }

    // ================================================================ 8. SELF-MODULATION (schema 9): a modulator modulating this device's own controls
    {
        const deq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); passed++; }; // (values from the VM have another Array prototype)
        const ownNames = ["MegaModState", "Foo"];
        for (let s = 0; s < 16; s++) ownNames.push(...C.autoSlotNames(s), ...C.AUTO_SW_NAMES.map((n, t) => C.autoSwitchName(s, t)));
        for (let k = 0; k < 64; k++) ownNames.push(C.autoDepthName(k));
        const bootS = (opts) => {
            const e = boot(opts);
            e.lom.tree.master.devices[0].params = ownNames.slice();
            e.ctx.init_lom(); // (the LOM tree had only two parameters when the device was first initialised: resolve again)
            e.ownPath = (nm) => "live_set master_track devices 0 parameters " + ownNames.indexOf(nm);
            e.selOwn = (nm) => e.sel(e.ownPath(nm));
            e.mapsOf = () => e.run("MM.allMappings()");
            e.addLfos = (n) => { for (let i = 0; i < n; i++) e.run("MM.addModulator(MOD_LFO)"); };
            return e;
        };
        const ib = (e, off, n) => Array.from(e.bufs["---megamodint"].data.slice(off, off + n));
        const ic = (e, r, j) => e.bufs["---megamodicurve"].data[r * 256 + j];

        // ---- dest codes and Live parameter names are the same thing
        {
            for (let c = 0; c < C.DEST_COUNT; c++) {
                const d = C.selfDestInfo(c);
                eq(C.selfDestFor(d.kind, d.slot, d.ctl), c, `dest ${c}: code <-> info round trip`);
                eq(C.selfDestFromName(C.selfDestName(c)), c, `dest ${c}: name <-> code (${C.selfDestName(c)})`);
            }
            eq(C.selfDestInfo(-1), null, "no dest -1"); eq(C.selfDestInfo(256), null, "no dest 256");
            for (const bad of ["MegaModState", "Foo", "Device On", "M17 A", "M0 A", "M1 F", "Depth 65", "Depth 0", "MM Auto Stored", ""]) eq(C.selfDestFromName(bad), -1, `not a target: "${bad}"`);
            eq(C.selfDestFromName("M2 A"), 6, "M2 A = 1 * 6 + 0"); eq(C.selfDestFromName("M2 On"), 11, "M2 On = 1 * 6 + 5");
            eq(C.selfDestFromName("M2 Shape"), 96 + 6, "M2 Shape"); eq(C.selfDestFromName("Depth 3"), 192 + 2, "Depth 3 = slot 2");
            // every pool parameter of the builder is exactly one target (257 parameters = Device On + 96 + 96 + 64)
            const names = new Set();
            for (let c = 0; c < C.DEST_COUNT; c++) names.add(C.selfDestName(c));
            eq(names.size, 256, "256 distinct targets (96 modulator parameters + 96 switches + 64 depths)");
            eq(C.DEST_SW, C.AUTO_COUNT, "switch codes start after the 96 modulator parameters"); eq(C.DEST_DEPTH, C.AUTO_COUNT + C.AUTO_SW_COUNT, "depth codes start after the switches");
        }
        // ---- existence per type, naming by meaning, rejection rules
        {
            const st = C.defaultState();
            st.mods[0] = C.makeModSlot(C.MOD_LFO, 0); st.mods[1] = C.makeModSlot(C.MOD_ENV, 1); st.mods[1].name = "Follow";
            ok(C.selfDestExists(C.selfDestFor("ctl", 0, 3), st) && !C.selfDestExists(C.selfDestFor("ctl", 0, 4), st), "LFO has A..D, no E");
            ok(C.selfDestExists(C.selfDestFor("ctl", 1, 3), st) && !C.selfDestExists(C.selfDestFor("ctl", 1, 4), st), "Envelope has A..D (gain), no E");
            ok(C.selfDestExists(C.selfDestFor("sw", 0, 0), st) && !C.selfDestExists(C.selfDestFor("sw", 1, 0), st) && C.selfDestExists(C.selfDestFor("sw", 1, 2), st), "LFO has Shape, Envelope only Bipolar");
            ok(!C.selfDestExists(C.selfDestFor("ctl", 5, 0), st) && C.selfDestExists(C.selfDestFor("depth", -1, 7), st), "an empty slot has no controls, Depth always exists");
            eq(C.selfDestLabel(6, st), "Follow Attack", "Envelope A = Attack, named by meaning");
            eq(C.selfDestLabel(0, st), "LFO 1 Rate", "LFO A = Rate"); eq(C.selfDestLabel(2, st), "LFO 1 Depth", "LFO C = Depth");
            eq(C.selfDestLabel(C.selfDestFor("on", 1, 0), st), "Follow On", "On"); eq(C.selfDestLabel(C.selfDestFor("sw", 0, 0), st), "LFO 1 Shape", "Shape");
            eq(C.selfDestLabel(193, st, (k) => (k === 1 ? "Frequency" : "")), "Frequency Depth", "Depth named after the mapping's parameter");
            eq(C.selfDestLabel(194, st, () => ""), "Depth 3", "...or generically when the slot is empty");
            deq(C.classifySelfParam("M2 A", 0, st), { ok: true, dest: 6 }, "another modulator's control is a target");
            eq(C.classifySelfParam("M1 A", 0, st).reason, "self-loop", "the source's own control is a self-loop");
            eq(C.classifySelfParam("M1 Shape", 0, st).reason, "self-loop", "...and its switch");
            eq(C.classifySelfParam("M1 On", 0, st).ok, false, "...and its On");
            ok(C.classifySelfParam("M2 On", 0, st).ok && C.classifySelfParam("Depth 5", 0, st).ok, "another modulator's On and any Depth are fine");
            eq(C.classifySelfParam("Depth 1", 0, st).ok, true, "Depth of a mapping of the source itself is not a self-loop");
            for (const n of ["MegaModState", "Foo", "Device On", "MM Auto Stored"]) eq(C.classifySelfParam(n, 0, st).ok, false, `${n}: not a target`);
            eq(C.classifySelfParam("M9 A", 0, st).reason, "no modulator in that slot", "an empty slot");
        }
        // ---- engine descriptors vs the model ranges, and the engine math in JS
        {
            const d = C.intDescriptorFloats();
            eq(d.length, C.INT_SAMPS - C.INT_DESC_AT, "descriptor block fits the buffer");
            for (let t = 1; t <= 5; t++) for (let j = 0; j < 5; j++) {
                const key = C.AUTO_KEYS[t][j], o = (t * 5 + j) * 5;
                if (!key) { eq(d[o], 0, `type ${t} control ${j}: no control`); continue; }
                const r = C.MOD_PARAM_RANGE[key];
                eq(d[o] - 1, C.KEY_CF[key], `type ${t} ${key}: CF field`);
                deq([d[o + 1], d[o + 2], d[o + 3], d[o + 4]], [r[0], r[1], C.AUTO_LOG[key] ? 1 : 0, r[2] ? 1 : 0], `type ${t} ${key}: lo / hi / log / int`);
                // the engine formula (descriptor driven) equals autoValue(autoNorm) + the offset, over the whole travel
                for (const off of [-0.3, -0.05, 0, 0.07, 0.4]) for (const frac of [0, 0.2, 0.5, 0.9, 1]) {
                    const base = C.autoValue(key, frac);
                    const lo = d[o + 1], hi = d[o + 2], lg = d[o + 3], it = d[o + 4];
                    let n0 = lg ? Math.log(Math.max(base, lo) / lo) / Math.log(hi / lo) : (base - lo) / (hi - lo);
                    n0 = Math.max(0, Math.min(1, n0));
                    const n1 = Math.max(0, Math.min(1, n0 + off));
                    let v = lg ? lo * Math.exp(n1 * Math.log(hi / lo)) : lo + (hi - lo) * n1;
                    if (it) v = Math.floor(v + 0.5);
                    near(v, C.selfCtlValue(t, j, base, off), 1e-9 * Math.max(1, Math.abs(v)), `engine math == selfCtlValue (${key}, off ${off}, at ${frac})`);
                }
            }
            for (let t = 0; t < 6; t++) {
                eq(d[C.INT_SW_AT - C.INT_DESC_AT + t] - 1, C.KEY_CF[C.AUTO_SW_KEYS[t]], `switch ${t}: CF field`);
                eq(d[C.INT_SW_AT - C.INT_DESC_AT + 6 + t], t === 0 ? 4 : 1, `switch ${t}: max value`);
            }
            // one octave of LFO rate = ln 2 / ln 4000 of the knob (log 0.01..40 Hz): 4 Hz -> 8 Hz exactly
            near(C.selfCtlValue(C.MOD_LFO, 0, 4, Math.log(2) / Math.log(4000)), 8, 1e-9, "+1 octave of the Rate knob doubles the rate");
            near(C.selfCtlValue(C.MOD_LFO, 0, 4, -Math.log(2) / Math.log(4000)), 2, 1e-9, "-1 octave halves it");
            eq(C.selfCtlValue(C.MOD_LFO, 0, 40, 0.5), 40, "clamped to the control's range");
            eq(C.selfCtlValue(C.MOD_STEPS, 3, 8, 0.1), Math.round(1 + 31 * (7 / 31 + 0.1)), "an integer control (Steps) rounds");
        }
        // ---- engine source: the static contract with src/megamod_engine.genexpr
        {
            const g = GEN.replace(/\/\/.*$/gm, "");
            ok(/^Buffer ibuf\("megamodint"\);/m.test(g) && /^Buffer icurve\("megamodicurve"\);/m.test(g) && /^Buffer route\("megamodroute"\);/m.test(g), "engine buffers: megamodint / megamodicurve / megamodroute");
            ok(g.includes(`peek(ibuf, ${C.INT_COUNT_AT}, 0)`), "route count at megamodint[256]");
            ok(g.includes("rt * 4 + 1") && g.includes("peek(ibuf, rt * 4, 0)"), "route stride 4: [src + 1, dest]");
            ok(g.includes(`peek(icurve, rt * ${C.CURVE_REGION} + ia, 0)`), "route table stride 256 (router convention)");
            ok(g.includes(`rt < ${C.INT_ROUTES}; rt += 1`), "64 routes");
            ok(g.includes(`264 + (peek(cf, msl * 24) * 5 + mjj) * 5`) && C.INT_DESC_AT === 264, "control descriptors at 264 + (type * 5 + j) * 5");
            ok(g.includes(`peek(ibuf, 414 + mtt, 0)`) && g.includes(`peek(ibuf, 420 + mtt, 0)`) && C.INT_SW_AT === 414, "switch descriptors at 414 / 420");
            ok(g.includes("if (dst < 96)") && g.includes("} else if (dst < 192) {") && C.DEST_SW === 96 && C.DEST_DEPTH === 192, "dest code ranges 0..95 / 96..191 / 192..255");
            ok(g.includes(`${C.ROUTE_DEPTH_BASE} + dk`) && g.includes(`${C.ROUTE_DEPTH_BASE} + dkk`) && g.includes("2 * dk + 1") && g.includes("2 * dkk + 1"), "engine writes the effective depth at route[2k + 1] from the base at [512 + k]");
            ok(g.includes(`128 + sl * ${C.SCOPE_EFF_STRIDE}`) && C.SCOPE_EFF === 128 && g.includes(`${C.SCOPE_DEPTH} + ts`) && C.SCOPE_DEPTH === 320, "effective-value telemetry layout");
            ok(C.SCOPE_EFF + C.MAX_MODS * C.SCOPE_EFF_STRIDE <= C.SCOPE_DEPTH && C.SCOPE_DEPTH + C.AUTO_DEPTH_SLOTS <= C.SCOPE_SAMPS, "telemetry regions do not overlap and fit");
            ok(/poke\(cf, peek\(cfg, rs \* 24 \+ k, 0\), rs \* 24 \+ k\);\s*poke\(cm,/.test(g), "cm is refreshed together with cf, then modulated");
            ok(GEN.indexOf("3c. Internal") > GEN.indexOf("3. Refresh"), "the matrix runs after the config refresh");
            ok(GEN.indexOf("3c. Internal") < GEN.indexOf("4. Evaluate the slots"), "...and before the slots are evaluated (previous-sample sources)");
            ok(g.includes("nHi > 0.5"), "the matrix is skipped when no route is active");
            ok(!/\bnormOf\(|\bvalOf\(/.test(g), "no helper function called with those argument shapes (it silently broke the gen compile in Max 9)");
            ok(/peek\(outv, sidx - 1\)/.test(g), "sources are read from outv before the slots of this sample run");
            ok(!/\be[0-9]\b/.test(g), "no e<digit> identifiers");
            // routers: EVERY pool slot (schema 10) applies the depth per sample (the depth multiplier covers slots >= 64)
            let covered = 0, baseOk = true;
            for (let r = 0; r < 8; r++) {
                const R = mcPy.router(r);
                for (let jx = 0; jx < 32; jx++) {
                    const k = r * 32 + jx;
                    if (!R.includes(`dk${jx} = peek(route, ${2 * k + 1});`) || !R.includes(`rm${jx} = peek(route, ${C.ROUTE_DEPTH_MIN + k});`) || !R.includes(`yv${jx} = (rm${jx} < -0.5) ? yv${jx} * dk${jx} : rm${jx} + (yv${jx} - rm${jx}) * dk${jx};`)) baseOk = false;
                    covered++;
                }
            }
            ok(baseOk && covered === 256, "all 8 routers read dk = route[2k+1] and rm = route[768 + k] for each of their 32 slots (256 pool slots)");
            ok(C.ROUTE_DEPTH_BASE === 512 && C.ROUTE_DEPTH_MIN === 768 && C.ROUTE_DEPTH_MIN + 256 <= C.ROUTE_SAMPS && C.ROUTE_DEPTH_BASE + 256 <= C.ROUTE_DEPTH_MIN && 2 * 256 <= C.ROUTE_DEPTH_BASE, "route buffer layout: [0..511] source/effective, [512..767] base, [768..1023] Remote centre");
            ok(/Data dsum\(512\);/.test(g) && /Data dcl\(512\);/.test(g) && /Data dprd\(512\);/.test(g), "the destination accumulators (sum, count, product) hold 448 depth / control cells");
            ok(g.includes("dk = sampleCount - 256 * floor(sampleCount / 256);"), "the base -> effective depth refresh walks all 256 slots");
            ok(g.includes("poke(route, clip(peek(route, 512 + dkk, 0) * peek(dprd, dst), 0, 1), 2 * dkk + 1, 0);") && g.includes("dkk = dst - 192;") && g.includes("poke(dprd, peek(dprd, dst) * (va + (vb - va) * (fi - ia)), dst);") && g.includes("poke(dprd, 1, dz);"), "a depth destination 192 + k (k up to 255) writes base * the PRODUCT of the routes' unipolar factors (clipped 0..1) as the effective depth of pool slot k");
            ok(g.includes("poke(scope, peek(route, 2 * (ts + 192) + 1, 0), 512 + ts, 0);") && C.SCOPE_DEPTH + C.ROUTER_DEPTH_SLOTS <= C.SCOPE_SAMPS, "telemetry carries the effective depth of all 256 slots");
        }
        // ---- model: schema 9, selector, targets, serialization
        {
            eq(C.defaultSettings().selfMod, "internal", "Self-mod defaults to INTERNAL");
            eq(C.sanitizeSettings({ selfMod: "live" }).selfMod, "live", "live accepted"); eq(C.sanitizeSettings({ selfMod: "bogus" }).selfMod, "internal", "anything else = internal");
            eq(C.sanitizeSettings({}).selfMod, "internal", "missing = internal");
            const old = C.normalizeState({ schema: 8, mods: [{ type: 1 }], mappings: [{ id: 1, mod: 0, target: { path: "live_set tracks 0 devices 0 parameters 1", paramName: "x" } }], settings: { defaultMode: "remote", smoothMs: 10 } });
            eq(old.schema, 10, "schema 8 -> 10"); eq(old.settings.selfMod, "internal", "migration defaults to internal"); eq(old.settings.defaultMode, "remote", "...and keeps the other settings");
            eq(old.mappings.length, 1, "...and the mappings"); ok(!old.mappings[0].target.internal && old.mappings[0].target.selfDest === undefined, "an old mapping is not a self-mapping");
            const t = C.sanitizeTarget(C.makeInternalTarget(6));
            ok(t.internal === true && t.selfDest === 6 && t.kind === "ctl" && t.slot === 1 && t.ctl === 0 && t.path === "" && t.paramName === "M2 A", "internal target keeps its code and derived fields");
            eq(C.sanitizeTarget({ internal: true, selfDest: 999 }).internal, undefined, "an invalid code is dropped");
            const m = C.sanitizeMapping({ id: 3, mod: 0, mode: "remote", min: 0.3, target: C.makeInternalTarget(6) });
            eq(m.mode, "mod", "an internal mapping is Mod only (Remote is forced to Mod)");
            eq(C.targetKey(C.makeInternalTarget(6)), C.targetKey({ path: "live_set master_track devices 0 parameters 9", selfDest: 6 }), "internal and via-Live targets of the same control collide (duplicate rule)");
            const s = C.defaultState();
            s.mods[0] = C.makeModSlot(C.MOD_LFO, 0); s.mods[1] = C.makeModSlot(C.MOD_LFO, 1);
            s.settings.selfMod = "live";
            s.mappings.push(C.defaultMapping(1, 0, C.makeInternalTarget(6), "mod"));
            const live = C.defaultMapping(2, 0, { path: "live_set master_track devices 0 parameters 5", paramName: "M2 B", selfDest: 7 }, "remote");
            live.min = 0.2; live.max = 0.7; live.slot = 4;
            s.mappings.push(live);
            const back = C.deserializeState(C.serializeState(s));
            eq(back.settings.selfMod, "live", "selfMod round trips");
            ok(back.mappings[0].target.internal === true && back.mappings[0].target.selfDest === 6, "internal mapping round trips");
            ok(!back.mappings[1].target.internal && back.mappings[1].target.selfDest === 7 && back.mappings[1].mode === "remote" && back.mappings[1].slot === 4, "via-Live mapping round trips (Remote, pool slot)");
            ok(C.isSelfMapping(back.mappings[0]) && C.isSelfMapping(back.mappings[1]), "isSelfMapping");
        }

        // ---- runtime: learn on the device's own parameters, INTERNAL (the default)
        {
            const e = bootS();
            e.addLfos(2);
            e.run("globalThis.__evs = []; MM.on('change', function (ev) { __evs.push(ev.kind + ':' + ev.id); })");
            const learnOwn = (nm, mod) => { e.run(`MM.armLearn(${mod === undefined ? 0 : mod}, false)`); e.selOwn(nm); };
            for (const bad of ["M1 A", "M1 On", "M1 Shape", "MegaModState", "Foo"]) {
                learnOwn(bad); eq(e.mapsOf().length, 0, `learn rejects ${bad}`);
                e.run("MM.disarmLearn()");
                e.sel("live_set tracks 0 devices 0 parameters 1"); // move the observed selection away so the same parameter can be learned again
            }
            learnOwn("M2 A");
            let ms = e.mapsOf();
            eq(ms.length, 1, "a click on LFO 2's Rate learns one self-mapping");
            ok(ms[0].target.internal === true && ms[0].target.selfDest === 6 && ms[0].mode === "mod" && ms[0].mod === 0, "...INTERNAL, Mod, source = the learning modulator, target = M2 A");
            eq(e.run("MM.mappingSlot(" + ms[0].id + ")"), -1, "no Live pool slot");
            eq(e.run("MM.mappingCapacity().used"), 0, "the pool is untouched");
            eq(e.run("MM.internalCapacity().used"), 1, "one internal route used");
            eq(e.run("MM.selfLabel(MM.allMappings()[0])"), "LFO 2 Rate", "named by meaning");
            eq(e.run("MM.mappingStatus(MM.allMappings()[0].id)"), "ok", "status ok (no Live id needed)");
            ok(Object.values(e.pool).every((p) => p.messages.every((q) => q[1] === 0)), "no live.modulate~ / live.remote~ was bound");
            ok(!e.run("MM.learn.armed"), "single-shot learn disarmed");
            // buffer: route 0 = [src + 1, dest], count 1, the table is the mapping's table
            deq(ib(e, 0, 4), [1, 6, 0, 0], "megamodint route 0 = [source + 1, dest code]");
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 1, "route count = 1");
            near(ic(e, 0, 255), C.mappingTable(ms[0])[255], 1e-12, "icurve holds the mapping table (last sample)");
            near(ic(e, 0, 128), C.mappingTable(ms[0])[128], 1e-12, "icurve holds the mapping table (middle)");
            deq(ib(e, C.INT_DESC_AT, C.INT_SAMPS - C.INT_DESC_AT), C.intDescriptorFloats(), "control descriptors are written");
            // editing the mapping rewrites the table; depth is baked in
            e.run(`MM.updateMapping(${ms[0].id}, { range: 1, polarity: 1, depth: 0.5 })`);
            near(ic(e, 0, 255), 0.5, 1e-12, "table follows range / polarity / depth (depth baked in: no Live parameter)");
            e.run(`MM.updateMapping(${ms[0].id}, { mode: "remote", min: 0.1 })`);
            eq(e.run("MM.allMappings()[0].mode"), "mod", "Remote is refused for an internal route");
            // duplicates and the other accepted targets
            learnOwn("M2 A"); eq(e.mapsOf().length, 1, "the same target twice is a duplicate");
            e.run("MM.disarmLearn()");
            e.sel("live_set tracks 0 devices 0 parameters 1");
            learnOwn("M2 Shape"); e.sel("live_set tracks 0 devices 0 parameters 1");
            learnOwn("M2 On"); e.sel("live_set tracks 0 devices 0 parameters 1");
            learnOwn("M2 Bipolar");
            eq(e.mapsOf().length, 4, "Shape, On and a Bipolar switch are targets too");
            deq(e.mapsOf().map((m) => m.target.selfDest), [6, 96 + 6, 11, 104], "dest codes 6 / 102 / 11 / 104");
            deq([0, 1, 2, 3].map((r) => ib(e, 4 * r + 1, 1)[0]), [6, 102, 11, 104], "...in the matrix");
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 4, "count 4");
            eq(e.run("MM.addMapping(0, { internal: true, selfDest: 6, paramName: 'M2 A' })"), null, "addMapping never creates an internal target (addSelfMapping does)");
            eq(e.run("MM.addMapping(0, { path: 'live_set master_track devices 0 parameters 2', paramName: 'Foo' })"), null, "a normal mapping on the device's own non-pool parameter is refused");
            // disabling the source / the mapping switches the route off (src 0)
            e.run("MM.setParam(0, 'enabled', 0)");
            eq(ib(e, 0, 1)[0], 0, "source disabled: route off (no stale table read)");
            e.run("MM.setParam(0, 'enabled', 1)");
            eq(ib(e, 0, 1)[0], 1, "...and back on");
            e.run(`MM.updateMapping(${ms[0].id}, { enabled: 0 })`);
            eq(ib(e, 0, 1)[0], 0, "mapping disabled: route off");
            // delete releases the route; count follows
            e.run(`MM.deleteMapping(${e.mapsOf()[3].id})`);
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 3, "deleting the last route lowers the count");
            e.run("MM.undo()");
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 4, "undo restores it");
            deq(ib(e, 12, 2), [1, 104], "...on its route");
        }

        // ---- the internal route cap: the 65th route fires "full" (id -1) and uses no Live pool slot
        {
            const e = bootS();
            e.addLfos(16);
            e.run("globalThis.__full = []; MM.on('change', function (ev) { if (ev.kind === 'full') __full.push(ev.id); })");
            let made = 0;
            for (let s = 0; s < 16; s++) for (const c of [0, 1, 2, 3]) {
                const dest = C.selfDestFor("ctl", (s + 1) % 16, c);
                if (e.run(`MM.addSelfMapping(${s}, ${dest}, "internal")`)) made++;
            }
            eq(made, 64, "64 internal routes fit");
            eq(e.run("MM.internalCapacity().free"), 0, "internal capacity exhausted");
            eq(e.run(`MM.addSelfMapping(0, ${C.selfDestFor("ctl", 5, 2)}, "internal")`), null, "route 65 is refused");
            deq(e.run("__full"), [-1], 'change kind "full" with id -1 (the internal matrix)');
            eq(e.run("MM.mappingCapacity().used"), 0, "no pool slot was consumed");
            ok(e.run(`MM.addSelfMapping(0, ${C.selfDestFor("ctl", 5, 2)}, "live")`), "VIA LIVE still works when the matrix is full");
            const res = e.run('MM.setSelfMod("internal")');
            eq(res.converted, 0, "converting to INTERNAL with a full matrix converts nothing");
            eq(e.run("MM.allMappings().filter((m) => !m.target.internal).length"), 1, "...the via-Live mapping is left as it was");
            eq(e.run("MM.getSettings().selfMod"), "internal", "(the selector still changes)");
        }

        // ---- VIA LIVE: a normal pool mapping on the device's own parameter; the modulated output reaches the engine only
        {
            const e = bootS();
            e.addLfos(2);
            e.run('MM.setSelfMod("live")');
            eq(e.run("MM.getSettings().selfMod"), "live", "selector VIA LIVE");
            e.run("MM.armLearn(0, false)"); e.selOwn("M2 A");
            const ms = e.mapsOf();
            eq(ms.length, 1, "learn creates one mapping");
            ok(!ms[0].target.internal && ms[0].target.selfDest === 6 && ms[0].target.paramName === "M2 A", "a normal target on the device's own parameter M2 A");
            eq(e.run(`MM.mappingSlot(${ms[0].id})`), 0, "it takes pool slot 0");
            eq(e.bufs["---megamodroute"].data[0], 0, "route[0] = source modulator 0");
            eq(e.run("MM.internalCapacity().used"), 0, "no internal route");
            eq(e.run("MM.selfLabel(MM.allMappings()[0])"), "LFO 2 Rate (M2 A)", "named by meaning, with the Live parameter in brackets");
            eq(e.run("MM._test.bound()[0].mod"), e.lom.idOf(e.ownPath("M2 A")), "live.modulate~ is bound to the device's OWN parameter id");
            eq(e.run("MM.mappingStatus(MM.allMappings()[0].id)"), "ok", "status ok");
            e.run(`MM.updateMapping(${ms[0].id}, { mode: "remote" })`);
            eq(e.run("MM._test.bound()[0].rem"), e.lom.idOf(e.ownPath("M2 A")), "Remote is allowed through Live (live.remote~ bound)");
            e.run(`MM.updateMapping(${ms[0].id}, { mode: "mod" })`);
            // the modulated output of the parameter: the engine's cfg changes, the model, undo, dirty state do not
            const cfg = e.bufs["---megamodcfg"].data;
            const i = 1 * C.CFG_STRIDE + C.CF_RATE;
            e.run("MM.setParam(1, 'rate', 4)");
            near(cfg[i], 4, 1e-9, "stored rate in the engine");
            deq(e.run("MM.viaDests()"), [6], "dest 6 is tracked as modulated");
            const undoN = e.run("MM.undoInfo().undo"), notify0 = e.log.notify;
            const modulated = 100 * C.autoNorm("rate", 8);
            e.ctx.autop(6, modulated);
            near(cfg[i], 8, 1e-6, "the modulated output (8 Hz) drives the engine's cfg");
            near(e.run("MM.state.mods[1].p.rate"), 4, 1e-12, "...but NOT the model's stored value");
            eq(e.run("MM.undoInfo().undo"), undoN, "no undo entry"); eq(e.log.notify, notify0, "no dirty state");
            e.run("MM.setParam(1, 'phase', 0.25)"); // rewrites the whole cfg slot: the modulated value stays
            near(cfg[i], 8, 1e-6, "rewriting the slot's cfg keeps the modulated value");
            // the stored value is read from the LOM (value): a real change of it reaches the model
            const store = {};
            e.ctx.LiveAPI.prototype.get = function (k) { return k === "value" ? [store[this.cur]] : (k === "name" && this.n ? [this.n.name] : []); };
            store[e.ownPath("M2 A")] = 100 * C.autoNorm("rate", 4);
            e.run("MM._viaStoredRead()");
            near(e.run("MM.state.mods[1].p.rate"), 4, 1e-9, "an unchanged stored value changes nothing");
            store[e.ownPath("M2 A")] = 100 * C.autoNorm("rate", 6);
            e.run("MM._viaStoredRead()");
            near(e.run("MM.state.mods[1].p.rate"), 6, 1e-6, "a changed stored value (face drag / automation) reaches the model");
            // stopping the modulation restores the engine from the model
            e.ctx.autop(6, modulated);
            near(cfg[i], 8, 1e-6, "modulated again");
            e.run(`MM.deleteMapping(${ms[0].id})`);
            near(cfg[i], 6, 1e-6, "deleting the mapping restores the stored value in the engine");
            deq(e.run("MM.viaDests()"), [], "nothing is tracked any more");
            e.ctx.autop(6, 100 * C.autoNorm("rate", 3));
            near(e.run("MM.state.mods[1].p.rate"), 3, 1e-6, "an unmodulated parameter follows Live as usual (automation path)");
            // Depth of a mapping through Live: the router's base-depth cell is the modulated target
            e.run("MM.addMapping(1, { path: 'live_set tracks 1 devices 1 parameters 0', paramName: 'Freq', trackName: 'Bass', deviceName: 'Auto Filter', id: 777 })");
            const mapX = e.mapsOf().filter((m) => m.mod === 1)[0];
            const dslot = e.run(`MM.mappingSlot(${mapX.id})`);
            e.run(`MM.addSelfMapping(0, ${C.selfDestFor("depth", -1, dslot)}, "live")`);
            ok(e.run("MM.viaDests()").indexOf(192 + dslot) >= 0, "the Depth of the mapped parameter is a modulated destination");
            e.ctx.autod(dslot, 20);
            near(e.bufs["---megamodroute"].data[C.ROUTE_DEPTH_BASE + dslot], 0.2, 1e-9, "Depth output goes to the router's depth cell");
            near(e.run(`MM.getMapping(${mapX.id}).depth`), 1, 1e-12, "...not into the model");
        }

        // ---- converting existing self-mappings when the selector changes; undo / redo
        {
            const e = bootS();
            e.addLfos(3);
            e.run('MM.addSelfMapping(0, 6, "internal"); MM.addSelfMapping(0, 12, "internal")');
            const id1 = e.mapsOf()[0].id;
            e.run(`MM.updateMapping(${id1}, { range: 0.3, polarity: -1, depth: 0.6, shape: curveToShape(CURVE_EXP, 0.5, 4) })`);
            const snap = JSON.parse(JSON.stringify(e.mapsOf()));
            const r1 = e.run('MM.setSelfMod("live")');
            deq([r1.from, r1.to, r1.converted], ["internal", "live", 2], "selector -> VIA LIVE converts both internal self-mappings");
            const conv = e.mapsOf();
            ok(conv.every((m) => !m.target.internal && m.target.selfDest !== undefined && m.mode === "mod"), "...to normal pool mappings (Mod)");
            deq(conv.map((m) => m.id), snap.map((m) => m.id), "ids are kept");
            const c1 = conv[0];
            near(c1.range, 0.3, 1e-12, "range kept"); near(c1.depth, 0.6, 1e-12, "depth kept"); eq(c1.polarity, -1, "polarity kept");
            deq(c1.shape, snap[0].shape, "shape kept");
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 0, "the matrix is empty again");
            eq(e.run("MM.mappingCapacity().used"), 2, "two pool slots used");
            eq(e.bufs["---megamodroute"].data[0], 0, "the pool route is on");
            eq(e.run("MM.undoInfo().kind"), "conv", "the conversion is one undo step");
            const back = e.run("MM.undo()");
            eq(back.kind, "conv", "undo reports a conversion");
            deq(e.mapsOf(), snap, "undo restores both mappings exactly (internal targets, ranges, shapes)");
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 2, "...and the matrix routes");
            eq(e.run("MM.mappingCapacity().used"), 0, "...and frees the pool slots");
            e.run("MM.redo()");
            ok(e.mapsOf().every((m) => !m.target.internal), "redo converts again");
            e.run("MM.undo()");
            // VIA LIVE -> INTERNAL: Remote becomes the closest Mod (same span, same direction)
            e.run('MM.setSelfMod("live")');
            const idsLive = e.mapsOf().map((m) => m.id);
            e.run(`MM.updateMapping(${idsLive[0]}, { mode: "remote", min: 0.2, max: 0.8, depth: 0.5 })`);
            e.run(`MM.updateMapping(${idsLive[1]}, { mode: "remote", min: 0.9, max: 0.3 })`);
            const r2 = e.run('MM.setSelfMod("internal")');
            eq(r2.converted, 2, "selector -> INTERNAL converts both");
            const ci = e.mapsOf();
            ok(ci.every((m) => m.target.internal && m.mode === "mod"), "internal and Mod");
            eq(ci[0].polarity, 1, "Remote 0.2..0.8 -> '+'"); near(ci[0].range, 0.6, 1e-12, "...range = the span"); near(ci[0].depth, 0.5, 1e-12, "...depth kept");
            eq(ci[1].polarity, -1, "inverted Remote 0.9..0.3 -> '-'"); near(ci[1].range, 0.6, 1e-12, "...range = the span");
            e.run("MM.undo()");
            const ru = e.mapsOf();
            ok(ru.every((m) => !m.target.internal) && ru[0].mode === "remote" && ru[0].min === 0.2 && ru[1].min === 0.9, "undo gives the Remote mappings back");
            // no conversion when there is nothing to convert; a change without self-mappings of the other kind is just the selector
            e.run("MM.deleteMapping(" + ru[0].id + "); MM.deleteMapping(" + ru[1].id + ")");
            const r3 = e.run('MM.setSelfMod("internal")');
            eq(r3.converted, 0, "nothing to convert");
            eq(e.run("MM.getSettings().selfMod"), "internal", "selector set");
            // normal mappings are never converted
            e.run("MM.addMapping(0, { path: 'live_set tracks 0 devices 0 parameters 1', paramName: 'Dry/Wet', id: 5 })");
            e.run('MM.setSelfMod("live")');
            ok(e.mapsOf().length === 1 && !C.isSelfMapping(e.mapsOf()[0]), "ordinary mappings are untouched by the selector");
        }

        // ---- deleting a modulator takes its self-mappings (as source AND as target) with it; undo restores all
        {
            const e = bootS();
            e.addLfos(3);
            e.run('MM.addSelfMapping(0, 6, "internal")');     // LFO 1 -> LFO 2 Rate
            e.run('MM.addSelfMapping(1, 12, "internal")');    // LFO 2 -> LFO 3 Rate
            e.run('MM.addSelfMapping(2, 0, "live")');          // LFO 3 -> LFO 1 Rate via Live
            e.run("MM.addMapping(1, { path: 'live_set tracks 1 devices 1 parameters 0', paramName: 'Freq', trackName: 'Bass', deviceName: 'Auto Filter', id: 11 })");
            eq(e.mapsOf().length, 4, "4 mappings");
            const before = JSON.parse(JSON.stringify(e.mapsOf()));
            e.run("MM.removeModulator(1)"); // LFO 2: source of two mappings, target of one
            deq(e.mapsOf().map((m) => m.target.selfDest), [0], "only LFO 3 -> LFO 1 Rate remains (sourced by / targeting LFO 2 are gone)");
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 0, "the internal routes are released");
            e.run("MM.undo()");
            deq(e.mapsOf(), before, "undo restores all four mappings in their original order");
            eq(ib(e, C.INT_COUNT_AT, 1)[0], 2, "...with their internal routes");
            // undo into a different slot re-aims the self-mappings that targeted it
            e.run("MM.removeModulator(1)");
            e.run("MM.addModulator(MOD_ENV, 1)"); // the slot is taken meanwhile
            e.run("MM.undo()");
            const slotBack = e.run("MM.state.mods.findIndex((m, i) => m && m.name === 'LFO 2')");
            ok(slotBack >= 0 && slotBack !== 1, "the modulator returned to another free slot " + slotBack);
            const dests = e.mapsOf().filter((m) => C.isSelfMapping(m)).map((m) => C.selfDestInfo(C.selfDestOf(m)));
            ok(dests.some((d) => d.kind === "ctl" && d.slot === slotBack), "the self-mapping that targeted it follows to slot " + slotBack);
            eq(e.mapsOf().filter((m) => m.mod === slotBack).length, 2, "the mappings it sourced follow it");
        }

        // ---- changing a modulator's type: self-mappings whose control the new type lacks become MISSING and revive on the way back
        {
            const e = bootS();
            e.addLfos(2);
            e.run("MM.addSelfMapping(0, " + C.selfDestFor("ctl", 1, 4) + ', "internal")');          // LFO 2 control E (LFO has none)
            e.run("MM.addSelfMapping(0, " + C.selfDestFor("ctl", 1, 3) + ', "internal")');          // D (Phase)
            e.run("MM.addSelfMapping(0, " + C.selfDestFor("sw", 1, 1) + ', "internal")');           // Sync switch
            const st = () => e.mapsOf().map((m) => e.run(`MM.mappingStatus(${m.id})`));
            deq(st(), ["missing", "ok", "ok"], "LFO has no E: that route is missing from the start, Phase and Sync are fine");
            deq([0, 1, 2].map((r) => ib(e, 4 * r, 1)[0]), [0, 1, 1], "a missing route is off in the matrix");
            e.run("MM.setModType(1, MOD_ENV)");
            deq(st(), ["missing", "ok", "missing"], "Envelope: D (Gain) kept, Sync has no meaning -> missing");
            deq([0, 1, 2].map((r) => ib(e, 4 * r, 1)[0]), [0, 1, 0], "...off in the matrix");
            e.run("MM.setModType(1, MOD_RANDOM)");
            deq(st(), ["ok", "ok", "ok"], "Random has E (Seed) and Sync: all revive");
            deq([0, 1, 2].map((r) => ib(e, 4 * r, 1)[0]), [1, 1, 1], "...and are on again");
            // a via-Live row is missing too: its route is off, no Live id bound
            e.run("MM.setSelfMod('live')");
            e.run("MM.setModType(1, MOD_ENV)");
            const lv = e.mapsOf();
            deq(lv.map((m) => e.run(`MM.mappingStatus(${m.id})`)), ["missing", "ok", "missing"], "via Live: same rule");
            eq(e.bufs["---megamodroute"].data[2 * e.run(`MM.mappingSlot(${lv[2].id})`)], -1, "...and its pool route is off");
        }

        // ---- save / load: both kinds round-trip into a new instance
        {
            const a = bootS();
            a.addLfos(2);
            a.run('MM.addSelfMapping(0, 6, "internal"); MM.addSelfMapping(0, 7, "live")');
            a.run("MM.updateMapping(MM.allMappings()[1].id, { mode: \"remote\", min: 0.1, max: 0.9 })");
            const blob = a.run("MM.save()");
            const b = bootS({ beforeReady: (x) => { x.ctx.setvalueof(blob); } });
            const mb = b.mapsOf();
            eq(mb.length, 2, "two mappings after load");
            ok(mb[0].target.internal && mb[0].target.selfDest === 6, "the internal one is still internal");
            ok(!mb[1].target.internal && mb[1].target.selfDest === 7 && mb[1].mode === "remote" && mb[1].min === 0.1, "the via-Live one is still via Live (Remote)");
            deq(ib(b, 0, 2), [1, 6], "the matrix is rebuilt on load");
            eq(ib(b, C.INT_COUNT_AT, 1)[0], 1, "...with its count");
            eq(b.run("MM.mappingSlot(" + mb[1].id + ")"), a.run("MM.mappingSlot(" + mb[1].id + ")"), "the via-Live mapping keeps its pool slot");
            eq(b.run("MM._test.bound()[" + b.run("MM.mappingSlot(" + mb[1].id + ")") + "].rem"), b.lom.idOf(b.ownPath("M2 B")), "...and is bound to the device's own M2 B");
        }

        // ---- telemetry: the effective (modulated) values written by the engine reach tel.eff / tel.depth
        {
            const e = bootS();
            e.run("MM.readTelemetry()"); // (creates the scope buffer)
            const sc = e.bufs["---megamodscope"].data;
            for (let j = 0; j < 5; j++) sc[C.SCOPE_EFF + 12 * 3 + j] = 0.1 * (j + 1);
            sc[C.SCOPE_EFF + 12 * 3 + 5] = 1; sc[C.SCOPE_EFF + 12 * 3 + 6] = 3; sc[C.SCOPE_EFF + 12 * 3 + 8] = 1;
            sc[C.SCOPE_DEPTH + 9] = 0.37;
            const t = e.run("MM.readTelemetry()");
            deq(t.eff[3].ctl.map((v) => Math.round(v * 10) / 10), [0.1, 0.2, 0.3, 0.4, 0.5], "tel.eff[slot].ctl = normalized A..E");
            eq(t.eff[3].on, 1, "tel.eff.on"); deq([t.eff[3].sw[0], t.eff[3].sw[2]], [3, 1], "tel.eff.sw = the switches (shape 3, bipolar 1)");
            near(t.depth[9], 0.37, 1e-6, "tel.depth[k]");
        }

        // ---- DEPTH-MODULATION ROUTES (schema 10): a modulator modulating the Depth of another mapping, followed by mapping id
        {
            const addMap = (e, mod, k) => e.run(`MM.addMapping(${mod}, { path: 'live_set tracks 0 devices 0 parameters ${k + 1}', paramName: 'P${k}', trackName: 'Drums', deviceName: 'Reverb', id: ${3000 + k} })`);
            const routes = (e) => e.run("MM.allMappings()").filter((m) => C.isDepthRoute(m));
            const slotOfId = (e, id) => e.run(`MM.mappingSlot(${id})`);
            const route = (e, r) => ib(e, 4 * r, 2); // [src + 1, dest]
            // -- model, no pool slot, engine matrix
            {
                const e = bootS(); e.addLfos(3);
                const m = addMap(e, 0, 0);
                const r = e.run(`MM.addDepthRoute(1, ${m.id})`);
                ok(r && C.isDepthRoute(r) && r.target.internal === true && r.target.kind === "depth" && r.target.mapId === m.id, "addDepthRoute: target {internal, kind: depth, mapId}");
                eq(r.mode, "mod", "a depth route is Mod only"); eq(e.run("MM.mappingCapacity().used"), 1, "no pool slot is used by the route");
                eq(e.run("MM.internalCapacity().used"), 1, "one internal route is used"); eq(e.run(`MM.mappingSlot(${r.id})`), -1, "no Live pool slot");
                eq(e.run(`MM.mappingStatus(${r.id})`), "ok", "status ok"); ok(!C.isSelfMapping(r), "a depth route is not a self-mapping (the selector never converts it)");
                deq(route(e, 0), [2, 192 + slotOfId(e, m.id)], "matrix route = [source + 1, 192 + the pool slot of the mapping]");
                eq(e.run(`MM.depthRoutesFor(${m.id})`).length, 1, "depthRoutesFor"); eq(e.run(`MM.depthRouteLabel(MM.getMapping(${r.id}))`), "P0 Depth", "labelled by the mapped parameter");
                near(ic(e, 0, 255), 0.5, 1e-12, "the route's table is its unipolar depth FACTOR m = range * y (0.5 at x = +1)"); near(ic(e, 0, 0), 0, 1e-12, "...and 0 at x = -1 (never negative)");
                eq(e.run(`MM.addDepthRoute(1, ${m.id})`), null, "the same source twice on one mapping is a duplicate");
                eq(e.run(`MM.addDepthRoute(7, ${m.id})`), null, "an empty modulator slot cannot source a route");
                eq(e.run("MM.addDepthRoute(1, 9999)"), null, "an unknown mapping is refused");
                eq(e.run(`MM.addDepthRoute(2, ${r.id})`), null, "a route cannot target a depth route (no router stage)");
                const own = e.run(`MM.addDepthRoute(0, ${m.id})`);
                ok(own && own.mod === 0, "self-loop decision: the mapping's OWN modulator may modulate its depth (tremolo of self; no feedback, the router output never feeds the engine)");
                eq(ib(e, C.INT_COUNT_AT, 1)[0], 2, "count 2");
                // several routes onto one mapping share the destination (the engine sums them)
                const r3 = e.run(`MM.addDepthRoute(2, ${m.id})`);
                ok(r3, "a third source"); const d = [0, 1, 2].map((q) => route(e, q)[1]);
                ok(d[0] === d[1] && d[1] === d[2], "three routes, one destination (they sum in the engine)");
                near(C.effectiveDepth(1, [3, 0.5]), 1, 1e-12, "effective depth clamps at +1"); near(C.effectiveDepth(0.5, [-4, 1]), 0, 1e-12, "...and never below 0 (no inversion)");
                near(C.effectiveDepth(0.5, [0.2, 0.1, 0.5]), 0.5 * 0.2 * 0.1 * 0.5, 1e-12, "the factors MULTIPLY");
                // editing a route edits the usual fields
                e.run(`MM.updateMapping(${r.id}, { polarity: -1, range: 0.4, enabled: 0 })`);
                deq(route(e, 0), [0, d[0]], "a disabled route is off"); e.run(`MM.updateMapping(${r.id}, { enabled: 1, polarity: -1, range: 0.4 })`);
                near(ic(e, 0, 255), 0.4, 1e-12, "stored polarity - is ignored: range 0.4 -> the factor table's end is +0.4, never negative"); near(ic(e, 0, 0), 0, 1e-12, "...and its start 0"); eq(e.run(`MM.getMapping(${r.id}).mode`), "mod", "stays Mod");
            }
            // -- it works for pool slots >= 64 (the depth multiplier covers every slot)
            {
                const e = bootS(); e.addLfos(2);
                for (let k = 0; k < 70; k++) addMap(e, 0, k);
                const m69 = e.run("MM.allMappings()[69]"); eq(slotOfId(e, m69.id), 69, "mapping 70 sits in slot 69");
                const r = e.run(`MM.addDepthRoute(1, ${m69.id})`); ok(r, "a route onto a slot >= 64 mapping");
                deq(route(e, 0), [2, 192 + 69], "destination 192 + 69 = 261");
                e.run(`MM.updateMapping(${m69.id}, { depth: 0.6 })`);
                near(e.bufs["---megamodroute"].data[C.ROUTE_DEPTH_BASE + 69], 0.6, 1e-6, "the base depth cell of slot 69 follows the mapping");
                e.run("MM.readTelemetry()"); const sc = e.bufs["---megamodscope"].data; sc[C.SCOPE_DEPTH + 69] = 0.33;
                near(e.run(`MM.readTelemetry().depth[69]`), 0.33, 1e-6, "telemetry reads the effective depth of slot 69"); eq(e.run("MM.readTelemetry().depth.length"), 256, "telemetry holds 256 depths");
                near(e.run(`MM.effectiveDepth(${m69.id})`), 0.33, 1e-6, "MM.effectiveDepth reads it for a modulated mapping");
            }
            // -- REMOTE mapping + depth route (reported in Live: Remote 0..1 + a +-15 % depth route looked pinned at min): the router cells of the
            // mapping's slot ([2k] source, [2k+1] effective, [512+k] base, [768+k] Remote centre = (min + max) / 2) for slots < 64 and >= 64, with the route, with a
            // changed base depth, and after a reload from the saved blob
            {
                const REAL = "{ path: 'live_set tracks 1 devices 1 parameters 0', paramName: 'Freq', trackName: 'Bass', deviceName: 'Auto Filter', id: 4000 }";
                const cells = (e, k) => { const d = e.bufs["---megamodroute"].data; return [d[2 * k], d[2 * k + 1], d[C.ROUTE_DEPTH_BASE + k], d[C.ROUTE_DEPTH_MIN + k]].map((v) => Math.round(v * 1e6) / 1e6); };
                for (const pad of [0, 70]) {
                    const tag = `Remote + route, ${pad ? "slot >= 64" : "slot < 64"}`;
                    const e = bootS(); e.addLfos(2);
                    for (let k = 0; k < pad; k++) addMap(e, 0, 100 + k);
                    const m = e.run(`MM.addMapping(0, ${REAL})`);
                    e.run(`MM.updateMapping(${m.id}, { mode: 'remote', min: 0, max: 1, depth: 1 })`);
                    const k = slotOfId(e, m.id);
                    eq(k, pad, `${tag}: pool slot ${pad}`);
                    deq(cells(e, k), [0, 1, 1, 0.5], `${tag}: cells [source 0, effective 1, base 1, Remote centre 0.5]`);
                    near(e.bufs["---mmcurve"].data[k * C.CURVE_REGION + 255], 1, 1e-9, `${tag}: the table is baked at depth 1 (linear 0..1)`);
                    const r = e.run(`MM.addDepthRoute(1, ${m.id})`);
                    e.run(`MM.updateMapping(${r.id}, { polarity: 0, range: 0.15 })`);
                    deq(route(e, 0), [2, 192 + k], `${tag}: matrix route [LFO 2, 192 + slot]`);
                    near(ic(e, 0, 255), 0.15, 1e-9, `${tag}: the route's factor table ends at 0.15 (unipolar, range 15 %: m = 0.15 y)`); near(ic(e, 0, 0), 0, 1e-9, `${tag}: ...and starts at 0 (never negative)`);
                    deq(cells(e, k), [0, 1, 1, 0.5], `${tag}: adding the route leaves source / base / Remote centre alone (the engine writes the effective depth)`);
                    // the engine's math on these cells (JS reference of the router + matrix): Remote out = c + (lookup - c) * clip(base * prod m), c = the centre cell
                    const outAt = (x, xb, rt) => { const c = cells(e, k); const y = C.mappingOutput(Object.assign({}, m, { mode: "remote", min: 0, max: 1, depth: 1 }), x); const d = C.effectiveDepth(c[2], [C.depthFactor(rt, xb)]); return c[3] < -0.5 ? y * d : c[3] + (y - c[3]) * d; };
                    near(outAt(1, 1, r), 0.575, 1e-9, `${tag}: Remote top at x = +1 with the route at its top (m = 0.15)`); near(outAt(1, -1, r), 0.5, 1e-9, `${tag}: ...back to the centre 0.5 at the route's bottom (m = 0, never inverted)`); near(outAt(0, -1, r), 0.5, 1e-9, `${tag}: the centre (x = 0) stays at 0.5`);
                    // a full-range route (m = (B+1)/2): B at its minimum -> depth 0 -> the output sits at the centre 0.5; B at its maximum -> the full sweep; never inverted
                    e.run(`MM.updateMapping(${r.id}, { polarity: 1, range: 1 })`);
                    const full = e.run(`MM.getMapping(${r.id})`);
                    for (const x of [-1, -0.4, 0, 0.8, 1]) {
                        near(outAt(x, 0, full), 0.5 + ((x + 1) / 2 - 0.5) * 0.5, 1e-9, `${tag}: full-range route, B = 0: half depth (x ${x})`);
                        near(outAt(x, 1, full), (x + 1) / 2, 1e-9, `${tag}: B = +1: the full sweep (x ${x})`);
                        near(outAt(x, -1, full), 0.5, 1e-9, `${tag}: B at its minimum: depth 0, centred, NOT inverted (x ${x})`);
                    }
                    near(ic(e, 0, 255), 1, 1e-9, `${tag}: full-range route factor table ends at +1`); near(ic(e, 0, 0), 0, 1e-9, `${tag}: ...starts at 0`); near(ic(e, 0, 128), 0.5, 1e-2, `${tag}: ...and is 0.5 at B = 0`);
                    e.run(`MM.updateMapping(${r.id}, { polarity: 0, range: 0.15 })`);
                    e.run(`MM.updateMapping(${m.id}, { depth: 0.8 })`);
                    deq(cells(e, k), [0, 1, 0.8, 0.5], `${tag}: base depth 0.8 reaches the base cell, the centre stays 0.5`);
                    e.run(`MM.updateMapping(${m.id}, { min: 0.2, max: 0.9 })`);
                    near(cells(e, k)[3], 0.55, 1e-6, `${tag}: the Remote centre cell follows the mapping's (min + max) / 2`);
                    e.run(`MM.updateMapping(${m.id}, { min: 0, max: 1, depth: 1 })`);
                    // reload from the saved blob
                    const blob = e.run("MM.save()");
                    const e2 = bootS(); e2.addLfos(2); e2.ctx.setvalueof(blob);
                    const k2 = e2.run(`MM.mappingSlot(${m.id})`);
                    eq(k2, k, `${tag}: reload keeps the slot`); eq(e2.run(`MM.mappingStatus(${m.id})`), "ok", `${tag}: reload resolves the target`);
                    deq(cells(e2, k2), [0, 1, 1, 0.5], `${tag}: after a reload the cells are source 0, effective 1, base 1, centre 0.5`);
                    ok(ib(e2, 0, 40).some((v, i) => i % 4 === 1 && v === 192 + k2), `${tag}: after a reload the route aims at 192 + the slot`);
                    near(e2.bufs["---mmcurve"].data[k2 * C.CURVE_REGION + 255], 1, 1e-9, `${tag}: after a reload the table is still baked at depth 1`);
                }
            }
            // -- refusals: internal targets; deleting the target / the source modulator
            {
                const e = bootS(); e.addLfos(3);
                const a = addMap(e, 0, 0), b = addMap(e, 1, 1);
                const self = e.run(`MM.addSelfMapping(0, ${C.selfDestFor("ctl", 2, 0)}, "internal")`);
                eq(e.run(`MM.addDepthRoute(1, ${self.id})`), null, "an INTERNAL mapping has no router stage: no depth route on it");
                const r1 = e.run(`MM.addDepthRoute(1, ${a.id})`), r2 = e.run(`MM.addDepthRoute(2, ${a.id})`), r3 = e.run(`MM.addDepthRoute(0, ${b.id})`);
                const ids = () => e.run("MM.allMappings()").map((m) => m.id).join(",");
                const before = ids(), cnt = e.run("MM.internalCapacity().used");
                e.run(`MM.deleteMapping(${a.id})`);
                ok(!ids().includes(String(r1.id)) && !ids().includes(String(r2.id)) && ids().includes(String(r3.id)), "deleting the target mapping deletes its depth routes (and only those)");
                eq(e.run("MM.internalCapacity().used"), cnt - 2, "...and frees their matrix routes");
                e.run("MM.undo()"); eq(ids(), before, "undo restores the mapping and its routes in the old list order (one step)");
                deq(route(e, e.run(`MM.allMappings()`).findIndex((m) => m.id === r1.id) >= 0 ? 1 : 0).length, 2, "...and they are routed again");
                e.run("MM.redo()"); ok(!ids().includes(String(r1.id)), "redo deletes them again"); e.run("MM.undo()");
                // deleting the SOURCE modulator deletes its routes
                e.run("MM.removeModulator(2)");
                ok(!ids().includes(String(r2.id)) && ids().includes(String(r1.id)), "deleting the source modulator deletes its routes");
                e.run("MM.undo()"); ok(ids().includes(String(r2.id)), "undo restores them");
                // deleting the modulator that SOURCES the target mapping deletes the routes of every other modulator onto it
                e.run("MM.removeModulator(0)");
                ok(!ids().includes(String(a.id)) && !ids().includes(String(r1.id)) && !ids().includes(String(r2.id)) && !ids().includes(String(r3.id)), "deleting the modulator that owns the target mapping removes the routes aimed at it too");
                e.run("MM.undo()"); eq(ids(), before, "undo brings everything back");
                const slotA = slotOfId(e, a.id);
                for (const q of e.run("MM.depthRoutesFor(" + a.id + ")")) { const ri = e.run("MM.allMappings()").findIndex((m) => m.id === q.id); ok(ri >= 0, "route restored"); }
                ok(e.run(`MM.depthRoutesFor(${a.id})`).every((q) => ib(e, 0, 40).some((v, i) => i % 4 === 1 && v === 192 + slotA)), "restored routes aim at the restored slot");
            }
            // -- the route follows the mapping across a slot change (undo into another slot) and a reload
            {
                const e = bootS(); e.addLfos(2);
                const a = addMap(e, 0, 0); addMap(e, 0, 1);
                const r = e.run(`MM.addDepthRoute(1, ${a.id})`);
                eq(slotOfId(e, a.id), 0, "slot 0"); e.run(`MM.deleteMapping(${a.id})`);
                const x = addMap(e, 0, 5); eq(slotOfId(e, x.id), 0, "the freed slot 0 is reused by a new mapping");
                e.run("MM.undo()");
                const ns = slotOfId(e, a.id); ok(ns > 0, `undo restores the mapping into another slot (${ns})`);
                const ri = e.run("MM.allMappings()").findIndex((m) => m.id === r.id);
                ok(ri >= 0, "the route came back"); deq(ib(e, 4 * 2, 2).concat(ib(e, 4 * 1, 2)).concat(ib(e, 0, 2)).filter((v) => v === 192 + ns).length, 1, "its destination is the NEW slot (192 + " + ns + ")");
                // reload from the saved blob: routes follow the mapping by id, also when the blob says another slot
                const blob = e.run("MM.save()");
                const e2 = bootS(); e2.addLfos(2); e2.ctx.setvalueof(blob);
                const a2 = e2.run("MM.allMappings()").find((m) => m.id === a.id), rr = e2.run("MM.allMappings()").find((m) => C.isDepthRoute(m));
                ok(a2 && rr && rr.target.mapId === a.id, "reload keeps the route and its mapId"); eq(e2.run(`MM.mappingSlot(${a.id})`), ns, "the mapping keeps its slot");
                const rIdx = e2.run("MM.allMappings()").filter((m) => !m.target.internal).length;
                deq(Array.from(e2.bufs["---megamodint"].data.slice(0, 40)).filter((v, i) => i % 4 === 1 && v > 0).includes(192 + ns), true, "the reloaded route aims at 192 + the mapping's slot");
                const json = JSON.parse(C.stateToJson(e.run("MM.state") ? JSON.parse(JSON.stringify(e.run("MM.state"))) : null));
                json.mappings.find((m) => m.id === a.id).slot = 9;
                const e3 = bootS(); e3.addLfos(2); e3.ctx.setvalueof(C.serializeState(json));
                eq(e3.run(`MM.mappingSlot(${a.id})`), 9, "a blob that moved the mapping to slot 9...");
                ok(Array.from(e3.bufs["---megamodint"].data.slice(0, 40)).filter((v, i) => i % 4 === 1).includes(192 + 9), "...moves the route's destination to 192 + 9"); ok(rIdx >= 1, "pool mappings present");
            }
            // -- schema 10 migration: internal self-mappings that targeted `Depth k`
            {
                const s = C.defaultState(); s.schema = 9;
                s.mods[0] = C.makeModSlot(C.MOD_LFO, 0); s.mods[1] = C.makeModSlot(C.MOD_LFO, 1);
                const pm = C.defaultMapping(1, 0, { path: "live_set tracks 0 devices 0 parameters 1", paramName: "Freq" }, "mod"); pm.slot = 7;
                const old = C.defaultMapping(2, 1, C.makeInternalTarget(192 + 7), "mod"); old.slot = 3; old.range = 0.4; old.polarity = -1;
                const dead = C.defaultMapping(3, 1, C.makeInternalTarget(192 + 20), "mod"); dead.slot = 4;
                const via = C.defaultMapping(4, 1, { path: "live_set master_track devices 0 parameters 9", paramName: "Depth 8", selfDest: 192 + 7 }, "mod"); via.slot = 9;
                const other = C.defaultMapping(5, 1, C.makeInternalTarget(6), "mod"); other.slot = 5;
                s.mappings = [pm, old, dead, via, other]; s.nextMapId = 6;
                const n = C.normalizeState(JSON.parse(JSON.stringify(s)));
                eq(n.schema, 10, "migrated state is schema 10");
                const mr = n.mappings.find((m) => m.id === 2);
                ok(mr && C.isDepthRoute(mr) && mr.target.mapId === 1 && mr.range === 0.4 && mr.polarity === -1 && mr.mod === 1, "the internal `Depth 8` self-mapping became a depth route on the mapping in slot 7 (range / polarity / source kept)");
                ok(!n.mappings.some((m) => m.id === 3), "an internal Depth route on an EMPTY slot is dead and dropped");
                const vv = n.mappings.find((m) => m.id === 4); ok(vv && !vv.target.internal && vv.target.selfDest === 199 && C.isSelfMapping(vv), "a VIA LIVE `Depth k` mapping stays as it is");
                const oo = n.mappings.find((m) => m.id === 5); ok(oo && oo.target.internal && oo.target.selfDest === 6, "other internal self-mappings are untouched");
                const back = C.deserializeState(C.serializeState(n)); ok(C.isDepthRoute(back.mappings.find((m) => m.id === 2)) && back.mappings.find((m) => m.id === 2).target.mapId === 1, "round trip");
                // orphans / duplicates are repaired on load
                const bad = JSON.parse(C.stateToJson(n)); bad.mappings.push(JSON.parse(JSON.stringify(mr)), Object.assign(JSON.parse(JSON.stringify(mr)), { id: 9, target: C.makeDepthTarget(99) }));
                eq(C.normalizeState(bad).mappings.filter((m) => C.isDepthRoute(m)).length, 1, "a duplicate id / an orphan route (unknown mapId) is dropped");
            }
            // -- learn / selector interplay
            {
                const e = bootS(); e.addLfos(2);
                const a = addMap(e, 0, 0); const slot = slotOfId(e, a.id);
                e.run("MM.armLearn(1, false)"); e.selOwn(C.autoDepthName(slot));
                const rs = routes(e); eq(rs.length, 1, "INTERNAL learn on `Depth 1` (the mapped slot) creates a depth route");
                ok(rs[0] && rs[0].target.mapId === a.id, "...on that mapping");
                e.run("MM.disarmLearn()"); e.sel("live_set tracks 0 devices 0 parameters 1");
                e.run("MM.armLearn(1, false)"); e.selOwn(C.autoDepthName(30)); eq(routes(e).length, 1, "`Depth 31` has no mapping: refused");
                e.run("MM.disarmLearn()");
                e.run('MM.setSelfMod("live")'); eq(routes(e).length, 1, "the selector never converts a depth route");
                eq(e.run(`MM.addSelfMapping(1, ${C.selfDestFor("depth", -1, slot)}, "live")`).target.selfDest, 192 + slot, "VIA LIVE `Depth k` still makes a pool mapping");
                e.run('MM.setSelfMod("internal")');
                eq(routes(e).length, 1, "converting the VIA LIVE `Depth k` mapping to INTERNAL: the source already routes this mapping, so it is left as it was (duplicate)");
            }
        }
    }

    // ---- 7z. a mapped target is deleted: learn keeps working, mappings of a deleted device / track are removed (AGENTS.md section 21, "Target deleted")
    {
        const deq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); passed++; };
        const P = (t, d, q) => `live_set tracks ${t} devices ${d} parameters ${q}`;
        const mapAt = (e, mod, t, d, q) => e.run(`MM.addMapping(${mod}, { path: '${P(t, d, q)}', paramName: '${e.lom.tree.tracks[t].devices[d].params[q]}', trackName: '${e.lom.tree.tracks[t].name}', deviceName: '${e.lom.tree.tracks[t].devices[d].name}', id: ${e.lom.idOf(P(t, d, q))} })`);
        const mapsNow = (e) => e.run("MM.allMappings()").map((m) => ({ id: m.id, path: m.target.path, st: e.run(`MM.mappingStatus(${m.id})`) }));
        const idBox = (e, slot) => { const g = (n) => { const o = e.pool[n]; return o && o.messages.length ? o.messages[o.messages.length - 1][1] : 0; }; return [g("mm_mid_" + slot), g("mm_rid_" + slot)]; };
        const poll = (e, n) => { for (let i = 0; i < (n === undefined ? 1 : n); i++) e.run("MM._test.validate()"); };
        // two devices in a row on track 1 (Bass): Reverb (0) and Auto Filter (1); deleting the first slides the second into index 0
        const fresh = () => { const e = boot(); e.run("MM.addModulator(MOD_LFO)"); e.run("MM.addModulator(MOD_LFO)"); return e; };
        // an Auto Filter on track 0 as another real target
        const delDevice = (e, t, d) => { const dev = e.lom.tree.tracks[t].devices[d]; for (let q = 0; q < dev.params.length; q++) delete e.lom.ids[P(t, d, q)]; e.lom.tree.tracks[t].devices.splice(d, 1); };

        // ---- the user's bug: map X, delete the device, learn onto another device's parameter
        {
            const e = fresh();
            e.lom.tree.tracks[0].devices.push({ name: "Auto Filter", params: ["Freq", "Res"] }); // Drums: Reverb (0), Auto Filter (1)
            const a = mapAt(e, 0, 1, 1, 0); // X -> Bass / Auto Filter / Freq
            ok(a && e.run(`MM._test.pid(${a.id})`) > 0, "7z: X mapped");
            const slot = e.run(`MM.mappingSlot(${a.id})`);
            deq(idBox(e, slot)[0] > 0, true, "7z: slot bound before the delete");
            // the mapped parameter is the one Live has selected; the device is deleted
            e.sel(P(1, 1, 0));
            delDevice(e, 1, 1);
            poll(e); // poll 1: unresolved, marked missing, nothing deleted yet
            eq(e.run(`MM.mappingStatus(${a.id})`), "missing", "7z: poll 1: the mapping is missing");
            eq(e.run("MM.allMappings().length"), 1, "7z: poll 1: ...but kept (two polls needed)");
            poll(e); // poll 2: confirmed -> deleted
            eq(e.run("MM.allMappings().length"), 0, "7z: poll 2: the mapping is auto-deleted");
            deq(idBox(e, slot), [0, 0], "7z: its pool slot is unbound (id 0 on both boxes)");
            eq(e.run("MM.mappingSlot(" + a.id + ")"), -1, "7z: and the slot is freed");
            eq(e.run("MM.undoInfo().undo"), 1, "7z: ONE undo entry");
            // learn onto a parameter of another device works (also onto the SAME path a sliding device now has)
            e.run("MM.armLearn(0, false)"); e.sel(P(0, 1, 1));
            eq(e.run("MM.allMappings().length"), 1, "7z: learn after the delete creates a mapping");
            ok(!e.run("MM.learn.armed"), "7z: single-shot learn disarms");
            const b = e.run("MM.allMappings()")[0];
            eq(b.target.path, P(0, 1, 1), "7z: ...on the new target");
            ok(idBox(e, e.run(`MM.mappingSlot(${b.id})`))[0] === e.lom.idOf(P(0, 1, 1)), "7z: ...bound to its Live id");
        }
        // ---- the device after the deleted one has the SAME name and slides into its place: the mapping must not jump onto it
        {
            const e = fresh();
            e.lom.tree.tracks[1].devices = [{ name: "Utility", params: ["Device On", "Balance"] }, { name: "Utility", params: ["Device On", "Balance"] }];
            const a = mapAt(e, 0, 1, 0, 1); // X -> first Utility / Balance
            const idB = e.lom.idOf(P(1, 1, 1));
            delDevice(e, 1, 0);
            e.lom.ids[P(1, 0, 1)] = idB; delete e.lom.ids[P(1, 1, 1)]; // the 2nd Utility keeps its Live ids and slides to index 0
            poll(e);
            eq(e.run(`MM.mappingStatus(${a.id})`), "missing", "7z: same-name neighbour slides in: the mapping does NOT follow it (missing)");
            eq(e.run(`MM._test.pid(${a.id})`), 0, "7z: ...its Live id is dropped");
            poll(e);
            eq(e.run("MM.allMappings().length"), 0, "7z: ...and it is auto-deleted on poll 2");
            e.run("MM.armLearn(0, false)"); e.sel(P(1, 0, 1));
            eq(e.run("MM.allMappings().length"), 1, "7z: learn onto the neighbour (the same path) works");
            eq(e.run(`MM._test.pid(${e.run("MM.allMappings()")[0].id})`), idB, "7z: ...bound to its own id");
        }
        // ---- learn with a dead mapping in the pool: a stale path is no duplicate, a throwing LiveAPI never aborts or half-arms the learn
        {
            const e = fresh();
            const a = mapAt(e, 0, 1, 0, 0); // X -> Bass / Reverb / Dry/Wet (index 0 of track 1)
            // Reverb is deleted, the Auto Filter slides to index 0 (its parameter 0 is "Freq": same path, other device)
            const staleId = e.lom.idOf(P(1, 0, 0));
            delete e.lom.ids[P(1, 0, 0)]; delete e.lom.ids[P(1, 0, 1)];
            e.lom.tree.tracks[1].devices.shift(); delete e.lom.ids[P(1, 1, 0)]; delete e.lom.ids[P(1, 1, 1)];
            const newId = e.lom.idOf(P(1, 0, 0));
            ok(newId !== staleId, "7z: the slid-in parameter is another Live object");
            // (with the old rule the stale path P(1,0,0) made this learn a "duplicate")
            e.run("MM.armLearn(0, false)"); e.sel(P(1, 0, 0));
            ok(e.run("MM.allMappings().length") >= 1 && !e.run("MM.learn.armed"), "7z: the learn is not blocked by the dead mapping with the same stale path");
            ok(e.run("MM.allMappings()").some((m) => m.target.path === P(1, 0, 0) && e.run(`MM._test.pid(${m.id})`) === newId), "7z: a mapping is bound to the new parameter id");
        }
        {
            const e = fresh();
            const a = mapAt(e, 0, 0, 0, 0);
            // a LiveAPI whose "id N" lookups throw for dead ids (like a stale handle) must not stop the poll, the learn or other mappings
            const LA = e.ctx.LiveAPI;
            const deadIds = new Set([e.lom.idOf(P(0, 0, 0))]);
            const origGoto = LA.prototype.goto;
            LA.prototype.goto = function (p) { const m = /^id (\d+)$/.exec(p || ""); if (m && deadIds.has(Number(m[1]))) throw new Error("dead id " + m[1]); return origGoto.call(this, p); };
            const b = mapAt(e, 0, 1, 1, 1);
            delDevice(e, 0, 0);
            poll(e, 3);
            eq(e.run("MM.allMappings().length"), 1, "7z: a throwing LiveAPI on the dead id: the dead mapping is deleted, the other one is untouched");
            eq(e.run(`MM.mappingStatus(${b.id})`), "ok", "7z: ...and still ok");
            e.run("MM.armLearn(1, false)"); e.sel(P(1, 1, 0));
            eq(e.run("MM.mappingsFor(1).length"), 1, "7z: learn after it works");
            // a selection that cannot be described (LiveAPI throws on the id) leaves learn armed and consistent; the next different selection works
            const origNew = e.ctx.LiveAPI;
            e.run("MM.armLearn(1, false)");
            e.ctx.LiveAPI = function (cb, p) { if (/^id /.test(String(p))) throw new Error("boom"); return new origNew(cb, p); };
            e.sel(P(1, 1, 1));
            ok(e.run("MM.learn.armed") && e.run("MM.learn.mod") === 1, "7z: an undescribable selection leaves the learn armed");
            e.ctx.LiveAPI = origNew;
            e.sel(P(1, 0, 1));
            eq(e.run("MM.mappingsFor(1).length"), 2, "7z: ...and the next selection works");
            ok(!e.run("MM.learn.armed"), "7z: ...and disarms (single-shot)");
            // an exception inside the learn (addMapping throws) never leaves a single-shot learn armed, a multi-learn stays armed
            const realAdd = e.ctx.MM.addMapping;
            e.ctx.MM.addMapping = function () { throw new Error("boom"); };
            e.run("MM.armLearn(1, false)"); e.sel(P(1, 1, 0));
            ok(!e.run("MM.learn.armed"), "7z: an exception in the learn handler: single-shot is disarmed, not half armed");
            e.run("MM.armLearn(1, true)"); e.sel(P(1, 1, 1));
            ok(e.run("MM.learn.armed"), "7z: ...a multi-learn stays armed");
            e.ctx.MM.addMapping = realAdd;
            e.sel(P(1, 0, 0));
            ok(e.run("MM.mappingsFor(1).length") >= 3, "7z: ...and works again afterwards (one bad selection never blocks the next)");
            e.run("MM.disarmLearn()");
        }
        // ---- a MOVED device keeps its mapping (same Live id, new path; also onto a track with another name)
        {
            const e = fresh();
            const a = mapAt(e, 0, 1, 1, 0); // Bass / Auto Filter / Freq
            const idF = e.lom.idOf(P(1, 1, 0));
            const dev = e.lom.tree.tracks[1].devices.splice(1, 1)[0];
            e.lom.tree.tracks[0].devices.push(dev); // moved onto Drums, index 1
            for (let q = 0; q < dev.params.length; q++) { const old = P(1, 1, q), nw = P(0, 1, q); e.lom.ids[nw] = e.lom.ids[old]; delete e.lom.ids[old]; }
            poll(e, 4);
            eq(e.run("MM.allMappings().length"), 1, "7z: a moved device keeps its mapping");
            eq(e.run(`MM.mappingStatus(${a.id})`), "ok", "7z: ...status ok");
            eq(e.run("MM.allMappings()[0].target.path"), P(0, 1, 0), "7z: ...re-pointed at the new path");
            eq(e.run("MM.allMappings()[0].target.trackName"), "Drums", "7z: ...and the new track name");
            eq(e.run(`MM._test.pid(${a.id})`), idF, "7z: ...same Live id");
            // moved AND the id changed (found by name): kept too
            const e2 = fresh();
            const a2 = mapAt(e2, 0, 1, 1, 0);
            const d2 = e2.lom.tree.tracks[1].devices.splice(1, 1)[0];
            e2.lom.tree.tracks[1].devices.unshift(d2); // reordered within its track: path changes, the old id is gone
            for (let q = 0; q < 2; q++) delete e2.lom.ids[P(1, 1, q)];
            delete e2.lom.ids[P(1, 0, 0)]; delete e2.lom.ids[P(1, 0, 1)];
            poll(e2, 4);
            eq(e2.run("MM.allMappings().length"), 1, "7z: a reordered device (new id) is found by name and keeps its mapping");
            eq(e2.run(`MM.mappingStatus(${a2.id})`), "ok", "7z: ...status ok");
        }
        // ---- nothing is deleted while the LOM is not healthy / not ready, or for a temporary glitch
        {
            const e = fresh();
            const a = mapAt(e, 0, 1, 1, 0);
            const saved = e.lom.tree.tracks[1].devices.splice(1, 1)[0];
            poll(e); eq(e.run("MM.allMappings().length"), 1, "7z: one unresolved poll deletes nothing");
            e.lom.tree.tracks[1].devices.push(saved); // the device is back
            poll(e, 2);
            eq(e.run(`MM.mappingStatus(${a.id})`), "ok", "7z: a temporary glitch: revived, kept");
            poll(e); e.lom.tree.tracks[1].devices.splice(1, 1); poll(e); poll(e, 0); e.lom.tree.tracks[1].devices.push(saved); poll(e, 1);
            eq(e.run("MM.allMappings().length"), 1, "7z: the miss counter restarts after a revive (non-consecutive misses never delete)");
            // the LOM unhealthy (master track gone, as while a Set loads): many unresolved polls delete nothing
            const m0 = e.lom.tree.master;
            e.lom.tree.tracks[1].devices.splice(1, 1);
            e.lom.tree.master = { name: "x", devices: [] };
            const keepNode = e.lom.node;
            e.ctx.LiveAPI.prototype._set = function () { this.cur = this.p; this.n = null; this.id = "0"; this.unquotedpath = ""; this.path = ""; };
            poll(e, 5);
            eq(e.run("MM.allMappings().length"), 1, "7z: an unhealthy LOM (nothing resolves, no master track) never deletes");
        }
        // ---- a mapping already missing at load is kept (marked missing), however many polls pass; it revives when the device comes back
        {
            const lom = mockLom();
            const e1 = makeEnv(lom); loadScript("", e1);
            const run1 = (c) => vm.runInContext(c, e1.ctx);
            e1.ctx.setnames(...NAMES); e1.ctx.init_lom();
            run1("MM.addModulator(MOD_LFO)");
            run1(`MM.addMapping(0, { path: '${P(1, 1, 0)}', paramName: 'Freq', trackName: 'Bass', deviceName: 'Auto Filter', id: ${lom.idOf(P(1, 1, 0))} })`);
            const saved = e1.ctx.getvalueof();
            const lom2 = mockLom();
            const dev = lom2.tree.tracks[1].devices.splice(1, 1)[0]; // removed while Mega Modulator was not running
            const e2 = makeEnv(lom2); loadScript("", e2);
            e2.ctx.setvalueof(saved); e2.ctx.setnames(...NAMES); e2.ctx.init_lom();
            const run2 = (c) => vm.runInContext(c, e2.ctx);
            const id0 = run2("MM.allMappings()[0].id");
            for (let i = 0; i < 6; i++) run2("MM._test.validate()");
            eq(run2("MM.allMappings().length"), 1, "7z: a mapping missing at load is NOT auto-deleted (polls: 6)");
            eq(run2(`MM.mappingStatus(${id0})`), "missing", "7z: ...it stays marked missing");
            lom2.tree.tracks[1].devices.push(dev);
            run2("MM._test.validate()");
            eq(run2(`MM.mappingStatus(${id0})`), "ok", "7z: ...and revives when the device comes back");
            // now it has been seen live in this session: a later delete IS auto-deleted
            lom2.tree.tracks[1].devices.pop();
            for (let i = 0; i < 3; i++) run2("MM._test.validate()");
            eq(run2("MM.allMappings().length"), 0, "7z: after it was seen live, a later deletion is auto-deleted");
        }
        // ---- a deleted TRACK removes all its mappings as ONE undo step; undo restores them and re-resolves
        {
            const e = fresh();
            const a = mapAt(e, 0, 1, 0, 0), b = mapAt(e, 1, 1, 0, 1), c = mapAt(e, 0, 1, 1, 0), keep = mapAt(e, 1, 0, 0, 0);
            e.run(`MM.addDepthRoute(1, ${a.id})`); // a depth route on a mapping that goes away
            const nBefore = e.run("MM.allMappings().length");
            eq(nBefore, 5, "7z: 4 pool mappings + 1 depth route");
            const slots = [a, b, c].map((m) => e.run(`MM.mappingSlot(${m.id})`));
            const snapTree = JSON.stringify(e.lom.tree.tracks[1]);
            const idsBefore = {}; for (let d = 0; d < 2; d++) for (let q = 0; q < 2; q++) idsBefore[P(1, d, q)] = e.lom.ids[P(1, d, q)];
            const track = e.lom.tree.tracks.splice(1, 1)[0]; // Bass is deleted (nothing is left at index 1)
            for (const k of Object.keys(idsBefore)) delete e.lom.ids[k];
            poll(e, 2);
            const left = e.run("MM.allMappings()");
            eq(left.length, 1, "7z: all of the deleted track's mappings (and the depth route) are gone, the other track's mapping stays");
            eq(left[0].id, keep.id, "7z: ...the survivor is the other one");
            ok(slots.every((s) => idBox(e, s)[0] === 0 && idBox(e, s)[1] === 0), "7z: every slot of theirs is unbound");
            eq(e.run("MM.undoInfo().undo"), 1, "7z: ONE undo entry for the whole batch");
            // Live's own Undo brought the track back (new Live ids): Mega Modulator's undo restores and rebinds to the restored device
            e.lom.tree.tracks.splice(1, 0, track);
            const r = e.run("MM.undo()");
            ok(r && r.kind === "tdel", "7z: undo of the auto-delete");
            eq(e.run("MM.allMappings().length"), nBefore, "7z: undo restores all mappings (with the depth route)");
            const am = e.run("MM.allMappings()").filter((m) => !m.target.internal);
            ok(am.every((m) => e.run(`MM.mappingStatus(${m.id})`) === "ok"), "7z: undo re-resolved every target (device is back): status ok");
            ok(am.filter((m) => m.id !== keep.id).every((m) => idBox(e, e.run(`MM.mappingSlot(${m.id})`)).some((x) => x > 0)), "7z: ...and rebound the pool slots to the new ids");
            // redo deletes again
            const rr = e.run("MM.redo()");
            ok(rr && e.run("MM.allMappings().length") === 1, "7z: redo deletes the batch again");
            // undo while the device is still gone: restored, marked missing, NOT deleted again
            e.lom.tree.tracks.splice(1, 1);
            e.run("MM.undo()");
            eq(e.run("MM.allMappings().length"), nBefore, "7z: undo with the target still gone restores the mappings");
            const am2 = e.run("MM.allMappings()").filter((m) => !m.target.internal && m.id !== keep.id);
            ok(am2.every((m) => e.run(`MM.mappingStatus(${m.id})`) === "missing"), "7z: ...marked missing");
            poll(e, 6);
            eq(e.run("MM.allMappings().length"), nBefore, "7z: ...and not auto-deleted again (never seen live since the restore)");
            e.lom.tree.tracks.splice(1, 0, track);
            poll(e);
            ok(e.run("MM.allMappings()").filter((m) => !m.target.internal).every((m) => e.run(`MM.mappingStatus(${m.id})`) === "ok"), "7z: they revive when the device returns");
        }
        // ---- self mappings and depth routes are never touched; one batch with two targets is one undo entry
        {
            const e = fresh();
            const ms = [mapAt(e, 0, 1, 0, 0), mapAt(e, 0, 1, 1, 0), mapAt(e, 1, 0, 0, 1)];
            const st = e.run("MM.addSelfMapping(0, " + C.selfDestFor("ctl", 1, 0) + ", 'internal')");
            ok(st && st.target.internal, "7z: an internal self-mapping exists");
            delete e.lom.ids[P(1, 0, 0)]; delete e.lom.ids[P(1, 0, 1)]; delete e.lom.ids[P(1, 1, 0)]; delete e.lom.ids[P(1, 1, 1)];
            e.lom.tree.tracks[1].devices.length = 0;
            poll(e, 3);
            const ids = e.run("MM.allMappings()").map((m) => m.id);
            deq(ids.sort(), [ms[2].id, st.id].sort(), "7z: both mappings of the emptied track are deleted in one poll; the internal self-mapping and the other track's mapping stay");
            eq(e.run("MM.undoInfo().undo"), 1, "7z: one undo entry for both");
        }
    }

}

console.log(`megamod tests passed (${passed} checks)`);
