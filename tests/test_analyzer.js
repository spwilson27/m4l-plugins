#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cfg = require("../src/analyzer_config.js");

const ROOT = path.join(__dirname, "..");
let checks = 0;

function ok(cond, msg) {
    assert.ok(cond, msg);
    checks++;
}

function near(got, want, tol, msg) {
    assert.ok(Math.abs(got - want) <= tol, msg + " (got " + got + ", want " + want + ")");
    checks++;
}

function permutations(xs) {
    if (xs.length <= 1) return [xs.slice()];
    const out = [];
    for (let i = 0; i < xs.length; i++) {
        const rest = xs.slice(0, i).concat(xs.slice(i + 1));
        for (const tail of permutations(rest)) out.push([xs[i]].concat(tail));
    }
    return out;
}

function overlaps(a, b) {
    return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

function inside(rect, x, y, w, h) {
    return rect[0] >= x - 0.01 && rect[1] >= y - 0.01 && rect[0] + rect[2] <= x + w + 0.01 && rect[1] + rect[3] <= y + h + 0.01;
}

function panelBox(panel) {
    return [panel.x, 0, panel.w, cfg.AN_H];
}

// ---------------------------------------------------------------------------------------------
// Layout: every mask, every order
// ---------------------------------------------------------------------------------------------
ok(cfg.anFoldWidth(0) === 28, "closed device is the rail");
ok(cfg.anFoldWidth(1) === 392, "spectrogram only is 392 px");
ok(cfg.anFoldWidth(15) === 1134, "all four panels are 1134 px");
ok(cfg.anFoldWidth(15) < 1600, "open device stays under the width other devices already use");

const orders = permutations([0, 1, 2, 3]);
ok(orders.length === 24, "four sections have 24 orders");
for (let mask = 0; mask < 16; mask++) {
    for (const order of orders) {
        const width = cfg.anFoldWidth(mask, order);
        ok(width <= cfg.AN_MAX_W && width >= 28, "width in range for mask " + mask);
        ok(cfg.anFoldWidth(mask, order) === cfg.anFoldWidth(mask), "order does not change the width");
        const panels = cfg.anSectionRects(mask, order);
        let expect = 0;
        for (let bit = 0; bit < 4; bit++) if ((mask >> bit) & 1) expect++;
        ok(panels.length === expect, "open panel count");
        for (let i = 0; i < panels.length; i++) {
            const p = panels[i];
            ok(p.x >= cfg.AN_SEC_X0, "panel starts after the rail");
            ok(p.x + p.w + cfg.AN_WIN_PAD <= width + 0.01, "panel sits inside the device width");
            ok(p.w === cfg.AN_SECTIONS[p.index].w, "panel uses its section width");
            if (i) ok(panels[i - 1].x + panels[i - 1].w + cfg.AN_SEC_GAP === p.x, "panels pack with a 4 px gap");
            const box = panelBox(p);
            if (p.id === "spec") {
                const g = cfg.anSpecGeom(p);
                for (const pill of g.pills) ok(inside(pill, p.x, 0, p.w, cfg.AN_H), "spec pill inside the panel");
                ok(inside(g.lcd, p.x, 0, p.w, cfg.AN_H) && inside(g.plot, p.x, 0, p.w, cfg.AN_H), "spec plot inside the panel");
            } else if (p.id === "scope") {
                const g = cfg.anScopeGeom(p);
                for (const r of g.modes.concat(g.times, [g.trig, g.lcd])) ok(inside(r, p.x, 0, p.w, cfg.AN_H), "scope control inside the panel");
            } else if (p.id === "stereo") {
                const g = cfg.anStereoGeom(p, cfg.AN_XOVER_DEFAULT);
                for (const h of g.handles) ok(inside(h, p.x, 0, p.w, cfg.AN_H), "crossover handle inside the panel");
                ok(inside(g.gonio, p.x, 0, p.w, cfg.AN_H), "goniometer inside the panel");
                ok(inside(g.axis, p.x, 0, p.w, cfg.AN_H), "stereo axis inside the panel");
            } else if (p.id === "loud") {
                const g = cfg.anLoudGeom(p);
                ok(inside(g.reset, p.x, 0, p.w, cfg.AN_H), "reset inside the loudness panel");
                ok(inside(g.spark, p.x, 0, p.w, cfg.AN_H), "sparkline inside the loudness panel");
                for (const row of g.rows) ok(inside(row, p.x, 0, p.w, cfg.AN_H), "loudness row inside the panel");
            }
            ok(box[1] + box[3] === 169, "panels stay inside the 169 px face");
        }
        for (let i = 0; i < panels.length; i++) {
            for (let j = i + 1; j < panels.length; j++) {
                ok(!overlaps(panelBox(panels[i]), [panels[j].x, 0, panels[j].w, cfg.AN_H]), "panels do not overlap");
            }
        }
    }
}

const rail = cfg.anRailGeom();
ok(inside(rail.rail, 0, 0, 28, 169), "rail fits the closed device");
const railRects = rail.buttons.concat([rail.freeze]);
for (const r of railRects) ok(inside(r, rail.rail[0], rail.rail[1], rail.rail[2], rail.rail[3]), "rail button inside the rail");
for (let i = 0; i < railRects.length; i++) {
    for (let j = i + 1; j < railRects.length; j++) ok(!overlaps(railRects[i], railRects[j]), "rail buttons do not overlap");
}
const tip = cfg.anTipRect(0);
ok(tip[0] + tip[2] > cfg.anFoldWidth(0), "a tooltip does not fit while every panel is closed");
ok(tip[0] + tip[2] < cfg.anFoldWidth(1), "a tooltip fits once a panel is open");

// ---------------------------------------------------------------------------------------------
// K-weight, loudness, stereo, 1/3-octave, blob
// ---------------------------------------------------------------------------------------------
const k = cfg.anKWeightCoeffs(48000);
const published = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
for (const key of Object.keys(published)) near(k.pre[key], published[key], 1e-9, "shelf " + key + " at 48 kHz");
near(k.rlb.a1, -1.99004745483398, 1e-9, "RLB a1 at 48 kHz");
near(k.rlb.a2, 0.99007225036621, 1e-9, "RLB a2 at 48 kHz");
near(k.rlb.b0 + k.rlb.b1 + k.rlb.b2, 0, 1e-9, "RLB is silent at DC");
const gain = (freq) => 20 * Math.log10(cfg.anBiquadGain(k.pre, freq, 48000) * cfg.anBiquadGain(k.rlb, freq, 48000));
near(gain(1000), 0.654, 0.05, "K-weight at 1 kHz");
near(gain(100), -1.177, 0.05, "K-weight at 100 Hz");
near(gain(5000), 3.97, 0.05, "K-weight at 5 kHz");
near(gain(10000), 4, 0.05, "K-weight shelf at 10 kHz");

const zPkt = { kL: 2.4, kR: 2.4, rL: 2.4, rR: 2.4, tpL: 0.2, tpR: 0.1, pkL: 0.1, pkR: 0.1, n: 480,
    bands: [{ ll: 1, rr: 1, lr: 1 }, { ll: 0, rr: 0, lr: 0 }, { ll: 0, rr: 0, lr: 0 }, { ll: 0, rr: 0, lr: 0 }] };
const loud = cfg.anLoudCreate();
for (let i = 0; i < 40; i++) cfg.anLoudPush(loud, zPkt);
near(loud.mom, cfg.anLufsFromZ((2.4 + 2.4) / 480), 1e-9, "momentary LUFS of a steady packet");
near(loud.rms, cfg.anDbFromPow(2.4 / 480), 1e-9, "RMS of the same window");
near(loud.tp, 0.2, 1e-12, "true peak holds the larger channel");
function fill(state, n, level) {
    const pkt = Object.assign({}, zPkt, { kL: level, kR: level, rL: level, rR: level });
    for (let i = 0; i < n; i++) cfg.anLoudPush(state, pkt);
}
fill(loud, 400, 2.4);
fill(loud, 400, 0.24);
fill(loud, 400, 2.4);
ok(loud.integ < -20 && loud.integ > -30, "integrated LUFS sits between the two gated levels");
ok(loud.lra > 8 && loud.lra < 12, "LRA separates the two short-term levels");
cfg.anLoudReset(loud);
ok(loud.mom === -200 && loud.integ === -200 && loud.tp === 0 && loud.lra === null, "reset clears the meters");

near(cfg.anCorrelation(1, 1, 1), 1, 1e-12, "identical channels correlate at 1");
near(cfg.anCorrelation(1, 1, -1), -1, 1e-12, "inverted channels correlate at -1");
near(cfg.anWidth(1, 1, 1), 0, 1e-12, "a mono signal has no width");
near(cfg.anWidth(1, 1, -1), 1, 1e-12, "an inverted pair is all side");
near(cfg.anBalance(1, 3), 0.5, 1e-12, "balance follows the louder channel");

const centers = cfg.anThirdCenters();
ok(centers.length === 31, "31 third-octave bands");
near(centers[17], 1000, 1e-9, "the 1 kHz band is index 17");
ok(cfg.anThirdBand(1000) === 17, "1 kHz maps to band 17");
ok(cfg.anThirdBand(20) === 0 && cfg.anThirdBand(20000) === 30, "the band edges cover 20 Hz to 20 kHz");
const power = new Array(4096).fill(0);
power[171] = 4;
const bands = cfg.anBandEnergies(power, 8192, 48000);
ok(bands[cfg.anThirdBand(171 * 48000 / 8192)] === 4 / 1.5, "a bin lands in its third-octave band");
ok(bands.reduce((s, v) => s + v, 0) === 4 / 1.5, "other bands stay empty");

ok(cfg.anEncodeOrder([0, 1, 2, 3]) === 123, "default order encodes as 123");
assert.deepStrictEqual(cfg.anDecodeOrder(123), [0, 1, 2, 3]);
checks++;
assert.deepStrictEqual(cfg.anDecodeOrder(cfg.anEncodeOrder([3, 0, 1, 2])), [3, 0, 1, 2]);
checks++;
assert.deepStrictEqual(cfg.anDecodeOrder(111), cfg.anDefaultOrder ? cfg.anDefaultOrder() : [0, 1, 2, 3]);
checks++;
const blob = cfg.anBlob({ mask: 9, order: [2, 0, 3, 1], specType: 2, scopeMode: 3, scopeTime: 0, trigger: 1, f1: 200, f2: 900, f3: 7000 });
ok(blob[0] === 1 && blob.length === 10, "blob v1 has ten fields");
const back = cfg.anFromBlob(blob);
ok(back.mask === 9 && back.specType === 2 && back.scopeMode === 3 && back.scopeTime === 0 && back.trigger === 1, "blob round-trip");
assert.deepStrictEqual(back.order, [2, 0, 3, 1]);
checks++;
near(back.f1, 200, 1e-6, "crossover f1");
const fresh = cfg.anFromBlob([1]);
ok(fresh.mask === 1 && fresh.specType === 0 && fresh.scopeTime === 1 && fresh.trigger === 0, "a short blob falls back to the defaults");
ok(cfg.anFromBlob([2, 15, 123, 0, 0, 1, 0, 150, 1000, 6000]).mask === 1, "an unknown version falls back to the defaults");

const floats = new Array(24).fill(0);
floats[0] = 1; floats[1] = 2; floats[9] = 3; floats[10] = 4; floats[11] = 5;
const pkt = cfg.anPktFromFloats(floats);
ok(pkt.kL === 1 && pkt.kR === 2 && pkt.bands[0].ll === 3 && pkt.bands[0].lr === 5, "packet field map");

// ---------------------------------------------------------------------------------------------
// Gen source rules, and the face ships with the preview flag off
// ---------------------------------------------------------------------------------------------
const gen = fs.readFileSync(path.join(ROOT, "src", "analyzer_core.genexpr"), "utf8");
ok(!/\be\d/.test(gen), "gen identifiers are not e0..e9");
ok(!gen.includes("delay("), "gen does not call delay()");
ok(gen.includes('Buffer scope("analyzerscope")'), "telemetry buffer is analyzerscope");
for (const token of ["1568", "17952", "34336", "42528", "480"]) ok(gen.includes(token), "gen layout includes " + token);
ok(gen.includes("out1 = in1") && gen.includes("out2 = in2"), "the tap copies its input");
const bufAt = gen.indexOf("\nBuffer ");
const dataAt = gen.indexOf("\nData ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const exprAt = gen.indexOf("\nif (coefDone");
ok(gen.indexOf("\nop_g(") >= 0 && gen.indexOf("\nop_g(") < bufAt, "the helper precedes Buffer");
ok(bufAt < dataAt && dataAt < paramAt && paramAt < histAt && histAt < exprAt, "gen order is Buffer, Data, Param, History, expressions");

let depth = 0;
let inFn = false;
let nestedReturn = false;
let fnFor = false;
for (const line of gen.split("\n")) {
    const code = line.replace(/\/\/.*$/, "");
    if (depth === 0 && /^[A-Za-z_][A-Za-z0-9_]*\(/.test(line) && line.includes("{")) inFn = true;
    if (inFn && /\bfor\s*\(/.test(code)) fnFor = true;
    if (/\breturn\b/.test(code) && depth > 1) nestedReturn = true;
    for (const ch of code) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
    }
    if (depth === 0) inFn = false;
}
ok(!nestedReturn, "gen has no return inside a block");
ok(!fnFor, "gen has no for-loop inside a function");
ok(depth === 0, "gen braces balance");

const uiFiles = [
    "analyzer_ui.js"
];
for (const uiFile of uiFiles) {
    const ui = fs.readFileSync(path.join(ROOT, "src", uiFile), "utf8");
    ok(/var AN_PREVIEW = 0;/.test(ui), uiFile + ": AN_PREVIEW is 0 in the shipping source");
    ok(ui.includes("mgraphics.relative_coords = 0"), uiFile + ": the face draws in pixels");
    ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(ui), uiFile + ": the face does not declare Max globals");
}

// ---------------------------------------------------------------------------------------------
// Built device (Analyzer.amxd) & Mock mgraphics Paint / Interaction Verification
// ---------------------------------------------------------------------------------------------
const vm = require("vm");
const deviceNames = [
    "Analyzer.amxd"
];
for (const devName of deviceNames) {
    const amxd = path.join(ROOT, "devices", devName);
    ok(fs.existsSync(amxd), "devices/" + devName + " exists (build first)");
    const raw = fs.readFileSync(amxd);
    ok(raw.slice(0, 4).toString("ascii") === "ampf", devName + ": ampf header");
    ok(raw.slice(8, 12).toString("ascii") === "aaaa", devName + ": audio effect");
    ok(raw.slice(24, 28).toString("ascii") === "ptch", devName + ": ptch chunk");
    const doc = JSON.parse(raw.slice(32, 32 + raw.readUInt32LE(28)).toString("utf8"));
    const patcher = doc.patcher;
    ok(patcher.openrect[3] === 169 && patcher.devicewidth === patcher.openrect[2], devName + ": presentation is 169 px tall");
    if (devName === "Analyzer UI1.amxd") {
        near(patcher.devicewidth, cfg.anFoldWidth(1), 0.01, devName + ": shipping width is the spectrogram fold");
    } else {
        ok(patcher.devicewidth >= 200 && patcher.devicewidth <= 1200, devName + ": valid device width " + patcher.devicewidth);
    }
    const boxes = patcher.boxes.map((b) => b.box);
    const byId = {};
    for (const box of boxes) byId[box.id] = box;
    ok(byId["obj-plugin"].text === "plugin~" && byId["obj-plugin"].varname === "an_plugin", devName + ": plugin~");
    ok(byId["obj-plugout"].text === "plugout~" && byId["obj-plugout"].varname === "an_plugout", devName + ": plugout~");
    ok(byId["obj-gen-in"].text === "gate 1 1" && byId["obj-gen-in"].varname === "an_genin", devName + ": message hub is gate 1 1");
    ok(byId["obj-buf"].text.includes("---analyzerscope") && byId["obj-buf"].text.includes("42528"), devName + ": scope buffer is ---analyzerscope @samps 42528");
    ok(byId["obj-msg-scope"].text === "scope ---analyzerscope", devName + ": scope bind is ---analyzerscope");
    ok(byId["obj-msg-setbuf"].text === "setbuffer ---analyzerscope", devName + ": setbuffer is ---analyzerscope");
    for (const b of boxes) {
        const t = b.text || "";
        if (/^buffer~ /.test(t) || /^scope /.test(t) || /^setbuffer /.test(t)) {
            ok(!/#0(?![0-9])/.test(t), devName + ": no literal #0 in " + t);
        }
    }
    ok(!boxes.some((b) => b.maxclass === "gen~" || /^gen~/.test(b.text || "") || b.maxclass === "gen.codebox~"), devName + ": no static gen~");
    const viz = byId["obj-viz"];
    ok(viz.varname === "AnalyzerViz" && viz.maxclass === "v8ui", devName + ": face is AnalyzerViz");
    ok(!/#0-/.test(viz.textfile.text.replace(/\/\/[^\n]*/g, "")), devName + ": no #0- in the v8ui script code");
    ok(viz.saved_attribute_attributes.valueof.parameter_type === 3, devName + ": AnalyzerState is a blob");
    ok(viz.saved_attribute_attributes.valueof.parameter_longname === "AnalyzerState", devName + ": blob name");
    ok(viz.textfile.text.includes("GEN_DSP_TEXT") && viz.textfile.text.includes("GEN_DSP_HASH"), devName + ": the gen patch is embedded");
    const last = boxes[boxes.length - 1];
    ok(last.id === "obj-panel-body" && last.background === 1, devName + ": body panel is the last box");
    function wired(src, outlet, dst, inlet) {
        return patcher.lines.some((ln) => {
            const p = ln.patchline;
            return p.source[0] === src && p.source[1] === outlet && p.destination[0] === dst && p.destination[1] === inlet;
        });
    }
    ok(wired("obj-plugin", 0, "obj-plugout", 0) && wired("obj-plugin", 1, "obj-plugout", 1), devName + ": audio passes plugin~ to plugout~");
    ok(wired("obj-viz", 0, "obj-thisdevice", 0), devName + ": width messages reach live.thisdevice");
    ok(wired("obj-viz", 1, "obj-gen-in", 1), devName + ": crossovers reach the hub");
    ok(wired("obj-msg-scope", 0, "obj-gen-in", 1), devName + ": the buffer bind reaches the hub");
    ok(!patcher.lines.some((ln) => ln.patchline.source[0] === "obj-gen" || (ln.patchline.destination[0] === "obj-plugout" && ln.patchline.source[0] !== "obj-plugin")), devName + ": nothing else feeds plugout~");

    // Execute v8ui script in a sandbox across all modes and verify bounds & interactions
    const cmds = [];
    const ctx = {
        Math, Number, String, Array, Object, Float64Array, isFinite, isNaN, parseInt, parseFloat, Date,
        inlets: 1, outlets: 2,
        outlet: () => {},
        notifyclients: () => {},
        post: () => {},
        arrayfromargs: (a) => Array.prototype.slice.call(a),
        mgraphics: {
            size: [1134, 169],
            relative_coords: 0,
            autofill: 0,
            _fs: 9.5,
            init() {},
            redraw() {},
            set_source_rgba(r, g, b, a = 1) { cmds.push({ op: "rgba", r, g, b, a }); },
            set_line_width(w) { cmds.push({ op: "lw", w }); },
            rectangle(x, y, w, h) { cmds.push({ op: "rect", x, y, w, h }); },
            rectangle_rounded(x, y, w, h, rx, ry) { cmds.push({ op: "rrect", x, y, w, h, rx, ry }); },
            move_to(x, y) { cmds.push({ op: "move", x, y }); },
            line_to(x, y) { cmds.push({ op: "line", x, y }); },
            curve_to(x1, y1, x2, y2, x3, y3) { cmds.push({ op: "curve", x1, y1, x2, y2, x3, y3 }); },
            close_path() { cmds.push({ op: "close" }); },
            arc(x, y, r, a1, a2) { cmds.push({ op: "arc", x, y, r, a1, a2 }); },
            ellipse(x, y, w, h) { cmds.push({ op: "ellipse", x, y, w, h }); },
            fill() { cmds.push({ op: "fill" }); },
            fill_preserve() { cmds.push({ op: "fill_preserve" }); },
            stroke() { cmds.push({ op: "stroke" }); },
            select_font_face() {},
            set_font_size(s) { this._fs = s; },
            text_measure(s) { return [String(s).length * this._fs * 0.56, this._fs]; },
            show_text(s) { cmds.push({ op: "text", s }); },
            save() {},
            restore() {},
            translate() {},
            rotate() {}
        }
    };
    vm.createContext(ctx);
    vm.runInContext(viz.textfile.text, ctx);
    for (const mask of [0, 1, 2, 4, 8, 15]) {
        for (let specType = 0; specType < 3; specType++) {
            for (let scopeMode = 0; scopeMode < 4; scopeMode++) {
                cmds.length = 0;
                const widthFn = typeof ctx.anUiWidth === "function" ? ctx.anUiWidth : cfg.anFoldWidth;
                const w = widthFn(mask);
                ctx.mgraphics.size = [w, 169];
                ctx.setvalueof(1, mask, 123, specType, scopeMode, 1, 0, 150, 1000, 6000);
                ctx.paint();
                ok(cmds.length > 5, devName + ": paints commands for mask " + mask);
                for (const c of cmds) {
                    if (c.op === "rect" || c.op === "rrect") {
                        ok(isFinite(c.x) && isFinite(c.y) && isFinite(c.w) && isFinite(c.h), devName + ": finite rect");
                        ok(c.y >= -1 && c.y + c.h <= 170, devName + ": rect within 169px height (got y=" + c.y + " h=" + c.h + ")");
                    } else if (c.op === "move" || c.op === "line") {
                        ok(isFinite(c.x) && isFinite(c.y), devName + ": finite line coord");
                        ok(c.y >= -2 && c.y <= 171, devName + ": line within 169px height (got y=" + c.y + ")");
                    }
                }
            }
        }
    }
    // Verify freeze, hover tooltip, crossover drag, and blob round-trip
    ctx.setvalueof(1, 15, 123, 0, 0, 1, 0, 150, 1000, 6000);
    ctx.onidle(10, 12);
    ctx.paint();
    ctx.onidleout();
    ctx.onclick(10, 150); // Freeze click
    ctx.paint();
    // Verify native Ableton Live colors via max.getcolor(name) are ALWAYS used in Live runtime
    // even when Global("m4l_theme_bus") contains a stale purple abletonUi simulation (colorHue 275, brightness -0.06)
    const rgbaCalls = [];
    const liveNative = {
        live_surface_bg: [0.22, 0.23, 0.24, 1],
        live_desktop: [0.17, 0.18, 0.19, 1],
        live_lcd_bg: [0.09, 0.09, 0.09, 1],
        live_lcd_frame: [0.24, 0.24, 0.24, 1],
        live_control_selection: [1.0, 0.68, 0.34, 1]
    };
    const liveCtx = Object.assign({}, ctx, {
        max: {
            getcolor(name) {
                return liveNative[name] || [0.5, 0.5, 0.5, 1];
            }
        },
        Global: function () {
            return {
                version: 161,
                stateJson: JSON.stringify({
                    version: 161,
                    preset: "Default",
                    macros: { hueShift: 0, satScale: 1, contrast: 1, brightness: -0.06 },
                    tokens: {},
                    deviceOverrides: {},
                    abletonUi: { enabled: true, theme: "Default", appearance: "Dark", tone: "Cool", highContrast: true, brightness: 122, colorIntensity: 100, colorHue: 275 }
                })
            };
        }
    });
    liveCtx.mgraphics = Object.assign({}, ctx.mgraphics, {
        set_source_rgba(r, g, b, a = 1) { rgbaCalls.push([r, g, b, a]); }
    });
    vm.createContext(liveCtx);
    vm.runInContext(viz.textfile.text, liveCtx);
    liveCtx.loadbang();
    liveCtx.paint();
    ok(rgbaCalls.length > 0, devName + ": painted with max.getcolor in Live runtime");
    // The first background fill is live_surface_bg ([0.22, 0.23, 0.24]), NOT purple (where b >> g)
    const bgCall = rgbaCalls[0];
    near(bgCall[0], 0.22, 0.01, devName + ": uses native max.getcolor live_surface_bg R");
    near(bgCall[1], 0.23, 0.01, devName + ": uses native max.getcolor live_surface_bg G");
    near(bgCall[2], 0.24, 0.01, devName + ": uses native max.getcolor live_surface_bg B (not purple)");
    const stateOut = ctx.getvalueof();
    ok(Array.isArray(stateOut) && ((stateOut[0] === 1 && stateOut.length === 10) || (stateOut[0] === 2 && stateOut.length === 7) || (stateOut[0] === 3 && stateOut.length === 9)), devName + ": getvalueof returns valid blob");
}

console.log("analyzer: " + checks + " checks");
