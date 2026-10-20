#!/usr/bin/env node
/**
 * Verification suite for devices/Timbre Follower A.amxd, B.amxd and C.amxd.
 *
 * Covers:
 *  1. All three variants' JSON: .amxd header, device width / 169 px height, `latency` 0, no overlap between visible
 *     presentation widgets (and none between live.* widgets and the v8ui), panels last with `background: 1`,
 *     everything inside the device, `#0-` buffer isolation, parameter ranges (no Int > 255), 7 widgets + `p Map`
 *     per mapping slot wired as Better Shaper's (signal in, min/max/unmap/map/mode/bipolar/amount, name -> v8ui)
 *  2. GenExpr ordering / lexer rules and the gen core's interface (3 outputs, params, scope bind)
 *  3. JS mirror (src/timbre_ref.js) of the MFCC + novelty math on synthetic signals:
 *       mel / DCT tables, c0 dropped (level invariance), sustained tone ~ 0 novelty, sine -> saw -> noise at equal
 *       loudness peaks, +12 dB level changes stay small, gate and idle, Env shaping, Trig pulses, Focus weighting
 *  4. The v8ui script on all three layouts with a mocked mgraphics: paint bounds, threshold drag synced with Sens,
 *     redraw skipping when silent, telemetry decode, slot names, versioned state
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const amax = (a) => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
const amin = (a) => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
const T = require(path.join(ROOT, "src", "timbre_ref.js"));
const REF = require(path.join(ROOT, "src", "cepstrum_ref.js"));
const UI_SRC = fs.readFileSync(path.join(ROOT, "src", "timbre_ui.js"), "utf8");
const CORE_SRC = fs.readFileSync(path.join(ROOT, "src", "timbre_core.genexpr"), "utf8");
const LIB_SRC = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8");

const VARIANTS = {
    a: { file: "Timbre Follower A.amxd", width: 440 },
    b: { file: "Timbre Follower B.amxd", width: 264 },
    c: { file: "Timbre Follower C.amxd", width: 412 },
};

function loadAmxd(letter) {
    const buf = fs.readFileSync(path.join(ROOT, "devices", VARIANTS[letter].file));
    assert.strictEqual(buf.subarray(0, 8).toString("latin1"), "ampf\x04\x00\x00\x00", "ampf header");
    assert.strictEqual(buf.subarray(8, 12).toString("latin1"), "aaaa", "Max Audio Effect device type");
    assert.strictEqual(buf.subarray(12, 24).toString("latin1"), "meta\x04\x00\x00\x00\x00\x00\x00\x00");
    assert.strictEqual(buf.subarray(24, 28).toString("latin1"), "ptch");
    const len = buf.readUInt32LE(28);
    assert.strictEqual(buf.length, 32 + len, "header length matches the JSON payload");
    const json = buf.subarray(32).toString("utf8");
    assert.ok(json.endsWith("\n"), "payload ends with a newline");
    return JSON.parse(json).patcher;
}

function overlaps(a, b) {
    return a[0] < b[0] + b[2] - 0.01 && b[0] < a[0] + a[2] - 0.01 && a[1] < b[1] + b[3] - 0.01 && b[1] < a[1] + a[3] - 0.01;
}

// =========================================================================
// 1. DEVICE JSON
// =========================================================================
const patchers = {};
for (const letter of Object.keys(VARIANTS)) {
    const p = loadAmxd(letter);
    patchers[letter] = p;
    const boxes = p.boxes.map((b) => b.box);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    const devW = VARIANTS[letter].width;

    assert.strictEqual(p.devicewidth, devW, `${letter}: device width`);
    assert.deepStrictEqual(p.openrect, [0, 0, devW, 169], `${letter}: openrect height must be 169`);
    assert.strictEqual(p.openinpresentation, 1, `${letter}: opens in presentation`);
    assert.strictEqual(p.latency, 0, `${letter}: latency must be 0 (analysis only)`);

    // presentation: inside the device, no overlaps, no live.* over the v8ui, panels last
    const vis = boxes.filter((b) => b.presentation === 1 && !b.hidden && b.maxclass !== "panel");
    const panels = boxes.filter((b) => b.maxclass === "panel");
    assert.ok(panels.length >= 2, `${letter}: background panels exist`);
    for (const b of vis.concat(panels)) {
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= devW + 0.01 && r[1] + r[3] <= 169.01, `${letter}: ${b.id} outside the device ${r}`);
    }
    for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
            assert.ok(!overlaps(vis[i].presentation_rect, vis[j].presentation_rect),
                `${letter}: ${vis[i].id} overlaps ${vis[j].id}`);
        }
    }
    const viz = byId["obj-viz"];
    assert.ok(viz && viz.maxclass === "v8ui" && viz.presentation === 1, `${letter}: v8ui canvas`);
    for (const b of boxes) {
        if (b.maxclass && b.maxclass.startsWith("live.") && b.presentation === 1) {
            assert.ok(!overlaps(b.presentation_rect, viz.presentation_rect), `${letter}: live widget ${b.id} overlaps the v8ui`);
        }
    }
    // hidden widgets (unmap, min, max) must not sit on the v8ui either
    for (const b of boxes) {
        if (b.presentation === 1 && b.hidden && b.maxclass !== "panel") {
            assert.ok(!overlaps(b.presentation_rect, viz.presentation_rect), `${letter}: hidden ${b.id} overlaps the v8ui`);
        }
    }
    const lastNonPanel = amax(boxes.map((b, i) => (b.maxclass === "panel" ? -1 : i)));
    boxes.forEach((b, i) => {
        if (b.maxclass === "panel") {
            assert.strictEqual(b.background, 1, `${letter}: panel ${b.id} must be background`);
            assert.ok(i > lastNonPanel, `${letter}: panel ${b.id} must come after every control`);
        }
    });

    // v8ui script header and embedded layout
    const js = viz.textfile.text;
    assert.ok(js.startsWith(`var TIMBRE_LAYOUT = "${letter}";`), `${letter}: layout letter passed to the v8ui`);
    assert.ok(/mgraphics\.init\(\);\s*mgraphics\.relative_coords = 0;\s*mgraphics\.autofill = 0;/.test(js), `${letter}: mgraphics init lines`);
    assert.strictEqual(viz.textfile.embed, 1);

    // instance isolation
    const bufBox = boxes.find((b) => /^buffer~/.test(b.text || ""));
    assert.strictEqual(bufBox.text, "buffer~ #0-timbrescope @samps 2064", `${letter}: instance-local telemetry buffer`);
    for (const b of boxes) {
        if (b.maxclass === "newobj" && /^(buffer~|send|receive|s |r )/.test(b.text || "")) {
            assert.ok(/#0-|---/.test(b.text), `${letter}: ${b.text} must be instance-local`);
        }
    }
    assert.ok(byId["obj-msg-gen-buf"].text === "scope #0-timbrescope" && byId["obj-msg-ui-buf"].text === "setbuffer #0-timbrescope");

    // audio path and control signal
    const lines = p.lines.map((l) => l.patchline);
    const has = (s, so, d, di) => lines.some((l) => l.source[0] === s && l.source[1] === so && l.destination[0] === d && l.destination[1] === di);
    assert.ok(has("obj-plugin", 0, "obj-gen", 0) && has("obj-plugin", 1, "obj-gen", 1), `${letter}: plugin~ -> gen`);
    assert.ok(has("obj-gen", 0, "obj-plugout", 0) && has("obj-gen", 1, "obj-plugout", 1), `${letter}: gen -> plugout~`);
    assert.strictEqual(byId["obj-gen"].numoutlets, 3, `${letter}: gen has out1, out2 and the control out3`);
    for (const key of ["sens", "attack", "release", "focus", "mode"]) {
        assert.ok(has(`obj-ctrl-${key}`, 0, `obj-prep-gen-${key}`, 0) && has(`obj-prep-gen-${key}`, 0, "obj-gen", 0), `${letter}: ${key} -> gen`);
        assert.ok(has(`obj-ctrl-${key}`, 0, `obj-prep-ui-${key}`, 0) && has(`obj-prep-ui-${key}`, 0, "obj-viz", 0), `${letter}: ${key} -> v8ui`);
        assert.ok(byId[`obj-prep-gen-${key}`].text === `prepend ${key}`, `${letter}: gen message name for ${key}`);
    }
    assert.ok(has("obj-viz", 0, "obj-route-ui", 0) && has("obj-route-ui", 0, "obj-ctrl-sens", 0), `${letter}: v8ui threshold drag -> Sens`);
    assert.strictEqual(byId["obj-route-ui"].text, "route ui_sens");

    // parameters: ranges and the Int > 255 rule
    const specs = {
        "obj-ctrl-sens": [0, 100, 50],
        "obj-ctrl-attack": [1, 500, 8],
        "obj-ctrl-release": [5, 3000, 250],
        "obj-ctrl-focus": [-100, 100, 0],
    };
    for (const [id, [lo, hi, init]] of Object.entries(specs)) {
        const v = byId[id].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_mmin, lo, `${letter}: ${id} min`);
        assert.strictEqual(v.parameter_mmax, hi, `${letter}: ${id} max`);
        assert.strictEqual(v.parameter_initial[0], init, `${letter}: ${id} initial`);
        assert.strictEqual(v.parameter_type, 0, `${letter}: ${id} is Float (range > 255 or not, never Int)`);
        assert.ok(["live.numbox", "live.dial"].includes(byId[id].maxclass));
    }
    const modeV = byId["obj-ctrl-mode"].saved_attribute_attributes.valueof;
    assert.deepStrictEqual(modeV.parameter_enum, ["Env", "Trig"]);
    assert.strictEqual(modeV.parameter_initial[0], 0);
    for (const b of boxes) {
        const v = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
        if (v && v.parameter_type === 1) assert.ok((v.parameter_mmax || 0) <= 255, `${letter}: Int parameter ${b.id} exceeds 255`);
        if (v && v.parameter_mmin !== undefined && v.parameter_mmax !== undefined) {
            assert.ok(v.parameter_mmin < v.parameter_mmax, `${letter}: ${b.id} range`);
            const init = (v.parameter_initial || [v.parameter_mmin])[0];
            assert.ok(init >= v.parameter_mmin && init <= v.parameter_mmax, `${letter}: ${b.id} initial in range`);
        }
    }
    // saved UI state blob
    const pat = byId["obj-state-pattr"];
    assert.strictEqual(pat.saved_attribute_attributes.valueof.parameter_type, 3);
    assert.deepStrictEqual(pat.saved_attribute_attributes.valueof.parameter_initial, [1, 0], `${letter}: versioned blob [version, view]`);
    assert.ok(has("obj-state-pattr", 1, "obj-viz", 0));

    // the two mapping slots, Better Shaper's wiring
    for (const n of [1, 2]) {
        const sub = byId[`obj-map-sub-${n}`];
        assert.ok(sub && sub.numinlets === 8 && sub.numoutlets === 2 && sub.text === `p Map_${n}`, `${letter}: slot ${n} p Map`);
        const inner = JSON.stringify(sub.patcher);
        assert.ok(inner.includes("live.modulate~") && inner.includes("live.remote~ @normalized 1") && inner.includes("live.map @strict 1"),
            `${letter}: slot ${n} Mod and Remote engines`);
        assert.ok(has("obj-gen", 2, sub.id, 0), `${letter}: gen out3 -> slot ${n} signal inlet`);
        const want = [
            [`obj-min-${n}`, 1, 1], [`obj-max-${n}`, 1, 2], [`obj-unmap-btn-${n}`, 0, 3], [`obj-map-btn-${n}`, 0, 4],
            [`obj-mod-mode-${n}`, 0, 5], [`obj-bipolar-${n}`, 0, 6], [`obj-mod-amt-${n}`, 0, 7],
        ];
        for (const [src, so, inlet] of want) assert.ok(has(src, so, sub.id, inlet), `${letter}: ${src} -> slot ${n} inlet ${inlet}`);
        assert.ok(has(sub.id, 1, `obj-map-btn-${n}`, 0), `${letter}: slot ${n} name/state back to the Map button`);
        assert.ok(has(sub.id, 1, `obj-name-route-${n}`, 0) && has(`obj-name-route-${n}`, 0, `obj-name-prep-${n}`, 0) && has(`obj-name-prep-${n}`, 0, "obj-viz", 0),
            `${letter}: slot ${n} target name -> v8ui`);
        assert.strictEqual(byId[`obj-name-prep-${n}`].text, `prepend slot_name ${n}`);
        assert.strictEqual(byId[`obj-mapped-prep-${n}`].text, `prepend slot_mapped ${n}`);
        assert.ok(has("obj-dev-ig", 0, `obj-map-btn-${n}`, 0) && has("obj-dev-ig", 0, `obj-unmap-btn-${n}`, 0), `${letter}: ignoreclick guard`);
        assert.strictEqual(byId[`obj-mod-mode-${n}`].saved_attribute_attributes.valueof.parameter_enum.join(), "Mod,Remote");
        const amt = byId[`obj-mod-amt-${n}`].saved_attribute_attributes.valueof;
        assert.ok(amt.parameter_mmin === -100 && amt.parameter_mmax === 100, "Mod amount -100..100 %");
        for (const k of ["min", "max"]) {
            const v = byId[`obj-${k}-${n}`].saved_attribute_attributes.valueof;
            assert.ok(v.parameter_mmin === 0 && v.parameter_mmax === 100, "Remote min/max 0..100 %");
        }
        assert.strictEqual(byId[`obj-unmap-btn-${n}`].hidden, 1, "unmap only shows while mapped");
        assert.strictEqual(byId[`obj-min-${n}`].hidden, 1);
        assert.ok(p.parameters[`obj-map-btn-${n}`] && p.parameters[`obj-mod-amt-${n}`], `${letter}: slot ${n} registered parameters`);
    }
    // the ExclusiveArm of slot 2 listens for its own number
    const arm2 = JSON.stringify(byId["obj-map-sub-2"].patcher);
    assert.ok(arm2.includes('"text":"route 2"') && arm2.includes('"text":"2 0"'), `${letter}: slot 2 ExclusiveArm number`);
    const arm1 = JSON.stringify(byId["obj-map-sub-1"].patcher);
    assert.ok(arm1.includes('"text":"route 1"') && arm1.includes('"text":"1 0"'), `${letter}: slot 1 ExclusiveArm number`);

    // gen code embeds the shared library + core
    assert.strictEqual(byId["obj-gen"].code, LIB_SRC + "\n" + CORE_SRC, `${letter}: gen code is lib + core`);
}
console.log("[PASS] 3 variants: header, 169 px height, latency 0, overlap / panel / #0- / parameter rules, 2 map slots wired");

// the variants differ for real
{
    const sizes = Object.keys(VARIANTS).map((k) => {
        const v = patchers[k].boxes.map((b) => b.box).find((b) => b.id === "obj-viz").presentation_rect;
        return `${k}:${v[2]}x${v[3]}`;
    });
    assert.strictEqual(new Set(sizes).size, 3, `three different canvases (${sizes})`);
    const kinds = Object.keys(VARIANTS).map((k) => patchers[k].boxes.map((b) => b.box.maxclass).filter((m) => m === "live.dial").length);
    assert.ok(kinds[0] === 0 && kinds[1] === 4 && kinds[2] === 3, `control mix differs (dials ${kinds})`);
    console.log(`[PASS] variants are genuinely different (${sizes.join("  ")}, dials ${kinds.join("/")})`);
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
    assert.ok(firstDecl > 0 && lastFn >= 0 && lastFn < firstDecl, "every function precedes the first Buffer / Param / History / Data declaration");
    const decls = lines.slice(firstDecl).filter((ln) => /^(Buffer|Param|History|Data|Delay)\b/.test(ln));
    const lastDecl = lines.lastIndexOf(decls[decls.length - 1]);
    const stmtAfter = lines.slice(firstDecl, lastDecl).some((ln) => /^[a-z]\w* = /.test(ln));
    assert.ok(!stmtAfter, "all declarations precede the expression statements");
    const stripped = code.replace(/\/\/.*$/gm, "");
    assert.ok(!/\be\d*\b\s*(=|\+=|-=)/.test(stripped) && !/\b[(,]\s*e\d*\s*[,)]/.test(stripped), "no identifier named e or e<digits> (Euler constant in the lexer)");
    assert.ok(!/\bdelay\s*\(/.test(stripped), "no delay() call");
    assert.ok(/Buffer scope\("timbrescope"\);/.test(CORE_SRC), "telemetry Buffer bound by the GenExpr variable name");
    for (const prm of ["sens", "attack", "release", "focus", "mode"]) assert.ok(new RegExp(`^Param ${prm}\\(`, "m").test(CORE_SRC), `Param ${prm}`);
    assert.ok(/^out1 = in1;$/m.test(CORE_SRC) && /^out2 = in2;$/m.test(CORE_SRC) && /^out3 = cv;$/m.test(CORE_SRC), "pass-through outputs and control out3");
    // no History is read after being written in the same sample inside the hop block (checked by name list)
    for (const h of ["gate", "hv", "refr", "nprev", "head", "cntr", "quiet"]) {
        assert.ok(new RegExp(`^History ${h}\\(`, "m").test(CORE_SRC), `History ${h}`);
    }
    console.log("[PASS] GenExpr ordering, lexer and interface rules");
}

// =========================================================================
// 3. MFCC + NOVELTY MIRROR ON SYNTHETIC SIGNALS
// =========================================================================
const SR = 44100;
const dbA = (d) => Math.pow(10, d / 20);
const RMSU = { sine: Math.SQRT1_2, saw: Math.sqrt(1 / 3), square: 1, noise: Math.sqrt(1 / 3) };
function seg(kind, sec, rmsDb, f0, rnd) {
    return T.synth(kind, Math.round(sec * SR), SR, dbA(rmsDb) / RMSU[kind], f0 || 220, rnd);
}
function cat(...arrs) {
    const out = new Float64Array(arrs.reduce((s, a) => s + a.length, 0));
    let i = 0;
    for (const a of arrs) { out.set(a, i); i += a.length; }
    return out;
}
function runNov(sig, params, sr) {
    const f = new T.TimbreFollower(sr || SR, params);
    const nov = [];
    const dist = [];
    const fires = [];
    f.onHop = (h) => { nov.push(h.nov); dist.push(h.d); fires.push(h.fire); };
    const ctl = f.run(sig);
    return { nov, dist, fires, ctl, f };
}
const hopS = (t) => Math.round((t * SR) / T.K.HOP);
const maxIn = (arr, a, b) => amax(arr.slice(hopS(a), hopS(b)));

// 3a. tables
{
    for (const sr of [22050, 44100, 48000, 88200, 96000]) {
        const mel = T.melTable(sr);
        assert.strictEqual(mel.length, 24);
        let prevCtr = -1;
        for (const m of mel) {
            assert.ok(m.lo >= 0 && m.lo < m.ctr && m.ctr < m.hi && m.hi <= 512, `mel band bins at ${sr}: ${JSON.stringify(m)}`);
            assert.ok(m.ctr > prevCtr, `mel centres increase at ${sr}`);
            assert.ok(isFinite(m.inv) && m.inv > 0);
            prevCtr = m.ctr;
        }
    }
    const dct = T.dctTable();
    for (let k = 0; k < 13; k++) {
        for (let j = 0; j < 13; j++) {
            let s = 0;
            for (let b = 0; b < 24; b++) s += dct[k * 24 + b] * dct[j * 24 + b];
            assert.ok(Math.abs(s - (k === j ? 1 : 0)) < 1e-9, `DCT rows ${k},${j} orthonormal (got ${s})`);
        }
        let rowSum = 0;
        for (let b = 0; b < 24; b++) rowSum += dct[k * 24 + b];
        assert.ok(Math.abs(rowSum) < 1e-9, `DCT row c${k + 1} sums to zero, so a gain only moves c0 (dropped)`);
    }
    const w0 = T.focusWeights(0);
    const wLo = T.focusWeights(-100);
    const wHi = T.focusWeights(100);
    for (const w of [w0, wLo, wHi]) assert.ok(Math.abs(w.reduce((a, b) => a + b) - 1) < 1e-12, "focus weights sum to 1");
    assert.ok(Math.abs(w0[0] - 1 / 13) < 1e-12 && Math.abs(w0[12] - 1 / 13) < 1e-12, "Focus 0 is flat");
    for (let k = 0; k < 12; k++) {
        assert.ok(wLo[k] > wLo[k + 1] && wHi[k] < wHi[k + 1], "Focus tilts monotonically toward low / high order");
    }
    assert.ok(wLo[0] > 6 * wLo[12] && wHi[12] > 6 * wHi[0], "Focus -100 / +100 weigh the ends by about 20x");
    for (const s of [0, 25, 50, 80, 100]) assert.ok(Math.abs(T.thresholdToSens(T.sensToThreshold(s)) - s) < 1e-9, "Sens <-> threshold round trip");
    assert.ok(T.sensToThreshold(100) < T.sensToThreshold(0), "higher Sens = lower threshold");
    console.log("[PASS] mel filterbank (22..96 kHz), orthonormal DCT with zero-sum rows, Focus weights, Sens law");
}

// 3b. level invariance of the MFCCs themselves
{
    const mel = T.melTable(SR);
    const dct = T.dctTable();
    const win = REF.hann(1024);
    const rnd = T.lcg(11);
    const x = T.synth("noise", 1024, SR, 0.2, 0, rnd);
    const mf = (g) => {
        const re = new Float64Array(1024);
        const im = new Float64Array(1024);
        for (let i = 0; i < 1024; i++) re[i] = x[i] * win[i] * g;
        REF.fft(re, im, false);
        return T.mfccFromSpectrum(re, im, mel, dct);
    };
    const c1 = mf(1);
    const c4 = mf(4);
    const c01 = mf(0.01);
    let d4 = 0;
    let d01 = 0;
    for (let k = 0; k < 13; k++) {
        d4 = Math.max(d4, Math.abs(c1[k] - c4[k]));
        d01 = Math.max(d01, Math.abs(c1[k] - c01[k]));
    }
    assert.ok(d4 < 1e-6, `+12 dB leaves c1..c13 unchanged (max diff ${d4})`);
    assert.ok(d01 < 1e-5, `-40 dB leaves c1..c13 unchanged (max diff ${d01})`);
    console.log(`[PASS] MFCC level invariance: +12 dB ${d4.toExponential(1)}, -40 dB ${d01.toExponential(1)} max coefficient change`);
}

// 3c. sustained tone, timbre switches, level changes
{
    const rnd = T.lcg(3);
    const tone = runNov(seg("sine", 3, -18), {});
    const sustained = amax(tone.nov.slice(hopS(0.5)));
    assert.ok(sustained < 0.005, `sustained tone has ~0 novelty after the start-up (max ${sustained})`);

    const sw = cat(seg("sine", 1.5, -18), seg("saw", 1.5, -18), seg("noise", 1.5, -18, 220, rnd), seg("saw", 1.5, -18));
    const r = runNov(sw, {});
    const peaks = [1.5, 3.0, 4.5].map((t) => maxIn(r.nov, t, t + 0.25));
    const steady = [1.0, 2.2, 3.7, 5.2].map((t) => maxIn(r.nov, t, t + 0.25));
    assert.ok(peaks.every((p) => p > 0.55), `sine -> saw -> noise -> saw at equal loudness give clear peaks (${peaks.map((p) => p.toFixed(2))})`);
    assert.ok(steady.every((s) => s < 0.08), `steady parts stay quiet (${steady.map((p) => p.toFixed(3))})`);
    console.log(`[PASS] sustained tone novelty ${sustained.toExponential(1)}; timbre switches peak ${peaks.map((p) => p.toFixed(2))}, steady ${steady.map((p) => p.toFixed(3))}`);

    // +12 dB / -24 dB steps of the same timbre
    const lv = {};
    for (const kind of ["saw", "square", "noise"]) {
        const rr = T.lcg(5);
        const s = cat(seg(kind, 1.5, -18, 220, rr), seg(kind, 1.5, -6, 220, rr), seg(kind, 1.5, -30, 220, rr));
        const res = runNov(s, {});
        lv[kind] = Math.max(maxIn(res.nov, 1.5, 1.8), maxIn(res.nov, 3.0, 3.3));
        // a square's odd-harmonic-only spectrum has deep nulls that the click of an instant step fills a little
        const bound = kind === "square" ? 0.2 : 0.06;
        assert.ok(lv[kind] < bound, `${kind}: +12 dB and -24 dB steps stay below ${bound} (got ${lv[kind].toFixed(3)})`);
    }
    // a pure sine is the worst case: an instant step is a click (real broadband energy), a 20 ms fade is not
    const ramp = (sig, at, ms, gdb) => {
        const o = Float64Array.from(sig);
        const n = Math.round((ms * SR) / 1000);
        const g = dbA(gdb);
        for (let i = at; i < o.length; i++) o[i] *= 1 + (g - 1) * Math.min(1, (i - at) / Math.max(n, 1));
        return o;
    };
    const sine = seg("sine", 3, -18);
    const fade = runNov(ramp(sine, SR * 1.5, 20, 12), {});
    const fadeMax = maxIn(fade.nov, 1.5, 2.0);
    assert.ok(fadeMax < 0.05, `sine +12 dB over 20 ms stays small (got ${fadeMax.toFixed(3)})`);
    const hard = runNov(ramp(sine, SR * 1.5, 0, 12), {});
    const hardMax = maxIn(hard.nov, 1.5, 1.8);
    assert.ok(hardMax < 0.5 * Math.min(...peaks), `even an instant +12 dB sine step (a click) stays under the real switches (${hardMax.toFixed(2)})`);
    console.log(`[PASS] +12 dB level changes: saw ${lv.saw.toFixed(3)} square ${lv.square.toFixed(3)} noise ${lv.noise.toFixed(3)}, sine fade ${fadeMax.toFixed(3)} (instant step ${hardMax.toFixed(2)} = a click)`);
}

// 3d. gate, idle, steady noise
{
    const quiet = runNov(cat(seg("sine", 1, -80), seg("noise", 1, -75, 0, T.lcg(2)), seg("sine", 1, -80)), { mode: 1 });
    assert.ok(amax(quiet.nov) === 0, "signals below the -60 dB gate give exactly 0 novelty");
    assert.ok(quiet.fires.every((f) => !f) && amax(quiet.ctl) === 0, "...and never trigger or move the output");
    const noise = runNov(seg("noise", 3, -18, 0, T.lcg(9)), {});
    const nn = amax(noise.nov.slice(hopS(0.5)));
    assert.ok(nn < 0.05, `steady noise (periodogram variance) stays under 0.05 (got ${nn.toFixed(3)})`);
    // onset from silence: history is forgotten while gated, so the first frame seeds it and never self-triggers
    const onset = runNov(cat(new Float64Array(SR), seg("saw", 1.5, -18)), { mode: 1 });
    assert.ok(onset.f.trigCount <= 1, `a note onset out of silence fires at most the start-up transient (${onset.f.trigCount})`);
    // idle: 200 quiet hops put the analysis to sleep, a new sound wakes it
    const idle = new T.TimbreFollower(SR, {});
    let asleepAt = -1;
    let wokeAt = -1;
    let hops = 0;
    idle.onHop = (h) => { hops++; if (h.asleep && asleepAt < 0) asleepAt = hops; if (asleepAt > 0 && !h.asleep && wokeAt < 0) wokeAt = hops; };
    idle.run(cat(new Float64Array(SR * 2), seg("saw", 0.5, -18)));
    assert.ok(asleepAt > 200 && asleepAt < 215, `analysis sleeps after about 1.2 s of silence (hop ${asleepAt})`);
    assert.ok(wokeAt > asleepAt, "and wakes when sound returns");
    console.log(`[PASS] gate (-60 dB), steady noise ${nn.toFixed(3)}, onset triggers ${onset.f.trigCount}, idle sleep at hop ${asleepAt}`);
}

// 3e. Env shaping and Trig pulses on the switching signal
{
    const sw = cat(seg("sine", 1, -18), seg("saw", 1, -18), seg("noise", 1, -18, 220, T.lcg(3)), seg("saw", 1, -18), seg("saw", 1, -6), seg("saw", 1, -18));
    const env = runNov(sw, { mode: 0, sens: 50, attack: 2, release: 60 });
    const pk = [1, 2, 3].map((t) => amax(env.ctl.slice(Math.round(t * SR), Math.round((t + 0.35) * SR))));
    const lvp = [4, 5].map((t) => amax(env.ctl.slice(Math.round(t * SR), Math.round((t + 0.35) * SR))));
    assert.ok(pk.every((p) => p > 0.35), `Env: the output rises on each timbre switch (${pk.map((p) => p.toFixed(2))})`);
    assert.ok(lvp.every((p) => p < 0.02), `Env: +12 / -12 dB changes leave the output at 0 (${lvp.map((p) => p.toFixed(3))})`);
    assert.ok(amin(env.ctl) >= 0 && amax(env.ctl) <= 1, "output stays in 0..1");
    // Sens: a high threshold (low Sens) rejects what a low threshold (high Sens) passes
    const lowSens = runNov(sw, { mode: 0, sens: 5, attack: 2, release: 60 });
    const highSens = runNov(sw, { mode: 0, sens: 95, attack: 2, release: 60 });
    assert.ok(amax(lowSens.ctl) < amax(highSens.ctl), "Sens 95 reacts harder than Sens 5");
    assert.ok(amax(lowSens.ctl) < 0.75 * amax(highSens.ctl), `Sens 5 (threshold 0.59) only passes the biggest changes, rescaled (${amax(lowSens.ctl).toFixed(2)} vs ${amax(highSens.ctl).toFixed(2)})`);
    // attack / release timing: 90 % rise time ~ Attack, 10 % fall time ~ Release (on the hold of a constant target)
    const f = new T.TimbreFollower(SR, { mode: 0, attack: 50, release: 200 });
    f.ca = 1 - Math.exp(-2.3 / (0.05 * SR));
    f.cr = 1 - Math.exp(-2.3 / (0.2 * SR));
    f.tgt = 1;
    let up = 0;
    while (f.envs < 0.9 && up < SR) { f.envs += f.ca * (1 - f.envs); up++; }
    assert.ok(Math.abs(up / SR - 0.05) < 0.003, `Attack = time to 90 % (${(up / SR * 1000).toFixed(1)} ms for 50 ms)`);

    const trig = runNov(sw, { mode: 1, sens: 50, attack: 5, release: 120 });
    const pulses = [];
    let armed = true;
    let cur = null;
    // the sound starts abruptly at t = 0 (a cold-start onset may fire once); the switches are what is asserted
    for (let i = Math.round(0.3 * SR); i < trig.ctl.length; i++) {
        if (armed && trig.ctl[i] > 0.5) { armed = false; cur = { t: i / SR, h: trig.ctl[i] }; }
        else if (!armed) { cur.h = Math.max(cur.h, trig.ctl[i]); if (trig.ctl[i] < 0.2) { armed = true; pulses.push(cur); } }
    }
    assert.strictEqual(pulses.length, 3, `Trig: one pulse per timbre switch, none at the level changes (${pulses.map((p) => p.t.toFixed(2))})`);
    pulses.forEach((p, i) => {
        assert.ok(p.t > i + 1 && p.t < i + 1.3, `pulse ${i} lands just after switch ${i + 1} s (${p.t.toFixed(3)})`);
        assert.ok(p.h > 0.999, `fixed AD pulse reaches 1.0 (${p.h})`);
    });
    // a pulse is fixed: its shape does not depend on how big the novelty was
    const small = runNov(cat(seg("saw", 1, -18), seg("square", 1, -18)), { mode: 1, sens: 90, attack: 5, release: 120 });
    const big = runNov(cat(seg("sine", 1, -18), seg("noise", 1, -18, 0, T.lcg(4))), { mode: 1, sens: 90, attack: 5, release: 120 });
    const pk1 = amax(small.ctl.slice(SR, Math.round(1.4 * SR)));
    const pk2 = amax(big.ctl.slice(SR, Math.round(1.4 * SR)));
    assert.ok(Math.abs(pk1 - 1) < 1e-9 && Math.abs(pk2 - 1) < 1e-9, "Trig pulse height is fixed");
    // refractory: two peaks closer than 40 ms fire once (hops of 5.8 ms: 7 hops)
    assert.strictEqual(Math.ceil((T.K.REFRACTORY_S * SR) / T.K.HOP), 7);
    console.log(`[PASS] Env peaks ${pk.map((p) => p.toFixed(2))} / level ${lvp.map((p) => p.toFixed(3))}; Trig 3 pulses at ${pulses.map((p) => p.t.toFixed(3))} s, height 1.000`);
}

// 3f. Focus: low-order (brightness) vs high-order (texture) changes
{
    const rndN = T.lcg(21);
    const white = T.synth("noise", SR * 2, SR, 0.2, 0, rndN);
    // brightness: white noise -> the same noise through a one-pole low-pass (spectral tilt, low-order cepstrum)
    const dark = new Float64Array(white.length);
    let y = 0;
    for (let i = 0; i < white.length; i++) { y += 0.12 * (white[i] - y); dark[i] = y * 3.2; }
    const bright = cat(white.subarray(0, SR), dark.subarray(SR));
    // texture: the same tilt but a different harmonic comb (saw 1000 Hz -> 1300 Hz at equal loudness): the change lives in the
    // high-order coefficients while c1 barely moves
    const texture = cat(T.synth("saw", SR, SR, 0.35, 1000), T.synth("saw", SR, SR, 0.35, 1300));
    const peakD = (sig, focus) => amax(runNov(sig, { focus }).dist.slice(hopS(1.0), hopS(1.4)));
    const bLow = peakD(bright, -100);
    const bHigh = peakD(bright, 100);
    const tLow = peakD(texture, -100);
    const tHigh = peakD(texture, 100);
    assert.ok(bLow > 1.3 * bHigh, `brightness change: Focus -100 (${bLow.toFixed(2)}) weighs more than +100 (${bHigh.toFixed(2)})`);
    assert.ok(tHigh > 1.3 * tLow, `texture change: Focus +100 (${tHigh.toFixed(2)}) weighs more than -100 (${tLow.toFixed(2)})`);
    console.log(`[PASS] Focus: brightness d ${bLow.toFixed(2)} (low) vs ${bHigh.toFixed(2)} (high); texture d ${tLow.toFixed(2)} (low) vs ${tHigh.toFixed(2)} (high)`);
}

// =========================================================================
// 4. THE V8UI SCRIPT ON ALL THREE LAYOUTS
// =========================================================================
function makeContext(letter, size) {
    const ops = { calls: [], texts: [], redraws: 0, outs: [], notify: 0, bounds: { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 } };
    const track = (x, y) => {
        ops.bounds.minX = Math.min(ops.bounds.minX, x);
        ops.bounds.minY = Math.min(ops.bounds.minY, y);
        ops.bounds.maxX = Math.max(ops.bounds.maxX, x);
        ops.bounds.maxY = Math.max(ops.bounds.maxY, y);
    };
    const mg = {
        size,
        init() {}, relative_coords: 1, autofill: 1,
        redraw() { ops.redraws++; },
        set_source_rgba(r, g, b, a) { for (const v of [r, g, b, a === undefined ? 1 : a]) assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `colour component ${v}`); },
        set_line_width() {},
        rectangle(x, y, w, h) { track(x, y); track(x + w, y + h); ops.calls.push("rect"); },
        rectangle_rounded(x, y, w, h) { track(x, y); track(x + w, y + h); ops.calls.push("rrect"); },
        move_to(x, y) { track(x, y); ops.last = [x, y]; },
        line_to(x, y) { track(x, y); },
        curve_to() {}, close_path() {},
        arc(x, y, r) { track(x - r, y - r); track(x + r, y + r); },
        fill() { ops.calls.push("fill"); },
        stroke() { ops.calls.push("stroke"); },
        select_font_face() {},
        set_font_size(s) { ops.fs = s; },
        show_text(t) { ops.texts.push({ t, x: ops.last[0], y: ops.last[1], size: ops.fs }); },
    };
    let telemetry = null;
    const ctx = {
        mgraphics: mg, inlets: 1, outlets: 1, console,
        outlet: (n, ...a) => ops.outs.push(a),
        notifyclients: () => { ops.notify++; },
        Buffer: function () { this.peek = () => telemetry; },
        Date,
    };
    ctx.setTelemetry = (t) => { telemetry = t; };
    vm.createContext(ctx);
    vm.runInContext(`var TIMBRE_LAYOUT = "${letter}";\n` + UI_SRC, ctx);
    return { ctx, ops };
}

function telemetryFrame(counter, head, idle, frames) {
    const t = new Array(2064).fill(0);
    t[0] = counter; t[1] = head; t[2] = 1; t[3] = 0.32; t[6] = 44100; t[7] = 0; t[8] = 0; t[9] = idle ? 1 : 0; t[10] = -20;
    for (const [col, vals] of Object.entries(frames || {})) {
        const base = 16 + Number(col) * 16;
        vals.forEach((v, i) => { t[base + i] = v; });
    }
    return t;
}

for (const letter of Object.keys(VARIANTS)) {
    const viz = patchers[letter].boxes.map((b) => b.box).find((b) => b.id === "obj-viz").presentation_rect;
    const W = viz[2];
    const H = viz[3];
    const { ctx, ops } = makeContext(letter, [W, H]);
    assert.strictEqual(ctx.mgraphics.relative_coords, 0, "relative_coords = 0 at the top of the script");
    assert.strictEqual(ctx.mgraphics.autofill, 0);

    // paint: demo state, then every mode; nothing outside the canvas, no text overflow
    const checkPaint = (label) => {
        ops.calls.length = 0; ops.texts.length = 0;
        ops.bounds = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
        vm.runInContext("paint()", ctx);
        assert.ok(ops.calls.length > 100, `${letter} ${label}: drew ${ops.calls.length} ops`);
        assert.ok(ops.bounds.minX >= -0.01 && ops.bounds.minY >= -0.01 && ops.bounds.maxX <= W + 0.01 && ops.bounds.maxY <= H + 0.01,
            `${letter} ${label}: geometry outside the ${W}x${H} canvas ${JSON.stringify(ops.bounds)}`);
        for (const tx of ops.texts) {
            const tw = ctx.textW(tx.t, tx.size);
            assert.ok(tx.x >= 0 && tx.x + tw <= W - 1 && tx.y - tx.size >= -0.5 && tx.y <= H + 0.5,
                `${letter} ${label}: text "${tx.t}" at ${tx.x.toFixed(1)},${tx.y.toFixed(1)} (w ${tw.toFixed(1)}) leaves the canvas`);
        }
        return ops.texts.map((t) => t.t);
    };
    vm.runInContext("preview()", ctx);
    let texts = checkPaint("demo");
    assert.ok(!texts.some((t) => /Filter Freq|Delay Fbk/.test(t)) && texts.some((t) => /not mapped/.test(t)), `${letter}: demo never fakes mapping state`);
    assert.ok(texts.some((t) => /^Sens \d+% \u00b7 thr \d+%$/.test(t)) || letter === "b", `${letter}: threshold readout`);
    vm.runInContext("curMode = 1; flashT0 = Date.now() - 80;", ctx);
    checkPaint("trig mode flash");
    vm.runInContext("curMode = 0; viewMode = 1;", ctx);
    checkPaint("deviation view");
    vm.runInContext("viewMode = 0; flashT0 = 0;", ctx);

    // slot messages: names from the Map subpatcher, unmapped state returns the word Map
    vm.runInContext('loadbang(); slot_name(1, "Filter", "Freq"); slot_mapped(1, 1); slot_name(2, "Map");', ctx);
    texts = checkPaint("live slots");
    assert.ok(texts.some((t) => /Filter Freq/.test(t)), `${letter}: slot 1 target name shown`);
    assert.ok(texts.some((t) => /2 +\u2014 not mapped/.test(t)), `${letter}: slot 2 shows unmapped`);
    assert.ok(!texts.some((t) => /Delay Fbk/.test(t)), `${letter}: demo names are gone once slots are live`);

    // threshold drag <-> Sens
    const g = vm.runInContext(`geom(${W}, ${H})`, ctx);
    const midY = g.strip[1] + g.strip[3] * 0.5;
    ops.outs.length = 0;
    vm.runInContext(`onclick(${g.strip[0] + 20}, ${midY}, 1)`, ctx);
    assert.ok(ops.outs.length === 1 && ops.outs[0][0] === "ui_sens", `${letter}: click in the novelty area emits ui_sens`);
    const s1 = ops.outs[0][1];
    assert.ok(s1 >= 0 && s1 <= 100 && Number.isInteger(s1));
    vm.runInContext(`ondrag(${g.strip[0] + 20}, ${g.strip[1] + 2}, 1)`, ctx);
    const sTop = ops.outs[ops.outs.length - 1][1];
    vm.runInContext(`ondrag(${g.strip[0] + 20}, ${g.strip[1] + g.strip[3] - 2}, 1)`, ctx);
    const sBottom = ops.outs[ops.outs.length - 1][1];
    assert.ok(sTop < s1 && s1 < sBottom, `${letter}: dragging the line up lowers Sens (top ${sTop}, mid ${s1}, bottom ${sBottom})`);
    assert.ok(sTop <= 8 && sBottom >= 92, `${letter}: the drag spans the whole Sens range (${sTop}..${sBottom})`);
    vm.runInContext("ondrag(0, 0, 0)", ctx);
    // the line follows the Sens value and a Sens set from the control does not echo back
    ops.outs.length = 0;
    vm.runInContext("set_sens(30)", ctx);
    assert.strictEqual(vm.runInContext("curSens", ctx), 30);
    assert.strictEqual(ops.outs.length, 0, `${letter}: set_sens does not echo (no feedback loop)`);
    const yThr = vm.runInContext("thrToY(geom(" + W + "," + H + "), sensToThr(curSens))", ctx);
    assert.ok(Math.abs(vm.runInContext(`thrToSens(yToThr(geom(${W},${H}), ${yThr}))`, ctx) - 30) < 1e-6, `${letter}: y <-> Sens round trip`);
    // double-click resets to 50
    ops.outs.length = 0;
    vm.runInContext(`lastClickT = 0; onclick(${g.strip[0] + 10}, ${midY}, 1); onclick(${g.strip[0] + 10}, ${midY}, 1)`, ctx);
    assert.deepStrictEqual(ops.outs[ops.outs.length - 1], ["ui_sens", 50], `${letter}: double-click resets Sens to 50`);
    vm.runInContext("ondrag(0, 0, 0)", ctx);

    // constants shared with the reference
    assert.strictEqual(vm.runInContext("TIMBRE_THR_BASE", ctx), T.K.THR_BASE);
    assert.strictEqual(vm.runInContext("TIMBRE_THR_SPAN", ctx), T.K.THR_SPAN);
    for (const s of [0, 37, 100]) assert.ok(Math.abs(vm.runInContext(`sensToThr(${s})`, ctx) - T.sensToThreshold(s)) < 1e-12);

    // telemetry decode + redraw skipping
    vm.runInContext('setbuffer("#0-timbrescope")', ctx);
    const col = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0.6, 0.4, 0];
    ctx.setTelemetry(telemetryFrame(10, 5, false, { 5: col, 4: col, 3: col }));
    ops.redraws = 0;
    vm.runInContext("pullScope()", ctx);
    assert.strictEqual(vm.runInContext("demoActive", ctx), false, `${letter}: demo ends with the first real telemetry`);
    assert.strictEqual(ops.redraws, 1, `${letter}: a new hop counter redraws once`);
    const newest = vm.runInContext("dNov[dNov.length - 1]", ctx);
    assert.ok(newest > 0.55 && newest <= 0.6 + 1e-9, `${letter}: novelty decoded (${newest})`);
    for (let i = 0; i < 5; i++) vm.runInContext("pullScope()", ctx);
    assert.strictEqual(ops.redraws, 1, `${letter}: an unchanged counter (silence) costs zero redraws`);
    ctx.setTelemetry(telemetryFrame(10, 5, true, {}));
    vm.runInContext("pullScope()", ctx);
    assert.strictEqual(ops.redraws, 2, `${letter}: the idle flag redraws once`);
    for (let i = 0; i < 5; i++) vm.runInContext("pullScope()", ctx);
    assert.strictEqual(ops.redraws, 2, `${letter}: and then nothing`);
    // wrapped counter and a burst of 3 new columns
    ctx.setTelemetry(telemetryFrame(13, 8, false, { 6: col, 7: col, 8: col }));
    vm.runInContext("pullScope()", ctx);
    assert.strictEqual(ops.redraws, 3);
    // a trigger count change starts a flash that keeps redrawing until it fades
    const trigFrame = telemetryFrame(14, 9, false, { 9: col });
    trigFrame[8] = 3;
    ctx.setTelemetry(trigFrame);
    vm.runInContext("pullScope()", ctx);
    assert.ok(vm.runInContext("flashT0", ctx) > 0, `${letter}: trigger count change arms the flash`);
    checkPaint("after telemetry");

    // versioned state
    assert.strictEqual(JSON.stringify(vm.runInContext("getvalueof()", ctx)), "[1,0]");
    vm.runInContext("setvalueof([1, 1])", ctx);
    assert.strictEqual(JSON.stringify(vm.runInContext("getvalueof()", ctx)), "[1,1]", `${letter}: state round trip`);
    vm.runInContext("setvalueof([99, 0])", ctx); // a future version still reads the fields it knows
    vm.runInContext("setvalueof([])", ctx);
    vm.runInContext("setvalueof()", ctx);
    assert.strictEqual(vm.runInContext("getvalueof()[0]", ctx), 1, `${letter}: first element is the version`);
    console.log(`[PASS] v8ui layout ${letter} (${W}x${H}): paint bounds / text fit, threshold <-> Sens, no redraw when silent, slots, state`);
}

// =========================================================================
// 5. PREVIEW HOOK
// =========================================================================
{
    for (const letter of Object.keys(VARIANTS)) {
        const { ctx } = makeContext(letter, [10, 10]);
        assert.strictEqual(typeof ctx.preview, "function", "preview() hook for scripts/render_preview.py");
        assert.strictEqual(typeof ctx.paint, "function");
    }
    console.log("[PASS] preview() / paint() hooks");
}

console.log("All Timbre Follower tests passed!");
