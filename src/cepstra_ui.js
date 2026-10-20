// Cepstra face (left section, 290 x 169): header pills + title tab, five flat glyph knobs (Res, Mid, Mix, Side,
// Gate), Mid/Side padlock, Formant / Harmonic dot bars and the Quality selector. This v8ui has `ignoreclick: 1`:
// it only DRAWS. Every control is a real, fully transparent live.* widget placed in front of it in presentation,
// so Live's native drag, double-click reset, automation, macro mapping and MIDI/key mapping all work. The widgets
// report their values here through `set_<x>` messages and the glyphs redraw.
// src/cepstra_config.js is prepended at build time.
//
// Messages in:
//   set_res/set_mid/set_side/set_mix/set_gate/set_fmt/set_harm <value>, set_mode/set_auto/set_midi/set_lock <int>, set_quality <int>
// Messages out (outlet 0), each answered by `prepend set` into its live object (silent, no echo) and gen:
//   ["mid"|"side", value]  (Mid/Side Lock follower), ["auto"|"midi", 0|1] and ["resmode", 0|1|2] (exclusive AUTO / MIDI pills)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var ORANGE = [1.0, 0.56, 0.10];
var BLUE = [0.30, 0.58, 1.0];
var GREEN = [0.22, 0.92, 0.46];
var WHITE = [0.94, 0.94, 0.94];
var MONO = "Courier New";

var readoutKey = "";
var readoutTask = null;
var previewed = false;

var vals = { res: DEFAULT_RES_PCT, mid: 0, side: 0, mix: 100, gate: 0, fmt: 100, harm: 100 };
var curMode = 0;
var curQuality = 1;
var curLock = 0;
var nFft = 2048;

function emit(msg, v) { outlet(0, [msg, v]); }

// A value changed (drag, automation or macro): show its monospace readout for about 1 s.
function showReadout(key) {
    readoutKey = key;
    if (typeof Task === "function") {
        if (readoutTask) readoutTask.cancel();
        readoutTask = new Task(function () {
            readoutKey = "";
            mgraphics.redraw();
        }, this);
        readoutTask.schedule(1000);
    }
}

function setVal(key, v, lo, hi) {
    v = clamp(Number(v), lo, hi);
    if (vals[key] !== v) {
        vals[key] = v;
        showReadout(key);
    }
    mgraphics.redraw();
}

function set_res(v) { setVal("res", v, 0, 100); }
function set_mix(v) { setVal("mix", v, 0, 100); }
function set_gate(v) { setVal("gate", v, 0, 100); }
function set_fmt(v) { setVal("fmt", v, 0, 200); }
function set_harm(v) { setVal("harm", v, 0, 200); }
function set_quality(v) { curQuality = clamp(Math.round(Number(v)), 0, 2); nFft = fftSizeForQuality(curQuality); mgraphics.redraw(); }
function set_lock(v) { curLock = Number(v) > 0.5 ? 1 : 0; mgraphics.redraw(); }

// AUTO / MIDI pills: two exclusive toggles that map onto resmode (0 Manual, 1 Auto, 2 MIDI). The hidden resmode
// tab is kept in sync with `set`, and the toggles are only ever changed with `set` (silent), so nothing loops.
function set_mode(v) {
    var m = clamp(Math.round(Number(v)), 0, 2);
    if (m !== curMode) {
        curMode = m;
        emit("auto", m === 1 ? 1 : 0);
        emit("midi", m === 2 ? 1 : 0);
    }
    mgraphics.redraw();
}

function set_auto(v) {
    var on = Number(v) > 0.5;
    var m = on ? 1 : (curMode === 1 ? 0 : curMode);
    if (m === curMode) return;
    curMode = m;
    emit("resmode", m);
    if (on) emit("midi", 0);
    mgraphics.redraw();
}

function set_midi(v) {
    var on = Number(v) > 0.5;
    var m = on ? 2 : (curMode === 2 ? 0 : curMode);
    if (m === curMode) return;
    curMode = m;
    emit("resmode", m);
    if (on) emit("auto", 0);
    mgraphics.redraw();
}

