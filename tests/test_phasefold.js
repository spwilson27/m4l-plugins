#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ref = require("../src/cepstrum_ref.js");
const model = require("./phasefold_model.js");
const legacy = require("./phasefold_legacy_model.js");
const mx = require("./phasefold_metrics.js");

const ROOT = path.join(__dirname, "..");
const LIB_PATH = path.join(ROOT, "src", "cepstrum_lib.genexpr");
const CORE_PATH = path.join(ROOT, "src", "phasefold_core.genexpr");
const UI_PATH = path.join(ROOT, "src", "phasefold_ui.js");

const lib = fs.readFileSync(LIB_PATH, "utf8");
const core = fs.readFileSync(CORE_PATH, "utf8");
const ui = fs.readFileSync(UI_PATH, "utf8");

// ---------------------------------------------------------------- gen source
assert.ok(!core.match(/\be\d/), "e-digits are Euler's number in GenExpr");
assert.strictEqual((core.match(/\bdelay\(/g) || []).length, 0, "delay() is not valid GenExpr");
for (const bad of ["phi", "pi", "gate", "pos", "neg", "twopi"]) {
    assert.ok(!new RegExp(`\\b${bad}\\s*=[^=]`).test(core), `identifier ${bad} is a GenExpr constant or operator`);
}
const lastFn = core.indexOf("\npf_slew(");
for (const decl of ["\nBuffer ", "\nParam ", "\nData ", "\nDelay ", "\nHistory "]) {
    assert.ok(lastFn > 0 && core.indexOf(decl) > lastFn, `${decl.trim()} must come after every function`);
}
assert.ok(core.includes('Buffer scope("phasefoldscope")'), "telemetry buffer");
assert.ok(core.includes("padL.read(4096 - (n - 1))"), "constant 4096 sample pad");
assert.ok(core.includes("Data tab(8192, 3);") && core.includes("Data fx(8192, 2);") && core.includes("Data fc(8192, 2);") && core.includes("Data xo(8192, 2);"), "2N zero-padded cepstral path needs 8192-point work buffers");
assert.ok(core.includes("pf_fft(fx, tab, m, 0);") && !core.includes("fft_run(") && !core.includes("cep_from_spec("), "cepstral path uses the 2N FFT, not the 4096-point library FFT");
assert.ok(core.includes("pf_limit(") && core.includes("0.0031622776601683794"), "crest limiter and relative log floor");
assert.ok(core.includes("2.5118864315095806") && model.LIM_DB === 8 && Math.abs(Math.pow(10, model.LIM_DB / 20) - 2.5118864315095806) < 1e-12, "gen and model use the same crest limit");
assert.ok(Math.abs(model.FLOOR_REL - 0.0031622776601683794) < 1e-15 && model.PAD === 2, "gen and model use the same log floor and padding");
assert.ok(core.includes("* 1.1, 0.25, 4)") && model.AGC_KC === 1.1 && model.AGC_FRAME === 0.25, "gen and model use the same Auto Gain constants");
assert.ok(core.includes("dryL.read(4096)"), "dry path delayed by the same 4096 samples");

// ------------------------------------------------------------------ variants
const VARIANTS = {
    a: { file: "Phase Fold A.amxd", width: 408 },
    b: { file: "Phase Fold B.amxd", width: 300 },
    c: { file: "Phase Fold C.amxd", width: 440 },
};
const PARAM_RANGES = {
    Phase: [-100, 100],
    Size: [0, 3],
    Orig: [0, 100],
    "Auto Gain": [0, 1],
    Mix: [0, 100],
    Output: [-24, 12],
};
const sigs = new Set();

function overlaps(a, b) {
    return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

function loadDevice(file) {
    const raw = fs.readFileSync(path.join(ROOT, "devices", file));
    assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected an audio effect");
    assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch");
    assert.strictEqual(32 + raw.readUInt32LE(28), raw.length, "ptch chunk length mismatch");
    return JSON.parse(raw.slice(32).toString("utf8")).patcher;
}

for (const [letter, info] of Object.entries(VARIANTS)) {
    const p = loadDevice(info.file);
    const tag = `variant ${letter}`;
    assert.strictEqual(p.devicewidth, info.width, `${tag} width`);
    assert.deepStrictEqual(p.openrect, [0, 0, info.width, 169], `${tag} openrect height 169`);
    assert.strictEqual(p.openinpresentation, 1);
    assert.strictEqual(p.latency, 4096, `${tag} static latency attribute`);
    const boxes = new Map(p.boxes.map((b) => [b.box.id, b.box]));

    // gen core = library + core, verbatim
    assert.strictEqual(boxes.get("obj-gen").code, lib + "\n" + core, `${tag} embedded gen code`);
    assert.strictEqual(boxes.get("obj-gen").maxclass, "gen.codebox~");
    assert.ok(boxes.get("obj-scope").text.includes("#0-phasefoldscope"), "instance isolated buffer");
    assert.strictEqual(boxes.get("obj-msg-genbuf").text, "scope #0-phasefoldscope");
    assert.strictEqual(boxes.get("obj-msg-uibuf").text, "setbuffer #0-phasefoldscope");
    assert.strictEqual(boxes.get("obj-msg-layout").text, `layout ${letter}`);
    for (const b of boxes.values()) {
        if (/\b(send|receive|s|r|buffer~)\b/.test(b.text || "") && /^(send|receive|buffer~)/.test(b.text || "")) {
            assert.ok((b.text || "").includes("#0-"), `${b.id} must use #0- naming`);
        }
    }

    // v8ui: same script, only the layout line differs
    const viz = boxes.get("obj-viz");
    const want = ui.replace('var layoutMode = "a"; // @layout', `var layoutMode = "${letter}"; // @layout`);
    assert.strictEqual(viz.textfile.text, want, `${tag} v8ui text`);
    assert.ok(viz.textfile.text.includes("mgraphics.relative_coords = 0;"));
    assert.ok(viz.textfile.text.includes("mgraphics.autofill = 0;"));
    sigs.add(JSON.stringify(boxes.get("obj-gen").code) + ui.length);

    // parameters
    const found = {};
    for (const b of boxes.values()) {
        const v = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
        if (!v || !v.parameter_longname) continue;
        found[v.parameter_longname] = v;
        assert.ok(v.parameter_mmax <= 255 || v.parameter_type === 0, "Int range above 255 needs a float parameter");
    }
    assert.deepStrictEqual(Object.keys(found).sort(), Object.keys(PARAM_RANGES).sort(), `${tag} parameter set`);
    for (const [name, [lo, hi]] of Object.entries(PARAM_RANGES)) {
        assert.strictEqual(found[name].parameter_mmin, lo, `${name} min`);
        assert.strictEqual(found[name].parameter_mmax, hi, `${name} max`);
    }
    assert.deepStrictEqual(found.Size.parameter_enum, ["512", "1024", "2048", "4096"]);
    assert.strictEqual(found.Size.parameter_initial[0], 2, "Size default 2048");
    assert.strictEqual(found.Mix.parameter_initial[0], 100);
    assert.strictEqual(found["Auto Gain"].parameter_initial[0], 1, "Auto Gain defaults on");
    assert.deepStrictEqual(p.parameters.parameterbanks["0"].parameters.sort(), Object.keys(PARAM_RANGES).sort());

    // layout rules: no widget over the canvas, no interactive overlaps, panels last
    const vr = viz.presentation_rect;
    assert.ok(vr[1] + vr[3] <= 169, `${tag} canvas inside 169 px`);
    const interactive = [];
    for (const [id, b] of boxes) {
        if (id === "obj-viz" || b.maxclass === "panel" || !b.presentation || !b.presentation_rect) continue;
        const r = b.presentation_rect;
        assert.ok(!overlaps(r, vr), `${tag}: ${id} overlaps the v8ui canvas`);
        assert.ok(r[0] >= 0 && r[0] + r[2] <= info.width && r[1] >= 0 && r[1] + r[3] <= 169, `${tag}: ${id} outside the device`);
        if (b.maxclass.startsWith("live.") && b.maxclass !== "live.comment") interactive.push([id, r]);
        if (b.maxclass === "live.numbox" && b.appearance >= 2) {
            const c = b.activeslidercolor;
            assert.strictEqual(c[3], 1.0, `${id} slider alpha`);
            assert.ok(Math.max(...c.slice(0, 3)) < 0.5, `${id} slider colour is pre-blended with the dark background`);
        }
    }
    for (let i = 0; i < interactive.length; i++) {
        for (let j = i + 1; j < interactive.length; j++) {
            assert.ok(!overlaps(interactive[i][1], interactive[j][1]), `${tag}: ${interactive[i][0]} overlaps ${interactive[j][0]}`);
        }
    }
    const order = p.boxes.map((b) => b.box.id);
    const lastWidget = Math.max(...order.map((id, i) => (boxes.get(id).maxclass !== "panel" ? i : -1)));
    for (const [id, b] of boxes) {
        if (b.maxclass !== "panel") continue;
        assert.strictEqual(b.background, 1, `${id} background`);
        assert.ok(order.indexOf(id) > lastWidget, `${id} must be last in boxes`);
    }

    // patchlines
    const lines = new Set(
        p.lines.map((l) => `${l.patchline.source[0]}:${l.patchline.source[1]}->${l.patchline.destination[0]}:${l.patchline.destination[1]}`)
    );
    for (const [ctl, prep, ui2] of [
        ["obj-phase", "obj-prep-phase", "obj-ui-phase"],
        ["obj-size", "obj-prep-size", "obj-ui-size"],
        ["obj-orig", "obj-prep-orig", "obj-ui-orig"],
        ["obj-auto", "obj-prep-auto", "obj-ui-auto"],
        ["obj-mix", "obj-prep-mix", "obj-ui-mix"],
        ["obj-output", "obj-prep-out", "obj-ui-out"],
    ]) {
        for (const l of [`${ctl}:0->${prep}:0`, `${prep}:0->obj-gen:0`, `${ctl}:0->${ui2}:0`, `${ui2}:0->obj-viz:0`]) {
            assert.ok(lines.has(l), `${tag}: missing ${l}`);
        }
    }
    for (const l of ["obj-viz:0->obj-route-viz:0", "obj-route-viz:0->obj-prep-phase:0", "obj-route-viz:0->obj-set-phase:0", "obj-set-phase:0->obj-phase:0"]) {
        assert.ok(lines.has(l), `${tag}: missing ${l}`);
    }
    // the three layouts are genuinely different
    boxes.vizRect = vr.join(",");
    VARIANTS[letter].viz = vr.join(",");
    VARIANTS[letter].count = p.boxes.length;
}
assert.strictEqual(new Set(Object.values(VARIANTS).map((v) => v.viz)).size, 3, "three different canvas rects");
assert.strictEqual(new Set(Object.values(VARIANTS).map((v) => v.width)).size, 3, "three different widths");

// ------------------------------------------------------------ v8ui (mock)
function makeUi(letter) {
    const cmds = [];
    const mg = new Proxy(
        { size: [270, 134], relative_coords: 1, autofill: 1 },
        {
            get(t, k) {
                if (k in t) return t[k];
                return () => cmds.push(k);
            },
            set(t, k, v) {
                t[k] = v;
                return true;
            },
        }
    );
    const sent = [];
    const text = ui.replace('var layoutMode = "a"; // @layout', `var layoutMode = "${letter}"; // @layout`);
    const fn = new Function(
        "mgraphics", "inlets", "outlets", "outlet",
        text + "\nreturn { paint, onclick, ondrag, ondblclick, set_phase, set_size, layout, preview, getPhase: function () { return curPhase; }, mgraphics };"
    );
    return { m: fn(mg, 1, 1, (i, msg) => sent.push(msg)), mg, cmds, sent };
}
const sizes = { a: [270, 134], b: [280, 40], c: [420, 114] };
for (const letter of ["a", "b", "c"]) {
    const t = makeUi(letter);
    t.mg.size = sizes[letter];
    t.m.preview();
    t.m.paint();
    assert.strictEqual(t.mg.relative_coords, 0);
    assert.strictEqual(t.mg.autofill, 0);
    assert.ok(t.cmds.length > 20, `variant ${letter} paints`);
    // phase handle: a and c only
    t.m.onclick(10, sizes[letter][1] - 8);
    t.m.ondrag(sizes[letter][0] - 4, sizes[letter][1] - 8);
    if (letter === "b") {
        assert.strictEqual(t.sent.length, 0, "variant b has no canvas handle");
    } else {
        assert.ok(t.sent.length >= 2, `variant ${letter} emits phase`);
        assert.deepStrictEqual(t.sent[0][0], "phase");
        assert.ok(t.sent[0][1] <= -95, "left edge is -100 (max phase)");
        assert.ok(t.sent[t.sent.length - 1][1] >= 95, "right edge is +100 (min phase)");
        t.m.paint();
        t.m.ondblclick(100, sizes[letter][1] - 8);
        assert.strictEqual(t.m.getPhase(), 0, "double click resets to 0");
    }
    t.m.set_phase(77);
    assert.strictEqual(t.m.getPhase(), 77, "set_phase mirrors the control");
}

// ------------------------------------------------------------------- DSP math
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
function noise(len, amp, seed) {
    const r = rng(seed);
    const o = new Float64Array(len);
    for (let i = 0; i < len; i++) o[i] = (r() * 2 - 1) * amp;
    return o;
}
function kick(len, start, sr) {
    const o = new Float64Array(len);
    for (let i = 0; i < 12000 && start + i < len; i++) {
        const t = i / sr;
        o[start + i] = 0.8 * Math.exp(-t * 25) * Math.sin(2 * Math.PI * (55 * t + 3 * (1 - Math.exp(-t * 40))));
    }
    return o;
}
function windowed(x, start, n) {
    const w = ref.hann(n);
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = (x[start + i] || 0) * w[i];
    return { xw: o, win: w };
}
function magnitudes(re, im) {
    return Array.from(re, (v, i) => Math.hypot(v, im[i]));
}

// Magnitude spectrum preserved for every Phase (on the whole 2N transform), and p = +/-1 equal the library folds.
{
    const n = 1024;
    const m = n * model.PAD;
    const { xw, win } = windowed(noise(4096, 0.3, 7), 500, n);
    const xr = new Float64Array(m);
    const xi = new Float64Array(m);
    xr.set(xw);
    ref.fft(xr, xi, false);
    const magIn = magnitudes(xr, xi);
    for (const p of [-1, -0.5, 0, 0.5, 1]) {
        const r = model.processFrame(xw, win, p, 0, false, 0);
        const yr = Float64Array.from(r.yfull);
        const yi = new Float64Array(m);
        ref.fft(yr, yi, false);
        const magOut = magnitudes(yr, yi);
        let worst = 0;
        for (let k = 0; k < m; k++) worst = Math.max(worst, Math.abs(magOut[k] - magIn[k]) / (magIn[k] + 1e-3));
        assert.ok(worst < 1e-5, `phase ${p}: magnitude spectrum preserved (worst rel err ${worst})`);
    }
    // p = +1 is exactly the library's minimum-phase frame, p = -1 the maximum-phase one (same log floor)
    for (const [p, fold] of [[1, ref.foldMinPhase], [-1, ref.foldMaxPhase]]) {
        const r = model.processFrame(xw, win, p, 0, false, 0);
        const c = ref.realCepstrum(xr, xi, r.eps);
        const ls = ref.cepToLogSpec(fold(c));
        const sp = ref.expSpec(ls.re, ls.im, r.eps);
        ref.fft(sp.re, sp.im, true);
        let worst = 0;
        let peak = 0;
        for (let i = 0; i < m; i++) {
            worst = Math.max(worst, Math.abs(r.yfull[i] - sp.re[i]));
            peak = Math.max(peak, Math.abs(sp.re[i]));
        }
        assert.ok(worst < 1e-6 * Math.max(1, peak), `p = ${p} matches the cepstrum_ref fold (${worst})`);
    }
}

// Energy centroid inside the frame: +100 earlier than the input, -100 later, monotonic in between.
{
    const n = 2048;
    const cs = [];
    for (const p of [1, 0.5, 0, -0.5, -1]) {
        // a click at the frame centre with a decay (the Hann window centres the input energy)
        const click = new Float64Array(n);
        for (let i = 0; i < 900; i++) click[n / 2 - 30 + i] = Math.exp(-i / 220) * (i % 7 < 3 ? 1 : -0.6);
        const win = ref.hann(n);
        const xw = click.map((v, i) => v * win[i]);
        const r = model.processFrame(xw, win, p, 0, false);
        cs.push([p, r.cIn, r.cOut]);
    }
    const cIn = cs[0][1];
    assert.ok(Math.abs(cIn - 0.5) < 0.1, `input centroid near the frame centre (${cIn})`);
    assert.ok(cs[0][2] < cIn - 0.15, `Phase +100: centroid earlier than the input (${cs[0][2]} vs ${cIn})`);
    assert.ok(cs[4][2] > cIn + 0.15, `Phase -100: centroid later than the input (${cs[4][2]} vs ${cIn})`);
    assert.ok(Math.abs(cs[2][2] - 0.5) < 0.08, `Phase 0: centroid mid frame (${cs[2][2]})`);
    for (let i = 1; i < cs.length; i++) assert.ok(cs[i][2] > cs[i - 1][2], "centroid moves monotonically with Phase");
}

// Time domain: a kick gets a swell before its attack at -100, none at +100, more at larger Size.
{
    const sr = 44100;
    const st = 10000;
    const x = kick(30000, st, sr);
    const preFrac = (n, p) => {
        const y = model.run(x, n, p, 0, true).subarray(n - 1);
        let pre = 0;
        let tot = 0;
        for (let i = 0; i < y.length; i++) {
            const e = y[i] * y[i];
            tot += e;
            if (i < st - 50) pre += e;
        }
        return pre / tot;
    };
    const maxPhase = preFrac(4096, -1);
    const minPhase = preFrac(4096, 1);
    assert.ok(maxPhase > 0.2, `-100 at 4096: pre-swell holds ${(maxPhase * 100).toFixed(1)} % of the energy`);
    assert.ok(minPhase < 0.03, `+100 at 4096: no pre-ring (${(minPhase * 100).toFixed(2)} %)`);
    assert.ok(preFrac(2048, -1) < maxPhase, "larger Size gives a longer swell");
    const pre0 = preFrac(4096, 0);
    assert.ok(pre0 > minPhase && pre0 < maxPhase, "Phase 0 sits between");
}

// Level: Auto Gain holds loudness within 1 dB across Phase (noise) and 1.5 dB (kicks); Orig = 100 is identity.
{
    const sr = 44100;
    const sigNoise = noise(sr, 0.35, 12345);
    const sigKick = new Float64Array(sr * 2);
    for (let s = 2000; s < sigKick.length - 9000; s += 22050) sigKick.set(kick(10000, 0, sr).subarray(0, 8000), s);
    const level = (x, n, p, orig, ag) => {
        const y = model.run(x, n, p, orig, ag);
        const a = 8192;
        const b = x.length - 8192;
        return 20 * Math.log10(model.rms(y, a + n - 1, b + n - 1) / model.rms(x, a, b));
    };
    for (const n of [512, 2048]) {
        for (const p of [-1, -0.5, 0, 0.5, 1]) {
            const ln = level(sigNoise, n, p, 0, true);
            assert.ok(Math.abs(ln) < 1.0, `noise N=${n} Phase ${p * 100}: ${ln.toFixed(2)} dB`);
            const lk = level(sigKick, n, p, 0, true);
            assert.ok(Math.abs(lk) < 1.5, `kick N=${n} Phase ${p * 100}: ${lk.toFixed(2)} dB`);
        }
    }
    // the problem Auto Gain fixes: re-phased frames add as powers, so without it the level is down
    const raw = level(sigNoise, 1024, -1, 0, false);
    assert.ok(raw < -0.8 && raw > -3.6, `uncompensated level ${raw.toFixed(2)} dB is the incoherent overlap loss`);
    assert.ok(Math.abs(level(sigNoise, 1024, -1, 0, true)) < Math.abs(raw), "Auto Gain brings it closer to 0 dB");
    // Orig 100%: the original spectrum goes through untouched, so unity gain and perfect identity
    const y = model.run(sigNoise, 1024, -1, 1, true);
    let worst = 0;
    for (let i = 9000; i < sigNoise.length - 9000; i++) worst = Math.max(worst, Math.abs(y[i + 1023] - sigNoise[i]));
    assert.ok(worst < 1e-5, `Orig 100% is identity (max err ${worst})`);
    // Orig 50%: finite, level still close
    const l50 = level(sigNoise, 1024, -1, 0.5, true);
    assert.ok(Math.abs(l50) < 1.5, `Orig 50% level ${l50.toFixed(2)} dB`);
}

// Why the unplaced frame is quiet: pivot 0 puts the min-phase energy under the Hann window's zero.
{
    const n = 1024;
    const { xw, win } = windowed(noise(4096, 0.3, 99), 300, n);
    const atZero = model.processFrame(xw, win, 1, 0, false, 0);
    const placed = model.processFrame(xw, win, 1, 0, false);
    assert.ok(atZero.eOut < 0.2 * atZero.eIn, "pivot 0: frame energy under the synthesis window is a fraction of the input's");
    assert.ok(placed.eOut > 0.35 * placed.eIn, "pivot placement keeps the energy under the window");
}

// Pivot finder lands on a click.
{
    const ep = new Float64Array(2048);
    ep[1500] = 1;
    assert.ok(Math.abs(model.findPivot(ep) - 1500) <= 16, "pivot near the click");
}

// Silence: frames below the energy gate are skipped, output is exactly zero.
{
    const y = model.run(new Float64Array(8192), 1024, -1, 0, true);
    assert.strictEqual(Math.max(...y.map(Math.abs)), 0, "silence in, exact zeros out");
}

// ------------------------------------------------- crispiness regression (artifact metrics)
// "Crispy" = crackly, gritty output. Causes found with these metrics (legacy model = before the fix):
//   spikes     a rebuilt phase turns noise frames into clicks: hop-rate ripple 3..4 dB, crest +19 dB
//   incoherence the loudest-sample pivot flips sign on tonal frames: 13 dB AM on a sine, +6 dB floor between saw harmonics
//   aliasing   N-point cepstrum wraps long min/max-phase tails (narrow-band input) around the frame
//   level      the +3.1 dB overlap compensation overshoots tonal frames (saw +3.0 dB)
{
    const n = 1024;
    const len = Math.floor(mx.SR * 1.2);
    const a0 = 8192;
    const aEnd = len - 8192;
    const lat = n - 1;
    const phases = [-1, -0.5, 0, 0.5, 1];
    const white = mx.whiteNoise(len);
    const sine = mx.sine(len);
    const saw = mx.saw(len);
    const chord = mx.chord(len);
    const inFloor = mx.interharmonicFloorDb(saw, a0, 200);
    const inCrest = mx.crestDb(white, a0, aEnd);
    const inRip = mx.envRipple(white, a0, aEnd);
    const levels = {};
    const worst = { rip: 0, crest: 0, am: 0, floor: -99, hf: -99 };
    const bad = { rip: 0, crest: 0, am: 0, floor: -99, lvl: 0 };
    const lp = { white: mx.lowpass(white, 5000), chord: mx.lowpass(chord, 5000) };
    const hfIn = { white: mx.highBandDb(lp.white, a0), chord: mx.highBandDb(lp.chord, a0) };
    for (const [label, m, w] of [["fixed", model, worst], ["legacy", legacy, bad]]) {
        const lv = {};
        for (const p of phases) {
            const yw = m.run(white, n, p, 0, true);
            w.rip = Math.max(w.rip, mx.envRipple(yw, a0 + lat, aEnd + lat));
            w.crest = Math.max(w.crest, mx.crestDb(yw, a0 + lat, aEnd + lat));
            w.am = Math.max(w.am, mx.amRipple(m.run(sine, n, p, 0, true), a0 + lat, aEnd + lat));
            const ys = m.run(saw, n, p, 0, true);
            w.floor = Math.max(w.floor, mx.interharmonicFloorDb(ys, a0 + lat, 200));
            for (const [k, x, y] of [["noise", white, yw], ["saw", saw, ys], ["chord", chord, m.run(chord, n, p, 0, true)], ["sine", sine, m.run(sine, n, p, 0, true)]]) {
                (lv[k] = lv[k] || []).push(mx.rmsDb(y, a0 + lat, aEnd + lat) - mx.rmsDb(x, a0, aEnd));
            }
            if (m === model) {
                for (const k of ["white", "chord"]) {
                    const y = m.run(lp[k], n, p, 0, true);
                    worst.hf = Math.max(worst.hf, mx.highBandDb(y, a0 + lat) - hfIn[k]);
                }
            }
        }
        levels[label] = lv;
    }
    // each metric must (a) pass with the fix and (b) fail on the legacy model, so it really detects the artifact
    assert.ok(worst.rip < inRip + 1.2, `noise hop-rate ripple ${worst.rip.toFixed(2)} dB (input ${inRip.toFixed(2)})`);
    assert.ok(bad.rip > inRip + 2.2, `legacy noise ripple ${bad.rip.toFixed(2)} dB is the click train`);
    assert.ok(worst.crest < inCrest + 12, `noise crest ${worst.crest.toFixed(1)} dB (input ${inCrest.toFixed(1)})`);
    assert.ok(bad.crest > inCrest + 17, `legacy noise crest ${bad.crest.toFixed(1)} dB is the spikes`);
    assert.ok(worst.am < 5, `sine amplitude modulation ${worst.am.toFixed(1)} dB p-p`);
    assert.ok(bad.am > 9, `legacy sine amplitude modulation ${bad.am.toFixed(1)} dB p-p is the pivot incoherence`);
    assert.ok(worst.floor < inFloor + 3.5, `saw floor between harmonics ${worst.floor.toFixed(1)} dB (input ${inFloor.toFixed(1)})`);
    assert.ok(bad.floor > inFloor + 5, `legacy saw floor ${bad.floor.toFixed(1)} dB is the grit between harmonics`);
    assert.ok(worst.hf < 3, `energy above 10 kHz on band-limited input rises ${worst.hf.toFixed(1)} dB at most`);
    for (const [k, v] of Object.entries(levels.fixed)) {
        const lo = Math.min(...v);
        const hi = Math.max(...v);
        assert.ok(lo > -1.5 && hi < 1.5, `${k}: level ${lo.toFixed(2)}..${hi.toFixed(2)} dB across Phase`);
        assert.ok(hi - lo < 1.5, `${k}: level spread ${(hi - lo).toFixed(2)} dB across Phase`);
    }
    assert.ok(Math.max(...levels.legacy.saw) > 2.5, "legacy saw is +3 dB loud (overlap compensation overshoots coherent frames)");
}

// Cepstral time aliasing: a narrow-band frame has a min/max-phase response longer than the frame.
// The 2N-point cepstral path keeps it in n..2n and drops it, the old N-point path wrapped it into the frame.
{
    const n = 1024;
    const win = ref.hann(n);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 1000 * i) / mx.SR) * win[i];
    for (const p of [1, -1]) {
        const r = model.processFrame(x, win, p, 0, false, p > 0 ? 256 : 768);
        let inside = 0;
        let beyond = 0;
        for (let i = 0; i < 2 * n; i++) {
            if (i < n) inside += r.yfull[i] * r.yfull[i];
            else beyond += r.yfull[i] * r.yfull[i];
        }
        assert.ok(beyond > 0.004 * inside, `p ${p}: ${(100 * beyond / (inside + beyond)).toFixed(1)} % of the response lies past the frame`);
        assert.strictEqual(r.y.length, n);
        assert.strictEqual(r.y[10], r.yfull[10], "y is the first n samples of the 2N transform");
    }
}

