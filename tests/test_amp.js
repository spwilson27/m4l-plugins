// Amp engine tests (host, Node). Faces: tests/test_amp_face.js (run at the end). Real Max: scripts/vm_amp.sh audio.
//   node tests/test_amp.js
// - ampForward equals the official NAM torch model (tests/amp_ref/*_io.json made by scripts/amp_nam_ref.py)
//   for Nano / Feather / Lite / Standard WaveNets and 1- and 2-layer LSTMs
// - the parser accepts the classic and the newer .nam layout, rejects what the generator cannot run
// - the generated GenExpr follows the rules that silently break gen (no bitwise &, no e<digits> names,
//   declarations before statements, every placeholder filled) and fits the template's telemetry slots
// - built-in captures parse, are Feather, and have loudness metadata
// - tone stack / cab math, and every built device's structure (deferred gen, buffers, parameters)
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const A = require("../src/amp_config.js");

const ROOT = path.join(__dirname, "..");
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) passes++; else { fails++; console.log("FAIL " + msg); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// 1. reference forward vs official NAM
{
    let e = 0;
    for (let x = -12; x <= 12; x += 0.001) e = Math.max(e, Math.abs(A.ampFastTanh(x) - Math.tanh(x)));
    check(e < 1e-3 && A.ampFastTanh(0) === 0 && Math.abs(A.ampFastTanh(50)) < 1.009, `fast tanh within ${e.toExponential(2)} of tanh`);
    console.log(`fast tanh max error ${e.toExponential(2)}`);
}
for (const name of ["nano", "feather", "lite", "standard", "lstm", "lstm2"]) {
    const m = A.ampParseNam(read(`tests/amp_ref/${name}.nam`));
    const io = JSON.parse(read(`tests/amp_ref/${name}_io.json`));
    // torch pads the start with zeros (pad_start); feed the same zeros first
    const pad = m.kind === "WaveNet" ? new Array(m.receptiveField - 1).fill(0) : [];
    const y = A.ampForward(m, pad.concat(io.x), { exactTanh: true }).slice(pad.length);
    const yf = A.ampForward(m, pad.concat(io.x)).slice(pad.length);
    let err = 0, peak = 0, errF = 0;
    for (let i = 0; i < y.length; i++) { err = Math.max(err, Math.abs(y[i] - io.y[i])); errF = Math.max(errF, Math.abs(yf[i] - io.y[i])); peak = Math.max(peak, Math.abs(io.y[i])); }
    check(err / peak < 1e-4, `${name}: ampForward (exact tanh) vs NAM torch rel err ${(err / peak).toExponential(2)}`);
    // The fast tanh the gen runs (NAM plugin default) stays close to the exact model.
    // Deep models compound it (measured: nano 9e-4, feather 1.2e-2, lite 1.3e-2, standard 9e-2 of the peak).
    const fastBound = { nano: 5e-3, feather: 3e-2, lite: 3e-2, standard: 0.15 }[name] || 1e-5;
    check(errF / peak < fastBound, `${name}: ampForward (fast tanh) vs NAM torch rel err ${(errF / peak).toExponential(2)}`);
    console.log(`fast tanh ${name}: rel err ${(errF / peak).toExponential(2)}`);
}
{
    const m = A.ampParseNam(read("tests/amp_ref/standard.nam"));
    check(m.nWeights === 13802 && A.ampArchLabel(m).startsWith("Standard") && m.receptiveField === 4093, "standard: 13802 weights, label, receptive field");
    check(A.ampArchLabel(A.ampParseNam(read("tests/amp_ref/lite.nam"))).startsWith("Lite"), "lite label");
}

// 2. parser: newer export layout parses to the same model, unsupported features are rejected
{
    const classic = JSON.parse(read("tests/amp_ref/feather.nam"));
    const modern = JSON.parse(JSON.stringify(classic));
    for (const lc of modern.config.layers) {
        lc.head = { out_channels: lc.head_size, kernel_size: 1, bias: lc.head_bias };
        delete lc.head_size; delete lc.head_bias; delete lc.gated;
        lc.activation = { type: "Tanh" };
        lc.kernel_sizes = lc.dilations.map(() => lc.kernel_size); delete lc.kernel_size;
        lc.layer1x1 = { active: true, groups: 1 }; lc.head1x1 = { active: false };
    }
    const a = A.ampParseNam(classic), b = A.ampParseNam(modern);
    check(A.ampArchKey(a) === A.ampArchKey(b), "newer .nam layout parses to the same architecture");
    const x = Array.from({ length: 300 }, (_, i) => Math.sin(i * 0.05) * 0.5);
    check(A.ampForward(a, x).every((v, i) => v === A.ampForward(b, x)[i]), "and the same output");
    const bad = (mut, why) => {
        const d = JSON.parse(JSON.stringify(classic));
        mut(d);
        let msg = "";
        try { A.ampParseNam(d); } catch (e) { msg = e.message; }
        check(!!msg, `rejects ${why}${msg ? " (" + msg + ")" : ""}`);
    };
    bad((d) => d.weights.pop(), "a short weight list");
    bad((d) => { d.architecture = "ConvNet"; }, "another architecture");
    bad((d) => { d.config.layers[0].activation = "Gelu?"; }, "an unknown activation");
    bad((d) => { d.config.layers[1].input_size = 3; }, "arrays that do not chain");
    bad((d) => { d.config.head = { x: 1 }; }, "a post head");
    bad((d) => { d.config.layers[0].conv_pre_film = { active: true }; }, "FiLM");
    bad((d) => { delete d.weights; }, "no weights");
    let threw = false;
    try { A.ampParseNam("not json"); } catch (e) { threw = true; }
    check(threw, "rejects non-JSON text");
    // gated and other activations generate and run
    const g = JSON.parse(read("tests/amp_ref/nano.nam"));
    g.config.layers.forEach((lc) => { lc.gated = true; lc.activation = "ReLU"; });
    let n = 0;
    for (const lc of g.config.layers) {
        const c = lc.channels, k = lc.kernel_size;
        n += lc.input_size * c + lc.dilations.length * (2 * c * c * k + 2 * c + 2 * c + c * c + c) + c * lc.head_size + (lc.head_bias ? lc.head_size : 0);
    }
    g.weights = Array.from({ length: n + 1 }, (_, i) => Math.sin(i * 1.3) * 0.3);
    const gm = A.ampParseNam(g);
    check(gm.layers[0].gated && A.ampForward(gm, x).every(isFinite), "gated ReLU WaveNet parses and runs");
    check(/exp\(-zq4\)\)/.test(A.ampGenNam(gm).body) && /exp\(-peek\(vz, o \+ 4\)\)/.test(A.ampGenNam(gm, { fullMacs: 0 }).body), "gated: the generated gate reads the second half of the conv outputs (unrolled and looped)");
    globalThis.__ampGated = gm;
}

