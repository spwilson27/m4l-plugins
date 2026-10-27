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
for (const name of ["nano", "feather", "lite", "standard", "lstm", "lstm2"]) {
    const m = A.ampParseNam(read(`tests/amp_ref/${name}.nam`));
    const io = JSON.parse(read(`tests/amp_ref/${name}_io.json`));
    // torch pads the start with zeros (pad_start); feed the same zeros first
    const pad = m.kind === "WaveNet" ? new Array(m.receptiveField - 1).fill(0) : [];
    const y = A.ampForward(m, pad.concat(io.x)).slice(pad.length);
    let err = 0, peak = 0;
    for (let i = 0; i < y.length; i++) { err = Math.max(err, Math.abs(y[i] - io.y[i])); peak = Math.max(peak, Math.abs(io.y[i])); }
    check(err / peak < 1e-4, `${name}: ampForward vs NAM torch rel err ${(err / peak).toExponential(2)}`);
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
    check(/exp\(-peek\(vz, o \+ 4\)\)/.test(A.ampGenNam(gm).body), "gated: the generated gate reads the second half of vz");
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
    check(/poke\(scope, nin, 64 \+ xyh \* 2, 0\)/.test(tmpl) && /poke\(scope, wet, 1088 \+ oh, 0\)/.test(tmpl), "template rings match AMP_SCOPE");
    check(/poke\(scope, peek\(lsm, q\), 16 \+ q, 0\)/.test(tmpl), "template layer slots match AMP_SCOPE.LAYER");
    check(A.ampRingSize(A.ampParseNam(read("tests/amp_ref/standard.nam"))) < 200000, "standard ring size");
}

// 4. built-in captures
for (const name of ["clean", "crunch", "lead"]) {
    const d = JSON.parse(read(`src/amp_models/${name}.nam`));
    const m = A.ampParseNam(d);
    check(A.ampArchLabel(m).startsWith("Feather") && typeof m.loudness === "number", `${name}: Feather capture with loudness (${m.loudness} dB)`);
    check(d.metadata.validation_esr < 0.03, `${name}: validation ESR ${d.metadata.validation_esr}`);
    const x = Array.from({ length: 6000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 110 * i / 48000));
    const y = A.ampForward(m, x).slice(4500);
    const pk = Math.max(...y.map(Math.abs));
    check(pk > 0.02 && pk < 2, `${name}: a 110 Hz sine comes out at peak ${pk.toFixed(3)}`);
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
    check(A.ampResponseDb(cab, 12000, 48000) < -20 && A.ampResponseDb(cab, 30, 48000) < -6, "4x12 rolls off highs and lows");
    check(A.ampNormDb({ loudness: -12 }) === -6 && A.ampNormDb({ loudness: null }) === 0, "normalize gain");
}

// 6. built devices
const designs = fs.readdirSync(path.join(ROOT, "scripts", "amp_designs")).filter((f) => f.endsWith(".py") && !f.startsWith("_"));
check(designs.length === 5, `five designs (${designs.length})`);
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
    // background panels are the last boxes
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    check(firstPanel < 0 || boxes.slice(firstPanel).every((b) => b.maxclass === "panel"), `${dev}: panels last`);
}

console.log(`test_amp: ${passes} passed, ${fails} failed`);
try {
    execFileSync("node", [path.join(__dirname, "test_amp_face.js")], { stdio: "inherit" });
} catch (e) { fails++; }
process.exit(fails ? 1 : 0);