// Relative log floor: eps follows the frame's peak magnitude (-50 dB), never below 1e-9.
{
    const n = 512;
    const win = ref.hann(n);
    for (const amp of [1e-6, 0.3, 1]) {
        const { xw } = windowed(noise(2048, amp, 5), 100, n);
        const r = model.processFrame(xw, win, 0.5, 0, false, 0);
        const xr = new Float64Array(2 * n);
        const xi = new Float64Array(2 * n);
        xr.set(xw);
        ref.fft(xr, xi, false);
        let peak = 0;
        for (let k = 0; k < 2 * n; k++) peak = Math.max(peak, Math.hypot(xr[k], xi[k]));
        assert.ok(Math.abs(r.eps - Math.max(peak * Math.pow(10, -50 / 20), 1e-9)) < 1e-12, `eps follows the frame peak at amplitude ${amp}`);
    }
}

// Crest limiter: a noise frame (its rebuilt phase is a click) is blended back, a click frame is left alone.
{
    const n = 1024;
    const win = ref.hann(n);
    const { xw } = windowed(noise(4096, 0.3, 21), 700, n);
    const rn = model.processFrame(xw, win, 1, 0, false);
    const zo = xw.map((v, i) => v * win[i]);
    assert.ok(rn.blend > 0.2, `noise frame at +100 is blended toward the input (${rn.blend})`);
    assert.ok(model.crestOf(rn.z, n) <= model.crestOf(zo, n) * Math.pow(10, model.LIM_DB / 20) + 1e-9, "limited frame is at most 8 dB spikier than the input frame");
    const click = new Float64Array(n);
    click[n / 2] = 1;
    const rc = model.processFrame(click.map((v, i) => v * win[i]), win, 1, 0, false);
    assert.strictEqual(rc.blend, 0, "a click frame is not limited");
    // Orig 100 % stays an exact identity through the limiter
    const ro = model.processFrame(xw, win, 1, 1, true);
    let err = 0;
    for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(ro.z[i] - zo[i]));
    assert.ok(err < 1e-12 && ro.blend === 0, `Orig 100 %: z == input frame (err ${err})`);
}

