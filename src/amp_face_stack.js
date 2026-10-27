// Amp face "Stack": a classic amp head. Black tolex, a power-tube window whose four tubes glow with
// the output level and the model's saturation, a brass nameplate with the channel switch (the Model
// parameter) and LOAD, and a gold faceplate with chicken-head knobs and a jewel pilot lamp. Every
// control is drawn here and sets its parameter through ampSet() (the live.* objects are off the face).

var STK = {
    W: 560, H: 169,
    knobs: [
        { key: "input", label: "INPUT" }, { key: "gate", label: "GATE" }, { key: "bass", label: "BASS" },
        { key: "mid", label: "MIDDLE" }, { key: "treble", label: "TREBLE" }, { key: "presence", label: "PRESENCE" },
        { key: "output", label: "MASTER" }, { key: "mix", label: "BLEND" }
    ],
    plateY: 66, knobY: 116, knobR: 13, knobX0: 34, knobDX: 50,
    drag: null, hover: "", glow: [0, 0, 0, 0], jewel: 0, flick: 0
};

function stkKnobX(i) { return STK.knobX0 + i * STK.knobDX; }

/** @param {string} key */
function stkNorm(key) {
    var s = AMP_PARAMS[key];
    return (ampP[key] - s[2]) / (s[3] - s[2]);
}

function stkRgb(r, g, b, a) { mgraphics.set_source_rgba(r, g, b, a == null ? 1 : a); }

function stkText(t, x, y, size, align) {
    mgraphics.set_font_size(size);
    var w = mgraphics.text_measure(t)[0];
    mgraphics.move_to(align === 1 ? x - w / 2 : (align === 2 ? x - w : x), y);
    mgraphics.show_text(t);
}

function stkPoly(pts) {
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.close_path();
}

function stkCircle(x, y, r) { mgraphics.ellipse(x - r, y - r, 2 * r, 2 * r); }

function stkTolex() {
    stkRgb(0.07, 0.065, 0.06);
    mgraphics.rectangle(0, 0, STK.W, STK.H);
    mgraphics.fill();
    // tolex grain
    for (var y = 3; y < STK.H; y += 3) {
        stkRgb(1, 1, 1, (y % 6 === 0) ? 0.018 : 0.03);
        mgraphics.move_to(0, y);
        mgraphics.line_to(STK.W, y + ((y * 7) % 5) - 2);
        mgraphics.set_line_width(0.6);
        mgraphics.stroke();
    }
    // piping
    stkRgb(0.78, 0.66, 0.38, 0.75);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(3.5, 3.5, STK.W - 7, STK.H - 7);
    mgraphics.stroke();
}