// 3. generated GenExpr rules + template
{
    const tmpl = read("src/amp_core.genexpr");
    const strip = (s) => s.split("\n").map((l) => l.replace(/\/\/(?!@NAM_).*$/, "")).filter((l) => l.trim()).join("\n");
    for (const name of ["nano", "standard", "lstm2"]) {
        const m = A.ampParseNam(read(`tests/amp_ref/${name}.nam`));
        const code = A.ampGenCode(strip(tmpl), m);
        check(!/@@|\/\/@NAM/.test(code), `${name}: every placeholder filled`);
        check(!/[^&]&[^&]/.test(code), `${name}: no bitwise & (silently kills the gen compile)`);
        check(!/\be[0-9]+\b/.test(code), `${name}: no e<digits> identifiers`);
        const lines = code.split("\n");
        const firstStmt = lines.findIndex((l) => !/^\s*(Param|Buffer|History|Data|Delay)\b/.test(l));
        const lastDecl = lines.map((l) => /^\s*(Param|Buffer|History|Data|Delay)\b/.test(l)).lastIndexOf(true);
        check(lastDecl < firstStmt, `${name}: declarations before statements`);
        check(!/\breturn\b/.test(code), `${name}: no return`);
        const pokes = [...code.matchAll(/poke\(scope, [^,]+, (\d+), 0\)/g)].map((mm) => Number(mm[1]));
        check(pokes.every((p) => p < A.AMP_SCOPE.LAYER || p === 12 || p === 13 || p < 16), `${name}: header pokes inside the header`);
    }
    for (const [k, v] of [["XY", 64], ["OUT", 1088], ["SAMPS", 3136]]) check(A.AMP_SCOPE[k] === v, `scope ${k} = ${v}`);
    check(/poke\(scope, nin, 64 \+ xyh \* 2, 0\)/.test(tmpl) && /poke\(scope, \(wet \+ wetR\) \* 0\.5, 1088 \+ oh, 0\)/.test(tmpl), "template rings match AMP_SCOPE");
    check(/poke\(scope, peek\(lsm, q\), 16 \+ q, 0\)/.test(tmpl), "template layer slots match AMP_SCOPE.LAYER");
    check(A.ampRingSize(A.ampParseNam(read("tests/amp_ref/standard.nam"))) < 200000, "standard ring size");
}