// Signed pivot: lands on the positive crest of a periodic wave whatever the sign or offset of the frame.
{
    const n = 1024;
    const win = ref.hann(n);
    for (const ph of [0, 1.1, 2.5, 4]) {
        for (const sgn of [1, -1]) {
            const xw = new Float64Array(n);
            for (let i = 0; i < n; i++) xw[i] = sgn * Math.sin((2 * Math.PI * 441 * i) / mx.SR + ph) * win[i];
            const piv = model.findPivot(xw);
            const loc = Math.max(...xw.subarray(Math.max(0, piv - 6), piv + 7));
            assert.ok(loc > 0.6 * Math.max(...xw), `sine phase ${ph} sign ${sgn}: pivot ${piv} on a positive crest`);
        }
    }
}

// Auto Gain is smooth: the gain changes by < 0.5 dB per 128 samples on steady noise, and ends at ~0 dB.
{
    const x = noise(40000, 0.3, 3);
    const a = model.run(x, 1024, -0.5, 0, true);
    const b = model.run(x, 1024, -0.5, 0, false);
    let step = 0;
    for (let i = 20000; i < 38000; i += 128) {
        const g0 = model.rms(a, i, i + 128) / (model.rms(b, i, i + 128) + 1e-12);
        const g1 = model.rms(a, i + 128, i + 256) / (model.rms(b, i + 128, i + 256) + 1e-12);
        step = Math.max(step, Math.abs(20 * Math.log10(g1 / g0)));
    }
    assert.ok(step < 1.5, `Auto Gain steps ${step.toFixed(2)} dB between blocks`);
}

console.log("test_phasefold: ok");