function stkTubes() {
    var x0 = 14, y0 = 9, w = 236, h = 50;
    stkRgb(0.02, 0.02, 0.025);
    mgraphics.rectangle_rounded(x0, y0, w, h, 4, 4);
    mgraphics.fill();
    var lvl = Math.min(1, ampTel.out_rms * 4 + ampTel.sat * 0.6);
    for (var i = 0; i < 4; i++) {
        var cx = x0 + 34 + i * 56, cy = y0 + 28;
        var target = 0.18 + lvl * (0.7 + 0.3 * Math.sin(i * 2.1 + STK.flick));
        STK.glow[i] += (target - STK.glow[i]) * 0.35;
        var g = STK.glow[i];
        // glow halo
        for (var k = 4; k >= 1; k--) {
            stkRgb(1.0, 0.45 + 0.1 * g, 0.12, 0.05 * g * k);
            stkCircle(cx, cy + 4, 8 + k * 4 * g);
            mgraphics.fill();
        }
        // glass envelope
        stkRgb(0.6, 0.65, 0.7, 0.18);
        mgraphics.rectangle_rounded(cx - 11, cy - 22, 22, 42, 9, 9);
        mgraphics.fill();
        stkRgb(0.85, 0.9, 0.95, 0.35);
        mgraphics.set_line_width(1);
        mgraphics.rectangle_rounded(cx - 11, cy - 22, 22, 42, 9, 9);
        mgraphics.stroke();
        // getter flash on top
        stkRgb(0.55, 0.58, 0.6, 0.55);
        mgraphics.rectangle_rounded(cx - 8, cy - 21, 16, 5, 2, 2);
        mgraphics.fill();
        // plates
        stkRgb(0.22, 0.22, 0.24);
        mgraphics.rectangle(cx - 6, cy - 12, 12, 22);
        mgraphics.fill();
        // filament glow
        stkRgb(1.0, 0.55 + 0.35 * g, 0.2 + 0.3 * g, 0.35 + 0.65 * g);
        mgraphics.rectangle(cx - 2, cy - 9, 4, 16);
        mgraphics.fill();
        stkRgb(1.0, 0.95, 0.8, 0.6 * g);
        mgraphics.rectangle(cx - 0.75, cy - 7, 1.5, 12);
        mgraphics.fill();
        // base
        stkRgb(0.12, 0.1, 0.08);
        mgraphics.rectangle(cx - 10, cy + 18, 20, 4);
        mgraphics.fill();
    }
    // the cage
    stkRgb(0.5, 0.5, 0.52, 0.35);
    mgraphics.set_line_width(0.75);
    for (var x = x0 + 8; x < x0 + w; x += 9) {
        mgraphics.move_to(x, y0 + 2);
        mgraphics.line_to(x, y0 + h - 2);
        mgraphics.stroke();
    }
    stkRgb(0.78, 0.66, 0.38, 0.6);
    mgraphics.rectangle_rounded(x0 + 0.5, y0 + 0.5, w - 1, h - 1, 4, 4);
    mgraphics.stroke();
}

// Channel switch, LOAD and the model nameplate.
var STK_CH = { x: 262, y: 9, w: 290, h: 50 };
function stkChannelRects() {
    var names = ampModelNames(), out = [];
    for (var i = 0; i < 4; i++) out.push({ i: i, x: STK_CH.x + 8 + i * 50, y: STK_CH.y + 30, w: 46, h: 15, label: i < 3 ? names[i].toUpperCase() : "FILE" });
    return out;
}
function stkLoadRect() { return { x: STK_CH.x + STK_CH.w - 70, y: STK_CH.y + 30, w: 62, h: 15 }; }

function stkNameplate() {
    var p = STK_CH;
    stkRgb(0.55, 0.43, 0.2);
    mgraphics.rectangle_rounded(p.x, p.y, p.w, p.h, 3, 3);
    mgraphics.fill();
    stkRgb(0.8, 0.68, 0.4, 0.8);
    mgraphics.rectangle(p.x + 2, p.y + 2, p.w - 4, 1);
    mgraphics.fill();
    stkRgb(0.12, 0.08, 0.03);
    mgraphics.select_font_face("Georgia");
    stkText("Neural Hundred", p.x + 8, p.y + 17, 15, 0);
    mgraphics.select_font_face("Arial Bold");
    var info = amp.model.error ? amp.model.error : (amp.model.name ? amp.model.name + "  ·  " + amp.model.label : "");
    stkRgb(0.18, 0.12, 0.05, 0.9);
    mgraphics.set_font_size(7.5);
    var iw = mgraphics.text_measure(info)[0];
    if (iw > 150) { while (info.length > 4 && mgraphics.text_measure(info + "…")[0] > 150) info = info.slice(0, -1); info += "…"; }
    stkText(info, p.x + p.w - 8, p.y + 15, 7.5, 2);
    if (!amp.dsp.ready || amp.dsp.error) {
        stkRgb(0.6, 0.12, 0.05);
        stkText(amp.dsp.error ? "DSP: " + amp.dsp.error : "warming up…", p.x + p.w - 8, p.y + 25, 7, 2);
    }
    var sel = Math.round(ampP.model);
    var rs = stkChannelRects();
    for (var i = 0; i < rs.length; i++) {
        var r = rs[i], on = r.i === sel, hov = STK.hover === "ch" + r.i;
        stkRgb(on ? 0.1 : 0.2, on ? 0.07 : 0.15, on ? 0.03 : 0.08, on ? 1 : (hov ? 0.6 : 0.35));
        mgraphics.rectangle_rounded(r.x, r.y, r.w, r.h, 2, 2);
        mgraphics.fill();
        stkRgb(on ? 1.0 : 0.15, on ? 0.78 : 0.1, on ? 0.35 : 0.05);
        stkText(r.label, r.x + r.w / 2, r.y + 10.5, 7.5, 1);
        if (on) {
            stkRgb(1.0, 0.35, 0.1, 0.9);
            stkCircle(r.x + 5, r.y + 7.5, 2);
            mgraphics.fill();
        }
    }
    var l = stkLoadRect();
    stkRgb(0.12, 0.08, 0.03, STK.hover === "load" ? 1 : 0.85);
    mgraphics.rectangle_rounded(l.x, l.y, l.w, l.h, 2, 2);
    mgraphics.fill();
    stkRgb(0.95, 0.8, 0.45);
    stkText("LOAD .nam", l.x + l.w / 2, l.y + 10.5, 7.5, 1);
}

