// Generic checks for every Amp face (devices built by scripts/build_amp.py).
//   node tests/test_amp_face.js [slug ...]      (default: every scripts/amp_designs/*.py)
// For each design: runs the main v8ui script of the BUILT device in a mock Max (mgraphics recorder,
// Buffer / Global / Task / File stubs), then checks
//   - paint() works cold (no DSP, no model) and with preview telemetry, at several drive levels,
//     and draws nothing outside the v8ui (1 px tolerance), no NaN coordinates
//   - a grid of clicks / drags / double-clicks / hovers never throws, and every `param` message it
//     emits names a real parameter with a value inside its range
//   - every parameter can be reached: an on-face live.* widget or the face emits it
//   - no presentation live.* widget overlaps the (interactive) v8ui, everything is inside the device
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let fails = 0, passes = 0;
function check(ok, msg) {
    if (ok) passes++;
    else { fails++; console.log("FAIL " + msg); }
}

function readAmxd(file) {
    const buf = fs.readFileSync(file);
    return JSON.parse(buf.slice(32).toString("utf8"));
}

function designSlugs() {
    return fs.readdirSync(path.join(ROOT, "scripts", "amp_designs")).filter((f) => f.endsWith(".py") && !f.startsWith("_")).map((f) => f.slice(0, -3)).sort();
}

function designInfo(slug) {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "amp_designs", slug + ".py"), "utf8");
    const m = src.match(/^DEVICE\s*=\s*"([^"]+)"/m);
    return { device: m[1] };
}

function makeSandbox(w, h) {
    const rec = { ops: [], bad: [] };
    const pt = { x: 0, y: 0 };
    const tol = 1.01;
    function chk(op, x, y) {
        if (!isFinite(x) || !isFinite(y)) { rec.bad.push(op + " NaN"); return; }
        if (x < -tol || y < -tol || x > w + tol || y > h + tol) rec.bad.push(op + " (" + x.toFixed(1) + "," + y.toFixed(1) + ")");
    }
    let tx = 0, ty = 0, rotated = false;
    const stack = [];
    let fs_ = 10;
    const mg = {
        size: [w, h], relative_coords: 0, autofill: 0,
        init() {}, redraw() {},
        set_source_rgba() { for (const a of arguments) if (!isFinite(a)) rec.bad.push("rgba NaN"); },
        set_line_width() {}, set_line_cap() {}, set_line_join() {},
        rectangle(x, y, ww, hh) { if (!rotated) { chk("rect", x + tx, y + ty); chk("rect", x + ww + tx, y + hh + ty); } },
        rectangle_rounded(x, y, ww, hh) { if (!rotated) { chk("rrect", x + tx, y + ty); chk("rrect", x + ww + tx, y + hh + ty); } },
        move_to(x, y) { pt.x = x; pt.y = y; if (!rotated) chk("move", x + tx, y + ty); },
        line_to(x, y) { pt.x = x; pt.y = y; if (!rotated) chk("line", x + tx, y + ty); },
        rel_line_to(x, y) { pt.x += x; pt.y += y; },
        curve_to(a, b, c, d, x, y) { pt.x = x; pt.y = y; if (!rotated) chk("curve", x + tx, y + ty); },
        close_path() {},
        arc(x, y, r) { if (!rotated) { chk("arc", x - r + tx, y - r + ty); chk("arc", x + r + tx, y + r + ty); } },
        ellipse(x, y, ww, hh) { if (!rotated) { chk("ellipse", x + tx, y + ty); chk("ellipse", x + ww + tx, y + hh + ty); } },
        fill() {}, fill_preserve() {}, stroke() {}, stroke_preserve() {},
        select_font_face() {}, set_font_size(s) { fs_ = s; },
        text_measure(t) { return [String(t).length * fs_ * 0.56, fs_]; },
        show_text(t) { if (!rotated) { chk("text", pt.x + tx, pt.y + ty); chk("text-end", pt.x + tx + String(t).length * fs_ * 0.5, pt.y + ty); } },
        save() { stack.push([tx, ty, rotated]); }, restore() { const s = stack.pop() || [0, 0, false]; tx = s[0]; ty = s[1]; rotated = s[2]; },
        translate(x, y) { tx += x; ty += y; }, rotate(a) { if (a) rotated = true; }, scale() { rotated = true; },
        identity_matrix() { tx = 0; ty = 0; rotated = false; },
        new_path() {}
    };
    const outs = [];
    const sb = {
        mgraphics: mg, outlets: 1, inlets: 1, messagename: "",
        outlet: (...a) => outs.push(a), post() {}, notifyclients() {},
        Buffer: function () { this.peek = (c, i, n) => (n > 1 ? new Array(n).fill(0) : 0); this.poke = () => {}; this.framecount = () => 4096; },
        Global: function () {},
        Task: function (fn) { this.schedule = () => {}; this.repeat = () => {}; this.cancel = () => {}; this.interval = 0; },
        File: function () { this.isopen = false; this.close = () => {}; },
        max: { getcolor: () => [0.5, 0.5, 0.5, 1] },
        Math, JSON, Date, Number, String, Array, Object, isFinite, parseInt, parseFloat, console
    };
    sb.globalThis = sb;
    return { sb, rec, outs };
}