// 3b. the generated network run as JS (GenExpr subset: Data, peek / poke, for, ternaries): per channel state
// is separate (stereo = two independent models), each channel equals the reference ampForward
{
    // A wide WaveNet (24 channels, kernel 7) over the unroll limit takes the looped path.
    const wide = JSON.parse(read("tests/amp_ref/nano.nam"));
    wide.config.layers = [Object.assign({}, wide.config.layers[0], { channels: 24, kernel_size: 7, head_size: 1, dilations: [1, 2] })];
    let nw = 0;
    for (const lc of wide.config.layers) nw += lc.input_size * lc.channels + lc.dilations.length * (lc.channels * lc.channels * lc.kernel_size + 3 * lc.channels + lc.channels * lc.channels) + lc.channels * lc.head_size + (lc.head_bias ? lc.head_size : 0);
    wide.weights = Array.from({ length: nw + 1 }, (_, i) => Math.sin(i * 0.7) * 0.2);
    const cases = ["nano", "feather", "standard", "lstm", "lstm2"].map((name) => [name, A.ampParseNam(read(`tests/amp_ref/${name}.nam`))])
        .concat([["gated", globalThis.__ampGated], ["wide (looped)", A.ampParseNam(wide)],
            ["feather (looped)", A.ampParseNam(read("tests/amp_ref/feather.nam")), { fullMacs: 0 }], ["gated (looped)", globalThis.__ampGated, { fullMacs: 0 }], ["wide (fully unrolled)", A.ampParseNam(wide), { fullMacs: 1e9 }]]);
    check(/peek\(tv, j\)/.test(A.ampGenNam(cases[2][1]).body) && !/for \(o = /.test(A.ampGenNam(cases[1][1]).body) && A.ampWaveMacs(cases[1][1]) <= 3000,
        "feather (every built-in) is generated fully unrolled, standard looped");
    check(!/for \(o = /.test(A.ampGenNam(cases[1][1], { fullMacs: 1e9 }).body) && /for \(o = /.test(A.ampGenNam(cases[1][1], { fullMacs: 0 }).body), "fully unrolled: no output loops left");
    for (const [name, m, opts] of cases) {
        const g = A.ampGenNam(m, opts);
        const datas = [...g.decl.matchAll(/^Data (\w+)\((\d+)\);$/gm)].map((mm) => mm[1]);
        const assigned = new Set([...g.body.matchAll(/\b([a-z_]\w*)\s*(?:\+=|=(?!=))/gi)].map((mm) => mm[1]));
        const locals = [...assigned].filter((v) => !datas.includes(v) && !["nob", "nib"].includes(v));
        const src = g.decl.replace(/^Data (\w+)\((\d+)\);$/gm, "var $1 = new Float64Array($2);")
            + "\nvar " + locals.join(", ") + ";\n"
            + "function peek(d, i) { return d[i]; } function poke(d, v, i) { d[i] = v; }\n"
            + "var tanh = Math.tanh, exp = Math.exp, abs = Math.abs, floor = Math.floor, min = Math.min, max = Math.max, sqrt = Math.sqrt;\n"
            + "function clip(v, a, b) { return Math.min(b, Math.max(a, v)); }\n"
            + "return { reset: function () { [" + datas.filter((d) => /^(st|hs|cs)$/.test(d)).join(", ") + "].forEach(function (d) { d.fill(0); }); },\n"
            + "step: function (w, wb, tp, ninit, nch, nib, nob) {\nif (ninit > 0) { for (var jw = 0; jw < " + g.nWeights + "; jw++) wd[jw] = w[wb + jw]; }\n" + g.body + "\n} };";
        const net = new Function(src)();
        const W = Float64Array.from(m.weights), nib = new Float64Array(2), nob = new Float64Array(2);
        const n = 3000, xL = [], xR = [];
        for (let i = 0; i < n; i++) { xL.push(0.6 * Math.sin(2 * Math.PI * 110 * i / 48000) * Math.exp(-i / 9000)); xR.push(0.3 * Math.sin(2 * Math.PI * 247 * i / 48000)); }
        const refL = A.ampForward(m, xL), refR = A.ampForward(m, xR);
        let eL = 0, eR = 0, eM = 0, pk = 0;
        for (let i = 0; i < n; i++) {
            nib[0] = xL[i]; nib[1] = xR[i];
            net.step(W, 0, i, i === 0 ? 1 : 0, 2, nib, nob);
            eL = Math.max(eL, Math.abs(nob[0] - refL[i])); eR = Math.max(eR, Math.abs(nob[1] - refR[i])); pk = Math.max(pk, Math.abs(refL[i]));
        }
        net.reset();   // mono: channel 0 only, fresh state
        for (let i = 0; i < n; i++) {
            nib[0] = xL[i];
            net.step(W, 0, i + n, i === 0 ? 1 : 0, 1, nib, nob);
            eM = Math.max(eM, Math.abs(nob[0] - refL[i]));
        }
        check(pk > 0.01 && eL < 1e-6 && eR < 1e-6 && eM < 1e-6, `${name}: generated network, stereo L / R and mono equal the reference (err ${eL.toExponential(1)} / ${eR.toExponential(1)} / ${eM.toExponential(1)})`);
    }
}

// 3c. no hard-coded Model index in the engine (File moved from 3 to AMP_FILE_INDEX when the captures grew to 8:
// a leftover ampSelectModel(3) loaded Blues instead of the file)
{
    const eng = read("src/amp_engine.js");
    check(!/ampSelectModel\(\d/.test(eng) && !/ampP\.model\)\s*[!=]==\s*\d/.test(eng) && !/"model",\s*\d/.test(eng), "engine: Model indices only through AMP_FILE_INDEX");
}

// 3d. Analog engine parameters: appended after the original 13 (Live stores parameters by order), 16 short circuit labels
{
    const orig = ["model", "gain", "gate", "bass", "mid", "treble", "presence", "cab", "stereo", "normalize", "eqpos", "volume", "mix"];
    check(orig.every((k, i) => A.AMP_PARAM_KEYS[i] === k) && A.AMP_PARAM_KEYS.slice(13).join() === "engine,circuit,speaker", "parameter order: the analog ones appended");
    const labels = A.AMP_PARAMS.circuit[8];
    check(labels.length === 16 && new Set(labels).size === 16 && labels.every((l) => l.length <= 6), `16 circuit labels, unique, <= 6 characters (${labels.join(" ")})`);
    check(A.AMP_PARAMS.engine[8].join() === "Neural,Analog" && A.AMP_ENGINE.NEURAL === 0 && A.AMP_ENGINE.ANALOG === 1 && A.AMP_PARAMS.engine[4] === 0, "Engine: Neural (default) / Analog");
    const eng = read("src/amp_engine.js");
    check(!/"(?:engine|circuit)",\s*\d/.test(eng) && !/ampP\.(?:engine|circuit)\)?\s*[!=]==\s*\d/.test(eng), "engine: Engine / Circuit indices only through AMP_ENGINE");
    // the analog circuit labels in the parameter are the recipes' labels, in order
    global.ampFillHooks = A.ampFillHooks; global.ampBiquad = A.ampBiquad;
    const AA = require("../src/amp_analog.js");
    check(AA.AMP_ANALOG.map((r) => r.label).join() === labels.join(), "Circuit enum = the recipes in order");
}

// 4. built-in captures
const BUILTINS = ["clean", "magna", "bass", "chime", "drive", "crunch", "splawn", "markiv", "lead", "metal", "fuzz", "ds1"];
const GPL_BUILTINS = ["magna", "ds1", "splawn", "markiv"];
check(A.AMP_PARAMS.model[8].length === BUILTINS.length + 1 && A.AMP_PARAMS.model[8][A.AMP_FILE_INDEX] === "File", "Model enum = 12 captures + File");
// GPL-3.0 students: license, credit and teacher in the metadata, the teacher and the license text next to them
for (const name of GPL_BUILTINS) {
    const md = JSON.parse(read(`src/amp_models/${name}.nam`)).metadata || {};
    check(/GPL-3\.0/.test(A.ampParseNam(JSON.parse(read(`src/amp_models/${name}.nam`))).credit), `${name}: the parsed model carries the credit the display shows`);
    check(md.license === "GPL-3.0-or-later" && /GPL-3\.0/.test(md.credit || "") && /pelennor2170\/NAM_models/.test(md.modeled_by || "")
        && fs.existsSync(path.join(ROOT, "third_party", "nam_gpl", md.teacher || "-")), `${name}: GPL metadata (${md.credit})`);
}
check(/GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(read("third_party/nam_gpl/COPYING")) && /Roman A/.test(read("third_party/nam_gpl/README.md")), "third_party/nam_gpl: GPL text and attribution README");
check(/GPL-3\.0/.test(A.AMP_PARAMS.model[9]), "the Model parameter info names the GPL captures");
for (const name of BUILTINS) {
    const d = JSON.parse(read(`src/amp_models/${name}.nam`));
    const m = A.ampParseNam(d);
    check(A.ampArchLabel(m).startsWith("Feather") && typeof m.loudness === "number", `${name}: Feather capture with loudness (${m.loudness} dB)`);
    check(d.metadata.validation_esr < 0.03, `${name}: validation ESR ${d.metadata.validation_esr}`);
    const x = Array.from({ length: 6000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 110 * i / 48000));
    const y = A.ampForward(m, x).slice(4500);
    const pk = Math.max(...y.map(Math.abs));
    check(pk > 0.02 && pk < 2, `${name}: a 110 Hz sine comes out at peak ${pk.toFixed(3)}`);
}

// 4b. the built-ins sound different: tone fingerprint per capture (small-signal response in octave bands
// rel. 1 kHz from -40 dBFS noise, THD of a 200 Hz sine at -24 / -3 dBFS); every pair must differ clearly in
// EQ shape or in drive (the circuits are fitted to distinct measured targets, scripts/amp_fit_circuits.py)
{
    const SR = 48000, BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
    function eqBands(m) {
        let s = 12345;
        const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
        const skip = 6000, N = 4096, x = new Float64Array(skip + 2 * N);
        for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 * 0.01 * Math.sqrt(3);
        const y = A.ampForward(m, x), ein = new Float64Array(8), eout = new Float64Array(8);
        for (let st = skip; st + N <= x.length; st += N) {
            for (let k = 2; k < N / 2; k += 2) {
                const f = k * SR / N, bi = BANDS.findIndex((c) => f >= c / Math.SQRT2 && f < c * Math.SQRT2);
                if (bi < 0) continue;
                let xr = 0, xi = 0, yr = 0, yi = 0;
                for (let n = 0; n < N; n++) {
                    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N), a = 2 * Math.PI * k * n / N, c = Math.cos(a), sn = Math.sin(a);
                    xr += w * x[st + n] * c; xi += w * x[st + n] * sn; yr += w * y[st + n] * c; yi += w * y[st + n] * sn;
                }
                ein[bi] += xr * xr + xi * xi; eout[bi] += yr * yr + yi * yi;
            }
        }
        const g = BANDS.map((_, i) => 10 * Math.log10(eout[i] / ein[i]));
        return g.map((v) => v - g[4]);
    }
    function thd(m, lv) {
        const skip = 4800, n = 4800, x = new Float64Array(skip + n), a = Math.pow(10, lv / 20);
        for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * 200 * i / SR);
        const y = A.ampForward(m, x), h = [];
        for (let k = 1; k <= 9; k++) {
            let r = 0, im = 0;
            for (let i = 0; i < n; i++) { const p = 2 * Math.PI * 200 * k * i / SR; r += y[skip + i] * Math.cos(p); im += y[skip + i] * Math.sin(p); }
            h.push(Math.hypot(r, im));
        }
        return 100 * Math.sqrt(h.slice(1).reduce((e, v) => e + v * v, 0)) / Math.max(h[0], 1e-12);
    }
    const fp = BUILTINS.map((name) => {
        const m = A.ampParseNam(JSON.parse(read(`src/amp_models/${name}.nam`)));
        return { name, eq: eqBands(m), d: [thd(m, -24), thd(m, -3)].map((v) => Math.log(v + 0.5)) };
    });
    let minPair = Infinity, pair = "";
    for (let i = 0; i < fp.length; i++) for (let j = i + 1; j < fp.length; j++) {
        const eqd = Math.sqrt(fp[i].eq.reduce((e, v, k) => e + (v - fp[j].eq[k]) ** 2, 0) / 8);   // rms dB
        const dd = Math.hypot(fp[i].d[0] - fp[j].d[0], fp[i].d[1] - fp[j].d[1]);                 // drive
        const score = eqd / 3 + dd / 0.7;    // 3 dB rms of EQ shape ~ 0.7 of log-THD ~ one unit
        if (score < minPair) { minPair = score; pair = `${fp[i].name}/${fp[j].name} (EQ ${eqd.toFixed(1)} dB rms, drive ${dd.toFixed(2)})`; }
    }
    check(minPair >= 1, `built-ins sound different: closest pair ${pair}, score ${minPair.toFixed(2)} (>= 1)`);
    console.log("closest built-in pair: " + pair + ", score " + minPair.toFixed(2));
}

