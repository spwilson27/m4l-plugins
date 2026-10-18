#!/usr/bin/env node
/**
 * Comprehensive verification suite for devices/Reciprocator.amxd (448 x 169 px 3-Stage Signal Flow).
 *
 * Covers:
 *  1. Reciprocal math, smooth cubic noise gate, inverted dynamics (>100%), and ceiling limiters
 *  2. GenExpr ordering & lexer safety (functions first, Buffer -> Param -> History -> Delay, no e<digit>)
 *  3. .amxd binary header ("aaaa" Audio Effect) & 448 x 169 presentation geometry
 *  4. #0- instance isolation, `scope #0-recipscope` loadbang binding, and 4-panel z-order
 *  5. 3-stage signal-flow headers (`1. DETECT`, `2. 1 / ENV`, `3. OUTPUT`) and zero widget overlap
 *  6. Complete patchline graph verification (controls -> `/ 100.` -> `prepend <param>` -> `obj-gen`,
 *     plus bidirectional `v8ui` drag -> `route gate ceiling` -> `obj-gen` & `prepend set`)
 *  7. `v8ui` runtime execution: pixel-coordinate mode (`relative_coords === 0`), live scope buffer
 *     polling (`pullScope`), parameter setters, and interactive Gate + Ceiling drag gestures
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "reciprocator_core.genexpr");
const cfg = require(path.join(ROOT, "src", "reciprocator_config.js"));

// 1. Reciprocal math & smooth gate invariants
assert.strictEqual(cfg.computeRecipGain(0.0, 1.0, -42, -1), 0, "Silence must be gated to 0 gain");
assert.strictEqual(cfg.computeRecipGain(0.0001, 1.0, -36, -1), 0, "Signal well below gate must be muted");
assert.strictEqual(cfg.computeGateFactor(0.0, 0.01), 0, "Gate factor at 0 must be 0");
assert.strictEqual(cfg.computeGateFactor(0.05, 0.01), 1, "Gate factor well above threshold must be 1");
const midGate = cfg.computeGateFactor(0.01, 0.01);
assert.ok(midGate > 0.1 && midGate < 0.9, "Gate factor at threshold must be inside smooth cubic knee");

const ceilDb = -1.0;
const ceilLin = cfg.dbToLin(ceilDb);
assert.ok(Math.abs(cfg.linToDb(ceilLin) - ceilDb) < 1e-6, "dbToLin and linToDb must round-trip");

const loudIn = 0.5;
const quietIn = 0.04;
const loudOut = loudIn * cfg.computeRecipGain(loudIn, 1.0, -48, ceilDb);
const quietOut = quietIn * cfg.computeRecipGain(quietIn, 1.0, -48, ceilDb);
assert.ok(Math.abs(loudOut - ceilLin) < 0.02, "Loud signal at Amount=100% should land at Ceiling");
assert.ok(Math.abs(quietOut - ceilLin) < 0.02, "Quiet signal above gate at Amount=100% should also land at Ceiling");

const unityGain = cfg.computeRecipGain(0.25, 0.0, -48, -1.0);
assert.ok(Math.abs(unityGain - 1.0) < 1e-6, "Amount=0% should produce unity gain above gate");

const invQuiet = quietIn * cfg.computeRecipGain(quietIn, 1.5, -60, 0.0);
const invLoud = loudIn * cfg.computeRecipGain(loudIn, 1.5, -60, 0.0);
assert.ok(invQuiet > invLoud, "Amount > 100% should invert dynamics so quiet details exceed loud ones");

assert.ok(Math.abs(cfg.applyCeiling(10.0, 0.8, 0)) <= 0.80001, "Hard clip must clamp at ceilingLin");
assert.ok(Math.abs(cfg.applyCeiling(10.0, 0.8, 1)) <= 0.80001, "Soft clip must stay within ceilingLin");
assert.ok(Math.abs(cfg.applyCeiling(0.4, 0.8, 1)) < Math.abs(cfg.applyCeiling(0.4, 0.8, 0)), "Soft clip knee must gently compress near ceiling");

// 2. GenExpr ordering & lexer checks
const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(!gen.match(/\be\d/), "Never use e0..e9 identifiers in GenExpr (parsed as Euler's constant)");
assert.ok(!gen.includes("delay("), "GenExpr must use Delay.read / Delay.write instead of delay()");
const fnAt = gen.indexOf("slew(target, coef)");
const bufAt = gen.indexOf("\nBuffer ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const delayAt = gen.indexOf("\nDelay ");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1);");
assert.ok(fnAt >= 0 && fnAt < bufAt, "Functions must precede Buffer in GenExpr");
assert.ok(bufAt < paramAt && paramAt < histAt && histAt < delayAt, "Declarations must follow Buffer -> Param -> History -> Delay order");
assert.ok(delayAt < exprAt, "All Delay declarations must precede expressions");
assert.strictEqual((gen.match(/^Delay /gm) || []).length, 2, "Expected 2 lookahead Delay lines (lookL, lookR)");
assert.ok(gen.includes("fixnan(outL)") && gen.includes("fixnan(outR)"), "Outputs must be protected with fixnan()");

function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}

function verifyAmxd(amxdFile, expectedWidth) {
    const fullPath = path.join(ROOT, "devices", amxdFile);
    const raw = fs.readFileSync(fullPath);
    assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", `${amxdFile}: Expected ampf header`);
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", `${amxdFile}: Expected aaaa audio-effect type`);
    assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", `${amxdFile}: Expected ptch chunk`);
    const jsonLen = raw.readUInt32LE(28);
    assert.strictEqual(jsonLen, raw.length - 32, `${amxdFile}: Payload length mismatch`);

    const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    const devW = patcher.openrect[2];
    assert.strictEqual(patcher.openinpresentation, 1, `${amxdFile}: Must open in presentation mode`);
    assert.strictEqual(devW, expectedWidth, `${amxdFile}: Expected width ${expectedWidth} (got ${devW})`);
    assert.strictEqual(patcher.openrect[3], 169.0, `${amxdFile}: Expected height 169`);

    const boxes = patcher.boxes.map((b) => b.box);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    const lines = patcher.lines.map((l) => l.patchline);

    function hasLine(srcId, dstId) {
        return lines.some((l) => l.source[0] === srcId && l.destination[0] === dstId);
    }

    assert.ok(byId["obj-plugin"] && byId["obj-plugin"].text === "plugin~", `${amxdFile}: Missing plugin~`);
    assert.ok(byId["obj-plugout"] && byId["obj-plugout"].text === "plugout~", `${amxdFile}: Missing plugout~`);
    assert.ok(byId["obj-gen"] && byId["obj-gen"].maxclass === "gen.codebox~", `${amxdFile}: Missing gen.codebox~`);
    assert.strictEqual(byId["obj-gen"].code, gen, `${amxdFile}: Embedded GenExpr mismatch`);
    assert.strictEqual(byId["obj-msg-gen-buf"].text, "scope #0-recipscope", `${amxdFile}: Buffer bind message mismatch`);
    assert.ok(hasLine("obj-loadbang", "obj-msg-gen-buf") && hasLine("obj-msg-gen-buf", "obj-gen"), "Missing loadbang -> scope #0-recipscope -> gen wiring");
    assert.ok(hasLine("obj-loadbang", "obj-msg-ui-buf") && hasLine("obj-msg-ui-buf", "obj-viz"), "Missing loadbang -> setbuffer #0-recipscope -> viz wiring");

    // Verify 3-stage signal flow headers
    assert.strictEqual(byId["obj-hdr-det"].text, "1. DETECT", "Missing 1. DETECT stage header");
    assert.strictEqual(byId["obj-hdr-rec"].text, "2. 1 / ENV", "Missing 2. 1 / ENV stage header");
    assert.strictEqual(byId["obj-hdr-out"].text, "3. OUTPUT", "Missing 3. OUTPUT stage header");

    for (const b of boxes) {
        if (b.text && b.text.startsWith("buffer~")) {
            assert.ok(b.text.includes("#0-"), `${amxdFile}: buffer~ must use #0- prefix: ${b.text}`);
        }
    }

    // Verify all 11 parameters & their patchline chains into obj-gen
    const paramChecks = [
        ["amount", "Amount", "amount", true],
        ["gate", "Gate", "gate", false],
        ["attack", "Attack", "attack", false],
        ["release", "Release", "release", false],
        ["mix", "Mix", "wet", true],
        ["ceiling", "Ceiling", "ceiling", false],
        ["lookahead", "Lookahead", "lookahead", false],
        ["detect", "Detect", "detect", true],
        ["schp", "SC HP", "schp", false],
        ["sclp", "SC LP", "sclp", false],
    ];
    for (const [key, varname, genParam, isPct] of paramChecks) {
        const ctrl = byId[`obj-ctrl-${key}`];
        assert.ok(ctrl && ctrl.varname === varname, `${amxdFile}: Missing control obj-ctrl-${key} (${varname})`);
        const prep = byId[`obj-prep-${key}`];
        assert.ok(prep && prep.text === `prepend ${genParam}`, `${amxdFile}: Missing prepend ${genParam}`);
        assert.ok(hasLine(prep.id, "obj-gen"), `${amxdFile}: ${prep.id} not wired to obj-gen`);
        if (isPct) {
            const scale = byId[`obj-scale-${key}`];
            assert.ok(scale && scale.text === "/ 100.", `${amxdFile}: Percent param ${key} must scale by / 100.`);
            assert.ok(hasLine(ctrl.id, scale.id) && hasLine(scale.id, prep.id), `${amxdFile}: Broken scale chain for ${key}`);
        } else {
            assert.ok(hasLine(ctrl.id, prep.id), `${amxdFile}: ${ctrl.id} not wired to ${prep.id}`);
        }
    }
    assert.ok(byId["obj-softclip"] && byId["obj-softclip"].varname === "Soft Clip", "Missing Soft Clip toggle");
    assert.ok(hasLine("obj-softclip", "obj-prep-softclip") && hasLine("obj-prep-softclip", "obj-gen"), "Soft Clip not wired to gen");

    // Verify bidirectional scope drag routing (obj-viz -> route gate ceiling -> gen & controls)
    assert.ok(hasLine("obj-viz", "obj-route-viz"), "obj-viz outlet not wired to obj-route-viz");
    assert.ok(hasLine("obj-route-viz", "obj-prep-gate") && hasLine("obj-route-viz", "obj-set-gate"), "Gate drag route missing");
    assert.ok(hasLine("obj-route-viz", "obj-prep-ceiling") && hasLine("obj-route-viz", "obj-set-ceil"), "Ceiling drag route missing");

    const viz = byId["obj-viz"];
    assert.strictEqual(viz.maxclass, "v8ui");
    const vr = viz.presentation_rect;

    const interactive = boxes.filter(
        (b) => b.presentation === 1 && b.id !== "obj-viz" && b.maxclass && b.maxclass.startsWith("live.") && b.maxclass !== "live.comment"
    );
    for (const w of interactive) {
        assert.ok(!rectsOverlap(vr, w.presentation_rect), `${amxdFile}: v8ui overlaps ${w.id}`);
    }
    for (let i = 0; i < interactive.length; i++) {
        for (let j = i + 1; j < interactive.length; j++) {
            assert.ok(
                !rectsOverlap(interactive[i].presentation_rect, interactive[j].presentation_rect),
                `${amxdFile}: ${interactive[i].id} overlaps ${interactive[j].id}`
            );
        }
    }

    for (const b of boxes) {
        if (b.presentation === 1 && b.presentation_rect) {
            const r = b.presentation_rect;
            assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= devW && r[1] + r[3] <= 169, `${amxdFile}: ${b.id} outside ${devW}x169`);
        }
    }

    const panelIndices = boxes.map((b, idx) => (b.maxclass === "panel" ? idx : -1)).filter((i) => i >= 0);
    const maxWidgetIdx = Math.max(...boxes.map((b, idx) => (b.maxclass !== "panel" ? idx : -1)));
    assert.strictEqual(panelIndices.length, 4, `${amxdFile}: Expected 4 stage background panels`);
    for (const pi of panelIndices) {
        assert.strictEqual(boxes[pi].background, 1, `${amxdFile}: Panels must set background: 1`);
        assert.ok(pi > maxWidgetIdx, `${amxdFile}: Panels must appear after all widgets in boxes`);
    }

    // Evaluate v8ui script and verify pixel-coordinate mode, live scope updates, setters, and drag gestures
    let scopeSamples = [0.22, 0.18, 1.0, 0.65, 0.78, 0.008, 0.89, 12];
    const drawOps = [];
    const emitted = [];
    const sandbox = {
        mgraphics: {
            size: [vr[2], vr[3]],
            init() { drawOps.push("init"); },
            redraw() { drawOps.push("redraw"); },
            set_source_rgba() {},
            set_line_width() {},
            rectangle() {},
            move_to() {},
            line_to() {},
            close_path() {},
            fill() {},
            stroke() {},
            select_font_face() {},
            set_font_size() {},
            show_text(t) { drawOps.push("text:" + t); },
        },
        Buffer: function () {
            this.peek = () => scopeSamples.slice();
            this.poke = () => {};
        },
        Task: function (fn) {
            this.fn = fn;
            this.repeat = () => {};
        },
        outlet(idx, msg) { emitted.push(msg); },
    };

    const fn = new Function(
        "mgraphics", "Buffer", "Task", "outlet",
        viz.textfile.text + "\nreturn { loadbang, setbuffer, set_gate, set_ceiling, set_amount, set_softclip, onclick, ondrag, pullScope, paint, histOut };"
    );
    const ui = fn(sandbox.mgraphics, sandbox.Buffer, sandbox.Task, sandbox.outlet);
    assert.strictEqual(sandbox.mgraphics.relative_coords, 0, `${amxdFile}: v8ui must disable relative_coords`);
    assert.strictEqual(sandbox.mgraphics.autofill, 0, `${amxdFile}: v8ui must disable autofill`);
    ui.setbuffer("1001-recipscope");
    ui.loadbang();
    ui.set_gate(-36);
    ui.set_ceiling(-3);
    ui.set_amount(120);
    ui.set_softclip(0);
    ui.pullScope();
    ui.paint();
    assert.ok(ui.histOut[ui.histOut.length - 1] > 0.5, `${amxdFile}: pullScope must push live output peaks`);

    // Drag Gate bar (lower region of scope)
    ui.onclick(40, 110);
    ui.ondrag(40, 100);
    assert.ok(emitted.some((m) => m[0] === "gate" && m[1] <= -6 && m[1] >= -72), "Dragging lower scope must emit gate dB");

    // Drag Ceiling bar (upper region of scope)
    ui.onclick(40, 22);
    ui.ondrag(40, 28);
    assert.ok(emitted.some((m) => m[0] === "ceiling" && m[1] <= 0 && m[1] >= -18), "Dragging upper scope must emit ceiling dB");
}

verifyAmxd("Reciprocator.amxd", 448.0);

console.log("test_reciprocator: ok");