// Mid / Side with Lock. Works for the dial itself, automation and macros: whichever object changed, the
// follower is moved by the same delta with a silent `set` (+ gen), so the follower never echoes back.
function set_mid(v) {
    var r = applyLock(curLock, "mid", Number(v), vals.mid, vals.side);
    var changed = r.mid !== vals.mid;
    var followed = r.side !== vals.side;
    vals.mid = r.mid;
    vals.side = r.side;
    if (changed) showReadout("mid");
    if (followed) {
        emit("side", vals.side);
        showReadout("side");
    }
    mgraphics.redraw();
}

function set_side(v) {
    var r = applyLock(curLock, "side", Number(v), vals.mid, vals.side);
    var changed = r.side !== vals.side;
    var followed = r.mid !== vals.mid;
    vals.side = r.side;
    vals.mid = r.mid;
    if (changed) showReadout("side");
    if (followed) {
        emit("mid", vals.mid);
        showReadout("mid");
    }
    mgraphics.redraw();
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [290, 169];
    return [s[0], s[1]];
}

// Fixed face geometry (520 x 169)
function layoutRegions() {
    var cs = canvasSize();
    var knobs = [];
    for (var i = 0; i < KNOBS.length; i++) {
        knobs.push({ key: KNOBS[i].key, cx: 35 + i * 54, cy: 50, x: 8 + i * 54, y: 28, w: 54, h: 62 });
    }
    return {
        w: cs[0],
        h: cs[1],
        knobs: knobs,
        pillAuto: { x: 10, y: 6, w: 52, h: 16 },
        pillMidi: { x: 222, y: 6, w: 52, h: 16 },
        tab: { x: 86, y: -10, w: 112, h: 34 },
        lock: { cx: knobs[2].cx, cy: 100, r: 8 },
        sliders: [
            { key: "fmt", x: 62, y: 114, w: 160, h: 12 },
            { key: "harm", x: 62, y: 130, w: 160, h: 12 }
        ],
        quality: { x: 62, y: 146, w: 108, h: 14 }
    };
}

// Static demo state (used by the screenshot preview).
function preview() {
    previewed = true;
    vals.res = DEFAULT_RES_PCT;
    vals.mid = 7;
    vals.side = -3;
    vals.mix = 80;
    vals.gate = 35;
    vals.fmt = 100;
    vals.harm = 130;
    curMode = 1;
    curLock = 1;
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------------------------

function col(c, a) { mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1.0 : a); }

function fillRect(x, y, w, h, c, a) {
    col(c, a);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}

function fillCircle(cx, cy, r, c, a) {
    col(c, a);
    mgraphics.arc(cx, cy, r, 0, Math.PI * 2);
    mgraphics.fill();
}

function ringStroke(cx, cy, r, c, a, lw) {
    col(c, a);
    mgraphics.set_line_width(lw);
    mgraphics.arc(cx, cy, r, 0, Math.PI * 2);
    mgraphics.stroke();
}

function polyFill(pts, c, a) {
    col(c, a);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.close_path();
    mgraphics.fill();
}

function lineSeg(x0, y0, x1, y1, c, a, lw) {
    col(c, a);
    mgraphics.set_line_width(lw);
    mgraphics.move_to(x0, y0);
    mgraphics.line_to(x1, y1);
    mgraphics.stroke();
}

function textAt(str, x, y, size, c, a) {
    mgraphics.select_font_face(MONO);
    mgraphics.set_font_size(size);
    col(c, a);
    mgraphics.move_to(x, y);
    mgraphics.show_text(str);
}

function textW(str, size) { return str.length * size * 0.6; }

function dotGrid(x, y, w, h, step, a) {
    var cols = Math.floor(w / step);
    var rows = Math.floor(h / step);
    col(WHITE, a);
    for (var i = 0; i < cols; i++) {
        for (var j = 0; j < rows; j++) {
            mgraphics.rectangle(x + step * 0.5 + i * step - 0.5, y + step * 0.5 + j * step - 0.5, 1, 1);
            mgraphics.fill();
        }
    }
}

