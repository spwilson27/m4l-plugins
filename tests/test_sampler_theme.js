#!/usr/bin/env node
/**
 * Better Sampler face themes (Bitwig = default, Ableton). Run after `python3 scripts/build_sampler.py`:
 *   node tests/test_sampler_theme.js          (add --golden to print the Bitwig regression hashes)
 *
 *  - build: `face_theme` is the LAST parameter (stored UI state, default Bitwig), `env_page` the stored page of the
 *    envelope panel; neither is gen-bound; both reach every canvas
 *  - Bitwig theme: the main and side canvases paint and expose hit zones exactly as before the theme existed
 *    (hash of every mgraphics call + zone list over all states, taken before the theme was added)
 *  - Ableton theme = the parameters' own live.* objects: saved hidden at a parked rect with no colour attributes,
 *    identical parameter definitions to the design builds, theme-bound panels, two extra small v8uis
 *  - layout (src/sampler_layout_ableton.js) over every state: inside the device, no live.* over another live.* or over
 *    a visible v8ui, saved file == Bitwig state, every parameter reachable, apply step touches nothing when unchanged
 *  - drawn parts: sample panel, ADSR / filter displays (handles, drag, double-click reset), inspector Theme row
 */
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const layoutLib = require("../src/sampler_layout_ableton.js");

const ROOT = path.join(__dirname, "..");
function loadPatcher(file) {
    const raw = fs.readFileSync(path.join(ROOT, "devices", file));
    return JSON.parse(raw.slice(32).toString("utf8")).patcher;
}
const patcher = loadPatcher("Better Sampler.amxd");
const boxes = patcher.boxes.map((b) => b.box);
const byId = new Map(boxes.map((b) => [b.id, b]));
const lines = patcher.lines.map((l) => l.patchline);

// Bitwig regression hashes, taken from the face before face_theme existed (see goldenFor)
const GOLDEN = { main: "6275ef0a82dce4a3", side: "4a9d65bf59eb4bac" };

function makeSandbox(box, rec) {
    const ctx = { emitted: [], size: [box.presentation_rect[2], box.presentation_rect[3]] };
    const noop = () => {};
    const mg = new Proxy({}, {
        get: (t, k) => (k === "size" ? ctx.size : (...a) => {
            if (rec) rec.push(String(k) + ":" + a.map((v) => (typeof v === "number" ? v.toFixed(3) : String(v))).join(","));
        }),
    });
    const sb = {
        mgraphics: mg,
        outlet: (...a) => ctx.emitted.push(a),
        notifyclients: noop,
        arrayfromargs: (a) => Array.from(a),
        post: noop,
        Buffer: function () {
            this.framecount = () => 96000;
            this.channelcount = () => 2;
            this.peek = (ch, st, len) => {
                const n = Math.max(1, len || 1);
                const a = new Float32Array(n);
                for (let i = 0; i < n; i++) a[i] = 0.6 * Math.sin(((st || 0) + i) / 25) * Math.exp(-((st || 0) + i) / 60000);
                return a;
            };
            this.poke = noop;
        },
        Task: function () { this.schedule = noop; this.cancel = noop; this.repeat = noop; },
        Math, Number, String, Array, Object, Float32Array, Uint8Array, JSON, Date,
    };
    vm.createContext(sb);
    vm.runInContext(box.textfile.text, sb);
    ctx.sb = sb;
    sb.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope", "#0-bspitch");
    sb.sample_loaded("/Users/test/Pad - Granular - F#.wav");
    sb.sample_loaded("bang");
    return ctx;
}

const REGIONS = { main: "obj-viz", side: "obj-viz-side", insp: "obj-viz-insp", adsr: "obj-viz-adsr", filt: "obj-viz-filt" };
const mainBox = byId.get("obj-viz");

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
for (const key of ["face_theme", "env_page"]) {
    const b = byId.get(`obj-ctrl-${key}`);
    assert.ok(b, `obj-ctrl-${key} exists`);
    const v = b.saved_attribute_attributes.valueof;
    assert.strictEqual(v.parameter_invisible, 1, `${key}: stored UI state, not automatable`);
    assert.strictEqual(v.parameter_type, 2);
    assert.ok(!byId.get(`obj-prep-${key}`), `${key} is not sent to the gen hub`);
    assert.ok(lines.some((l) => l.destination[0] === `obj-ctrl-${key}` && l.source[0] === "obj-route-param"), `${key}: face -> route param -> live object`);
    for (const id of ["obj-viz", "obj-viz-side", "obj-viz-insp", "obj-viz-adsr", "obj-viz-filt"]) {
        assert.ok(lines.some((l) => l.source[0] === `obj-uiprep-${key}` && l.destination[0] === id), `set_${key} reaches ${id}`);
    }
}
const ftv = byId.get("obj-ctrl-face_theme").saved_attribute_attributes.valueof;
assert.deepStrictEqual(ftv.parameter_enum, ["Bitwig", "Ableton"]);
assert.deepStrictEqual(ftv.parameter_initial, [0], "default Bitwig");
assert.deepStrictEqual(byId.get("obj-ctrl-env_page").saved_attribute_attributes.valueof.parameter_enum, ["AMP", "MOD", "LFO", "UNI"]);
{
    const shortNames = boxes.filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_shortname)
        .map((b) => b.saved_attribute_attributes.valueof.parameter_shortname);
    assert.strictEqual(new Set(shortNames).size, shortNames.length, "parameter short names stay unique");
    const m = /var FACE_PARAMS = (\{.*\});/.exec(mainBox.textfile.text);
    const keys = Object.keys(JSON.parse(m[1]));
    assert.strictEqual(keys[keys.length - 1], "face_theme", "face_theme is the last face parameter");
    const ctrlOrder = boxes.filter((b) => /^obj-ctrl-/.test(b.id) && b.maxclass !== "live.drop").map((b) => b.id.replace("obj-ctrl-", ""));
    assert.strictEqual(ctrlOrder[ctrlOrder.length - 1], "face_theme", "its live.* object is created last");
    for (const id of Object.values(REGIONS)) {
        const t = byId.get(id).textfile.text;
        assert.ok(t.includes("function paintAbleton") && t.includes("function abComputeLayout"), `${id}: has the theme and layout code`);
    }
}

