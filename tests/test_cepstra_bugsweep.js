#!/usr/bin/env node
/**
 * RED suite for Cepstra bugsweep (bugsweep/cepstra-pass1).
 * PASS-2 review: kept Bug A (stale f0 / voiced-gate) and Bug B (#0-cepscope).
 * These checks are expected to FAIL on current production code until PASS 3.
 * See BUGS.md. Do not "fix" by editing src/ or scripts/ in PASS 1/2.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "cepstra_core.genexpr");
const DISP_PATH = path.join(ROOT, "src", "cepstra_display.js");
const CFG_PATH = path.join(ROOT, "src", "cepstra_config.js");
const BUILD_PATH = path.join(ROOT, "scripts", "build_cepstra.py");
const AMXD_PATH = path.join(ROOT, "devices", "Cepstra.amxd");
const cfg = require(CFG_PATH);

let checks = 0;
function ok(cond, msg) {
    checks++;
    assert.ok(cond, msg);
}
function eq(a, b, msg) {
    checks++;
    assert.strictEqual(a, b, msg);
}

const gen = fs.readFileSync(GEN_PATH, "utf8");
const cfgSrc = fs.readFileSync(CFG_PATH, "utf8");
const dispSrc = fs.readFileSync(DISP_PATH, "utf8");
const buildSrc = fs.readFileSync(BUILD_PATH, "utf8");
// Face script in the device is config + display (build prepends); sandbox must match.
const faceSrc = cfgSrc + "\n" + dispSrc;

// ---------------------------------------------------------------------------------------------
// Bug A — job_lift must clear f0v when Auto is unvoiced / MIDI has no note
// ---------------------------------------------------------------------------------------------
{
    const liftStart = gen.indexOf("job_lift(");
    ok(liftStart >= 0, "job_lift present");
    const liftEnd = gen.indexOf("\ninterp_env(", liftStart);
    const lift = gen.slice(liftStart, liftEnd > 0 ? liftEnd : undefined);

    const autoStart = lift.indexOf("} else if (modeNow < 1.5) {");
    const midiStart = lift.indexOf("\t} else {\n\t\tif (midiNote >= 0)");
    ok(autoStart >= 0 && midiStart > autoStart, "Auto and MIDI arms of job_lift located");
    const autoArm = lift.slice(autoStart, midiStart);

    // Success block sets f0v; anything after it in the Auto arm is the unvoiced fallthrough.
    const successRe = /if \(best > 0\.06\) \{[\s\S]*?\n\t\t\}/;
    const success = autoArm.match(successRe);
    ok(!!success, "Auto arm has best > 0.06 success block");
    const afterSuccess = autoArm.slice(autoArm.indexOf(success[0]) + success[0].length);
    ok(
        /f0v\s*=\s*0/.test(afterSuccess),
        "Bug A RED: Auto unvoiced path must assign f0v = 0 (scope 257 contract: 0 = unvoiced / unknown)"
    );

    const midiArm = lift.slice(midiStart, lift.indexOf("poke(stat, held, 4)"));
    // After the midiNote >= 0 block, no-note fallthrough must clear f0.
    const noteBlock = midiArm.match(/if \(midiNote >= 0\) \{[\s\S]*?\n\t\t\}/);
    ok(!!noteBlock, "MIDI arm has midiNote >= 0 block");
    const afterNote = midiArm.slice(midiArm.indexOf(noteBlock[0]) + noteBlock[0].length);
    ok(
        /f0v\s*=\s*0/.test(afterNote),
        "Bug A RED: MIDI with no note must assign f0v = 0 (unknown pitch)"
    );
}

// ---------------------------------------------------------------------------------------------
// Bug A — display: Auto + unvoiced must not keep a green pitch marker / ghost period
// ---------------------------------------------------------------------------------------------
{
    const presentation = [0, 0, 256, 100];
    const scopeMock = new Array(272).fill(0);
    for (let b = 0; b < 192; b++) {
        const ms = (b + 0.5) * 20 / 192;
        scopeMock[b] = (b === 0 ? 11 : 2.4 * Math.exp(-ms / 1.7) * Math.cos(ms * 7)
            + 0.55 * Math.exp(-(((ms - 8.33) / 0.2) ** 2)) + 0.004 * Math.sin(b * 3));
    }
    // Live audio, Auto-tracked L, STALE f0 from a previous voiced frame, voiced = 0.
    scopeMock[256] = 123;
    scopeMock[257] = 120;
    scopeMock[258] = 0.4;
    scopeMock[259] = 5;
    scopeMock[260] = 2048;
    scopeMock[261] = 0; // unvoiced
    scopeMock[262] = 1; // resmode Auto (also driven via set_mode)

    const sb = { emitted: [], rgba: [], rects: [], strokes: 0, fills: 0, tasks: [], texts: [] };
    sb.mgraphics = {
        size: [presentation[2], presentation[3]],
        init() {}, redraw() {},
        set_source_rgba(r, g, b, a) { sb.rgba.push([r, g, b, a]); },
        set_line_width() {},
        rectangle(x, y, w, h) { sb.rects.push({ x, y, w, h, c: sb.rgba[sb.rgba.length - 1] }); },
        rectangle_rounded() {}, arc() {}, move_to() {}, line_to() {}, curve_to() {}, close_path() {},
        fill() { sb.fills++; }, stroke() { sb.strokes++; },
        select_font_face() {}, set_font_size() {}, show_text(t) { sb.texts.push(t); },
    };
    sb.Buffer = function (name) { this.name = name; this.peek = () => scopeMock.slice(); this.poke = () => {}; };
    sb.Task = function (fn) {
        const t = this;
        t.fn = fn; t.repeat = () => {}; t.schedule = () => { sb.tasks.push(t); };
        t.cancel = () => { const i = sb.tasks.indexOf(t); if (i >= 0) sb.tasks.splice(i, 1); };
    };
    sb.outlet = (_i, msg) => sb.emitted.push(msg);

    const fnDisp = new Function(
        "mgraphics", "Buffer", "Task", "outlet", "notifyclients",
        faceSrc + "\nreturn { set_auto, set_midi, set_mode, set_res, setbuffer, pullScope, paint, preview, onclick, layoutRegions, barAxis01, res: () => curRes, loadbang, init_dsp };"
    );
    const dui = fnDisp(sb.mgraphics, sb.Buffer, sb.Task, sb.outlet, () => {});
    dui.setbuffer("1001-cepscope");
    dui.set_mode(1); // Auto
    for (let i = 0; i < 8; i++) dui.pullScope();

    sb.rgba.length = 0;
    sb.texts.length = 0;
    dui.paint();
    const hasGreen = sb.rgba.some((c) =>
        Math.abs(c[0] - 0.22) < 1e-6 && Math.abs(c[1] - 0.92) < 1e-6 && Math.abs(c[2] - 0.46) < 1e-6 && Math.abs(c[3] - 1.0) < 1e-6
    );
    ok(!hasGreen, "Bug A RED: Auto + unvoiced must not paint the green pitch marker despite stale f0Hz");
    ok(!sb.texts.some((t) => /Hz$/.test(String(t))), "Bug A RED: Auto + unvoiced must not show a Hz label from stale f0");

    // Res click must use the manual map when there is no voiced period (periodSamplesNow → 0).
    const D = dui.layoutRegions();
    sb.emitted.length = 0;
    const x6 = D.disp.x + cfg.msToAxis01(6) * D.disp.w;
    dui.onclick(x6, D.disp.plotY + 20);
    ok(sb.emitted.length >= 1 && sb.emitted[0][0] === "res", "Bug A setup: click emits res");
    const got = sb.emitted[0][1];
    const manualWant = Math.round(cfg.axis01ToRes(0, cfg.msToAxis01(6), 44100, 2048, 0) * 1000) / 10;
    const ghostPeriod = 44100 / 120;
    const ghostWant = Math.round(cfg.axis01ToRes(1, cfg.msToAxis01(6), 44100, 2048, ghostPeriod) * 1000) / 10;
    const close = (a, b, tol) => Math.abs(a - b) <= tol;
    ok(close(got, manualWant, 0.15), `Bug A RED: Auto + unvoiced Res click must use manual map (got ${got}, want ~${manualWant}; ghost Auto map would be ~${ghostWant})`);
    ok(!close(got, ghostWant, 0.15), "Bug A RED: Auto + unvoiced Res click must NOT use the stale-f0 Auto k-scale");
}

// ---------------------------------------------------------------------------------------------
// Bug B — scope buffer must be instance-unique (`---…`), not shared `#0-cepscope`
// ---------------------------------------------------------------------------------------------
{
    ok(
        /---cepscope/.test(buildSrc) || /scope\s+"---/.test(gen) || /setbuffer\(["']---/.test(dispSrc),
        "Bug B RED: build/gen/display should reference a unique ---cepscope (or equivalent) name"
    );
    ok(
        !/buffer~\s+#0-cepscope/.test(buildSrc),
        "Bug B RED: build must not create buffer~ #0-cepscope (Live does not expand #0 in top-level devices)"
    );
    ok(
        !/\bscope\s+#0-cepscope\b/.test(buildSrc),
        "Bug B RED: build must not bind scope #0-cepscope"
    );
    if (fs.existsSync(AMXD_PATH)) {
        const amxd = fs.readFileSync(AMXD_PATH, "utf8");
        // amxd is binary-ish but text atoms for box text are searchable
        ok(
            !/#0-cepscope/.test(amxd) || /---cepscope/.test(amxd),
            "Bug B RED: built Cepstra.amxd must not rely solely on shared #0-cepscope"
        );
    }
}


// ---------------------------------------------------------------------------------------------
// Bug C — Ceps voicing gate: the search region max(L, 1 ms)..1/60 s is empty when the lifter lag L
// exceeds sr/60, and degenerates to one sample at L == sr/60. MIDI low notes reach it at default
// settings (note 24 period ~1348 samples, lag ~943 at Res 57% vs cap 735 at 44.1 kHz): the region
// loop runs zero times, v = 0 / rms = 1e-10, and voicingGateStep / job_cgate close the gate to
// -60 dB on pitched frames. Unknown (no region to judge) must not be scored as unvoiced.
// ---------------------------------------------------------------------------------------------
{
    const srC = 44100, nC = 4096;
    const periodC = cfg.midiPeriodSamples(24, srC);
    const lagC = cfg.lifterLagSamples(2, 0.57, srC, nC, periodC);
    ok(lagC > Math.floor(srC / 60), "Bug C setup: MIDI note 24 at Res 57% gives a lifter lag past the 60 Hz quefrency cap");
    const cC = new Float64Array(nC);
    for (let i = 0; i < nC; i++) cC[i] = 0.01 * Math.sin(i * 1.7);
    cC[Math.round(periodC)] = 2.0;
    const voC = cfg.cepstralVoicing(cC, lagC, srC, nC);
    ok(voC.v > cfg.voicingThreshold(0.5), "Bug C RED: pitched low-MIDI frame must score as voiced (got v=" + voC.v + ", rms=" + voC.rms + ")");
    let stC = { open: 1 };
    for (let i = 0; i < 30; i++) stC = cfg.voicingGateStep(stC.open, voC.v, 0.5);
    ok(Math.abs(stC.logGain) < 0.01, "Bug C RED: Ceps gate must stay open for a pitched low-MIDI frame (settled logGain " + stC.logGain + ")");
    const lagB = Math.floor(srC / 60);
    const cB = new Float64Array(nC);
    for (let i = 0; i < nC; i++) cB[i] = 0.01 * Math.sin(i * 1.7);
    cB[lagB] = 2.0;
    const voB = cfg.cepstralVoicing(cB, lagB, srC, nC);
    ok(voB.v > cfg.voicingThreshold(0), "Bug C RED: pitched frame at the 60 Hz boundary lag must be able to score voiced (got v=" + voB.v + ")");
    const cgStart = gen.indexOf("job_cgate(");
    ok(cgStart >= 0, "job_cgate present");
    const cgBody = gen.slice(cgStart, gen.indexOf("\n}", cgStart));
    ok(/qhi\s*=\s*max\(|if\s*\(cnt/.test(cgBody), "Bug C RED: job_cgate must guard the empty/degenerate voicing region (extend qhi or bypass when cnt is too small)");
}

console.log(`cepstra bugsweep RED: ${checks} checks (expected FAIL on current code until PASS 3 fixes)`);
