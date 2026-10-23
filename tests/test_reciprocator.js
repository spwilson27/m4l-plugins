#!/usr/bin/env node
/**
 * Comprehensive verification suite for devices/Reciprocator.amxd (448 x 169 px 3-Stage Signal Flow).
 *
 * Covers:
 *  1. Reciprocal math, smooth normal & reverse gate (`Rev Gate`), inverted dynamics (>100%),
 *     and 3-mode output ceiling stage (`Soft`, `Hard`, `Lim`)
 *  2. GenExpr ordering & lexer safety (functions first, Buffer -> Param -> History -> Delay, no e<digit>)
 *  3. .amxd binary header ("aaaa" Audio Effect) & 448 x 169 presentation geometry
 *  4. #0- instance isolation, `scope #0-recipscope` loadbang binding, and 4-panel z-order
 *  5. 3-stage signal-flow headers (`1. DETECT`, `2. 1 / ENV`, `3. OUTPUT`), `Output Mode` selection box
 *     placed directly above `Ceiling`, `Rev Gate` button under `Gate`, and zero widget overlap
 *  6. Complete patchline graph verification (controls -> `/ 100.` -> `prepend <param>` -> `obj-gen-in`,
 *     plus bidirectional `v8ui` drag -> `route gate ceiling` -> gen hub & `prepend set`)
 *  7. Deferred DSP: no static gen~, no plugin~ -> plugout~ bypass, GEN_DSP_TEXT / GEN_DSP_HASH,
 *     gate hub, and live.thisdevice -> init_dsp
 *  8. `v8ui` runtime execution: pixel-coordinate mode (`relative_coords === 0`), live scope buffer
 *     polling (`pullScope`), parameter setters (`set_revgate`, `set_outmode`), and Gate + Ceiling drag gestures
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "reciprocator_core.genexpr");
const cfg = require(path.join(ROOT, "src", "reciprocator_config.js"));

// 1. Reciprocal math, normal & reverse gate, and Soft / Hard / Limiter invariants
assert.strictEqual(cfg.computeRecipGain(0.0, 1.0, -42, -1, 0), 0, "Silence must be gated to 0 gain in normal mode");
assert.strictEqual(cfg.computeRecipGain(0.0, 1.0, -24, -1, 1), 0, "Digital silence must also be muted in Reverse Gate mode");
assert.strictEqual(cfg.computeRecipGain(0.0001, 1.0, -36, -1, 0), 0, "Signal well below gate must be muted in normal mode");
assert.strictEqual(cfg.computeGateFactor(0.0, 0.01, 0), 0, "Normal gate factor at 0 must be 0");
assert.strictEqual(cfg.computeGateFactor(0.05, 0.01, 0), 1, "Normal gate factor well above threshold must be 1");

// Reverse gate (`reverseGate = 1`): mutes loud signals above Gate and passes quiet signals below Gate
assert.strictEqual(cfg.computeGateFactor(0.25, 0.06, 1), 0, "Reverse gate must mute loud signal above threshold");
assert.ok(cfg.computeGateFactor(0.015, 0.06, 1) > 0.95, "Reverse gate must open for quiet signal below threshold");
const revQuietGain = cfg.computeRecipGain(0.015, 1.0, -24, -1.0, 1);
const revLoudGain = cfg.computeRecipGain(0.25, 1.0, -24, -1.0, 1);
assert.ok(revQuietGain > 10.0 && revLoudGain === 0, "Reverse gate must boost quiet signal to Ceiling and mute loud signal");

const ceilDb = -1.0;
const ceilLin = cfg.dbToLin(ceilDb);
assert.ok(Math.abs(cfg.linToDb(ceilLin) - ceilDb) < 1e-6, "dbToLin and linToDb must round-trip");

const loudIn = 0.5;
const quietIn = 0.04;
const loudOut = loudIn * cfg.computeRecipGain(loudIn, 1.0, -48, ceilDb, 0);
const quietOut = quietIn * cfg.computeRecipGain(quietIn, 1.0, -48, ceilDb, 0);
assert.ok(Math.abs(loudOut - ceilLin) < 0.02, "Loud signal at Amount=100% should land at Ceiling");
assert.ok(Math.abs(quietOut - ceilLin) < 0.02, "Quiet signal above gate at Amount=100% should also land at Ceiling");

const unityGain = cfg.computeRecipGain(0.25, 0.0, -48, -1.0, 0);
assert.ok(Math.abs(unityGain - 1.0) < 1e-6, "Amount=0% should produce unity gain above gate");

const invQuiet = quietIn * cfg.computeRecipGain(quietIn, 1.5, -60, 0.0, 0);
const invLoud = loudIn * cfg.computeRecipGain(loudIn, 1.5, -60, 0.0, 0);
assert.ok(invQuiet > invLoud, "Amount > 100% should invert dynamics so quiet details exceed loud ones");

// Output mode checks: 0 = Soft, 1 = Hard, 2 = Lim
assert.ok(Math.abs(cfg.applyCeiling(10.0, 0.8, 0)) <= 0.80001, "Soft clip (mode 0) must stay within ceilingLin");
assert.ok(Math.abs(cfg.applyCeiling(10.0, 0.8, 1)) <= 0.80001, "Hard clip (mode 1) must clamp at ceilingLin");
assert.ok(Math.abs(cfg.applyCeiling(10.0, 0.8, 2, 10.0)) <= 0.80001, "Limiter (mode 2) must clamp at ceilingLin");
assert.ok(Math.abs(cfg.applyCeiling(0.4, 0.8, 0)) < Math.abs(cfg.applyCeiling(0.4, 0.8, 1)), "Soft clip knee must gently compress near ceiling");
assert.strictEqual(cfg.applyCeiling(0.4, 0.8, 2, 0.8), 0.4, "Limiter must stay linear below ceiling when envelope <= ceiling");

// 2. GenExpr ordering & lexer checks
const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(!gen.match(/\be\d/), "Never use e0..e9 identifiers in GenExpr (parsed as Euler's constant)");
assert.ok(!gen.includes("delay("), "GenExpr must use Delay.read / Delay.write instead of delay()");
const fnAt = gen.indexOf("onepole_lp(x, coef)");
const bufAt = gen.indexOf("\nBuffer ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const delayAt = gen.indexOf("\nDelay ");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1);");
assert.ok(fnAt >= 0 && fnAt < bufAt, "Functions must precede Buffer in GenExpr");
assert.ok(bufAt < paramAt && paramAt < histAt && histAt < delayAt, "Declarations must follow Buffer -> Param -> History -> Delay order");
assert.ok(delayAt < exprAt, "All Delay declarations must precede expressions");
assert.strictEqual((gen.match(/^Delay /gm) || []).length, 2, "Expected 2 lookahead Delay lines (lookL, lookR)");
assert.ok(gen.includes("Param outmode(0.0);") && gen.includes("Param revgate(0.0);"), "GenExpr must declare outmode and revgate Params");
assert.ok(gen.includes("isSilent") && gen.includes("recip_pow"), "GenExpr must include silence fast-path and recip_pow optimization");
assert.ok(gen.includes("fixnan(outL)") && gen.includes("fixnan(outR)"), "Outputs must be protected with fixnan()");
assert.ok(gen.includes("invCeilH = 1.0 / max(ceilLinH, 0.05)"), "Ceiling reciprocal must be cached");
assert.ok(gen.includes("hpCoefH") && gen.includes("atkCoefH") && gen.includes("gateLinH") && gen.includes("lookSampsH") && gen.includes("dryGH"), "Param coefficients must be cached in History");
assert.strictEqual((gen.match(/log10\(/g) || []).length, 1, "log10 belongs only in the telemetry write");
assert.ok(gen.indexOf("log10(") > gen.indexOf("if (tick == 0)"), "log10 must run inside the 64-sample telemetry block");
assert.ok(gen.includes("poke(scope, rollCounter, 7, 0)"), "Scope slot 7 is the frame head");
{
    const tickAt = gen.indexOf("if (tick == 0)");
    const headAt = gen.indexOf("Frame head moves every 64 samples");
    assert.ok(tickAt >= 0 && headAt > tickAt, "Frame head comment must sit in the telemetry block");
    let depth = 0;
    for (const ch of gen.slice(tickAt, headAt)) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
    }
    assert.strictEqual(depth, 1, "Frame head poke stays in the 64-sample block, not a nested silence skip");
}

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
    assert.strictEqual(byId["obj-plugin"].varname, "rcp_plugin", "plugin~ scripting name");
    assert.strictEqual(byId["obj-plugout"].varname, "rcp_plugout", "plugout~ scripting name");
    assert.ok(!byId["obj-gen"], `${amxdFile}: static gen.codebox~ must be gone (deferred gen~)`);
    assert.ok(!boxes.some((b) => b.maxclass === "gen.codebox~" || b.maxclass === "gen~"), `${amxdFile}: device must ship without a gen~`);
    assert.ok(!lines.some((l) => l.source[0] === "obj-plugin"), "plugin~ stays unconnected until the face wires the gen~");
    assert.ok(!lines.some((l) => l.destination[0] === "obj-plugout"), "plugout~ stays unconnected until the face wires the gen~");
    assert.ok(!lines.some((l) => l.source[0] === "obj-plugin" && l.destination[0] === "obj-plugout"), "No plugin~ -> plugout~ bypass");
    const hub = byId["obj-gen-in"];
    assert.ok(hub && hub.text === "gate 1 1" && hub.varname === "rcp_genin", "Missing open gate hub rcp_genin");
    assert.ok(lines.some((l) => l.destination[0] === "obj-gen-in"), "Gen hub has no incoming cords");
    for (const l of lines) {
        if (l.destination[0] === "obj-gen-in") {
            assert.strictEqual(l.destination[1], 1, "Every gen-bound cord must use the hub's data inlet");
        }
    }
    assert.strictEqual(byId["obj-msg-gen-buf"].text, "scope #0-recipscope", `${amxdFile}: Buffer bind message mismatch`);
    assert.strictEqual(byId["obj-msg-gen-buf"].varname, "rcp_scopebind", "Scope bind message needs a scripting name");
    assert.ok(hasLine("obj-loadbang", "obj-msg-gen-buf") && hasLine("obj-msg-gen-buf", "obj-gen-in"), "Missing loadbang -> scope #0-recipscope -> gen hub");
    assert.ok(hasLine("obj-loadbang", "obj-msg-ui-buf") && hasLine("obj-msg-ui-buf", "obj-viz"), "Missing loadbang -> setbuffer #0-recipscope -> viz wiring");
    assert.strictEqual(byId["obj-thisdevice"].text, "live.thisdevice", "Missing live.thisdevice");
    assert.strictEqual(byId["obj-msg-ui-dsp"].text, "init_dsp", "Missing init_dsp message");
    assert.ok(hasLine("obj-thisdevice", "obj-msg-ui-dsp") && hasLine("obj-msg-ui-dsp", "obj-viz"), "live.thisdevice must bang init_dsp into the face");

    // Verify 3-stage signal flow headers
    assert.strictEqual(byId["obj-hdr-det"].text, "1. DETECT", "Missing 1. DETECT stage header");
    assert.strictEqual(byId["obj-hdr-rec"].text, "2. 1 / ENV", "Missing 2. 1 / ENV stage header");
    assert.strictEqual(byId["obj-hdr-out"].text, "3. OUTPUT", "Missing 3. OUTPUT stage header");

    for (const b of boxes) {
        if (b.text && b.text.startsWith("buffer~")) {
            assert.ok(b.text.includes("#0-"), `${amxdFile}: buffer~ must use #0- prefix: ${b.text}`);
        }
    }

    // Verify all 10 dials/numboxes & their patchline chains into obj-gen
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
        assert.ok(hasLine(prep.id, "obj-gen-in"), `${amxdFile}: ${prep.id} not wired to the gen hub`);
        if (isPct) {
            const scale = byId[`obj-scale-${key}`];
            assert.ok(scale && scale.text === "/ 100.", `${amxdFile}: Percent param ${key} must scale by / 100.`);
            assert.ok(hasLine(ctrl.id, scale.id) && hasLine(scale.id, prep.id), `${amxdFile}: Broken scale chain for ${key}`);
        } else {
            assert.ok(hasLine(ctrl.id, prep.id), `${amxdFile}: ${ctrl.id} not wired to ${prep.id}`);
        }
    }

    // Verify Reverse Gate button (`obj-revgate`) and Output Mode selection box (`obj-outmode`) above Ceiling
    const revBtn = byId["obj-revgate"];
    assert.ok(revBtn && revBtn.maxclass === "live.text" && revBtn.varname === "Reverse Gate", "Missing Reverse Gate button");
    assert.ok(hasLine("obj-revgate", "obj-prep-revgate") && hasLine("obj-prep-revgate", "obj-gen-in"), "Reverse Gate not wired to gen hub");
    assert.ok(hasLine("obj-revgate", "obj-ui-revgate") && hasLine("obj-ui-revgate", "obj-viz"), "Reverse Gate not wired to viz");

    const outMenu = byId["obj-outmode"];
    const ceilDial = byId["obj-ctrl-ceiling"];
    assert.ok(outMenu && outMenu.maxclass === "live.menu" && outMenu.varname === "Output Mode", "Missing Output Mode selection box (live.menu)");
    assert.deepStrictEqual(
        outMenu.saved_attribute_attributes.valueof.parameter_enum,
        ["Soft Clip", "Hard Clip", "Limiter"],
        "Output Mode selection box must offer Soft Clip, Hard Clip, and Limiter"
    );
    assert.ok(
        outMenu.presentation_rect[1] + outMenu.presentation_rect[3] <= ceilDial.presentation_rect[1],
        "Output Mode selection box must be positioned directly above the Ceiling dial"
    );
    assert.ok(hasLine("obj-outmode", "obj-prep-outmode") && hasLine("obj-prep-outmode", "obj-gen-in"), "Output Mode not wired to gen hub");
    assert.ok(hasLine("obj-outmode", "obj-ui-outmode") && hasLine("obj-ui-outmode", "obj-viz"), "Output Mode not wired to viz");

    // Verify bidirectional scope drag routing (obj-viz -> route gate ceiling -> gen & controls)
    assert.ok(hasLine("obj-viz", "obj-route-viz"), "obj-viz outlet not wired to obj-route-viz");
    assert.ok(hasLine("obj-route-viz", "obj-prep-gate") && hasLine("obj-route-viz", "obj-set-gate"), "Gate drag route missing");
    assert.ok(hasLine("obj-route-viz", "obj-prep-ceiling") && hasLine("obj-route-viz", "obj-set-ceil"), "Ceiling drag route missing");

    const viz = byId["obj-viz"];
    assert.strictEqual(viz.maxclass, "v8ui");
    const vr = viz.presentation_rect;
    const embedded = viz.textfile.text.match(/var GEN_DSP_TEXT = (".*");\nvar GEN_DSP_HASH = "([0-9a-f]{12})";/);
    assert.ok(embedded, "The face script must embed GEN_DSP_TEXT / GEN_DSP_HASH");
    const gendspText = JSON.parse(embedded[1]);
    assert.strictEqual(embedded[2], crypto.createHash("sha1").update(gendspText).digest("hex").slice(0, 12), "GEN_DSP_HASH must match the .gendsp text");
    const gendsp = JSON.parse(gendspText);
    const gBoxes = Object.fromEntries(gendsp.patcher.boxes.map((b) => [b.box.id, b.box]));
    assert.strictEqual(gBoxes["obj-in1"].text, "in 1");
    assert.strictEqual(gBoxes["obj-in2"].text, "in 2");
    assert.strictEqual(gBoxes["obj-out1"].text, "out 1");
    assert.strictEqual(gBoxes["obj-out2"].text, "out 2");
    assert.strictEqual(gBoxes["obj-code"].code, gen, "GEN_DSP_TEXT codebox must carry reciprocator_core.genexpr");
    assert.ok(viz.textfile.text.includes('Global("reciprocator_dspq")'), "DSP create queue");
    assert.ok(viz.textfile.text.includes("/tmp/reciprocator_core_"), "Deferred gen file path");
    assert.ok(viz.textfile.text.includes('g.varname = "rcp_gen"'), "Created gen~ scripting name");
    assert.ok(viz.textfile.text.includes("DSP loading..."), "Loading pill copy");
    assert.ok(viz.textfile.text.includes("DSP failed:"), "Failure pill copy");
    assert.ok(viz.textfile.text.includes("function init_dsp"), "init_dsp handler");

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
    let fullPeeks = 0;
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
            this.peek = (_ch, start, count) => {
                const n = count || scopeSamples.length;
                const from = start || 0;
                if (n > 1) fullPeeks++;
                return scopeSamples.slice(from, from + n);
            };
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
        viz.textfile.text + "\nreturn { loadbang, setbuffer, set_gate, set_ceiling, set_amount, set_outmode, set_revgate, onclick, ondrag, pullScope, paint, histOut };"
    );
    const ui = fn(sandbox.mgraphics, sandbox.Buffer, sandbox.Task, sandbox.outlet);
    assert.strictEqual(sandbox.mgraphics.relative_coords, 0, `${amxdFile}: v8ui must disable relative_coords`);
    assert.strictEqual(sandbox.mgraphics.autofill, 0, `${amxdFile}: v8ui must disable autofill`);
    ui.setbuffer("1001-recipscope");
    ui.loadbang();
    ui.set_gate(-36);
    ui.set_ceiling(-3);
    ui.set_amount(120);
    ui.set_outmode(2);
    ui.set_revgate(1);
    ui.pullScope();
    ui.paint();
    assert.ok(ui.histOut[ui.histOut.length - 1] > 0.5, `${amxdFile}: pullScope must push live output peaks`);
    assert.ok(drawOps.some((op) => op.startsWith("text:REV ")), "Reverse Gate mode should show REV label in HUD");

    // Drag Gate bar (lower region of scope)
    ui.onclick(40, 110);
    ui.ondrag(40, 100);
    assert.ok(emitted.some((m) => m[0] === "gate" && m[1] <= -6 && m[1] >= -72), "Dragging lower scope must emit gate dB");

    // Drag Ceiling bar (upper region of scope)
    ui.onclick(40, 22);
    ui.ondrag(40, 28);
    assert.ok(emitted.some((m) => m[0] === "ceiling" && m[1] <= 0 && m[1] >= -18), "Dragging upper scope must emit ceiling dB");

    // Verify idle-redraw suppression when audio is silent. A frozen frame head
    // skips the 8-sample read; a moving head of real silence still settles.
    scopeSamples = [0, 0, 0, 0.25, 0, 0.008, 0.89, 55];
    const peeksAtSilence = fullPeeks;
    for (let k = 0; k < 130; k++) {
        ui.pullScope();
    }
    assert.strictEqual(ui.pullScope(), false, "pullScope() must return false and skip redraw once the frame head is frozen");
    assert.ok(fullPeeks - peeksAtSilence <= 2, "A frozen frame head must skip full scope reads");
    scopeSamples = [0.3, 0.25, 1.0, 0.6, 0.8, 0.008, 0.89, 56];
    assert.strictEqual(ui.pullScope(), true, "pullScope() must immediately resume redrawing when audio arrives");
    assert.ok(!drawOps.some((op) => op.startsWith("text:DSP ")), "Static paint must not draw the DSP pill");
}

{
    // GenExpr runs the code after a `return` nested in an `if` / loop block (and the last return wins), so every
    // return must sit at function level. A nested return once broke Freeze / the silence sleep / Soft and Hard Clip.
    let depth = 0, fn = "", nested = [];
    for (const line of gen.split("\n")) {
        if (/^[a-z_]+\(.*\) \{$/.test(line)) { fn = line; depth = 0; }
        depth += (line.match(/\{/g) || []).length;
        depth -= (line.match(/\}/g) || []).length;
        if (/\breturn\b/.test(line) && !/^\s*\/\//.test(line) && depth > 1) nested.push(fn.split("(")[0] + ": " + line.trim());
    }
    assert.strictEqual(nested.length, 0, `No return inside a block in GenExpr functions (${nested.join("; ")})`);
}

verifyAmxd("Reciprocator.amxd", 448.0);

console.log("test_reciprocator: ok");