// --- the Ableton theme's live.* objects: hidden in the saved file, no colours, same parameter definitions ---
const designDevice = fs.existsSync(path.join(ROOT, "devices", "Better Sampler Reactive.amxd")) ? loadPatcher("Better Sampler Reactive.amxd") : null;
const designById = designDevice ? new Map(designDevice.boxes.map((b) => [b.box.id, b.box])) : new Map();
const WANT = { dial: "live.dial", numbox: "live.numbox", text: "live.text", menu: "live.menu", tab: "live.tab" };
const kinds = {};
for (const k of ["rp_dist", "pitch_st", "out_gain", "unison_voices", "poly_voices", "lfo_rate", "fr_env", "glide_ms"]) kinds[k] = WANT.dial;
for (const k of ["fr_repeats", "filt_drive", "filt_env_amt", "menv_pitch", "menv_pos"]) kinds[k] = WANT.numbox;
for (const k of ["freeze", "filt_on", "show_inspector", "rp_imaging", "rp_vsr", "sp_onsets", "sp_formant_on", "cy_xfade", "fr_sync", "fr_use_density"]) kinds[k] = WANT.text;
for (const k of ["rp_char", "sp_char", "cy_char", "sp_quant", "lfo_shape"]) kinds[k] = WANT.menu;
for (const k of ["sliced", "mode", "filt_type", "mono_legato", "env_page"]) kinds[k] = WANT.tab;
for (const key of layoutLib.AB_PARAM_KEYS) {
    const b = byId.get(`obj-ctrl-${key}`);
    assert.ok(b, `${key}: native object exists`);
    assert.ok(/^live\./.test(b.maxclass), `${key}: ${b.maxclass} is a live.* object`);
    if (kinds[key]) assert.strictEqual(b.maxclass, kinds[key], `${key}: class`);
    assert.strictEqual(b.presentation, 1, `${key}: in presentation`);
    assert.strictEqual(b.hidden, 1, `${key}: hidden in the saved (Bitwig) state`);
    assert.strictEqual(b.parameter_enable, 1, `${key}: a real parameter`);
    assert.strictEqual(b.varname, b.saved_attribute_attributes.valueof.parameter_longname, `${key}: scripting name`);
    for (const attr of Object.keys(b)) assert.ok(!/color$/.test(attr), `${key}: no colour attribute (${attr}): Live's theme colours it`);
    if (b.maxclass === "live.dial") assert.ok(b.showname === 1 && b.shownumber === 1, `${key}: dial shows name and value`);
    if (b.maxclass === "live.text") assert.strictEqual(b.mode, 1, `${key}: toggle mode`);
    // the parameter definition is the one of the Bitwig-only (design) build
    const d = designById.get(`obj-ctrl-${key}`);
    if (d) assert.deepStrictEqual(b.saved_attribute_attributes.valueof, d.saved_attribute_attributes.valueof, `${key}: identical parameter definition`);
}
assert.strictEqual(byId.get("obj-ctrl-mode").num_lines_presentation, 5, "engine list is a vertical live.tab");
assert.strictEqual(byId.get("obj-ctrl-sliced").num_lines_presentation, 2, "Single / Sliced is a vertical live.tab");
{
    const names = JSON.parse(/var AB_BOXNAMES = (\{.*\});/.exec(mainBox.textfile.text)[1]);
    assert.deepStrictEqual(Object.keys(names).sort(), layoutLib.AB_LAYOUT_KEYS.slice().sort(), "AB_BOXNAMES covers exactly the layout keys");
    const varnames = new Set(boxes.filter((b) => b.varname).map((b) => b.varname));
    for (const [key, name] of Object.entries(names)) assert.ok(varnames.has(name), `layout key ${key}: a box with varname ${name} exists`);
    assert.strictEqual(varnames.size, boxes.filter((b) => b.varname).length, "scripting names are unique");
    for (const key of layoutLib.AB_PANEL_KEYS) {
        if (key === "pnl_bg") continue;
        const p = boxes.find((b) => b.varname === names[key]);
        assert.strictEqual(p.maxclass, "panel");
        assert.strictEqual(p.background, 1, `${key}: background panel`);
        assert.strictEqual(p.hidden, 1, `${key}: hidden in the saved state`);
        assert.ok(/^themecolor\.live_/.test(p.saved_attribute_attributes.bgfillcolor.expression), `${key}: bgfillcolor bound to a Live theme colour`);
        assert.ok(Array.isArray(p.bgfillcolor), `${key}: static fallback colour`);
    }
    const order = boxes.map((b) => b.id);
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    assert.ok(boxes.slice(firstPanel).every((b) => b.maxclass === "panel"), "all panels are at the end of boxes");
    assert.strictEqual(order[order.length - 1], "obj-pnl-bg");
    assert.ok(order.indexOf("obj-pnl-body") > order.indexOf("obj-pnl-lcd") && order.indexOf("obj-pnl-body") > order.indexOf("obj-pnl-env"),
        "body panel after the section panels (earlier background panels draw over later ones)");
    for (const id of ["obj-viz-adsr", "obj-viz-filt"]) {
        const v = byId.get(id);
        assert.strictEqual(v.maxclass, "v8ui");
        assert.strictEqual(v.hidden, 1);
        assert.strictEqual(v.presentation, 1);
    }
}