function stkKnob(i) {
    var k = STK.knobs[i], x = stkKnobX(i), y = STK.knobY, r = STK.knobR;
    var n = stkNorm(k.key);
    // scale ticks (0..10)
    stkRgb(0.15, 0.1, 0.04, 0.85);
    mgraphics.set_line_width(1);
    for (var t = 0; t <= 10; t++) {
        var a = (-135 + t * 27) * Math.PI / 180;
        var r1 = r + 4, r2 = r + (t % 5 === 0 ? 8 : 6);
        mgraphics.move_to(x + Math.sin(a) * r1, y - Math.cos(a) * r1);
        mgraphics.line_to(x + Math.sin(a) * r2, y - Math.cos(a) * r2);
        mgraphics.stroke();
    }
    // shadow and body
    stkRgb(0, 0, 0, 0.35);
    stkCircle(x + 1.5, y + 2, r + 1);
    mgraphics.fill();
    stkRgb(0.08, 0.075, 0.07);
    stkCircle(x, y, r);
    mgraphics.fill();
    stkRgb(1, 1, 1, 0.08);
    stkCircle(x - 2, y - 3, r * 0.6);
    mgraphics.fill();
    // chicken-head pointer
    var ang = (-135 + 270 * n) * Math.PI / 180;
    var sx = Math.sin(ang), cy = -Math.cos(ang);
    var px = -cy, py = sx;
    var tip = r + 3, tail = r * 0.55, wid = 4.5;
    stkRgb(0.92, 0.88, 0.78);
    stkPoly([[x + sx * tip, y + cy * tip], [x + px * wid - sx * 2, y + py * wid - cy * 2],
        [x - sx * tail + px * wid * 0.9, y - cy * tail + py * wid * 0.9], [x - sx * tail - px * wid * 0.9, y - cy * tail - py * wid * 0.9],
        [x - px * wid - sx * 2, y - py * wid - cy * 2]]);
    mgraphics.fill();
    stkRgb(0.15, 0.1, 0.05);
    mgraphics.set_line_width(1.2);
    mgraphics.move_to(x + sx * 2, y + cy * 2);
    mgraphics.line_to(x + sx * (tip - 1.5), y + cy * (tip - 1.5));
    mgraphics.stroke();
    // label and value
    mgraphics.select_font_face("Arial Bold");
    stkRgb(0.14, 0.09, 0.03);
    stkText(k.label, x, STK.plateY + 13, 7, 1);
    if (STK.drag && STK.drag.key === k.key || STK.hover === k.key) {
        stkRgb(0.14, 0.09, 0.03, 0.9);
        stkText(stkFormat(k.key), x, y + r + 21, 7, 1);
    }
}