// Half-filled disc (right half) as a polygon
function halfDisc(cx, cy, r, c) {
    var pts = [];
    for (var i = 0; i <= 12; i++) {
        var a = -Math.PI / 2 + (i / 12) * Math.PI;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    polyFill(pts, c, 1.0);
}

function bowtieH(cx, cy) {
    polyFill([[cx - 6, cy - 4], [cx, cy], [cx - 6, cy + 4]], WHITE, 1.0);
    polyFill([[cx + 6, cy - 4], [cx, cy], [cx + 6, cy + 4]], WHITE, 1.0);
}

function bowtieV(cx, cy) {
    polyFill([[cx - 4, cy - 6], [cx, cy], [cx + 4, cy - 6]], WHITE, 1.0);
    polyFill([[cx - 4, cy + 6], [cx, cy], [cx + 4, cy + 6]], WHITE, 1.0);
}

// ---------------------------------------------------------------------------------------------
// Glyph knobs (flat white pictograms that change with their value)
// ---------------------------------------------------------------------------------------------

function glyphRes(cx, cy, norm) {
    var n = resGridCount(norm);
    var area = 36;
    var s = area / n;
    var x0 = cx - area / 2;
    var y0 = cy - area / 2;
    for (var i = 0; i < n; i++) {
        for (var j = 0; j < n; j++) {
            if ((i + j) % 2 === 0) fillRect(x0 + i * s + 0.3, y0 + j * s + 0.3, s - 0.6, s - 0.6, WHITE, 0.95);
        }
    }
    fillCircle(cx, cy, 11, [0, 0, 0], 1.0);
    ringStroke(cx, cy, 10, WHITE, 1.0, 1.6);
    halfDisc(cx, cy, 6.5, WHITE);
    ringStroke(cx, cy, 6.5, WHITE, 1.0, 1.0);
}

function glyphMid(cx, cy, st) {
    var t = shiftOffsetNorm(st);
    lineSeg(cx - 20, cy + t * 6, cx - 11, cy + t * 0.5, WHITE, 1.0, 2);
    lineSeg(cx + 11, cy - t * 0.5, cx + 20, cy - t * 6, WHITE, 1.0, 2);
    fillCircle(cx, cy, 11, [0, 0, 0], 1.0);
    ringStroke(cx, cy, 10.5, WHITE, 1.0, 1.6);
    bowtieH(cx, cy - t * 4.5);
}

function glyphSide(cx, cy, st) {
    var t = shiftOffsetNorm(st);
    for (var i = -4; i <= 4; i++) {
        var x = cx + i * 4.6;
        var dx = Math.abs(x - cx);
        var skew = t * 3;
        if (dx < 11) {
            var half = Math.sqrt(121 - dx * dx) + 1.5;
            lineSeg(x + skew, cy - 19, x, cy - half, WHITE, 1.0, 1.8);
            lineSeg(x, cy + half, x - skew, cy + 19, WHITE, 1.0, 1.8);
        } else {
            lineSeg(x + skew, cy - 19, x - skew, cy + 19, WHITE, 1.0, 1.8);
        }
    }
    fillCircle(cx, cy, 11, [0, 0, 0], 1.0);
    ringStroke(cx, cy, 10.5, WHITE, 1.0, 1.6);
    bowtieV(cx + t * 4.5, cy);
}

function glyphMix(cx, cy, norm) {
    var count = mixRingCount(norm);
    for (var k = 1; k <= 5; k++) {
        if (k <= count) ringStroke(cx, cy, k * 3.7, WHITE, 1.0, 1.2 + norm * 1.6);
        else ringStroke(cx, cy, k * 3.7, [0.5, 0.5, 0.5], 0.28, 1.0);
    }
    if (norm > 0.001) fillCircle(cx, cy, 1.6, WHITE, 1.0);
}

function glyphGate(cx, cy, norm) {
    var hs = gateBarHeights(norm);
    var base = cy + 14;
    for (var i = 0; i < hs.length; i++) {
        var bh = hs[i] * 30;
        fillRect(cx - 19 + i * 4.5, base - bh, 2.8, bh, WHITE, 0.95);
    }
    fillCircle(cx, cy - 2, 6.5, [0, 0, 0], 1.0);
    ringStroke(cx, cy - 2, 6, WHITE, 1.0, 1.4);
    fillRect(cx - 20, base + 3, 40, 2.6, ORANGE, 1.0);
}

function drawLabel(cx, y, text, c, a, size) {
    size = size || 8;
    var w = textW(text, size);
    textAt(text, cx - w / 2, y, size, c, a);
    var bl = cx - 24, br = cx + 24;
    var top = y - 8;
    lineSeg(bl, top, bl, y + 2, c, 0.6, 1);
    lineSeg(bl, y + 2, bl + 4, y + 2, c, 0.6, 1);
    lineSeg(br, top, br, y + 2, c, 0.6, 1);
    lineSeg(br, y + 2, br - 4, y + 2, c, 0.6, 1);
}

function drawKnobs(r) {
    for (var i = 0; i < r.knobs.length; i++) {
        var k = r.knobs[i];
        var spec = KNOBS[i];
        var v = vals[k.key];
        dotGrid(k.cx - 24, k.cy - 24, 48, 48, 5, 0.13);
        if (k.key === "res") glyphRes(k.cx, k.cy, valueToNorm(spec, v));
        else if (k.key === "mid") glyphMid(k.cx, k.cy, v);
        else if (k.key === "mix") glyphMix(k.cx, k.cy, valueToNorm(spec, v));
        else if (k.key === "side") glyphSide(k.cx, k.cy, v);
        else glyphGate(k.cx, k.cy, valueToNorm(spec, v));
        var active = readoutKey === k.key;
        var txt = active ? (spec.label + " " + formatValue(spec, v)) : spec.label;
        drawLabel(k.cx, 84, txt, active ? ORANGE : [0.72, 0.72, 0.72], 1.0, active ? 7 : 8);
    }
}

function drawLock(r) {
    var lc = r.lock;
    var m = r.knobs[1].cx;
    var s = r.knobs[3].cx;
    var c = curLock ? GREEN : [0.20, 0.42, 0.28];
    lineSeg(m, 91, m, lc.cy, c, 0.9, 1.4);
    lineSeg(m, lc.cy, lc.cx - lc.r - 3, lc.cy, c, 0.9, 1.4);
    lineSeg(lc.cx + lc.r + 3, lc.cy, s, lc.cy, c, 0.9, 1.4);
    lineSeg(s, lc.cy, s, 91, c, 0.9, 1.4);
    fillCircle(lc.cx, lc.cy, lc.r, curLock ? GREEN : [0.08, 0.16, 0.10], 1.0);
    ringStroke(lc.cx, lc.cy, lc.r, c, 1.0, 1.2);
    var k = curLock ? [0.02, 0.10, 0.04] : [0.30, 0.55, 0.38];
    fillRect(lc.cx - 3.2, lc.cy - 0.5, 6.4, 4.6, k, 1.0);
    var sx = curLock ? lc.cx : lc.cx + 2.5;
    lineSeg(sx - 2, lc.cy - 0.5, sx - 2, lc.cy - 3.2, k, 1.0, 1.2);
    lineSeg(sx - 2, lc.cy - 3.2, sx + 2, lc.cy - 3.2, k, 1.0, 1.2);
    lineSeg(sx + 2, lc.cy - 3.2, sx + 2, lc.cy - 0.5, k, 1.0, 1.2);
}

function drawDotSlider(sl, spec) {
    var v = vals[sl.key];
    var norm = valueToNorm(spec, v);
    var dots = Math.floor(sl.w / 5);
    var lit = Math.round(norm * dots);
    var active = readoutKey === sl.key;
    textAt(spec.label, 8, sl.y + 9, 7.5, active ? ORANGE : [0.72, 0.72, 0.72], 1.0);
    for (var i = 0; i < dots; i++) {
        var on = i < lit;
        var hgt = on ? 7 : 3;
        fillRect(sl.x + i * 5, sl.y + 6 - hgt / 2 + 0.5, 2.2, hgt, on ? WHITE : [0.5, 0.5, 0.5], on ? 0.95 : 0.35);
    }
    textAt(formatValue(spec, v), sl.x + sl.w + 6, sl.y + 9, 7.5, WHITE, 0.85);
}

function drawQuality(r) {
    var q = r.quality;
    textAt("Quality", 8, q.y + 10, 7.5, active_color(false), 1.0);
    var names = QUALITY_NAMES;
    var segW = q.w / 3;
    for (var i = 0; i < 3; i++) {
        var on = i === curQuality;
        col(on ? WHITE : [0.5, 0.5, 0.5], on ? 1.0 : 0.6);
        if (on) {
            mgraphics.rectangle(q.x + i * segW + 1, q.y, segW - 2, q.h);
            mgraphics.fill();
        } else {
            mgraphics.set_line_width(1);
            mgraphics.rectangle(q.x + i * segW + 1.5, q.y + 0.5, segW - 3, q.h - 1);
            mgraphics.stroke();
        }
        textAt(names[i], q.x + i * segW + segW / 2 - textW(names[i], 8) / 2, q.y + 10, 8, on ? [0, 0, 0] : [0.72, 0.72, 0.72], 1.0);
    }
    textAt("N " + nFft, q.x + q.w + 8, q.y + 10, 7, [0.5, 0.5, 0.5], 1.0);
}

function active_color(on) { return on ? ORANGE : [0.72, 0.72, 0.72]; }

function drawHeader(r) {
    var pills = [[r.pillAuto, "AUTO", curMode === 1], [r.pillMidi, "MIDI", curMode === 2]];
    for (var i = 0; i < pills.length; i++) {
        var p = pills[i][0];
        var on = pills[i][2];
        col(on ? [0.17, 0.17, 0.17] : [0.085, 0.085, 0.085], 1.0);
        mgraphics.rectangle_rounded(p.x, p.y, p.w, p.h, 8, 8);
        mgraphics.fill();
        col(on ? ORANGE : [0.22, 0.22, 0.22], on ? 0.8 : 1.0);
        mgraphics.set_line_width(1);
        mgraphics.rectangle_rounded(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1, 8, 8);
        mgraphics.stroke();
        var tx = p.x + p.w / 2 - textW(pills[i][1], 8.5) / 2;
        textAt(pills[i][1], tx + 0.7, p.y + 11.7, 8.5, [0, 0, 0], 0.9); // embossed shadow
        textAt(pills[i][1], tx, p.y + 11, 8.5, on ? ORANGE : [0.46, 0.46, 0.46], 1.0);
    }
    var t = r.tab;
    col(ORANGE, 1.0);
    mgraphics.rectangle_rounded(t.x, t.y, t.w, t.h, 9, 9);
    mgraphics.fill();
    var title = "CEPSTRA";
    var cw = 10.4;
    var tx2 = t.x + t.w / 2 - (title.length * cw) / 2 + 0.6;
    for (var k = 0; k < title.length; k++) {
        textAt(title.charAt(k), tx2 + k * cw, 17, 12, [0, 0, 0], 1.0);
        textAt(title.charAt(k), tx2 + k * cw + 0.6, 17, 12, [0, 0, 0], 1.0);
    }
}

function paint() {
    if (!previewed && readoutKey === "" && vals.gate === 0 && vals.mid === 0 && vals.res === DEFAULT_RES_PCT) preview();
    var r = layoutRegions();
    var h = r.h;
    // Outer frame: the rounded device frame continues into the display v8ui on the right
    mgraphics.set_source_rgba(0, 0, 0, 1);
    mgraphics.rectangle_rounded(1.5, 1.5, 520 - 3, h - 3, 9, 9);
    mgraphics.fill();
    mgraphics.set_line_width(1.2);
    mgraphics.set_source_rgba(0.24, 0.24, 0.24, 1);
    mgraphics.rectangle_rounded(1.5, 1.5, 520 - 3, h - 3, 9, 9);
    mgraphics.stroke();

    drawHeader(r);
    drawKnobs(r);
    drawLock(r);
    drawDotSlider(r.sliders[0], SLIDERS[0]);
    drawDotSlider(r.sliders[1], SLIDERS[1]);
    drawQuality(r);
}