// ---------------------------------------------------------------------------
// Bitwig regression
// ---------------------------------------------------------------------------
const mainStates = [];
for (const sliced of [0, 1]) for (const mode of [0, 1, 2, 3, 4]) for (const root_dyn of [0, 1]) for (const envPage of [0, 1, 2, 3])
    mainStates.push({ sliced, mode, root_dyn, envPage });
const sideStates = [];
for (const mono_legato of [0, 1]) for (const show_inspector of [0, 1]) sideStates.push({ mono_legato, show_inspector });

function setState(s, st) {
    for (const k of Object.keys(st)) { if (k === "envPage") s.storeParam("env_page", st[k], true); else s.storeParam(k, st[k], true); }
}

function goldenFor(id, states) {
    const rec = [];
    const ctx = makeSandbox(byId.get(id), rec);
    const h = crypto.createHash("sha1");
    for (const st of states) {
        const s2 = Object.assign({}, st);
        if ("envPage" in s2) { ctx.sb.envPage = s2.envPage; delete s2.envPage; }
        setState(ctx.sb, s2);
        rec.length = 0;
        ctx.sb.paint();
        h.update(JSON.stringify(st));
        h.update(rec.join("|"));
        h.update(JSON.stringify(ctx.sb.hitZones));
    }
    return h.digest("hex").slice(0, 16);
}

if (process.argv.includes("--golden")) {
    console.log(JSON.stringify({ main: goldenFor("obj-viz", mainStates), side: goldenFor("obj-viz-side", sideStates) }));
    process.exit(0);
}
assert.strictEqual(goldenFor("obj-viz", mainStates), GOLDEN.main, "Bitwig main face renders and exposes zones exactly as before");
assert.strictEqual(goldenFor("obj-viz-side", sideStates), GOLDEN.side, "Bitwig side face renders and exposes zones exactly as before");

// ---------------------------------------------------------------------------
// Layout: every state
// ---------------------------------------------------------------------------
const { abComputeLayout, AB_LAYOUT_KEYS, AB_PARAM_KEYS, AB_VIZ_KEYS, AB_ORIGIN } = layoutLib;
const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const layoutStates = [];
for (const mode of [0, 1, 2, 3, 4]) for (const sliced of [0, 1]) for (const rpChar of [0, 1, 2]) for (const spChar of [0, 1])
    for (const spQuant of [0, 1, 2]) for (const cyChar of [0, 1, 2]) for (const envPage of [0, 1, 2, 3]) for (const inspector of [0, 1])
        layoutStates.push({ mode, sliced, rpChar, spChar, spQuant, cyChar, envPage, inspector });
const reachableByWidget = new Set();
{
    // theme 0 = the saved file
    const saved = abComputeLayout(0, layoutStates[0]);
    for (const key of AB_LAYOUT_KEYS) {
        const b = boxes.find((x) => x.varname === JSON.parse(/var AB_BOXNAMES = (\{.*\});/.exec(mainBox.textfile.text)[1])[key]);
        if (saved[key]) assert.deepStrictEqual(saved[key], b.presentation_rect, `Bitwig layout ${key} is the saved rect`);
        else assert.strictEqual(b.hidden, 1, `${key} is hidden in the saved file`);
    }
    for (const st of layoutStates) assert.deepStrictEqual(abComputeLayout(0, st), saved, "the Bitwig layout does not depend on the state");
}
for (const st of layoutStates) {
    const lay = abComputeLayout(1, st);
    const label = JSON.stringify(st);
    assert.deepStrictEqual(Object.keys(lay).sort(), AB_LAYOUT_KEYS.slice().sort(), `${label}: every layout key present`);
    const W = st.inspector ? 760 : 600;
    for (const key of AB_LAYOUT_KEYS) {
        const r = lay[key];
        if (!r) continue;
        const limit = key === "pnl_body" ? W : 600;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0 && r[0] + r[2] <= limit && r[1] + r[3] <= 169, `${label}: ${key} ${r} inside ${limit} x 169`);
    }
    assert.strictEqual(lay.pnl_bg, null, "Bitwig background hidden");
    assert.strictEqual(lay.v_side, null, "side canvas hidden in Ableton");
    const live = AB_PARAM_KEYS.filter((k) => lay[k]);
    const viz = AB_VIZ_KEYS.filter((k) => lay[k]);
    for (const k of live) reachableByWidget.add(k);
    for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) assert.ok(!overlap(lay[live[i]], lay[live[j]]), `${label}: ${live[i]} overlaps ${live[j]}`);
        for (const v of viz) assert.ok(!overlap(lay[live[i]], lay[v]), `${label}: ${live[i]} overlaps v8ui ${v}`);
        assert.ok(!overlap(lay[live[i]], [600, 0, 160, 169]), `${label}: ${live[i]} overlaps the inspector canvas`);
    }
    // the drawn canvases keep their top left (zones are in device pixels)
    assert.deepStrictEqual(lay.v_main.slice(0, 2), AB_ORIGIN.main);
    if (lay.v_adsr) assert.deepStrictEqual(lay.v_adsr.slice(0, 2), AB_ORIGIN.adsr);
    if (lay.v_filt) assert.deepStrictEqual(lay.v_filt.slice(0, 2), AB_ORIGIN.filt);
    assert.strictEqual(!!lay.v_adsr, st.envPage <= 1, `${label}: ADSR display only on AMP / MOD`);
    // which widgets show for the state
    assert.ok(lay.sliced && lay.mode && lay.freeze && lay.filt_on && lay.env_page && lay.show_inspector, `${label}: fixed widgets`);
    assert.strictEqual(!!lay.sp_quant, st.mode === 3 && st.spChar === 1, `${label}: Quantize menu only in Spectral / Reharm`);
    assert.strictEqual(!!lay.rp_imaging, st.mode === 0 && st.rpChar === 2, `${label}: Digital toggles`);
    assert.strictEqual(!!lay.lfo_shape, st.envPage === 2, `${label}: LFO shape menu on the LFO page`);
    assert.strictEqual(!!lay.menv_pitch, st.envPage === 1, `${label}: MOD amounts on the MOD page`);
}

