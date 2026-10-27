"use strict";
/** Tube-specific checks: the layout (all 33 keys on or off the face), paint cost and the hit / gate / split visual differences. */
const path = require("path");
const T = require("./deviate_test_lib.js");
const F = require("./face_fuzz_lib.js");
const P = require("./paint_bounds_lib.js");
const CFG = require("../src/deviate_config.js");

const R = T.makeReporter("test_deviate_face_tube");
const dir = process.env.DEVIATE_BUILD_DIR || T.tmpDir("tube");
if (!process.env.DEVIATE_BUILD_DIR) T.buildInto(dir);
const dev = T.readDevice(path.join(dir, "Deviate Tube.amxd"));
const S = CFG.DV_SCOPE;
const info = T.faceInfo().faces.tube;
const canvas = info.canvases[0];

function boot() {
    const b = dev.byId[canvas.id];
    const holder = { scope: null };
    function BufferMock(name) {
        this.peek = (ch, idx, count) => {
            const src = name === "scope" ? holder.scope : null;
            const out = new Array(count === undefined ? 1 : count).fill(0);
            if (src) for (let i = 0; i < out.length; i++) out[i] = src[idx + i] || 0;
            return count === undefined ? out[0] : out;
        };
        this.poke = () => {};
    }
    const f = F.loadFace(b.textfile.text, { width: canvas.rect[2], height: canvas.rect[3], id: canvas.id, filename: "tube.js", seed: 3, globals: { Buffer: BufferMock } });
    f.holder = holder; f.log = [];
    const mg = f.rec.mgraphics;
    for (const k of Object.keys(mg)) {
        const fn = mg[k];
        if (typeof fn !== "function" || k === "text_measure" || k === "init") continue;
        mg[k] = function (...a) { if (k !== "redraw") f.log.push(k + "(" + a.map((x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x)).join(",") + ")"); return fn.apply(this, a); };
    }
    F.call(f, "names", ["scope", "ctl", "ir", "spec", "test", "state"]);
    f.sandbox.messagename = "state"; F.call(f, "anything", ["dsp", 1, "-"]);
    return f;
}
let fc = 0;
function frame(f, base, mod) {
    const s = CFG.dvPreviewTel(base); if (mod) mod(s); s[S.FRAMES] = ++fc;
    f.holder.scope = s; f.state.clock += 33; F.call(f, "dvFrame", []);
}
function stream(base, mod) {
    const f = boot(); frame(f, { kind: "idle" }); frame(f, base, mod);
    f.log.length = 0; f.rec.begin("p"); F.call(f, "paint", []); f.rec.end();
    return f.log.join("|");
}

R.ok(info.canvases.length === 1 && info.width === 520, "one 520 px canvas face");
const idle = stream({ kind: "idle" });
const hit = stream({ kind: "hit", ageMs: 20 });
R.ok(idle !== hit, "idle and hit paint differently");
R.ok(stream({ kind: "hit" }, null) !== stream({ kind: "hit", gate: 0 }), "gate 0 is distinct");
R.ok(stream({ kind: "hit" }) !== stream({ kind: "hit", spectral: true }), "ENV vs SPEC differ");
const lampOnly = (k) => stream({ kind: "ring" }, (s) => { s[k] = 0.9; }) !== stream({ kind: "ring" }, (s) => { s[k] = 0.05; });
R.ok(lampOnly(S.PK_T) && lampOnly(S.PK_B) && lampOnly(S.PK_L), "T, B and L lamps each move pixels");
{
    // regression: a click flash must fade on the clock even when no telemetry frame arrives (sleeping / frozen gen)
    const f = boot(); frame(f, { kind: "idle" });
    F.call(f, "onclick", [10, 10]);
    const lit = f.sandbox.tbFlashNow();
    R.ok(lit >= 0.5, "click lights the flash (" + lit.toFixed(2) + ")");
    f.state.clock += 150;
    const mid = f.sandbox.tbFlashNow();
    R.ok(mid > 0 && mid < lit, "flash is fading at 150 ms with no onFrame");
    f.state.clock += 200;
    R.ok(f.sandbox.tbFlashNow() < 0.01, "flash is gone 350 ms after the click with no onFrame");
}
R.ok(/DRAW/.test(hit) && /ENV|SPEC/.test(hit), "DRAW and ENV labels painted");
const calls = hit.split("|").length;
console.log("hit paint calls", calls);
R.ok(calls <= 700, `hit paint uses ${calls} calls (<= 700)`);
R.done();
