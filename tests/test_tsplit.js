#!/usr/bin/env node
/**
 * Verification suite for devices/Timbre Split.amxd.
 *
 * Covers:
 *  1. Device JSON: .amxd header, 440 x 169 px, patcher latency 2048, no overlap between visible widgets (and none
 *     between live.* widgets and the v8ui), panels last with `background: 1`, `#0-` buffers, parameter ranges (no Int > 255),
 *     versioned state blob, widget <-> v8ui wiring, gen code = cepstrum lib + core, v8ui = config + ui
 *  2. GenExpr ordering / lexer / no-early-return rules and the core's interface
 *  3. Pure maths (src/tsplit_config.js): memberships, hysteresis, smoothing kernel, class-mask partition, state blob
 *     versioning, rack-path parsing, leader election
 *  4. Online k-means on synthetic kick / snare / hat signals: > 90 % per hop, per class, through the MFCC mirror
 *  5. Perfect reconstruction with the JS mirror (src/tsplit_ref.js): memberships sum to 1, chains sum to the input
 *     delayed by 2048 samples with a residual below -120 dB, class isolation, onsets not chopped, constant latency,
 *     gain, chatter bounded by the hysteresis
 *  6. The v8ui with mocked Max: linked instances (Auto class assignment, nested racks, Cmd+D isolation, leader),
 *     centroid sharing over the Global bus, learning from telemetry, pills / gain slider, paint bounds, state blob
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "src", "tsplit_config.js"));
const R = require(path.join(ROOT, "src", "tsplit_ref.js"));
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, "src", "tsplit_config.js"), "utf8");
const UI_SRC = fs.readFileSync(path.join(ROOT, "src", "tsplit_ui.js"), "utf8");
const CORE_SRC = fs.readFileSync(path.join(ROOT, "src", "tsplit_core.genexpr"), "utf8");
const LIB_SRC = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8");
const DEVICE = path.join(ROOT, "devices", "Timbre Split.amxd");
const SR = 48000;

function loadAmxd() {
    const buf = fs.readFileSync(DEVICE);
    assert.strictEqual(buf.subarray(0, 8).toString("latin1"), "ampf\x04\x00\x00\x00", "ampf header");
    assert.strictEqual(buf.subarray(8, 12).toString("latin1"), "aaaa", "Max Audio Effect device type");
    assert.strictEqual(buf.subarray(12, 24).toString("latin1"), "meta\x04\x00\x00\x00\x00\x00\x00\x00");
    assert.strictEqual(buf.subarray(24, 28).toString("latin1"), "ptch");
    assert.strictEqual(buf.length, 32 + buf.readUInt32LE(28), "header length matches the JSON payload");
    const json = buf.subarray(32).toString("utf8");
    assert.ok(json.endsWith("\n"), "payload ends with a newline");
    return JSON.parse(json).patcher;
}

function overlaps(a, b) {
    return a[0] < b[0] + b[2] - 0.01 && b[0] < a[0] + a[2] - 0.01 && a[1] < b[1] + b[3] - 0.01 && b[1] < a[1] + a[3] - 0.01;
}

const dbOf = (x) => 10 * Math.log10(x);

// =========================================================================
// 1. DEVICE JSON
// =========================================================================
const patcher = loadAmxd();
{
    const p = patcher;
    const boxes = p.boxes.map((b) => b.box);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    assert.strictEqual(p.devicewidth, 440, "device width");
    assert.deepStrictEqual(p.openrect, [0, 0, 440, 169], "openrect height must be 169");
    assert.strictEqual(p.openinpresentation, 1);
    assert.strictEqual(p.latency, 2048, "patcher latency = the 2048-sample lookahead");
    assert.strictEqual(p.latency, C.TSPLIT_LATENCY, "latency matches the config constant");

    const vis = boxes.filter((b) => b.presentation === 1 && !b.hidden && b.maxclass !== "panel");
    const panels = boxes.filter((b) => b.maxclass === "panel");
    assert.ok(panels.length >= 2, "background panels exist");
    for (const b of vis.concat(panels)) {
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 440.01 && r[1] + r[3] <= 169.01, `${b.id} outside the device ${r}`);
    }
    for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
            assert.ok(!overlaps(vis[i].presentation_rect, vis[j].presentation_rect), `${vis[i].id} overlaps ${vis[j].id}`);
        }
    }
    const viz = byId["obj-viz"];
    assert.ok(viz && viz.maxclass === "v8ui" && viz.presentation === 1, "v8ui canvas");
    assert.deepStrictEqual(viz.presentation_rect, [8, 8, 270, 153]);
    for (const b of boxes) {
        if (b.maxclass && b.maxclass.startsWith("live.") && b.presentation === 1 && b.maxclass !== "live.comment") {
            assert.ok(!overlaps(b.presentation_rect, viz.presentation_rect), `live widget ${b.id} overlaps the v8ui`);
        }
        if (b.presentation === 1 && b.hidden && b.maxclass !== "panel") {
            assert.ok(!overlaps(b.presentation_rect, viz.presentation_rect), `hidden ${b.id} overlaps the v8ui`);
        }
    }
    const lastNonPanel = Math.max(...boxes.map((b, i) => (b.maxclass === "panel" ? -1 : i)));
    boxes.forEach((b, i) => {
        if (b.maxclass === "panel") {
            assert.strictEqual(b.background, 1, `panel ${b.id} must be background`);
            assert.ok(i > lastNonPanel, `panel ${b.id} must come after every control`);
        }
    });

    // v8ui script = config + ui, mgraphics init lines, embedded
    const js = viz.textfile.text;
    assert.strictEqual(js, CONFIG_SRC + "\n\n" + UI_SRC, "v8ui script is config + ui");
    assert.ok(/mgraphics\.init\(\);\s*mgraphics\.relative_coords = 0;\s*mgraphics\.autofill = 0;/.test(js), "mgraphics init lines");
    assert.strictEqual(viz.textfile.embed, 1);

    // instance isolation
    const bufs = boxes.filter((b) => /^buffer~/.test(b.text || ""));
    assert.deepStrictEqual(bufs.map((b) => b.text).sort(),
        ["buffer~ #0-tsplitcent @samps 64", "buffer~ #0-tsplitscope @samps 2592"], "instance-local buffers");
    for (const b of boxes) {
        if (b.maxclass === "newobj" && /^(buffer~|send|receive|s |r )/.test(b.text || "")) {
            assert.ok(/#0-|---/.test(b.text), `${b.text} must be instance-local`);
        }
    }
    assert.strictEqual(byId["obj-msg-gen-buf"].text, "scope #0-tsplitscope");
    assert.strictEqual(byId["obj-msg-gen-cent"].text, "cent #0-tsplitcent");
    assert.strictEqual(byId["obj-msg-ui-buf"].text, "setbuffer #0-tsplitscope");
    assert.strictEqual(byId["obj-msg-ui-cent"].text, "setcent #0-tsplitcent");

    // audio path and gen interface
    const lines = p.lines.map((l) => l.patchline);
    const has = (s, so, d, di) => lines.some((l) => l.source[0] === s && l.source[1] === so && l.destination[0] === d && l.destination[1] === di);
    assert.ok(has("obj-plugin", 0, "obj-gen", 0) && has("obj-plugin", 1, "obj-gen", 1), "plugin~ -> gen");
    assert.ok(has("obj-gen", 0, "obj-plugout", 0) && has("obj-gen", 1, "obj-plugout", 1), "gen -> plugout~");
    assert.strictEqual(byId["obj-gen"].numoutlets, 2, "gen has out1 / out2 only");
    assert.strictEqual(byId["obj-gen"].code, LIB_SRC + "\n" + CORE_SRC, "gen code is lib + core");
    for (const m of ["obj-msg-gen-buf", "obj-msg-gen-cent"]) assert.ok(has(m, 0, "obj-gen", 0), `${m} -> gen`);
    for (const m of ["obj-msg-ui-buf", "obj-msg-ui-cent", "obj-msg-ui-init", "obj-msg-ui-free"]) assert.ok(has(m, 0, "obj-viz", 0), `${m} -> v8ui`);

    // wiring: widget -> prepend set_x -> v8ui ; v8ui -> route ui_x -> prepend set -> widget ; leftovers -> gen
    const controls = ["classes", "sharp", "smooth", "learn", "adapt", "classmode", "linkgroup", "gain"];
    const route = byId["obj-route-ui"];
    assert.strictEqual(route.text, "route " + controls.map((k) => `ui_${k}`).join(" "));
    assert.strictEqual(route.numoutlets, controls.length + 1);
    assert.ok(has("obj-viz", 0, "obj-route-ui", 0) && has("obj-route-ui", controls.length, "obj-gen", 0), "unmatched v8ui messages -> gen");
    controls.forEach((k, i) => {
        assert.ok(has(`obj-ctrl-${k}`, 0, `obj-prep-${k}`, 0) && has(`obj-prep-${k}`, 0, "obj-viz", 0), `${k}: widget -> v8ui`);
        assert.strictEqual(byId[`obj-prep-${k}`].text, `prepend set_${k}`);
        assert.ok(has("obj-route-ui", i, `obj-set-${k}`, 0) && has(`obj-set-${k}`, 0, `obj-ctrl-${k}`, 0), `${k}: v8ui -> widget`);
        assert.strictEqual(byId[`obj-set-${k}`].text, "prepend set", `${k}: set (no echo loop)`);
        assert.ok(p.parameters[`obj-ctrl-${k}`], `${k}: registered parameter`);
    });
    assert.ok(has("obj-state-pattr", 1, "obj-viz", 0), "state blob bound to the v8ui");

    // control set: restrained (visible: Classes, Learn, Sharp, Smooth, Adapt; v8ui: pills + Gain; hidden: Class Mode, Link, Gain)
    const visibleLive = vis.filter((b) => b.maxclass.startsWith("live.") && b.maxclass !== "live.comment").map((b) => b.id).sort();
    assert.deepStrictEqual(visibleLive, ["obj-ctrl-adapt", "obj-ctrl-classes", "obj-ctrl-learn", "obj-ctrl-sharp", "obj-ctrl-smooth"]);
    for (const id of ["obj-ctrl-gain", "obj-ctrl-linkgroup", "obj-ctrl-classmode"]) assert.strictEqual(byId[id].hidden, 1, `${id} hidden`);
    assert.deepStrictEqual(byId["obj-ctrl-classmode"].saved_attribute_attributes.valueof.parameter_enum,
        ["Auto Chain", "Class 1", "Class 2", "Class 3", "Class 4", "Multi"]);

    // parameters: ranges and the Int > 255 rule
    const specs = {
        "obj-ctrl-classes": [2, 4, 3, 1],
        "obj-ctrl-sharp": [0, 100, 60, 0],
        "obj-ctrl-smooth": [0, 60, 8, 0],
        "obj-ctrl-gain": [-70, 18, 0, 0],
    };
    for (const [id, [lo, hi, init, type]] of Object.entries(specs)) {
        const v = byId[id].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_mmin, lo, `${id} min`);
        assert.strictEqual(v.parameter_mmax, hi, `${id} max`);
        assert.strictEqual(v.parameter_initial[0], init, `${id} initial`);
        assert.strictEqual(v.parameter_type, type, `${id} parameter type`);
    }
    // the config defaults and the widget defaults agree
    assert.strictEqual(C.TSPLIT_DEFAULT_CLASSES, 3);
    assert.strictEqual(C.TSPLIT_DEFAULT_SHARP, 60);
    assert.strictEqual(C.TSPLIT_DEFAULT_SMOOTH, 8);
    for (const b of boxes) {
        const v = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
        if (v && v.parameter_type === 1) assert.ok((v.parameter_mmax || 0) <= 255, `Int parameter ${b.id} exceeds 255`);
        if (v && v.parameter_mmin !== undefined && v.parameter_mmax !== undefined) {
            assert.ok(v.parameter_mmin < v.parameter_mmax, `${b.id} range`);
            const init = (v.parameter_initial || [v.parameter_mmin])[0];
            assert.ok(init >= v.parameter_mmin && init <= v.parameter_mmax, `${b.id} initial in range`);
        }
    }
    for (const id of ["obj-ctrl-learn", "obj-ctrl-adapt"]) {
        const v = byId[id].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_type, 2);
        assert.deepStrictEqual(v.parameter_initial, [0], `${id} starts off`);
    }
    // saved state blob: versioned, pattr parameter_type 3, initial = the version-1 prefix (no centroids)
    const pat = byId["obj-state-pattr"].saved_attribute_attributes.valueof;
    assert.strictEqual(pat.parameter_type, 3);
    assert.strictEqual(pat.parameter_initial[0], C.TSPLIT_STATE_VERSION);
    const dflt = C.decodeStateBlob(pat.parameter_initial, C.defaultState());
    assert.strictEqual(dflt.classes, 3);
    assert.strictEqual(dflt.sharp, 60);
    assert.strictEqual(dflt.smooth, 8);
    assert.strictEqual(dflt.learned, 0, "the initial blob has no learned centroids");
    console.log("[PASS] device JSON: header, 440x169, latency 2048, layout / overlap / panel / #0- / parameter rules, wiring, blob");
}

// =========================================================================
// 2. GENEXPR RULES
// =========================================================================
{
    const code = LIB_SRC + "\n" + CORE_SRC;
    const lines = code.split("\n");
    let firstDecl = -1;
    let lastFn = -1;
    lines.forEach((ln, i) => {
        if (/^(Buffer|Param|History|Data|Delay)\b/.test(ln) && firstDecl < 0) firstDecl = i;
        if (/^[A-Za-z_][A-Za-z0-9_]*\([^)]*\)\s*\{\s*$/.test(ln)) lastFn = i;
    });
    assert.ok(firstDecl > 0 && lastFn >= 0 && lastFn < firstDecl, "every function precedes the first Buffer / Param / History / Data / Delay declaration");
    const decls = lines.slice(firstDecl).filter((ln) => /^(Buffer|Param|History|Data|Delay)\b/.test(ln));
    const lastDecl = lines.lastIndexOf(decls[decls.length - 1]);
    assert.ok(!lines.slice(firstDecl, lastDecl).some((ln) => /^[a-z]\w* = /.test(ln)), "all declarations precede the expression statements");
    const stripped = code.replace(/\/\/.*$/gm, "");
    assert.ok(!/\be\d*\b\s*(=|\+=|-=)/.test(stripped) && !/\b[(,]\s*e\d*\s*[,)]/.test(stripped), "no identifier named e or e<digits>");
    assert.ok(!/\b(pi|phi)\s*(=|\+=)/.test(stripped), "no identifier named pi / phi");
    assert.ok(!/\bdelay\s*\(/.test(stripped), "no delay() call; Delay objects only");
    // no early return in a block: a `return` must sit at function level (one tab)
    for (const ln of CORE_SRC.split("\n")) {
        if (/^\t{2,}return\b/.test(ln)) assert.fail(`early return inside a block: ${ln.trim()}`);
    }
    assert.ok(/Buffer scope\("tsplitscope"\);/.test(CORE_SRC), "telemetry Buffer bound by the GenExpr variable name");
    assert.ok(/Buffer cent\("tsplitcent"\);/.test(CORE_SRC), "centroid Buffer bound by the GenExpr variable name");
    for (const prm of ["classes", "sharp", "smooth", "gain", "cmask"]) assert.ok(new RegExp(`^Param ${prm}\\(`, "m").test(CORE_SRC), `Param ${prm}`);
    assert.ok(/^Delay dl1\(4096\);$/m.test(CORE_SRC) && /dl1\.read\(2048\)/.test(CORE_SRC) && /dl2\.read\(2048\)/.test(CORE_SRC), "2048-sample audio delay");
    assert.ok(/^out1 = dl1\.read\(2048\) \* gsum \* gn;$/m.test(CORE_SRC) && /^out2 = /m.test(CORE_SRC), "two audio outputs only");
    assert.ok(!/^out3 =/m.test(CORE_SRC), "no control output");
    assert.ok(/rdy = stft_in\(ring, st, xm, 1024\);/.test(CORE_SRC), "N 1024 / hop 256 analysis");
    assert.ok(/ts_kernel\(kern, smooth, samplerate\);/.test(CORE_SRC) && /ts_smooth\(tr, sw, kern, jn\);/.test(CORE_SRC), "memberships are smoothed over hops");
    // History values written and read in the same sample go through temps (checked by name list)
    for (const h of ["gate", "quiet", "hopidx", "primed", "curw", "head", "cntr", "gls", "m0s", "m3s"]) {
        assert.ok(new RegExp(`^History ${h}\\(`, "m").test(CORE_SRC), `History ${h}`);
    }
    // the JS mirror uses the same constants as the gen code
    for (const [re, val] of [[/ts_classify\(ft, cn, nk, bt, curw\)/, 1], [/pow\(40\., clip\(sharp, 0, 100\) \* 0\.01\)/, 1], [/\* gsum \* gn/, 1]]) {
        assert.ok(re.test(CORE_SRC) && val, `core keeps ${re}`);
    }
    assert.strictEqual(C.TSPLIT_SMOOTH_HALF, 3, "the gen core's 7-tap kernel");
    assert.ok(/Data kern\(7\);/.test(CORE_SRC) && /for \(i = 0; i < 7; i \+= 1\) \{\n\t\txo = i - 3;/.test(CORE_SRC) && /r = jm \+ 10 \+ i;/.test(CORE_SRC), "gen kernel = 2 * 3 + 1 taps over rows jm - 6 .. jm");
    assert.ok(/bonus = k == cur \? 1\. : 0\./.test(CORE_SRC), "hysteresis bonus = TSPLIT_HYST_DIST (1.0)");
    assert.strictEqual(C.TSPLIT_HYST_DIST, 1.0);
    assert.ok(/0\.1 \* pow\(40\./.test(CORE_SRC), "beta law matches sharpToBeta");
    console.log("[PASS] GenExpr ordering, lexer, no-early-return and interface rules");
}

// =========================================================================
// 3. PURE MATHS
// =========================================================================
{
    // Sharp -> beta
    assert.ok(Math.abs(C.sharpToBeta(0) - 0.1) < 1e-12 && Math.abs(C.sharpToBeta(100) - 4) < 1e-9);
    assert.ok(C.sharpToBeta(60) > C.sharpToBeta(30), "beta grows with Sharp");

    // memberships sum to 1, are ordered by distance, and Sharp sharpens them
    const cents = C.TSPLIT_PRIOR_CENTROIDS;
    const probe = cents[1].map((v, d) => v + 0.6 * Math.sin(d));
    for (const K of [2, 3, 4]) {
        for (const sharp of [0, 30, 60, 100]) {
            const r = C.classifyFrame(probe, cents, K, C.sharpToBeta(sharp), 0);
            const s = r.p.reduce((a, b) => a + b, 0);
            assert.ok(Math.abs(s - 1) < 1e-12, `memberships sum to 1 (K ${K}, Sharp ${sharp}): ${s}`);
            for (let k = K; k < 4; k++) assert.strictEqual(r.p[k], 0, "classes beyond K carry no weight");
        }
    }
    const soft = C.classifyFrame(probe, cents, 3, C.sharpToBeta(0), 0);
    const hard = C.classifyFrame(probe, cents, 3, C.sharpToBeta(100), 0);
    assert.strictEqual(hard.winner, 1, "nearest class wins");
    assert.ok(hard.p[1] > soft.p[1] && hard.p[1] > 0.99, `Sharp 100 is near-binary (${hard.p[1].toFixed(4)} vs soft ${soft.p[1].toFixed(3)})`);

    // hysteresis: an incumbent a hair farther away keeps winning, a clearly closer challenger takes over
    const mid = cents[0].map((v, d) => 0.5 * (v + cents[1][d]));
    const nudged = mid.map((v, d) => v + 0.15 * (cents[1][d] - cents[0][d]) / 8);
    const b = C.sharpToBeta(60);
    assert.strictEqual(C.classifyFrame(nudged, cents, 2, b, 0).winner, 0, "incumbent 0 keeps a near-boundary frame");
    assert.strictEqual(C.classifyFrame(nudged, cents, 2, b, 1).winner, 1, "incumbent 1 keeps the same frame");
    assert.strictEqual(C.classifyFrame(cents[1], cents, 2, b, 0).winner, 1, "a clearly closer challenger still takes over");

    // smoothing kernel
    for (const ms of [0, 2, 8, 30, 60]) {
        const k = C.smoothKernel(ms, SR);
        assert.strictEqual(k.length, 2 * C.TSPLIT_SMOOTH_HALF + 1);
        assert.ok(Math.abs(k.reduce((a, c) => a + c, 0) - 1) < 1e-12, `kernel sums to 1 (${ms} ms)`);
        assert.ok(k.every((v, i) => Math.abs(v - k[k.length - 1 - i]) < 1e-12), "symmetric");
    }
    assert.strictEqual(C.smoothKernel(0, SR)[C.TSPLIT_SMOOTH_HALF], 1, "Smooth 0 is a delta");

    // class-mask partition: any number of linked chains P and classes K, Auto masks cover every class exactly once
    for (let K = 2; K <= 4; K++) {
        for (let P = 1; P <= 6; P++) {
            let union = 0;
            let overlap = 0;
            for (let r = 0; r < P; r++) {
                const m = C.resolveEffectiveClassMask(0, r, P, K, 1);
                overlap |= union & m;
                union |= m;
            }
            assert.strictEqual(union, (1 << K) - 1, `Auto masks of ${P} chains cover all ${K} classes (${union})`);
            assert.strictEqual(overlap, 0, `Auto masks of ${P} chains never share a class (K ${K})`);
        }
    }
    assert.strictEqual(C.resolveEffectiveClassMask(0, 0, 3, 3, 1), 1, "chain 0 of 3 passes class 1");
    assert.strictEqual(C.resolveEffectiveClassMask(0, 2, 3, 3, 1), 4, "chain 2 of 3 passes class 3");
    assert.strictEqual(C.resolveEffectiveClassMask(0, 1, 2, 3, 1), 6, "last of 2 chains with 3 classes takes the leftovers (2 + 3)");
    assert.strictEqual(C.resolveEffectiveClassMask(0, 0, 1, 4, 1), 15, "a single chain passes everything");
    assert.strictEqual(C.resolveEffectiveClassMask(0, 3, 4, 3, 1), 0, "a chain without a class is silent");
    assert.strictEqual(C.resolveEffectiveClassMask(2, 0, 3, 3, 1), 2, "Class 2 solo");
    assert.strictEqual(C.resolveEffectiveClassMask(4, 0, 3, 3, 1), 4, "solo beyond K clamps to the last class");
    assert.strictEqual(C.resolveEffectiveClassMask(5, 0, 3, 3, 0b101), 5, "multi mask");
    assert.strictEqual(C.resolveEffectiveClassMask(5, 0, 3, 3, 0b1111), 7, "multi mask is limited to K classes");

    // state blob: versioned, round trips, older / shorter / future arrays load
    const st = C.defaultState();
    st.classes = 4; st.sharp = 72; st.smooth = 21; st.adapt = 1; st.classMode = 5; st.customMask = 6;
    st.linkGroup = 2; st.gainDb = -6.5; st.showLinkStatus = 0; st.learned = 1;
    st.centroids = st.centroids.map((c, k) => c.map((v, d) => v + k * 0.25 - d * 0.01));
    const blob = C.encodeStateBlob(st);
    assert.strictEqual(blob[0], C.TSPLIT_STATE_VERSION, "first element is the version");
    assert.strictEqual(blob.length, 11 + 4 * 13);
    assert.deepStrictEqual(C.decodeStateBlob(blob, C.defaultState()), st, "blob round trip");
    const short = C.decodeStateBlob(blob.slice(0, 11), C.defaultState());
    assert.deepStrictEqual(short.centroids, C.defaultState().centroids, "prefix-only blob keeps the base centroids");
    assert.strictEqual(short.classes, 4);
    assert.strictEqual(short.learned, 1);
    assert.strictEqual(C.decodeStateBlob([1, 2, 10, 5], C.defaultState()).classes, 2, "a 4-element v1 blob still loads");
    const future = blob.slice();
    future[0] = 99;
    future.push(1, 2, 3);
    assert.deepStrictEqual(C.decodeStateBlob(future, C.defaultState()), st, "a future version keeps parsing the v1 prefix");
    assert.deepStrictEqual(C.decodeStateBlob([], C.defaultState()), C.defaultState(), "empty blob = defaults");
    assert.deepStrictEqual(C.decodeStateBlob([0, 4, 1, 1], C.defaultState()), C.defaultState(), "version 0 is ignored");
    const bad = blob.slice();
    bad[20] = NaN;
    assert.deepStrictEqual(C.decodeStateBlob(bad, C.defaultState()).centroids, C.defaultState().centroids, "NaN centroids are rejected");
    const clamped = C.decodeStateBlob([1, 9, 500, -4, 3, 9, 99, 9, 99, 2, 5], C.defaultState());
    assert.ok(clamped.classes === 4 && clamped.sharp === 100 && clamped.smooth === 0 && clamped.classMode === 5 &&
        clamped.customMask === 15 && clamped.linkGroup === 5 && clamped.gainDb === 18, "out-of-range values clamp");
    assert.strictEqual(C.centroidsToBufferArray(st.centroids).length, 64);
    assert.strictEqual(C.centroidsToBufferArray(st.centroids)[16 + 2], st.centroids[1][2], "centroid k sits at k * 16");

    // rack paths
    const p1 = C.parseRackContextFromPath("live_set tracks 0 devices 0 chains 2 devices 1");
    assert.deepStrictEqual([p1.parentRackPath, p1.chainIndex, p1.deviceIndex, p1.nestingDepth, p1.isInRack],
        ["live_set tracks 0 devices 0", 2, 1, 1, true]);
    assert.strictEqual(p1.shortLabel, "RACK #1 CH3");
    const p2 = C.parseRackContextFromPath("live_set tracks 3 devices 2 chains 1 devices 0 chains 4 devices 0");
    assert.deepStrictEqual([p2.parentRackPath, p2.chainIndex, p2.nestingDepth], ["live_set tracks 3 devices 2 chains 1 devices 0", 4, 2]);
    assert.strictEqual(p2.shortLabel, "SUB-RACK L2 CH5");
    const p3 = C.parseRackContextFromPath("live_set tracks 1 devices 3");
    assert.deepStrictEqual([p3.isInRack, p3.parentRackPath, p3.chainIndex, p3.deviceIndex], [false, "live_set tracks 1", 0, 3]);
    assert.strictEqual(C.parseRackContextFromPath("").parentRackPath, "standalone_default");
    assert.strictEqual(C.resolveLinkGroupKey(0, "live_set tracks 0 devices 0"), "rack_group::live_set tracks 0 devices 0");
    assert.strictEqual(C.resolveLinkGroupKey(2, "x"), "manual_group_B");
    assert.strictEqual(C.resolveLinkGroupKey(5, "x"), null);

    // leader election and learn timing
    const peers = [
        { id: "c", chainIndex: 2, deviceIndex: 0, order: 1 },
        { id: "b2", chainIndex: 1, deviceIndex: 1, order: 5 },
        { id: "b", chainIndex: 1, deviceIndex: 0, order: 9 },
    ];
    assert.strictEqual(C.electLeaderId(peers), "b", "the left-most device of the first chain leads");
    assert.deepStrictEqual(C.sortPeerDescriptors(peers).map((q) => q.id), ["b", "b2", "c"]);
    assert.strictEqual(C.electLeaderId([]), null);
    assert.strictEqual(C.learnHopsForBars(6, 120, 48000), Math.round(12 * 48000 / 256), "6 bars at 120 bpm = 12 s of hops");
    assert.ok(C.learnHopsForBars(4, 60, 48000) > C.learnHopsForBars(4, 120, 48000));
    assert.ok(Math.abs(C.gainDbToLinear(-6.0206) - 0.5) < 1e-4 && C.gainDbToLinear(-70) === 0 && C.gainDbToLinear(0) === 1);
    console.log("[PASS] maths: memberships, hysteresis, kernel, class-mask partition, blob versions, rack paths, leader");
}

// =========================================================================
// 4. ONLINE K-MEANS ON SYNTHETIC KICK / SNARE / HAT SIGNALS
// =========================================================================
const learnSig = R.synthDrumLoop(SR, R.defaultDrumPattern(), 11.2);
let learned = null;
{
    // MFCC frames come from the mirror's analysis of the signal
    const split = new R.TimbreSplitRef(SR, { classes: 3 });
    const learner = C.createKMeansLearner(3, 4242);
    const online = C.createKMeansLearner(3, 4242);
    const frames = [];
    split.onHop = (h) => {
        if (h.feat) {
            learner.add(h.feat);
            online.add(h.feat);
            frames.push(h.feat);
        }
    };
    for (let i = 0; i < learnSig.L.length; i++) split.push(learnSig.L[i], learnSig.R[i]);
    assert.ok(frames.length > 600, `enough active frames (${frames.length})`);
    learned = learner.finalize();
    assert.strictEqual(learned.length, 3);
    for (let k = 1; k < 3; k++) assert.ok(learned[k - 1][0] >= learned[k][0], "classes are ordered by c1, darkest first");
    // determinism
    const again = C.createKMeansLearner(3, 4242);
    for (const f of frames) again.add(f);
    assert.deepStrictEqual(JSON.stringify(again.finalize()), JSON.stringify(learned), "learning is deterministic");

    // classification accuracy per hop, per class: windows fully inside one event, gate open
    function accuracy(cents) {
        const hits = [[0, 0], [0, 0], [0, 0]];
        const run = new R.TimbreSplitRef(SR, { classes: 3, sharp: 60, smooth: 8 }, cents);
        let n = 0;
        run.onHop = (h) => {
            n++;
            const e = n * 256 - 1;
            if (!h.feat) return;
            for (const ev of learnSig.events) {
                if (e - 1023 >= ev.start && e <= ev.end) {
                    hits[ev.kind][1]++;
                    if (h.winner === ev.kind) hits[ev.kind][0]++;
                }
            }
        };
        for (let i = 0; i < learnSig.L.length; i++) run.push(learnSig.L[i], learnSig.R[i]);
        return hits;
    }
    const acc = accuracy(learned);
    const names = ["kick", "snare", "hat"];
    for (let k = 0; k < 3; k++) {
        assert.ok(acc[k][1] >= 100, `${names[k]}: ${acc[k][1]} evaluated hops`);
        assert.ok(acc[k][0] / acc[k][1] > 0.9, `${names[k]} per-hop accuracy ${(100 * acc[k][0] / acc[k][1]).toFixed(1)} % must exceed 90 %`);
    }
    const accOnline = accuracy(online.centroids()); // the live estimate shown while learning
    for (let k = 0; k < 3; k++) {
        assert.ok(accOnline[k][0] / accOnline[k][1] > 0.9, `${names[k]} live estimate accuracy ${(100 * accOnline[k][0] / accOnline[k][1]).toFixed(1)} %`);
    }
    // a short take (too few distinct timbres) still returns K usable centroids
    const tiny = C.createKMeansLearner(3, 1);
    for (let i = 0; i < 50; i++) tiny.add(learned[0].map((v) => v + 0.01 * (i % 3)));
    assert.strictEqual(tiny.finalize().length, 3, "one timbre in -> K centroids out");
    console.log(`[PASS] k-means: ${names.map((n, k) => `${n} ${(100 * acc[k][0] / acc[k][1]).toFixed(1)} % of ${acc[k][1]}`).join(", ")} per hop (live estimate: ` +
        `${accOnline.map((a) => (100 * a[0] / a[1]).toFixed(1)).join(" / ")} %)`);
}

// =========================================================================
// 5. PERFECT RECONSTRUCTION, ISOLATION, TRANSIENTS, LATENCY, GAIN, CHATTER (JS mirror)
// =========================================================================
{
    const params = { classes: 3, sharp: 60, smooth: 8 };
    const delay = C.TSPLIT_LATENCY;
    function residualDb(outs, sig) {
        let num = 0;
        let den = 0;
        let maxd = 0;
        for (let i = delay; i < sig.L.length; i++) {
            let sL = 0;
            let sR = 0;
            for (const o of outs) {
                sL += o.L[i];
                sR += o.R[i];
            }
            const dl = sL - sig.L[i - delay];
            const dr = sR - sig.R[i - delay];
            num += dl * dl + dr * dr;
            den += sig.L[i - delay] ** 2 + sig.R[i - delay] ** 2;
            maxd = Math.max(maxd, Math.abs(dl), Math.abs(dr));
        }
        return { db: dbOf(num / den + 1e-300), maxd };
    }
    const overlapSig = R.synthDrumLoop(SR, R.overlappedDrumPattern(), 8.4);
    let worst = -Infinity;
    const lines = [];
    for (const [label, sig] of [["sequence", learnSig], ["overlapped loop", overlapSig]]) {
        for (const K of [2, 3, 4]) {
            const cents = K === 3 ? learned : C.TSPLIT_PRIOR_CENTROIDS.map((c) => c.slice());
            for (const P of [K, Math.max(1, K - 1)]) {
                const masks = [];
                for (let r = 0; r < P; r++) masks.push(C.resolveEffectiveClassMask(0, r, P, K, 1));
                const out = R.renderChains(SR, { classes: K, sharp: 60, smooth: 8 }, cents, sig.L, sig.R, masks);
                const r = residualDb(masks.map((_, i) => ({ L: out.outL[i], R: out.outR[i] })), sig);
                worst = Math.max(worst, r.db);
                assert.ok(r.db < -120, `${label}: K ${K}, ${P} chains: sum - delayed input = ${r.db.toFixed(1)} dB (must be < -120 dB)`);
                if (K === 3 && P === 3) lines.push(`${label} K3 ${r.db.toFixed(0)} dB`);
            }
        }
    }
    // the sum also holds for odd settings (Sharp 0 / 100, Smooth 0 / 60) and with the gate and idle paths in use
    for (const [sharp, smooth] of [[0, 0], [100, 0], [0, 60], [100, 60], [37, 25]]) {
        const out = R.renderChains(SR, { classes: 3, sharp, smooth }, learned, overlapSig.L, overlapSig.R, [1, 2, 4]);
        const r = residualDb([0, 1, 2].map((i) => ({ L: out.outL[i], R: out.outR[i] })), overlapSig);
        worst = Math.max(worst, r.db);
        assert.ok(r.db < -120, `Sharp ${sharp} Smooth ${smooth}: residual ${r.db.toFixed(1)} dB`);
    }
    const silent = { L: new Float64Array(SR * 2), R: new Float64Array(SR * 2) };
    silent.L.set(learnSig.L.subarray(0, SR / 2), 0);
    silent.R.set(learnSig.R.subarray(0, SR / 2), 0);
    {
        const out = R.renderChains(SR, params, learned, silent.L, silent.R, [1, 2, 4]);
        const r = residualDb([0, 1, 2].map((i) => ({ L: out.outL[i], R: out.outR[i] })), silent);
        assert.ok(r.db < -120, `through silence and idle: ${r.db.toFixed(1)} dB`);
    }

    // per-hop and per-sample membership sums
    {
        const split = new R.TimbreSplitRef(SR, params, learned);
        let maxErr = 0;
        for (let i = 0; i < overlapSig.L.length; i++) {
            const o = split.push(overlapSig.L[i], overlapSig.R[i]);
            if (i < 256) continue; // before the first hop there are no gains yet (the output is still the empty delay line)
            const s = o.g[0] + o.g[1] + o.g[2] + o.g[3];
            maxErr = Math.max(maxErr, Math.abs(s - 1));
            assert.strictEqual(o.g[3], 0, "no weight on a class beyond K");
        }
        assert.ok(maxErr < 1e-12, `per-sample class gains sum to 1 (max error ${maxErr})`);
        const hopSplit = new R.TimbreSplitRef(SR, params, learned);
        let maxHop = 0;
        hopSplit.onHop = (h) => {
            if (h.p) maxHop = Math.max(maxHop, Math.abs(h.p[0] + h.p[1] + h.p[2] + h.p[3] - 1));
            maxHop = Math.max(maxHop, Math.abs(h.hold[0] + h.hold[1] + h.hold[2] + h.hold[3] - 1));
        };
        for (let i = 0; i < overlapSig.L.length; i++) hopSplit.push(overlapSig.L[i], overlapSig.R[i]);
        assert.ok(maxHop < 1e-12, `per-hop memberships sum to 1 (max error ${maxHop})`);
    }

    // class isolation: each hit goes to its chain, > 95 % of its energy (sequence) / > 90 % (overlapped loop)
    {
        const out = R.renderChains(SR, params, learned, learnSig.L, learnSig.R, [1, 2, 4]);
        const E = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const ev of learnSig.events) {
            for (let c = 0; c < 3; c++) {
                for (let i = ev.start; i < ev.end; i++) E[ev.kind][c] += out.outL[c][i + delay] ** 2;
            }
        }
        for (let k = 0; k < 3; k++) {
            const t = E[k][0] + E[k][1] + E[k][2];
            assert.ok(E[k][k] / t > 0.95, `${R.DRUM[k].name} chain keeps ${(100 * E[k][k] / t).toFixed(1)} % of its hit energy`);
        }
        const out2 = R.renderChains(SR, params, learned, overlapSig.L, overlapSig.R, [1, 2, 4]);
        const E2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const ev of overlapSig.events) {
            for (let c = 0; c < 3; c++) {
                for (let i = ev.start; i < ev.end; i++) E2[ev.kind][c] += out2.outL[c][i + delay] ** 2;
            }
        }
        // the kick / snare / hat chains of the overlapped loop (hats sit on top of the other drums)
        const fr = [0, 1, 2].map((k) => E2[k][k] / (E2[k][0] + E2[k][1] + E2[k][2]));
        for (let k = 0; k < 3; k++) assert.ok(fr[k] > 0.9, `overlapped loop: ${R.DRUM[k].name} chain keeps ${(100 * fr[k]).toFixed(1)} %`);

        // transients are not chopped: the first 3 ms of every hit of the isolated sequence already lands in its own chain
        const n3 = Math.round(0.003 * SR);
        let worstOnset = 1;
        for (const ev of learnSig.events) {
            let own = 0;
            let tot = 0;
            for (let i = ev.start; i < ev.start + n3; i++) {
                for (let c = 0; c < 3; c++) {
                    const e = out.outL[c][i + delay] ** 2;
                    tot += e;
                    if (c === ev.kind) own += e;
                }
            }
            worstOnset = Math.min(worstOnset, own / Math.max(tot, 1e-30));
        }
        assert.ok(worstOnset > 0.95, `first 3 ms of every hit goes to its chain (worst ${(100 * worstOnset).toFixed(1)} %)`);
        // and the hit's own chain carries its peak: the worst peak of any hit loses < 0.75 dB at the defaults
        // (the soft hand-over of Sharp 60), and < 0.1 dB with Sharp 100
        const peakLoss = (o, sig) => {
            let worstLoss = 0;
            for (const ev of sig.events) {
                let inPk = 0;
                let outPk = 0;
                for (let i = ev.start; i < ev.end; i++) {
                    inPk = Math.max(inPk, Math.abs(sig.L[i]));
                    outPk = Math.max(outPk, Math.abs(o.outL[ev.kind][i + delay]));
                }
                worstLoss = Math.max(worstLoss, 20 * Math.log10(inPk / outPk));
            }
            return worstLoss;
        };
        const worstPeak = peakLoss(out, learnSig);
        assert.ok(worstPeak < 0.75, `hit peaks survive in their chain (worst loss ${worstPeak.toFixed(2)} dB)`);
        const sharpOut = R.renderChains(SR, { classes: 3, sharp: 100, smooth: 8 }, learned, learnSig.L, learnSig.R, [1, 2, 4]);
        const sharpPeak = peakLoss(sharpOut, learnSig);
        assert.ok(sharpPeak < 0.1, `Sharp 100: peaks survive (worst loss ${sharpPeak.toFixed(3)} dB)`);
        lines.push(`onset ${(100 * worstOnset).toFixed(1)} % in 3 ms, peak loss ${worstPeak.toFixed(2)} dB (Sharp 100: ${sharpPeak.toFixed(3)})`);
    }

    // constant latency: a lone impulse leaves exactly 2048 samples later, through the passing chain
    {
        const imp = new Float64Array(SR);
        imp[1000] = 0.5;
        const out = R.renderChains(SR, params, learned, imp, imp, [7]);
        let first = -1;
        for (let i = 0; i < SR; i++) {
            if (out.outL[0][i] !== 0) { first = i; break; }
        }
        assert.strictEqual(first, 1000 + C.TSPLIT_LATENCY, "impulse appears exactly 2048 samples later");
        assert.ok(Math.abs(out.outL[0][first] - 0.5) < 1e-15, "a chain that passes every class returns the input (to 1 ulp)");
    }

    // gain and mask: -inf mutes, +6 dB scales, a single chain passing all classes is the delayed input, Class mask 0 is silent
    {
        const sig = { L: learnSig.L.subarray(0, SR * 3), R: learnSig.R.subarray(0, SR * 3) };
        const out = R.renderChains(SR, params, learned, sig.L, sig.R, [15, 15, 15, 0], [0, 6.0206, -70, 0]);
        let maxMute = 0;
        let maxErr0 = 0;
        let maxErr6 = 0;
        for (let i = delay + 4000; i < sig.L.length; i++) {
            maxErr0 = Math.max(maxErr0, Math.abs(out.outL[0][i] - sig.L[i - delay]));
            maxErr6 = Math.max(maxErr6, Math.abs(out.outL[1][i] - 2 * sig.L[i - delay]));
            maxMute = Math.max(maxMute, Math.abs(out.outL[2][i]), Math.abs(out.outL[3][i]));
        }
        assert.ok(maxErr0 < 1e-12, `all-class chain = delayed input (${maxErr0})`);
        assert.ok(maxErr6 < 1e-3, `+6 dB doubles it (${maxErr6})`);
        assert.strictEqual(maxMute, 0, "-inf dB gain and an empty mask are silent");
    }

    // chatter: the incumbent bonus bounds winner flips on a boundary-hugging feature stream
    {
        const c0 = learned[0];
        const c1 = learned[1];
        const rnd = R.lcg(99);
        const beta = C.sharpToBeta(60);
        let withHyst = 0;
        let without = 0;
        let curA = 0;
        let curB = 0;
        for (let i = 0; i < 4000; i++) {
            const t = 0.5 + 0.08 * rnd(); // jitters around the midpoint between the two class centres
            const feat = c0.map((v, d) => v + t * (c1[d] - v) + 0.05 * rnd());
            const a = C.classifyFrame(feat, learned, 2, beta, curA).winner;
            const b2 = C.classifyFrame(feat, learned, 2, beta, -1).winner;
            if (a !== curA) withHyst++;
            if (b2 !== curB) without++;
            curA = a;
            curB = b2;
        }
        assert.ok(without > 200, `the stream really sits on the boundary (${without} flips without hysteresis)`);
        assert.ok(withHyst < 0.1 * without, `hysteresis cuts flips from ${without} to ${withHyst}`);
        // and on the real drum signal: winner switches stay within about two per hit
        const split = new R.TimbreSplitRef(SR, params, learned);
        let prev = -1;
        let flips = 0;
        split.onHop = (h) => {
            if (!h.feat) return;
            if (prev >= 0 && h.winner !== prev) flips++;
            prev = h.winner;
        };
        for (let i = 0; i < overlapSig.L.length; i++) split.push(overlapSig.L[i], overlapSig.R[i]);
        assert.ok(flips <= overlapSig.events.length * 3, `winner flips on the overlapped loop: ${flips} for ${overlapSig.events.length} hits`);
        lines.push(`flips ${withHyst} vs ${without} on a boundary stream, ${flips} on ${overlapSig.events.length} hits`);
    }
    console.log(`[PASS] reconstruction: worst residual ${worst.toFixed(1)} dB (< -120), sums = 1, latency 2048, isolation; ${lines.join("; ")}`);
}

// =========================================================================
// 6. THE V8UI WITH MOCKED MAX
// =========================================================================
{
    const combinedCode = CONFIG_SRC + "\n\n" + UI_SRC;
    const sharedBus = { groups: {}, peers: {} };
    const buffers = {};
    const refHops = [];
    {
        const split = new R.TimbreSplitRef(SR, { classes: 3, sharp: 60, smooth: 8 });
        split.onHop = (h) => refHops.push(h);
        for (let i = 0; i < learnSig.L.length; i++) split.push(learnSig.L[i], learnSig.R[i]);
    }
    const makeCols = (hops, startCounter, scope) => {
        let head = scope[1];
        let counter = startCounter;
        for (const h of hops) {
            head = (head + 1) % 128;
            const base = 32 + head * 20;
            for (let k = 0; k < 13; k++) scope[base + k] = h.feat ? h.feat[k] : 0;
            scope[base + 13] = h.c0;
            for (let k = 0; k < 4; k++) scope[base + 14 + k] = h.hold[k];
            scope[base + 18] = h.feat ? h.winner + 1 : 0;
            scope[base + 19] = h.gate;
            counter++;
        }
        scope[1] = head;
        scope[0] = counter;
        return counter;
    };

    let instCount = 0;
    function createUiInstance(lomPath) {
        const id = ++instCount;
        const emitted = [];
        const drawCmds = [];
        const sandbox = {
            Math, Date, Number, String, Boolean, Array, Object, JSON, parseInt, isNaN,
            liveLomPath: lomPath || "",
            cursorHiddenCount: 0,
            cursorShownCount: 0,
            notified: 0,
            redraws: 0,
            max: { hidecursor() { sandbox.cursorHiddenCount++; }, showcursor() { sandbox.cursorShownCount++; } },
            global: { __tsplit_shared_bus: sharedBus },
            Global: function () { return sharedBus; },
            LiveAPI: function (cb, target) {
                const t = (typeof cb === "string" && target === undefined) ? cb : target;
                if (t === "this_device") {
                    this.path = sandbox.liveLomPath;
                    this.unquotedpath = sandbox.liveLomPath;
                    this.id = sandbox.liveLomPath ? "42" : "0";
                } else if (t === "live_set") {
                    this.path = "live_set";
                    this.id = "1";
                    this.get = function (prop) { return prop === "tempo" ? [120] : [0]; };
                } else {
                    this.path = t || "";
                    this.id = this.path ? "10" : "0";
                }
            },
            Buffer: function (name) {
                this.poke = function (_ch, offset, arr) {
                    const b = buffers[name] || (buffers[name] = new Float32Array(4096));
                    for (let i = 0; i < arr.length; i++) b[offset + i] = arr[i];
                };
                this.peek = function (_ch, offset, count) {
                    const b = buffers[name] || (buffers[name] = new Float32Array(4096));
                    return b.slice(offset, offset + count);
                };
            },
            Task: function () { this.interval = 40; this.repeat = function () {}; },
            mgraphics: {
                size: [270, 153],
                relative_coords: 1,
                autofill: 1,
                init() {},
                redraw() { sandbox.redraws++; },
                set_source_rgba(r, g, b, a) { drawCmds.push({ op: "rgba", r, g, b, a }); },
                set_line_width(w) { drawCmds.push({ op: "lw", w }); },
                rectangle(x, y, w, h) { drawCmds.push({ op: "rect", x, y, w, h }); },
                rectangle_rounded(x, y, w, h) { drawCmds.push({ op: "rrect", x, y, w, h }); },
                move_to(x, y) { drawCmds.push({ op: "move", x, y }); },
                line_to(x, y) { drawCmds.push({ op: "line", x, y }); },
                close_path() {},
                arc(x, y, r) { drawCmds.push({ op: "arc", x, y, r }); },
                fill() {},
                stroke() {},
                select_font_face() {},
                set_font_size(s) { drawCmds.push({ op: "font", s }); },
                show_text(t) { drawCmds.push({ op: "text", text: t }); },
            },
            inlets: 1,
            outlets: 1,
            outlet(idx, msg) { emitted.push(msg); },
            notifyclients() { sandbox.notified++; },
            patcher: { latency: 0, setattr(k, v) { if (k === "latency") sandbox.patcher.latency = v; } },
        };
        vm.createContext(sandbox);
        vm.runInContext(combinedCode, sandbox);
        assert.strictEqual(sandbox.mgraphics.relative_coords, 0, "v8ui must set mgraphics.relative_coords = 0");
        assert.strictEqual(sandbox.mgraphics.autofill, 0, "v8ui must set mgraphics.autofill = 0");
        sandbox.setbuffer(`scope_${id}`);
        sandbox.setcent(`cent_${id}`);
        buffers[`scope_${id}`] = new Float32Array(2592);
        sandbox.loadbang();
        sandbox.id = id;
        sandbox.emitted = emitted;
        sandbox.drawCmds = drawCmds;
        sandbox.lastEmit = (name) => {
            for (let i = emitted.length - 1; i >= 0; i--) if (emitted[i][0] === name) return emitted[i][1];
            return undefined;
        };
        return sandbox;
    }
    const J = (x) => JSON.parse(JSON.stringify(x));

    // ---- Auto class assignment per Rack chain ----
    const i1 = createUiInstance("live_set tracks 0 devices 0 chains 0 devices 0");
    assert.strictEqual(i1.getEffectiveMask(), 7, "one chain alone passes every class (K = 3)");
    assert.strictEqual(i1.lastEmit("cmask"), 7, "the gen core receives the mask");
    assert.strictEqual(i1.patcher.latency, 0);
    const i2 = createUiInstance("live_set tracks 0 devices 0 chains 1 devices 0");
    assert.strictEqual(i1.getEffectiveMask(), 1, "chain 0 of 2 passes class 1");
    assert.strictEqual(i2.getEffectiveMask(), 6, "last of 2 chains passes class 2 + the leftover class 3");
    const i3 = createUiInstance("live_set tracks 0 devices 0 chains 2 devices 0");
    assert.deepStrictEqual([i1, i2, i3].map((i) => i.getEffectiveMask()), [1, 2, 4], "3 chains: chain N passes class N");
    assert.strictEqual(i3.lastEmit("cmask"), 4);
    const i4 = createUiInstance("live_set tracks 0 devices 0 chains 3 devices 0");
    assert.strictEqual(i4.getEffectiveMask(), 0, "a 4th chain with 3 classes passes nothing");
    i1.set_classes(4);
    assert.deepStrictEqual([i1, i2, i3, i4].map((i) => i.getEffectiveMask()), [1, 2, 4, 8], "Classes 4 is shared with every linked instance");
    assert.ok([i1, i2, i3, i4].every((i) => i.curClasses === 4));
    i4.set_classes(3);
    assert.ok([i1, i2, i3, i4].every((i) => i.curClasses === 3), "Classes is linked in both directions");
    // Sharp / Smooth / Adapt are shared too
    i2.set_sharp(82);
    i3.set_smooth(21);
    i1.set_adapt(1);
    assert.ok([i1, i2, i3, i4].every((i) => i.curSharp === 82 && i.curSmooth === 21 && i.curAdapt === 1), "Sharp, Smooth and Adapt are linked");
    assert.strictEqual(i4.lastEmit("sharp"), 82, "the gen core receives Sharp");
    i1.set_adapt(0);
    // class mode and gain stay per chain
    i2.set_classmode(1);
    assert.strictEqual(i2.getEffectiveMask(), 1, "Class 1 solo on chain 2");
    assert.strictEqual(i1.curClassMode, 0, "class mode is not linked");
    i2.set_classmode(0);
    i2.set_gain(-12);
    assert.strictEqual(i3.curGainDb, 0, "gain is not linked");
    assert.strictEqual(i2.lastEmit("gain"), -12);
    i2.set_gain(0);
    // removal compacts the classes
    i4.notifydeleted();
    assert.deepStrictEqual([i1, i2, i3].map((i) => i.getEffectiveMask()), [1, 2, 4], "deleting a chain without a class changes nothing");
    i3.notifydeleted();
    assert.deepStrictEqual([i1, i2].map((i) => i.getEffectiveMask()), [1, 6], "deleting chain 3 hands its class to the last chain");
    i2.notifydeleted();
    assert.strictEqual(i1.getEffectiveMask(), 7, "the last remaining chain passes everything again");
    i1.notifydeleted();

    // ---- nested racks, Cmd+D isolation ----
    {
        const a = createUiInstance("live_set tracks 1 devices 0 chains 0 devices 0");
        const b = createUiInstance("live_set tracks 1 devices 0 chains 1 devices 0");
        const n1 = createUiInstance("live_set tracks 1 devices 0 chains 1 devices 1 chains 0 devices 0");
        const n2 = createUiInstance("live_set tracks 1 devices 0 chains 1 devices 1 chains 1 devices 0");
        assert.deepStrictEqual([a.getEffectiveMask(), b.getEffectiveMask()], [1, 6], "outer rack: 2 chains");
        assert.deepStrictEqual([n1.getEffectiveMask(), n2.getEffectiveMask()], [1, 6], "a chain within a chain links only with its own siblings");
        assert.notStrictEqual(n1.getActiveGroupKey(), a.getActiveGroupKey());
        const dup = createUiInstance("live_set tracks 1 devices 0 chains 0 devices 1");
        assert.strictEqual(dup.getActiveGroupKey().indexOf("rack_group::isolated::"), 0, "Cmd+D duplicate to the right is isolated");
        assert.strictEqual(a.getEffectiveMask(), 1, "the duplicate does not take a class away from the Rack");
        assert.strictEqual(dup.getEffectiveMask(), 7, "an isolated instance passes every class");
        [a, b, n1, n2, dup].forEach((i) => i.notifydeleted());
    }

    // ---- learning on the leader, centroids shared with every linked instance ----
    {
        const a = createUiInstance("live_set tracks 2 devices 0 chains 0 devices 0");
        const b = createUiInstance("live_set tracks 2 devices 0 chains 1 devices 0");
        const c = createUiInstance("live_set tracks 2 devices 0 chains 2 devices 0");
        const all = [a, b, c];
        assert.ok(a.isLeader() && !b.isLeader() && !c.isLeader(), "the first chain is the leader");
        assert.strictEqual(a.curLearned, 0);
        const preCents = J(c.centroids);
        // the factory prior is already in every gen buffer
        for (const i of all) assert.ok(Math.abs(buffers[`cent_${i.id}`][0] - C.TSPLIT_PRIOR_CENTROIDS[0][0]) < 1e-5, "prior centroids poked into the buffer");
        a.TSPLIT_LEARN_BARS = 5; // 5 bars at 120 bpm = 10 s of hops

        // a follower's Learn button starts the leader's take; everyone mirrors it
        c.set_learn(1);
        assert.ok(a.learning && a.learnOwner, "the follower's request started learning on the leader");
        assert.ok(b.learning && !b.learnOwner && c.learning && !c.learnOwner, "followers mirror the learning state");
        assert.strictEqual(a.lastEmit("ui_learn"), 1);
        assert.ok(a.learnTargetHops > 1500 && a.learnTargetHops < 2400, `target ${a.learnTargetHops} hops`);

        // feed telemetry in polls of 7 hops (40 ms) to all instances
        const scopes = all.map((i) => buffers[`scope_${i.id}`]);
        let fedHops = 0;
        let sawProgress = false;
        for (let h = 0; h < refHops.length && a.learning; h += 7) {
            const batch = refHops.slice(h, h + 7);
            for (const s of scopes) makeCols(batch, s[0], s);
            fedHops += batch.length;
            for (const i of all) i.pullScope();
            if (a.learnProgress > 0.3 && a.learnProgress < 0.9) {
                sawProgress = true;
                assert.ok(b.learnProgress > 0.1, "followers see the leader's progress");
            }
        }
        assert.ok(sawProgress, "progress was reported");
        assert.ok(!a.learning && !b.learning && !c.learning, "learning ended on every instance");
        assert.strictEqual(a.lastEmit("ui_learn"), 0, "Learn buttons switch back off");
        assert.ok(a.curLearned === 1 && b.curLearned === 1 && c.curLearned === 1, "learned flag shared");
        assert.ok(fedHops >= a.learnTargetHops, "the take ran for its target length");
        assert.notDeepStrictEqual(J(c.centroids), preCents, "centroids changed");
        const ref0 = J(a.centroids);
        for (const i of all) {
            assert.deepStrictEqual(J(i.centroids), ref0, `instance ${i.id} holds the leader's centroids`);
            const buf = buffers[`cent_${i.id}`];
            for (let k = 0; k < 3; k++) {
                for (let d = 0; d < 13; d++) assert.ok(Math.abs(buf[k * 16 + d] - ref0[k][d]) < 1e-3, "gen buffer holds the shared centroids");
            }
        }
        // the shared centroids really classify the drums (through the mirror)
        let good = 0;
        let total = 0;
        const probe = new R.TimbreSplitRef(SR, { classes: 3 }, a.centroids);
        let n = 0;
        probe.onHop = (h) => {
            n++;
            const e = n * 256 - 1;
            if (!h.feat) return;
            for (const ev of learnSig.events) {
                if (e - 1023 >= ev.start && e <= ev.end) {
                    total++;
                    if (h.winner === ev.kind) good++;
                }
            }
        };
        for (let i = 0; i < learnSig.L.length; i++) probe.push(learnSig.L[i], learnSig.R[i]);
        assert.ok(good / total > 0.9, `learned-in-the-UI centroids classify ${(100 * good / total).toFixed(1)} % of hops`);

        // a follower saved/restored through the blob keeps the centroids
        const blob = J(b.getvalueof());
        assert.strictEqual(blob[0], 1);
        assert.strictEqual(blob.length, 63);
        assert.strictEqual(blob[10], 1, "learned flag in the blob");
        const late = createUiInstance("live_set tracks 2 devices 0 chains 3 devices 0");
        assert.deepStrictEqual(J(late.centroids), ref0, "a new instance in the Rack adopts the group's learned centroids");
        assert.strictEqual(late.curLearned, 1);

        // Adapt: only the leader drifts, slowly, and the drift is shared
        a.set_adapt(1);
        const before = J(a.centroids);
        for (let rep = 0; rep < 12; rep++) {
            for (let h = 0; h < 700; h += 7) {
                const batch = refHops.slice(900 + h, 900 + h + 7);
                for (const s of scopes) makeCols(batch, s[0], s);
                for (const i of all) i.pullScope();
            }
        }
        const moved = a.centroids.some((cc, k) => cc.some((v, d) => Math.abs(v - before[k][d]) > 1e-4));
        assert.ok(moved, "Adapt lets the centroids drift");
        const maxDrift = Math.max(...a.centroids.map((cc, k) => Math.sqrt(cc.reduce((acc, v, d) => acc + (v - before[k][d]) ** 2, 0))));
        console.log(`  adapt: max centroid drift ${maxDrift.toFixed(2)} after ${12 * 700} hops of replayed audio (class spacing ~ 10)`);
        assert.ok(maxDrift < 3, "the drift stays slow compared with the class spacing");
        assert.ok(c.centroids.every((cc, k) => cc.every((v, d) => Math.abs(v - a.centroids[k][d]) < 0.3)), "adapted centroids are shared (within one 0.5 s flush interval)");
        a.set_adapt(0);

        // stopping early works (the take is kept when it has enough frames) and Classes cancels a take
        a.set_learn(1);
        assert.ok(a.learning);
        a.set_classes(4);
        assert.ok(!a.learning, "changing Classes aborts a take");
        [a, b, c, late].forEach((i) => i.notifydeleted());
    }

    // ---- pills, gain slider, link badge, painting ----
    {
        const w = createUiInstance("live_set tracks 3 devices 0 chains 0 devices 0");
        const w2 = createUiInstance("live_set tracks 3 devices 0 chains 1 devices 0");
        const w3 = createUiInstance("live_set tracks 3 devices 0 chains 2 devices 0");
        assert.strictEqual(w2.getEffectiveMask(), 2);
        // solo click on pill 3, shift-click adds pill 1
        const p3 = w2.getPillRect(2);
        w2.onclick(p3[0] + 5, p3[1] + 5, 1, false, false);
        assert.strictEqual(w2.curClassMode, 3);
        assert.strictEqual(w2.getEffectiveMask(), 4);
        assert.strictEqual(w2.lastEmit("ui_classmode"), 3, "pill click syncs the hidden Class Mode parameter");
        const p1 = w2.getPillRect(0);
        w2.onclick(p1[0] + 5, p1[1] + 5, 1, false, true);
        assert.strictEqual(w2.curClassMode, 5);
        assert.strictEqual(w2.getEffectiveMask(), 5, "shift-click multi-selects classes 1 + 3");
        assert.strictEqual(w2.lastEmit("cmask"), 5);
        w2.onclick(p1[0] + 5, p1[1] + 5, 1, false, true);
        assert.strictEqual(w2.getEffectiveMask(), 4, "shift-click again removes it");
        const ar = w2.getAutoBtnRect();
        w2.onclick(ar[0] + 4, ar[1] + 4, 1, false, false);
        assert.strictEqual(w2.curClassMode, 0);
        assert.strictEqual(w2.getEffectiveMask(), 2, "AUTO restores the chain's own class");
        // undo restores the previous mode
        w2.onclick(p3[0] + 5, p3[1] + 5, 1, false, false);
        w2.undo();
        assert.strictEqual(w2.curClassMode, 0, "undo");

        // gain slider: vertical drag, double-click resets
        const vr = w2.getVolumeSliderRect();
        w2.onclick(vr[0] + 20, vr[1] + 6, 1, false, false);
        assert.ok(w2.dragVolume && w2.cursorHiddenCount === 1, "dragging steals the cursor");
        w2.ondrag(vr[0] + 20, vr[1] - 20, 1, false, false);
        assert.ok(w2.curGainDb > 0, `drag up raises the gain (${w2.curGainDb.toFixed(1)} dB)`);
        assert.strictEqual(w2.lastEmit("ui_gain"), w2.curGainDb, "the hidden Gain parameter follows");
        w2.ondrag(vr[0] + 20, vr[1] - 20, 0, false, false);
        assert.ok(!w2.dragVolume && w2.cursorShownCount === 1, "mouse up releases the cursor");
        w2.onclick(vr[0] + 20, vr[1] + 6, 1, false, false);
        w2.ondrag(vr[0] + 20, vr[1] + 400, 1, false, false);
        assert.strictEqual(w2.curGainDb, -70, "far down is -inf");
        w2.ondrag(vr[0] + 20, vr[1] + 80, 0, false, false);
        w2.ondblclick(vr[0] + 20, vr[1] + 6);
        assert.strictEqual(w2.curGainDb, 0, "double-click resets to 0 dB");
        assert.strictEqual(w2.formatGainDb(-70), "-inf dB");

        // link badge toggles between the full text and LNK
        const lr = w2.getLinkBadgeRect();
        assert.ok(w2.showLinkStatus);
        w2.onclick(lr[0] + 3, lr[1] + 3, 1, false, false);
        assert.ok(!w2.showLinkStatus);
        const lr2 = w2.getLinkBadgeRect();
        assert.ok(lr2[2] < lr[2], "the badge shrinks to LNK");
        w2.onclick(lr2[0] + 3, lr2[1] + 3, 1, false, false);
        assert.ok(w2.showLinkStatus);

        // paint: everything inside the canvas, text fits, badge text names the rack / chain / count / leader
        for (const [label, inst] of [["follower", w2], ["leader", w]]) {
            for (const mode of ["live", "preview"]) {
                if (mode === "preview") inst.preview();
                inst.drawCmds.length = 0;
                inst.paint();
                const W = 270;
                const H = 153;
                assert.ok(inst.drawCmds.length > 40, `${label} ${mode}: paint draws`);
                let font = 6;
                let pos = [0, 0];
                const texts = [];
                for (const cmd of inst.drawCmds) {
                    if (cmd.op === "rect" || cmd.op === "rrect") {
                        assert.ok(cmd.x >= -0.6 && cmd.y >= -0.6 && cmd.x + cmd.w <= W + 0.6 && cmd.y + cmd.h <= H + 0.6,
                            `${label} ${mode}: rect outside the canvas ${JSON.stringify(cmd)}`);
                    } else if (cmd.op === "font") font = cmd.s;
                    else if (cmd.op === "move") pos = [cmd.x, cmd.y];
                    else if (cmd.op === "text") {
                        const tw = inst.textW(cmd.text, font);
                        assert.ok(pos[0] >= 0 && pos[0] + tw <= W - 1, `${label} ${mode}: text "${cmd.text}" overflows (${pos[0].toFixed(1)} + ${tw.toFixed(1)})`);
                        assert.ok(pos[1] <= H && pos[1] >= 5, `${label} ${mode}: text "${cmd.text}" off the canvas vertically (${pos[1]})`);
                        texts.push(cmd.text);
                    }
                }
                assert.ok(texts.some((t) => /^LINK: .*\(\dx\)/.test(t)), `${label} ${mode}: link badge text (${texts.filter((t) => /LINK/.test(t))})`);
                if (label === "leader" && mode === "live") assert.ok(texts.some((t) => / LEAD$/.test(t)), "the leader says LEAD");
                if (label === "follower" && mode === "live") assert.ok(!texts.some((t) => / LEAD$/.test(t)), "a follower does not");
            }
        }
        // preview draws the learned state; the learn bar texts exist for every state
        w.preview();
        w.drawCmds.length = 0;
        w.paint();
        assert.ok(w.drawCmds.some((c) => c.op === "text" && /^LEARNED 3 CLASSES/.test(c.text)));
        w.curLearned = 0;
        w.drawCmds.length = 0;
        w.paint();
        assert.ok(w.drawCmds.some((c) => c.op === "text" && /FACTORY PRIOR/.test(c.text)));
        [w, w2, w3].forEach((i) => i.notifydeleted());
    }

    // ---- state blob + latency + telemetry decode on a lone instance ----
    {
        const s = createUiInstance("live_set tracks 5 devices 0");
        assert.strictEqual(s.getvalueof()[0], 1);
        const blob = [1, 4, 70, 12, 1, 5, 6, 0, -3, 0, 1];
        for (let k = 0; k < 4; k++) for (let d = 0; d < 13; d++) blob.push(k + d * 0.1);
        s.setvalueof(blob);
        assert.deepStrictEqual([s.curClasses, s.curSharp, s.curSmooth, s.curAdapt, s.curClassMode, s.curCustomMask, s.curGainDb, s.curLearned],
            [4, 70, 12, 1, 5, 6, -3, 1]);
        assert.strictEqual(s.getEffectiveMask(), 6, "multi mask restored");
        assert.ok(Math.abs(buffers[`cent_${s.id}`][16 + 3] - blob[11 + 13 + 3]) < 1e-5, "restored centroids reach the gen buffer");
        assert.deepStrictEqual(J(s.getvalueof()), J(blob.slice(0, 11).concat(blob.slice(11))), "blob round trips through the v8ui");
        s.setvalueof([1, 2, 55, 9]); // a short older blob keeps everything else
        assert.strictEqual(s.curClasses, 2);
        assert.strictEqual(s.curSharp, 55);
        assert.strictEqual(s.curLearned, 1);
        s.setvalueof(1, 3, 40, 9, 0, 0, 1, 0, 0, 1, 0); // pattr hands the list as separate arguments
        assert.strictEqual(s.curSharp, 40);
        // latency is reported to Live through the patcher attribute
        const scope = buffers[`scope_${s.id}`];
        scope[0] = 1;
        scope[1] = 0;
        s.pullScope();
        assert.strictEqual(s.patcher.latency, 2048, "the v8ui reports the 2048-sample latency");
        // telemetry decode: columns with c1..c13 = 5 and class 2 winning land in the display history
        const hop = { feat: new Array(13).fill(5), c0: 1, hold: [0, 1, 0, 0], winner: 1, gate: 1 };
        makeCols([hop, hop, hop], 0, scope);
        s.pullScope();
        makeCols([hop, hop, hop], scope[0], scope);
        s.pullScope();
        const last = s.dMfcc[s.dMfcc.length - 1];
        assert.ok(Math.abs(last[0] - 5) < 1e-9 && s.dWin[s.dWin.length - 1] === 2 && s.dW[s.dW.length - 1][1] > 0.99, "telemetry reaches the heatmap and the timeline");
        s.notifydeleted();
    }
    console.log("[PASS] v8ui: Auto class assignment, nested racks, Cmd+D isolation, shared parameters, leader learning, centroid sharing, " +
        "Adapt, pills, gain, link badge, paint bounds, blob, latency");
}

console.log("All Timbre Split tests passed.");