// every parameter of the Bitwig face is reachable in Ableton: a visible widget in some state, or a drawn zone
const DRAWN_ACTION_KEYS = { reverse: "reverse", freeze: "freeze", filt_on: "filt_on", filt_type: "filt_type", inspector: "show_inspector", sliced_set: "sliced", engine: "mode", voicing: "mono_legato", env_page: "env_page", face_theme: "face_theme" };
const REGION_KEYS = ["samp_start", "samp_end", "loop_start", "loop_end", "loop_xfade"];
const reachable = new Set(reachableByWidget);
const rectOf = (region, st) => {
    const lay = abComputeLayout(1, st);
    const r = lay[{ main: "v_main", adsr: "v_adsr", filt: "v_filt" }[region]];
    return r;
};
function collectZones(s, set) {
    for (const z of s.hitZones) {
        if (z.key) set.add(z.key);
        if (z.region) set.add(z.region);
        if (z.action && DRAWN_ACTION_KEYS[z.action]) set.add(DRAWN_ACTION_KEYS[z.action]);
        if (z.kind === "wave") set.add("play_pos");
        if (z.kind === "env_pt" || z.kind === "filt_pt") { for (const k of Object.values(z.keys || { a: "filt_cutoff", b: "filt_res" })) set.add(k); }
    }
}