// 5. tone stack / cab
{
    const flat = { bass: 5, mid: 5, treble: 5, presence: 5, cab: 0 };
    const bq = A.ampToneBiquads(flat, 48000);
    check(bq.length === A.AMP_NBQ, "10 biquads");
    check([30, 150, 1000, 5000, 15000].every((f) => Math.abs(A.ampResponseDb(bq, f, 48000)) < 0.01), "flat tone stack, cab off = 0 dB");
    const up = A.ampToneBiquads(Object.assign({}, flat, { bass: 10 }), 48000);
    check(Math.abs(A.ampResponseDb(up, 40, 48000) - 20) < 1, "bass 10 = +20 dB low shelf");
    const cab = A.ampToneBiquads(Object.assign({}, flat, { cab: 2 }), 48000);
    check(A.ampNormDb({ loudness: -12 }) === -6 && A.ampNormDb({ loudness: null }) === 0, "normalize gain");
    check(A.ampResponseDb(cab, 12000, 48000) < -20 && A.ampResponseDb(cab, 30, 48000) < -6, "4x12 rolls off highs and lows");
}

// 6. built devices
const designs = fs.readdirSync(path.join(ROOT, "scripts", "amp_designs")).filter((f) => f.endsWith(".py") && !f.startsWith("_"));
check(designs.length === 1, `one design (${designs.length})`);
for (const f of designs) {
    const dev = read(`scripts/amp_designs/${f}`).match(/^DEVICE\s*=\s*"([^"]+)"/m)[1];
    const file = path.join(ROOT, "devices", dev + ".amxd");
    const buf = fs.readFileSync(file);
    check(buf.slice(0, 4).toString() === "ampf" && buf.slice(8, 12).toString() === "aaaa", `${dev}: audio effect header`);
    const p = JSON.parse(buf.slice(32).toString("utf8")).patcher;
    const boxes = p.boxes.map((b) => b.box);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    check(!boxes.some((b) => /^gen/.test(b.maxclass) || /^gen~/.test(b.text || "")), `${dev}: ships without a gen~ (deferred)`);
    check(byId["obj-genin"] && byId["obj-genin"].text === "gate 1 1" && byId["obj-genin"].varname === "amp_genin", `${dev}: gate 1 1 hub amp_genin`);
    check(byId["obj-plugin"].varname === "amp_plugin" && byId["obj-plugout"].varname === "amp_plugout", `${dev}: plugin~ / plugout~ names`);
    check(!p.lines.some((l) => l.patchline.source[0] === "obj-plugin" && l.patchline.destination[0] === "obj-plugout"), `${dev}: no dry cord (silent until the gen runs)`);
    for (const t of ["buffer~ ---ampscope", "buffer~ ---ampw", "buffer~ ---ampcf"]) check(boxes.some((b) => (b.text || "").startsWith(t)), `${dev}: ${t}`);
    check(!boxes.some((b) => /#0-amp(scope|w|cf)/.test(b.text || "")), `${dev}: per-instance buffers use ---`);
    const params = boxes.filter((b) => b.parameter_enable).map((b) => b.saved_attribute_attributes.valueof.parameter_longname);
    for (const k of A.AMP_PARAM_KEYS) check(params.includes(A.AMP_PARAMS[k][0]), `${dev}: parameter ${A.AMP_PARAMS[k][0]}`);
    check(params.includes("Model File"), `${dev}: Model File live.drop`);
    const shorts = boxes.filter((b) => b.parameter_enable).map((b) => b.saved_attribute_attributes.valueof.parameter_shortname);
    check(new Set(shorts).size === shorts.length, `${dev}: unique short names`);
    check(p.openrect[3] === 169 && p.openinpresentation === 1, `${dev}: 169 px, presentation`);
    const viz = byId["obj-viz"];
    check(viz && /var AMP_BUILTIN/.test(viz.textfile.text) && /AMP_TEMPLATE/.test(viz.textfile.text), `${dev}: face embeds the template and the captures`);
    // Analog engine: its own buffers, hub (gen messages "a <msg>" through route a), parameters appended after the original 13
    for (const t of ["buffer~ ---ampscopea", "buffer~ ---ampa", "buffer~ ---ampcfa"]) check(boxes.some((b) => (b.text || "").startsWith(t)), `${dev}: ${t}`);
    check(byId["obj-genin-a"] && byId["obj-genin-a"].text === "gate 1 1" && byId["obj-genin-a"].varname === "amp_genin_a" && byId["obj-genroute"].text === "route a", `${dev}: analog hub amp_genin_a behind route a`);
    check(p.lines.some((l) => l.patchline.source[0] === "obj-viz" && l.patchline.source[1] === 1 && l.patchline.destination[0] === "obj-genroute")
        && p.lines.some((l) => l.patchline.source[0] === "obj-genroute" && l.patchline.source[1] === 0 && l.patchline.destination[0] === "obj-genin-a" && l.patchline.destination[1] === 1)
        && p.lines.some((l) => l.patchline.source[0] === "obj-genroute" && l.patchline.source[1] === 1 && l.patchline.destination[0] === "obj-genin" && l.patchline.destination[1] === 1), `${dev}: gen messages routed to both hubs`);
    check(/^setnames ---ampscope ---ampw ---ampcf ---ampscopea ---ampa ---ampcfa$/.test(byId["obj-msg-names"].text), `${dev}: setnames carries the analog buffers`);
    check(byId["obj-ctrl-circuit"].hidden === 1 && byId["obj-ctrl-speaker"].hidden === 1 && !byId["obj-ctrl-model"].hidden && !byId["obj-ctrl-engine"].hidden, `${dev}: saved state shows the Neural engine`);
    check(/var AMP_ANALOG_SRC/.test(viz.textfile.text) && /function aaBank\(/.test(viz.textfile.text), `${dev}: face embeds the analog circuits`);
    // background panels are the last boxes
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    check(firstPanel < 0 || boxes.slice(firstPanel).every((b) => b.maxclass === "panel"), `${dev}: panels last`);
}

console.log(`test_amp: ${passes} passed, ${fails} failed`);
try {
    execFileSync("node", [path.join(__dirname, "test_amp_face.js")], { stdio: "inherit" });
} catch (e) { fails++; }
try {
    execFileSync("node", [path.join(__dirname, "test_amp_analog.js")], { stdio: "inherit" });
} catch (e) { fails++; }
process.exit(fails ? 1 : 0);