/** @param {string} key */
function stkFormat(key) {
    var v = ampP[key];
    if (key === "gate") return v <= -99.9 ? "off" : v.toFixed(0) + " dB";
    if (key === "input" || key === "output") return (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
    if (key === "mix") return v.toFixed(0) + " %";
    return v.toFixed(1);
}

function stkFaceplate() {
    var y0 = STK.plateY;
    stkRgb(0.72, 0.6, 0.34);
    mgraphics.rectangle_rounded(10, y0, STK.W - 20, STK.H - y0 - 9, 3, 3);
    mgraphics.fill();
    // brushed lines
    for (var x = 12; x < STK.W - 12; x += 2) {
        stkRgb(1, 0.95, 0.8, (x % 6 === 0) ? 0.07 : 0.03);
        mgraphics.rectangle(x, y0 + 1, 1, STK.H - y0 - 11);
        mgraphics.fill();
    }
    stkRgb(0.4, 0.3, 0.12, 0.8);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(10.5, y0 + 0.5, STK.W - 21, STK.H - y0 - 10, 3, 3);
    mgraphics.stroke();
    for (var i = 0; i < STK.knobs.length; i++) stkKnob(i);
    stkSwitches();
    stkJewel();
}

// Cab selector (4 positions) and Normalize toggle, right of the knobs.
function stkCabRects() {
    var out = [], x0 = 438, y = STK.plateY + 22;
    var names = AMP_PARAMS.cab[8];
    for (var i = 0; i < 4; i++) out.push({ i: i, x: x0 + (i % 2) * 34, y: y + Math.floor(i / 2) * 17, w: 32, h: 14, label: names[i].toUpperCase() });
    return out;
}
function stkNormRect() { return { x: 438, y: STK.plateY + 60, w: 66, h: 14 }; }

function stkSwitches() {
    stkRgb(0.14, 0.09, 0.03);
    stkText("CABINET", 471, STK.plateY + 13, 7, 1);
    var cab = Math.round(ampP.cab), rs = stkCabRects();
    for (var i = 0; i < rs.length; i++) {
        var r = rs[i], on = r.i === cab;
        stkRgb(on ? 0.12 : 0.55, on ? 0.08 : 0.45, on ? 0.03 : 0.24);
        mgraphics.rectangle_rounded(r.x, r.y, r.w, r.h, 2, 2);
        mgraphics.fill();
        stkRgb(0.3, 0.22, 0.1, 0.8);
        mgraphics.set_line_width(0.75);
        mgraphics.rectangle_rounded(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 2, 2);
        mgraphics.stroke();
        stkRgb(on ? 1.0 : 0.18, on ? 0.8 : 0.12, on ? 0.4 : 0.05);
        stkText(r.label, r.x + r.w / 2, r.y + 10, 7, 1);
    }
    var n = stkNormRect(), on2 = ampP.normalize > 0.5;
    stkRgb(0.3, 0.22, 0.1);
    mgraphics.rectangle_rounded(n.x, n.y, 22, n.h, 7, 7);
    mgraphics.fill();
    stkRgb(on2 ? 0.95 : 0.6, on2 ? 0.85 : 0.55, on2 ? 0.6 : 0.5);
    stkCircle(n.x + (on2 ? 15 : 7), n.y + 7, 5.5);
    mgraphics.fill();
    stkRgb(0.14, 0.09, 0.03);
    stkText("NORMALIZE", n.x + 26, n.y + 10, 7, 0);
}

function stkJewel() {
    var x = 528, y = STK.plateY + 34;
    var target = Math.min(1, 0.25 + ampTel.out_pk * 1.5);
    STK.jewel += (target - STK.jewel) * 0.4;
    var j = amp.dsp.ready ? STK.jewel : 0.08;
    stkRgb(0.25, 0.2, 0.1);
    stkCircle(x, y, 13);
    mgraphics.fill();
    for (var k = 3; k >= 1; k--) {
        stkRgb(1.0, 0.1, 0.05, 0.12 * j * k);
        stkCircle(x, y, 7 + k * 3 * j);
        mgraphics.fill();
    }
    stkRgb(0.55 + 0.45 * j, 0.05 + 0.15 * j, 0.03);
    stkCircle(x, y, 8);
    mgraphics.fill();
    // facets
    stkRgb(1, 0.8, 0.7, 0.35 + 0.4 * j);
    for (var f = 0; f < 6; f++) {
        var a = f * Math.PI / 3;
        mgraphics.move_to(x, y);
        mgraphics.line_to(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
        mgraphics.set_line_width(0.6);
        mgraphics.stroke();
    }
    stkRgb(0.14, 0.09, 0.03);
    stkText("ON", x, y + 24, 7, 1);
}

function paint() {
    STK.flick += 0.37;
    stkTolex();
    stkTubes();
    stkNameplate();
    stkFaceplate();
}

function ampFaceFrame() { return true; }

// ---- interaction --------------------------------------------------------------------------------

/** @param {number} x @param {number} y */
function stkHit(x, y) {
    for (var i = 0; i < STK.knobs.length; i++) {
        var dx = x - stkKnobX(i), dy = y - STK.knobY;
        if (dx * dx + dy * dy <= (STK.knobR + 9) * (STK.knobR + 9)) return STK.knobs[i].key;
    }
    var rs = stkChannelRects();
    for (i = 0; i < rs.length; i++) if (stkIn(x, y, rs[i])) return "ch" + i;
    if (stkIn(x, y, stkLoadRect())) return "load";
    var cs = stkCabRects();
    for (i = 0; i < cs.length; i++) if (stkIn(x, y, cs[i])) return "cab" + i;
    if (stkIn(x, y, stkNormRect())) return "norm";
    return "";
}

function stkIn(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

function onclick(x, y, but, cmd, shift) {
    var h = stkHit(x, y);
    STK.drag = null;
    if (!h) return;
    if (h.indexOf("ch") === 0) { var c = Number(h.slice(2)); if (c === 3 && !amp.fileModel) ampBrowse(); else ampSet("model", c); }
    else if (h === "load") ampBrowse();
    else if (h.indexOf("cab") === 0) ampSet("cab", Number(h.slice(3)));
    else if (h === "norm") ampSet("normalize", ampP.normalize > 0.5 ? 0 : 1);
    else STK.drag = { key: h, y: y, v: stkNorm(h), fine: !!shift };
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift) {
    if (!STK.drag) return;
    if (!but) { STK.drag = null; mgraphics.redraw(); return; }
    var d = STK.drag, s = AMP_PARAMS[d.key];
    var n = Math.max(0, Math.min(1, d.v + (d.y - y) / (shift ? 600 : 140)));
    ampSet(d.key, s[2] + n * (s[3] - s[2]));
    mgraphics.redraw();
}

function ondblclick(x, y) {
    var h = stkHit(x, y);
    if (h && AMP_PARAMS[h]) ampSet(h, AMP_PARAMS[h][4]);
    mgraphics.redraw();
}

function onidle(x, y) {
    var h = stkHit(x, y);
    if (h !== STK.hover) { STK.hover = h; mgraphics.redraw(); }
}

function onidleout() { STK.hover = ""; mgraphics.redraw(); }

function preview() {
    ampPreviewSetup(0.75);
    for (var i = 0; i < 6; i++) { STK.flick += 0.37; for (var k = 0; k < 4; k++) STK.glow[k] = 0.8; }
    STK.jewel = 0.8;
    ampP.input = 6; ampP.bass = 6.5; ampP.mid = 4; ampP.treble = 7; ampP.presence = 6;
}
function ampFaceChanged(what) { }