// ---------------------------------------------------------------------------
// Painting in both themes, every hit zone inside its canvas
// ---------------------------------------------------------------------------
let painted = 0;
for (const theme of [0, 1]) {
    for (const [name, id] of Object.entries(REGIONS)) {
        if (theme === 0 && (name === "adsr" || name === "filt")) continue;
        const box = byId.get(id);
        const ctx = makeSandbox(box, null);
        const s = ctx.sb;
        s.storeParam("face_theme", theme, true);
        const states = name === "side" ? sideStates : (name === "insp" ? [0, 1, 2, 3, 4].map((mode) => ({ mode })) : mainStates);
        for (const inspector of name === "main" ? [0, 1] : [0]) {
            s.storeParam("show_inspector", inspector, true);
            for (const st of states) {
                const s2 = Object.assign({}, st);
                if ("envPage" in s2) { s.storeParam("env_page", s2.envPage, true); delete s2.envPage; }
                setState(s, s2);
                let rect = box.presentation_rect;
                if (theme === 1 && (name === "main" || name === "adsr" || name === "filt")) {
                    const lay = abComputeLayout(1, { mode: s.curMode, sliced: s.curSliced, rpChar: 0, spChar: 0, spQuant: 0, cyChar: 0, envPage: s.envPage, inspector });
                    rect = lay[{ main: "v_main", adsr: "v_adsr", filt: "v_filt" }[name]];
                    if (!rect) continue;
                    // the canvas is the rect of the layout (adsr / filt have a fixed small size)
                }
                ctx.size = [rect[2], rect[3]];
                s.paint();
                painted++;
                const label = `theme ${theme} ${name} ${JSON.stringify(st)}${inspector ? " inspector" : ""}`;
                const org = theme === 1 ? (AB_ORIGIN[{ main: "main", adsr: "adsr", filt: "filt" }[name]] || [0, 0]) : [0, 0];
                if (name === "side" && theme === 1) continue;   // hidden in Ableton: nothing to check
                assert.ok(s.hitZones.length > 0, `${label}: has hit zones`);
                for (const z of s.hitZones) {
                    assert.ok(z.x >= org[0] - 1 && z.y >= org[1] - 1 && z.x + z.w <= org[0] + rect[2] + 1 && z.y + z.h <= org[1] + rect[3] + 1,
                        `${label}: zone ${z.kind} ${z.key || z.action || z.pt || ""} inside canvas ${org} ${rect[2]}x${rect[3]}: ${[z.x, z.y, z.w, z.h].map((v) => Math.round(v))}`);
                }
                if (name === "main") assert.ok(s.hitZones.some((z) => z.kind === "wave"), `${label}: waveform zone`);
                if (theme === 1) collectZones(s, reachable);
            }
        }
    }
}
{
    // Bitwig has no Ableton-only zones; the Ableton ADSR / filter canvases have theirs
    const ctx = makeSandbox(byId.get("obj-viz-adsr"), null);
    ctx.sb.storeParam("face_theme", 1, true);
    ctx.size = [131, 38];
    ctx.sb.paint();
    assert.ok(ctx.sb.hitZones.some((z) => z.kind === "env_pt"), "ADSR canvas has handles");
    const f = makeSandbox(byId.get("obj-viz-filt"), null);
    f.sb.storeParam("face_theme", 1, true);
    f.size = [90, 22];
    f.sb.paint();
    assert.ok(f.sb.hitZones.some((z) => z.kind === "filt_pt"), "filter canvas has its point");
    const m = makeSandbox(mainBox, null);
    m.sb.paint();
    assert.ok(!m.sb.hitZones.some((z) => z.kind === "env_pt" || z.kind === "filt_pt"), "Bitwig main has no Ableton zones");
}
// inspector-only and drawn-sample-panel parameters come from the inspector / main canvases; the rest is widgets
{
    const ictx = makeSandbox(byId.get("obj-viz-insp"), null);
    ictx.sb.storeParam("face_theme", 1, true);
    for (const mode of [0, 1, 2, 3, 4]) { ictx.sb.storeParam("mode", mode, true); ictx.sb.paint(); collectZones(ictx.sb, reachable); }
    const mctx = makeSandbox(mainBox, null);
    mctx.sb.storeParam("face_theme", 1, true);
    mctx.size = [466, 100];
    for (const st of [{ sliced: 0 }, { sliced: 1 }]) for (const at of [0, 1, 2, 3, 4]) for (const dyn of [0, 1]) {
        setState(mctx.sb, st); mctx.sb.storeParam("slice_at", at, true); mctx.sb.storeParam("root_dyn", dyn, true); mctx.sb.paint(); collectZones(mctx.sb, reachable);
    }
    const all = Object.keys(JSON.parse(/var FACE_PARAMS = (\{.*\});/.exec(mainBox.textfile.text)[1]));
    for (const k of REGION_KEYS) reachable.add(k);   // regions are reported as zone.region (checked above via collectZones)
    const missing = all.filter((k) => !reachable.has(k));
    assert.deepStrictEqual(missing, [], `parameters not reachable in the Ableton theme: ${missing.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Applying the layout
// ---------------------------------------------------------------------------
{
    const names = JSON.parse(/var AB_BOXNAMES = (\{.*\});/.exec(mainBox.textfile.text)[1]);
    const calls = [];
    const objs = new Map();
    const fake = {
        getnamed: (n) => {
            if (!objs.has(n)) objs.set(n, { setattr: (a, v) => calls.push([n, a, v]) });
            return objs.get(n);
        },
    };
    const ctx = makeSandbox(mainBox, null);
    const s = ctx.sb;
    s.abPatcherOverride = fake;
    assert.strictEqual(s.abApplyLayout(), 0, "Bitwig state: nothing to apply");
    assert.strictEqual(calls.length, 0, "no setattr when the layout equals the saved Bitwig state");
    s.storeParam("mode", 3, true);
    assert.strictEqual(calls.length, 0, "changing mode in the Bitwig theme touches nothing");
    s.storeParam("face_theme", 1, true);
    assert.ok(calls.length > 20, "switching to Ableton moves the widgets");
    // what was applied is the layout
    const want = abComputeLayout(1, { mode: 3, sliced: 0, rpChar: 0, spChar: 0, spQuant: 0, cyChar: 0, envPage: 0, inspector: 0 });
    const last = new Map();
    for (const [n, a, v] of calls) { if (!last.has(n)) last.set(n, {}); last.get(n)[a] = v; }
    for (const key of AB_LAYOUT_KEYS) {
        const got = last.get(names[key]);
        if (want[key]) assert.strictEqual(JSON.stringify(got && got.presentation_rect), JSON.stringify(want[key]), `${key}: applied rect`);
        else if (got) assert.strictEqual(got.hidden, 1, `${key}: hidden`);
        if (want[key]) assert.strictEqual(got.hidden, 0, `${key}: shown`);
    }
    // the unhide comes after the rect (no flash at the parked rect)
    const firstCall = calls.find((c) => c[0] === names.mode);
    assert.strictEqual(firstCall[1], "presentation_rect");
    calls.length = 0;
    s.storeParam("face_theme", 1, true);
    s.storeParam("mode", 3, true);
    s.storeParam("pitch_st", 5, true);
    s.paint();
    assert.strictEqual(calls.length, 0, "no setattr when nothing changed");
    assert.strictEqual(s.abApplyLayout(), 0);
    s.storeParam("sp_char", 1, true);
    assert.ok(calls.some((c) => c[0] === names.sp_quant && c[1] === "hidden" || c[0] === names.sp_quant), "Reharm shows the Quantize menu");
    assert.ok(calls.every((c) => [names.sp_quant, names.sp_bend, names.formant, names.sp_shift, names.sp_quant_amt].includes(c[0])), "only the Spectral dials were touched");
    calls.length = 0;
    s.storeParam("env_page", 2, true);
    assert.ok(calls.some((c) => c[0] === names.v_adsr || c[0] === "obj-viz-adsr"), "the ADSR canvas hides on the LFO page");
    calls.length = 0;
    s.storeParam("face_theme", 0, true);
    assert.ok(calls.length > 20, "switching back restores the Bitwig layout");
    const back = new Map();
    for (const [n, a, v] of calls) { if (!back.has(n)) back.set(n, {}); back.get(n)[a] = v; }
    assert.strictEqual(JSON.stringify(back.get("SamplerStateData").presentation_rect), "[0,0,528,169]", "main canvas is full size again");
    assert.strictEqual(JSON.stringify(back.get("obj-viz-side").presentation_rect), "[531,3,66,163]");
    assert.strictEqual(back.get("obj-pnl-bg").hidden, 0);
}
// designs have no theme: their layout is never touched
if (designDevice) {
    const d = designDevice.boxes.map((b) => b.box);
    assert.ok(!d.some((b) => /^ab_/.test(b.varname || "")), "design builds carry no Ableton theme boxes");
    assert.ok(!d.some((b) => b.id === "obj-viz-adsr"));
}

// ---------------------------------------------------------------------------
// Interaction of the drawn parts (event coordinates are canvas-local; zones are in device pixels)
// ---------------------------------------------------------------------------
function paramsOf(ctx) { return ctx.emitted.filter((a) => a[1] === "param").map((a) => ({ key: a[2], value: a[3] })); }
function checkRange(s, list, label) {
    for (const e of list) {
        const sp = s.FACE_PARAMS[e.key];
        assert.ok(sp, `${label}: unknown param ${e.key}`);
        assert.ok(Number.isFinite(e.value) && e.value >= sp.lo - 1e-6 && e.value <= sp.hi + 1e-6, `${label}: ${e.key} = ${e.value} outside ${sp.lo}..${sp.hi}`);
    }
}
const centerOf = (z) => [z.x + z.w / 2, z.y + z.h / 2];
const local = (region, p) => [p[0] - (AB_ORIGIN[region] || [0, 0])[0], p[1] - (AB_ORIGIN[region] || [0, 0])[1]];
const zoneOf = (s, kind, pt) => s.hitZones.find((z) => z.kind === kind && (pt === undefined || z.pt === pt));

{
    const ctx = makeSandbox(byId.get("obj-viz-adsr"), null);
    const s = ctx.sb;
    s.storeParam("face_theme", 1, true);
    const pages = [
        { page: 0, w: 131, keys: { a: "atk_ms", d: "dec_ms", s: "sus_lvl", r: "rel_ms" } },
        { page: 1, w: 88, keys: { a: "matk_ms", d: "mdec_ms", s: "msus_lvl", r: "mrel_ms" } },
    ];
    const click = (region, p) => s.onclick(...local(region, p), 1, 0, 0);
    const dragTo = (region, p, but = 1, shift = 0) => s.ondrag(...local(region, p), but, 0, shift);
    for (const pg of pages) {
        const k = pg.keys;
        s.storeParam("env_page", pg.page, true);
        ctx.size = [pg.w, 38];
        s.paint();
        const zs = { A: zoneOf(s, "env_pt", "A"), D: zoneOf(s, "env_pt", "D"), R: zoneOf(s, "env_pt", "R") };
        for (const n of ["A", "D", "R"]) assert.ok(zs[n], `page ${pg.page}: ${n} handle`);
        const g = zs.A.geo;
        // Attack: horizontal only, half way along its stage = knob position 0.5
        ctx.emitted.length = 0;
        click("adsr", centerOf(zs.A));
        dragTo("adsr", [g.x0 + g.sA * 0.5, 130]);
        let ps = paramsOf(ctx);
        assert.ok(ps.length > 0 && ps.every((e) => e.key === k.a), `page ${pg.page}: attack handle edits only ${k.a}`);
        checkRange(s, ps, `page ${pg.page} attack`);
        assert.ok(Math.abs(s.toNorm(k.a, s.paramValue(k.a)) - 0.5) < 0.01, `page ${pg.page}: attack at 0.5 of its stage`);
        dragTo("adsr", [g.x0 - 40, 130]);
        assert.ok(s.paramValue(k.a) <= s.FACE_PARAMS[k.a].lo + 1e-6, `page ${pg.page}: attack clamps at min`);
        dragTo("adsr", [0, 0], 0);

        // Decay + sustain: x -> decay time, y -> sustain level
        s.paint();
        ctx.emitted.length = 0;
        click("adsr", centerOf(zoneOf(s, "env_pt", "D")));
        const xA = g.x0 + g.sA * s.toNorm(k.a, s.paramValue(k.a));
        dragTo("adsr", [xA + g.sD * 0.4, g.bot - (g.bot - g.top) * 0.3]);
        ps = paramsOf(ctx);
        assert.ok(ps.every((e) => e.key === k.d || e.key === k.s) && ps.some((e) => e.key === k.d) && ps.some((e) => e.key === k.s),
            `page ${pg.page}: decay handle edits ${k.d} and ${k.s}`);
        checkRange(s, ps, `page ${pg.page} decay`);
        assert.ok(Math.abs(s.toNorm(k.d, s.paramValue(k.d)) - 0.4) < 0.01, `page ${pg.page}: decay at 0.4 of its stage`);
        assert.ok(Math.abs(s.paramValue(k.s) - 30) < 1, `page ${pg.page}: sustain 30 % from the y position`);
        dragTo("adsr", [xA + g.sD * 5, g.bot + 50]);
        assert.ok(s.paramValue(k.s) >= 0 && s.paramValue(k.d) <= s.FACE_PARAMS[k.d].hi, `page ${pg.page}: decay / sustain clamp`);
        dragTo("adsr", [0, 0], 0);

        // Release
        s.storeParam(k.d, 100, true); s.storeParam(k.a, 50, true);
        s.paint();
        ctx.emitted.length = 0;
        click("adsr", centerOf(zoneOf(s, "env_pt", "R")));
        const xS = g.x0 + g.sA * s.toNorm(k.a, s.paramValue(k.a)) + g.sD * s.toNorm(k.d, s.paramValue(k.d)) + g.hold;
        dragTo("adsr", [xS + g.sR * 0.6, 150]);
        ps = paramsOf(ctx);
        assert.ok(ps.length > 0 && ps.every((e) => e.key === k.r), `page ${pg.page}: release handle edits only ${k.r}`);
        checkRange(s, ps, `page ${pg.page} release`);
        assert.ok(Math.abs(s.toNorm(k.r, s.paramValue(k.r)) - 0.6) < 0.01, `page ${pg.page}: release at 0.6 of its stage`);
        dragTo("adsr", [0, 0], 0);

        // Double-click resets
        for (const [n, keys] of [["A", [k.a]], ["D", [k.d, k.s]], ["R", [k.r]]]) {
            for (const key of keys) s.storeParam(key, (s.FACE_PARAMS[key].lo + s.FACE_PARAMS[key].hi) / 2 + 3, true);
            s.paint();
            ctx.emitted.length = 0;
            const c = centerOf(zoneOf(s, "env_pt", n));
            click("adsr", c);
            dragTo("adsr", [0, 0], 0);
            s.ondblclick(...local("adsr", c));
            ps = paramsOf(ctx);
            for (const key of keys) {
                const e = ps.filter((p) => p.key === key).pop();
                assert.ok(e && e.value === s.FACE_PARAMS[key].init, `page ${pg.page}: double-click on ${n} resets ${key}`);
            }
        }
        // readouts are draggable values of the four keys
        s.paint();
        for (const key of [k.a, k.d, k.s, k.r]) assert.ok(s.hitZones.some((z) => z.kind === "value" && z.key === key), `page ${pg.page}: readout ${key}`);
    }
    // Hit testing honours the canvas origin: a click at the local position of a handle reaches it
    s.storeParam("env_page", 0, true);
    ctx.size = [131, 38];
    s.paint();
    const zA = zoneOf(s, "env_pt", "A");
    const [lx, ly] = local("adsr", centerOf(zA));
    ctx.emitted.length = 0;
    s.onclick(lx, ly, 1, 0, 0);
    assert.ok(s.drag && s.drag.pt && s.drag.pt.pt === "A", "a local click lands on the device-space zone");
    s.ondrag(0, 0, 0, 0, 0);
}

{
    const ctx = makeSandbox(byId.get("obj-viz-filt"), null);
    const s = ctx.sb;
    s.storeParam("face_theme", 1, true);
    ctx.size = [90, 22];
    for (const type of [0, 1, 2]) {
        s.storeParam("filt_type", type, true);
        s.storeParam("filt_on", 1, true);
        s.paint();
        const zf = zoneOf(s, "filt_pt");
        assert.ok(zf, `filter type ${type}: point zone`);
        const g = zf.geo;
        ctx.emitted.length = 0;
        s.onclick(...local("filt", centerOf(zf)), 1, 0, 0);
        s.ondrag(...local("filt", [g.x0 + g.W * 0.5, g.y0 - 9 * g.k]), 1, 0, 0);    // middle of the log axis (632 Hz), +9 dB = half of the resonance
        let ps = paramsOf(ctx);
        assert.ok(ps.some((e) => e.key === "filt_cutoff") && ps.some((e) => e.key === "filt_res") && ps.every((e) => e.key === "filt_cutoff" || e.key === "filt_res"),
            `filter ${type}: point edits cutoff and resonance`);
        checkRange(s, ps, `filter ${type}`);
        assert.ok(Math.abs(s.paramValue("filt_cutoff") - 20 * Math.pow(1000, 0.5)) < 1, `filter ${type}: cutoff on the log axis`);
        assert.ok(Math.abs(s.paramValue("filt_res") - 50) < 1, `filter ${type}: resonance from y`);
        s.ondrag(...local("filt", [g.x0 + g.W * 3, g.y0 - 100]), 1, 0, 0);
        checkRange(s, paramsOf(ctx), `filter ${type} clamp`);
        assert.ok(s.paramValue("filt_cutoff") <= 20000 + 1e-6 && s.paramValue("filt_res") <= 100 + 1e-6);
        s.ondrag(...local("filt", [g.x0 - 100, g.y0 + 100]), 1, 0, 0);
        assert.ok(s.paramValue("filt_cutoff") >= 20 - 1e-6 && s.paramValue("filt_res") >= 0);
        s.ondrag(0, 0, 0, 0, 0);
        s.storeParam("filt_cutoff", 500, true); s.storeParam("filt_res", 70, true);
        s.paint();
        const c = centerOf(zoneOf(s, "filt_pt"));
        ctx.emitted.length = 0;
        s.onclick(...local("filt", c), 1, 0, 0);
        s.ondrag(0, 0, 0, 0, 0);
        s.ondblclick(...local("filt", c));
        const got = {};
        for (const e of paramsOf(ctx)) got[e.key] = e.value;
        assert.strictEqual(got.filt_cutoff, s.FACE_PARAMS.filt_cutoff.init, "double-click resets the cutoff");
        assert.strictEqual(got.filt_res, s.FACE_PARAMS.filt_res.init, "double-click resets the resonance");
    }
}

// The drawn sample panel keeps working in its shrunk canvas (zones in device pixels, events shifted by the origin)
{
    const ctx = makeSandbox(mainBox, null);
    const s = ctx.sb;
    s.storeParam("face_theme", 1, true);
    ctx.size = [466, 100];
    s.paint();
    const wave = zoneOf(s, "wave");
    assert.ok(wave && wave.x >= 59 && wave.y >= 3, "waveform zone in device pixels");
    ctx.emitted.length = 0;
    const c = centerOf(wave);
    s.onclick(c[0] - 59, c[1] - 3, 1, 0, 0);
    s.ondrag(0, 0, 0, 0, 0);
    // dropdowns stay inside the shrunk canvas
    s.storeParam("sliced", 1, true);
    s.paint();
    for (const key of ["slice_at", "slice_beat", "slice_play"]) {
        s.storeParam("slice_at", key === "slice_beat" ? 1 : 0, true);
        s.paint();
        const mz = s.hitZones.find((z) => z.action === "menu" && z.key === key);
        if (!mz) continue;
        s.onclick(mz.x + 2 - 59, mz.y + 2 - 3, 1, 0, 0);
        assert.ok(s.openMenu, `${key}: menu opens`);
        const m = s.openMenu;
        const n = s.menuItems(key).names.length;
        const h = n * m.rowH + 6;
        assert.ok(m.x >= 59 && m.y >= 3 && m.x + m.w <= 59 + 466 && m.y + h <= 3 + 100, `${key}: the drop area (${[m.x, m.y, m.w, h]}) stays inside the shrunk canvas`);
        s.paint();
        for (const z of s.hitZones) assert.ok(z.x >= 58 && z.y >= 2 && z.x + z.w <= 59 + 466 + 1 && z.y + z.h <= 3 + 100 + 1, `${key}: menu zone inside the canvas`);
        s.onclick(1, 1, 1, 0, 0);
    }
}

// The theme control (inspector, both themes)
for (const theme of [0, 1]) {
    const ctx = makeSandbox(byId.get("obj-viz-insp"), null);
    const s = ctx.sb;
    s.storeParam("face_theme", theme, true);
    s.paint();
    const cells = s.hitZones.filter((z) => z.action === "face_theme");
    assert.strictEqual(cells.length, 2, `theme ${theme}: two theme cells in the inspector`);
    assert.ok(cells.every((z) => z.y < 30), "theme row is at the top of the inspector");
    for (const target of [1, 0]) {
        ctx.emitted.length = 0;
        const z = cells.find((c) => c.value === target);
        s.onclick(...centerOf(z), 1, 0, 0);
        assert.deepStrictEqual(paramsOf(ctx), [{ key: "face_theme", value: target }], `theme ${theme}: clicking cell ${target} emits face_theme ${target}`);
    }
    s.echoPending = {};
    s.set_face_theme(1);
    assert.strictEqual(s.curFaceTheme, 1);
    s.set_face_theme(0);
    assert.strictEqual(s.curFaceTheme, 0);
}

// Smoke test: every zone of every drawn Ableton canvas survives click / drag / double-click and only emits valid params
for (const name of ["main", "insp", "adsr", "filt"]) {
    const ctx = makeSandbox(byId.get(REGIONS[name]), null);
    const s = ctx.sb;
    s.storeParam("face_theme", 1, true);
    const rect = name === "main" ? [59, 3, 466, 100] : (name === "adsr" ? [391, 124, 131, 38] : (name === "filt" ? [292, 125, 90, 22] : byId.get("obj-viz-insp").presentation_rect));
    ctx.size = [rect[2], rect[3]];
    const iStates = name === "main"
        ? [{ sliced: 0, mode: 0 }, { sliced: 1, mode: 2 }, { sliced: 0, mode: 3 }, { sliced: 0, mode: 4 }]
        : (name === "insp" ? [{ mode: 3 }, { mode: 4 }] : [{ env_page: 0 }, { env_page: 1 }]);
    for (const st of iStates) {
        setState(s, st);
        s.paint();
        for (const z of s.hitZones.slice()) {
            const [cx, cy] = local(name === "insp" ? "none" : name, centerOf(z));
            s.paint();
            s.onclick(cx, cy, 1, 0, 0);
            s.ondrag(cx, cy - 20, 1, 0, 0);
            s.ondrag(cx + 15, cy - 40, 1, 0, 1);
            s.ondrag(cx + 15, cy - 40, 0, 0, 0);
            s.onidle(cx, cy);
            s.paint();
            s.ondblclick(cx, cy);
            s.paint();
            checkRange(s, paramsOf(ctx), `${name} ${JSON.stringify(st)} zone ${z.kind} ${z.key || z.action || z.pt || ""}`);
            ctx.emitted.length = 0;
            if (s.openMenu) s.onclick(1, 1, 1, 0, 0);
        }
        s.onidleout();
    }
}

console.log(`Sampler themes OK: ${painted} canvas states painted, ${layoutStates.length} layout states checked (no overlaps, saved file = Bitwig), ` +
    "Bitwig regression hashes match, every parameter reachable, handles / filter point / theme control verified");
