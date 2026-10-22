"use strict";
/**
 * Freq Split paint bounds: drives the main face (src/freqsplit_config.js + spectral_link.js + spectral_theme.js + freqsplit_ui.js, as the
 * build concatenates them) and the header strip (spectral_theme.js + freqsplit_top_ui.js) through a grid of extreme parameter values and
 * telemetry edge cases (NaN, huge, negative, short, silent), and asserts with tests/paint_bounds_lib.js that nothing is drawn outside its
 * region: no value-to-pixel mapping leaves the plot, every path starts with a fresh move_to, text stays on the canvas.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeRecorder, loadFace, checkRecording, grid } = require("./paint_bounds_lib.js");

const SRC = path.join(__dirname, "..", "src");
const rd = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const faceCode = [rd("freqsplit_config.js").trimEnd(), rd("spectral_link.js").trimEnd(), rd("spectral_theme.js").trimEnd(), rd("freqsplit_ui.js")].join("\n\n");
const topCode = [rd("spectral_theme.js").trimEnd(), rd("freqsplit_top_ui.js")].join("\n\n");

function runMain() {
    const W = 328, H = 100;
    const rec = makeRecorder(W, H);
    let tele = null;
    const extra = { Buffer: function () { this.peek = () => tele; } };
    const sb = loadFace(faceCode, rec, extra);
    // the LCD background / frame (sptLcd) is the one legitimate full-canvas shape; the plot is checked tightly
    sb.sptLcd = function () {};
    const PL = vmGet(sb, "FV_PLOT");
    const plot = { x: PL.x, y: PL.y, w: PL.w, h: PL.h };
    const legend = { x: 0, y: PL.y + PL.h + 3, w: W, h: H - (PL.y + PL.h + 3) };
    const regions = [plot, legend];
    const NC = vmGet(sb, "FS_NCOLS"), SC_FRAME = vmGet(sb, "FS_SC_FRAME"), SAMPS = vmGet(sb, "FS_SCOPE_SAMPS");
    let frame = 1;
    const mkTele = (fn, awake) => {
        const d = new Array(SAMPS).fill(0);
        for (let i = 0; i < NC * 5; i++) d[i] = fn(i);
        d[SC_FRAME] = frame++; d[SC_FRAME + 1] = 48000; d[SC_FRAME + 2] = 4096; d[SC_FRAME + 3] = awake; d[SC_FRAME + 4] = 0.5;
        return d;
    };
    const teles = {
        ramp: mkTele((i) => (i % NC) / NC, 1),
        zero: mkTele(() => 0, 1),
        one: mkTele(() => 1, 1),
        nan: mkTele(() => NaN, 1),
        huge: mkTele(() => 1e9, 1),
        neg: mkTele((i) => -5 - i, 1),
        spiky: mkTele((i) => (i % 2 ? 1 : 0), 1),
        silent: mkTele(() => 0.3, 0),
        short: new Array(10).fill(0.5)
    };
    const apply = (name) => {
        if (name === "short") { tele = teles.short; } else { teles[name][SC_FRAME] = frame++; tele = teles[name]; }
        sb.setbuffer("x");
        sb.fvPoll();
    };
    let n = 0;
    const paintOnce = (label) => {
        rec.begin(label);
        sb.paint();
        rec.end();
        const tx = rec.shapes.filter((q) => q.kind === "text");
        for (let i = 0; i < tx.length; i++) for (let j = i + 1; j < tx.length; j++) {
            const A = tx[i], B = tx[j];
            if (A.x0 < B.x1 - 0.5 && B.x0 < A.x1 - 0.5 && A.y0 < B.y1 - 0.5 && B.y0 < A.y1 - 0.5) rec.bad.push(`${label}: text "${A.text}" overlaps text "${B.text}"`);
        }
        n++;
    };
    const infos = [
        { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 },
        { instanceId: "p", isInRack: true, chainIndex: 99, chainCount: 128, peers: 4, linked: true, autoChannel: 3 }
    ];
    // 1. pattern extremes x display mode x telemetry
    const pat = grid({ splits: [1, 2, 16, 1024], dir: [0, 2], xfade: [0, 100], nudge: [-4, 4], spin: [-50, 0, 50], bend: [-100, 100], pinch: [-100, 100], dispost: [0, 1] });
    const tnames = Object.keys(teles);
    let k = 0;
    for (const p of pat) {
        for (const key of Object.keys(p)) sb["set_" + key](p[key]);
        apply(tnames[k++ % tnames.length]);
        sb.fvInfo = infos[k % 2];
        paintOnce("pattern " + JSON.stringify(p));
    }
    // 2. limiter / dot / output extremes with every telemetry case, both displays
    sb.set_splits(16); sb.set_dir(0); sb.set_xfade(0); sb.set_nudge(0); sb.set_spin(0);
    const ex = grid({ limon: [0, 1], limthr: [-200, -120, -80, -72, -40, 0, 6, 12, 99, NaN], bend: [-100, 0, 100, 1000, NaN], pinch: [-100, 0, 100, -1000], output: [0, 1, 4], dispost: [0, 1], tele: tnames });
    for (const e of ex) {
        for (const key of ["limon", "limthr", "bend", "pinch", "output", "dispost"]) sb["set_" + key](e[key]);
        apply(e.tele);
        sb.fvInfo = infos[n % 2];
        paintOnce("extreme " + JSON.stringify(e));
    }
    // 3. an active limiter drag while the limiter is off, preview state
    sb.set_limon(0); sb.set_limthr(-120);
    sb.fvDrag = { kind: "limiter" };
    paintOnce("limiter drag at -120");
    sb.fvDrag = { kind: "dot" };
    paintOnce("dot drag");
    sb.fvDrag = null;
    sb.preview();
    paintOnce("preview");
    const bad = checkRecording(rec, { regions });
    assert.strictEqual(bad.length, 0, "Freq Split main face drawing out of bounds:\n" + [...new Set(bad)].slice(0, 20).join("\n"));
    return n;
}

function vmGet(sb, name) { return require("vm").runInContext(name, sb); }

function runTop() {
    const W = 84, H = 15;
    const rec = makeRecorder(W, H);
    const sb = loadFace(topCode, rec);
    let n = 0;
    for (const d of [0, 1, 2, -5, 7, NaN, 1.4]) {
        sb.set_dir(d);
        rec.begin("dir " + d);
        sb.paint();
        rec.end();
        n++;
    }
    const bad = checkRecording(rec, { regions: [{ x: 0, y: 0, w: W, h: H }] });
    assert.strictEqual(bad.length, 0, "Freq Split header strip drawing out of bounds:\n" + bad.slice(0, 20).join("\n"));
    return n;
}

const a = runMain();
const b = runTop();
console.log(`[paint bounds] Freq Split main face (${a} paints) and header strip (${b} paints) stay inside their regions`);