function runDesign(slug) {
    const info = designInfo(slug);
    const file = path.join(ROOT, "devices", info.device + ".amxd");
    check(fs.existsSync(file), slug + ": built device " + file);
    if (!fs.existsSync(file)) return;
    const doc = readAmxd(file).patcher;
    const boxes = doc.boxes.map((b) => b.box);
    const viz = boxes.find((b) => b.id === "obj-viz");
    const W = doc.devicewidth;
    check(doc.openrect[3] === 169, slug + ": height 169");
    const [vx, vy, vw, vh] = viz.presentation_rect;
    const A = require("../src/amp_config.js");
    // Presentation geometry.
    const onFace = new Set();
    for (const b of boxes) {
        if (!b.presentation || !b.presentation_rect) continue;
        const [x, y, w, h] = b.presentation_rect;
        check(x >= -0.01 && y >= -0.01 && x + w <= W + 0.01 && y + h <= 169.01, `${slug}: ${b.id} inside the device`);
        if (String(b.maxclass || "").indexOf("live.") === 0 && b.maxclass !== "live.comment" && b.maxclass !== "live.line" && !b.hidden) {
            const ov = x < vx + vw && x + w > vx && y < vy + vh && y + h > vy;
            check(!ov || viz.ignoreclick, `${slug}: ${b.id} (${b.maxclass}) overlaps the interactive v8ui`);
            const m = String(b.id).match(/^obj-ctrl-(.+)$/);
            if (m) onFace.add(m[1]);
        }
    }
    // Script.
    const code = viz.textfile.text;
    const { sb, rec, outs } = makeSandbox(vw, vh);
    vm.createContext(sb);
    try { vm.runInContext(code, sb, { filename: slug + ".js" }); } catch (err) { check(false, slug + ": script loads: " + err.stack); return; }
    check(sb.outlets === 2, `${slug}: the script declares 2 outlets (outlet 1 feeds the gen hub)`);
    const call = (fn, ...a) => { if (typeof sb[fn] === "function") sb[fn](...a); };
    // cold paint
    try { call("paint"); check(true, ""); } catch (err) { check(false, slug + ": cold paint: " + err.stack); }
    check(rec.bad.length === 0, `${slug}: cold paint inside the canvas: ${rec.bad.slice(0, 5).join(", ")}`);
    rec.bad.length = 0;
    // The gen code this device generates: the network is spliced in as code, not into a comment
    // (a comment mentioning the placeholder once swallowed it and the gen~ never ran in Live).
    try {
        const code = vm.runInContext("ampGenCode(AMP_TEMPLATE, ampParseNam(AMP_BUILTIN[5]))", sb);
        const lines = code.split("\n");
        check(/^Param /.test(lines[0]) && lines.some((l) => /^Data wd\(\d+\);$/.test(l)) && lines.some((l) => /^zq0 = peek\(wd, \d+\) \+ /.test(l)) && lines.some((l) => /^pk0 = 0; .*tq0 = 0;/.test(l))
            && !/@NAM|@@/.test(code),`${slug}: generated gen code is clean (declarations and body outside comments)`);
    } catch (err) { check(false, slug + ": ampGenCode: " + err.stack); }
    // setnames + a model through the engine (no Buffer data: exercises the load path)
    try { vm.runInContext("setnames('s','w','c'); ampLoadModel(AMP_BUILTIN[5], 'Crunch', '');", sb); } catch (err) { check(false, slug + ": model load path: " + err.stack); }
    for (const d of [0, 0.3, 1]) {
        try { vm.runInContext(`ampPreviewSetup(${d});`, sb); call("paint"); call("paint"); } catch (err) { check(false, `${slug}: paint at drive ${d}: ${err.stack}`); }
    }
    // extreme parameter values
    for (const ext of [2, 3]) {
        vm.runInContext(`for (var k in AMP_PARAMS) ampP[k] = AMP_PARAMS[k][${ext}];`, sb);
        try { call("paint"); } catch (err) { check(false, `${slug}: paint at extremes: ${err.stack}`); }
    }
    vm.runInContext("for (var k in AMP_PARAMS) ampP[k] = AMP_PARAMS[k][4]; amp.model.error = 'expected 13802 weights, file has 99'; amp.fileModel = {doc:null, name:'A very long model name that will not fit anywhere'};", sb);
    try { call("paint"); } catch (err) { check(false, `${slug}: paint with error + long names: ${err.stack}`); }
    vm.runInContext("amp.model.error = '';", sb);
    check(rec.bad.length === 0, `${slug}: paint inside the canvas: ${rec.bad.slice(0, 6).join(", ")}`);
    // interaction grid
    const emitted = new Set();
    let bad = 0;
    for (let y = 1; y < vh; y += 4) {
        for (let x = 1; x < vw; x += 4) {
            outs.length = 0;
            try {
                call("onidle", x, y);
                call("onclick", x, y, 1, 0, 0, 0, 0, 0);
                call("ondrag", x, y - 12, 1, 0, 0, 0, 0, 0);
                call("ondrag", x + 6, y - 30, 1, 0, 1, 0, 0, 0);
                call("ondrag", x, y - 30, 0, 0, 0, 0, 0, 0);
                call("ondblclick", x, y, 1, 0, 0, 0, 0, 0);
                call("paint");
            } catch (err) {
                if (bad++ < 3) check(false, `${slug}: interaction at ${x},${y}: ${err.stack}`);
                continue;
            }
            for (const o of outs) {
                if (o[0] !== 0 || o[1] !== "param") continue;
                const key = o[2], v = o[3], s = A.AMP_PARAMS[key];
                check(!!s, `${slug}: param message for unknown key ${key}`);
                if (!s) continue;
                emitted.add(key);
                check(isFinite(v) && v >= s[2] - 1e-9 && v <= s[3] + 1e-9, `${slug}: ${key} = ${v} outside ${s[2]}..${s[3]}`);
            }
        }
    }
    check(rec.bad.length === 0, `${slug}: paints during interaction stay inside: ${rec.bad.slice(0, 6).join(", ")}`);
    for (const k of A.AMP_PARAM_KEYS) check(onFace.has(k) || emitted.has(k), `${slug}: parameter ${k} reachable (on-face widget or face control)`);
    // browse must be reachable somewhere (Load)
    let browsed = false;
    for (let y = 1; y < vh && !browsed; y += 3) for (let x = 1; x < vw && !browsed; x += 3) {
        outs.length = 0;
        try { call("onclick", x, y, 1, 0, 0, 0, 0, 0); call("ondrag", x, y, 0, 0, 0, 0, 0, 0); } catch (_) {}
        if (outs.some((o) => o[0] === 0 && o[1] === "browse")) browsed = true;
    }
    check(browsed || boxes.some((b) => b.id === "obj-ctrl-file" && b.presentation), `${slug}: a Load control or a visible drop zone`);
    console.log(`${slug}: ${fails ? "checked" : "ok"} (${info.device}, ${W} px, on-face widgets: ${[...onFace].join(" ") || "none"})`);
}

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : designSlugs();
for (const s of slugs) runDesign(s);
console.log(`test_amp_face: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
