// Amp face "Pedal": a boutique overdrive stompbox. Candy-green hammertone enamel, a phosphor CRT
// window tracing the output waveform with persistence, a big DRIVE knob ringed by LEDs that follow
// the model's saturation, small tone / trim knobs, a 4-position cab strip and a footswitch that cycles
// the model (Clean, Crunch, Lead, File) with four indicator LEDs. All controls set parameters via ampSet().

var PED = {
    W: 360, H: 169,
    drive: { x: 62, y: 62, r: 20 },
    knobs: [
        { key: "input", label: "DRIVE", x: 62, y: 62, r: 20, big: 1 },
        { key: "bass", label: "BASS", x: 152, y: 88, r: 10 },
        { key: "mid", label: "MID", x: 196, y: 88, r: 10 },
        { key: "treble", label: "TREBLE", x: 240, y: 88, r: 10 },
        { key: "presence", label: "PRES", x: 274, y: 88, r: 7 },
        { key: "gate", label: "GATE", x: 296, y: 88, r: 7 },
        { key: "output", label: "LVL", x: 318, y: 88, r: 7 },
        { key: "mix", label: "MIX", x: 340, y: 88, r: 7 }
    ],
    crt: { x: 132, y: 12, w: 108, h: 54 },
    foot: { x: 62, y: 142, r: 14 },
    hist: [], gain: 1, level: 0, led: 0, peakHold: 0, lastFrame: -1,
    drag: null, hover: ""
};

function pedRgb(r, g, b, a) { mgraphics.set_source_rgba(r, g, b, a == null ? 1 : a); }
function pedCircle(x, y, r) { mgraphics.ellipse(x - r, y - r, 2 * r, 2 * r); }

function pedText(t, x, y, size, align) {
    mgraphics.set_font_size(size);
    var w = mgraphics.text_measure(t)[0];
    mgraphics.move_to(align === 1 ? x - w / 2 : (align === 2 ? x - w : x), y);
    mgraphics.show_text(t);
}

/** @param {string} t @param {number} size @param {number} maxW */
function pedFit(t, size, maxW) {
    mgraphics.set_font_size(size);
    if (mgraphics.text_measure(t)[0] <= maxW) return t;
    while (t.length > 3 && mgraphics.text_measure(t + "..")[0] > maxW) t = t.slice(0, -1);
    return t + "..";
}

/** polyline arc, degrees measured clockwise from 12 o'clock */
function pedRing(x, y, r, a0, a1) {
    var steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 6));
    for (var i = 0; i <= steps; i++) {
        var a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
        var px = x + Math.sin(a) * r, py = y - Math.cos(a) * r;
        if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();
}

/** @param {string} key */
function pedNorm(key) { var s = AMP_PARAMS[key]; return (ampP[key] - s[2]) / (s[3] - s[2]); }

/** @param {string} key */
function pedFormat(key) {
    var v = ampP[key];
    if (key === "gate") return v <= -99.9 ? "OFF" : v.toFixed(0) + "dB";
    if (key === "input" || key === "output") return (v > 0 ? "+" : "") + v.toFixed(1) + "dB";
    if (key === "mix") return v.toFixed(0) + "%";
    return v.toFixed(1);
}

function pedHash(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// ---- enamel ---------------------------------------------------------------------------------------

function pedEnamel() {
    var W = PED.W, H = PED.H;
    pedRgb(0.02, 0.1, 0.06);
    mgraphics.rectangle(0, 0, W, H);
    mgraphics.fill();
    pedRgb(0.04, 0.3, 0.16);
    mgraphics.rectangle_rounded(3, 3, W - 6, H - 6, 9, 9);
    mgraphics.fill();
    // hammertone: dark and light dimples in two passes
    pedRgb(0.0, 0.1, 0.05, 0.35);
    for (var i = 0; i < 260; i++) mgraphics.rectangle(8 + pedHash(i) * (W - 18), 8 + pedHash(i + 900) * (H - 18), 3 + pedHash(i + 50) * 4, 2 + pedHash(i + 70) * 3);
    mgraphics.fill();
    pedRgb(0.3, 0.85, 0.5, 0.13);
    for (i = 0; i < 260; i++) mgraphics.rectangle(8 + pedHash(i + 300) * (W - 18), 8 + pedHash(i + 1300) * (H - 18), 2 + pedHash(i + 90) * 3, 1 + pedHash(i + 20) * 2);
    mgraphics.fill();
    // edge highlight and bevel
    pedRgb(0.6, 1.0, 0.75, 0.35);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(3.5, 3.5, W - 7, H - 7, 9, 9);
    mgraphics.stroke();
    pedRgb(0, 0.05, 0.02, 0.6);
    mgraphics.rectangle_rounded(6.5, 6.5, W - 13, H - 13, 7, 7);
    mgraphics.stroke();
    // screws
    var sc = [[13, 13], [W - 13, 13], [13, H - 13], [W - 13, H - 13]];
    for (i = 0; i < 4; i++) {
        pedRgb(0, 0, 0, 0.4); pedCircle(sc[i][0] + 0.8, sc[i][1] + 1, 3.6); mgraphics.fill();
        pedRgb(0.75, 0.77, 0.8); pedCircle(sc[i][0], sc[i][1], 3.4); mgraphics.fill();
        pedRgb(0.25, 0.26, 0.3); mgraphics.set_line_width(1);
        var a = i * 0.9 + 0.4;
        mgraphics.move_to(sc[i][0] - Math.cos(a) * 2.6, sc[i][1] - Math.sin(a) * 2.6);
        mgraphics.line_to(sc[i][0] + Math.cos(a) * 2.6, sc[i][1] + Math.sin(a) * 2.6);
        mgraphics.stroke();
    }
    // chrome jack sockets on the left edge
    var jy = [46, 124];
    for (i = 0; i < 2; i++) {
        pedRgb(0.1, 0.1, 0.12); pedCircle(14, jy[i], 6.2); mgraphics.fill();
        pedRgb(0.78, 0.8, 0.84); pedCircle(14, jy[i], 5.3); mgraphics.fill();
        pedRgb(1, 1, 1, 0.5); pedCircle(12.8, jy[i] - 1.2, 2.2); mgraphics.fill();
        pedRgb(0.05, 0.05, 0.06); pedCircle(14, jy[i], 2.6); mgraphics.fill();
    }
}

// ---- CRT drive window -------------------------------------------------------------------------------

/** samples of the output ring ending `back` samples ago, resampled to 100 columns (-1..1) */
function pedTrace(back) {
    var ring = ampOutRing(2048), n = ring.length, out = [];
    if (n < 1700) { for (var z = 0; z < 100; z++) out.push(0); return out; }
    var end = n - back;
    for (var i = 0; i < 100; i++) {
        var v = ring[Math.max(0, end - 1600 + i * 16)];
        out.push(isFinite(v) ? v : 0);
    }
    return out;
}

function pedPushTrace(t) {
    var pk = 0.12;
    for (var i = 0; i < t.length; i++) pk = Math.max(pk, Math.abs(t[i]));
    PED.gain += (0.9 / pk - PED.gain) * 0.25;
    PED.hist.push(t.map(function (v) { return v; }));
    while (PED.hist.length > 5) PED.hist.shift();
}

function pedCrt() {
    var c = PED.crt;
    // chrome bezel
    pedRgb(0, 0, 0, 0.4); mgraphics.rectangle_rounded(c.x - 3 + 1, c.y - 3 + 2, c.w + 6, c.h + 6, 8, 8); mgraphics.fill();
    pedRgb(0.72, 0.75, 0.8); mgraphics.rectangle_rounded(c.x - 4, c.y - 4, c.w + 8, c.h + 8, 8, 8); mgraphics.fill();
    pedRgb(1, 1, 1, 0.45); mgraphics.rectangle(c.x - 1, c.y - 3.5, c.w - 2, 1); mgraphics.fill();
    pedRgb(0.2, 0.22, 0.26); mgraphics.rectangle_rounded(c.x - 1.5, c.y - 1.5, c.w + 3, c.h + 3, 5, 5); mgraphics.fill();
    pedRgb(0.0, 0.05, 0.025); mgraphics.rectangle_rounded(c.x, c.y, c.w, c.h, 4, 4); mgraphics.fill();
    var mid = c.y + c.h / 2, half = c.h / 2 - 4;
    // graticule
    pedRgb(0.2, 0.9, 0.4, 0.1); mgraphics.set_line_width(0.5);
    for (var gx = 1; gx < 6; gx++) { mgraphics.move_to(c.x + gx * c.w / 6, c.y + 3); mgraphics.line_to(c.x + gx * c.w / 6, c.y + c.h - 3); mgraphics.stroke(); }
    for (var gy = -1; gy <= 1; gy++) { mgraphics.move_to(c.x + 3, mid + gy * half * 0.9); mgraphics.line_to(c.x + c.w - 3, mid + gy * half * 0.9); mgraphics.stroke(); }
    // traces with persistence
    var hist = PED.hist, nh = hist.length;
    for (var h = 0; h < nh; h++) {
        var age = nh - 1 - h, t = hist[h];
        var a = age === 0 ? 1 : 0.22 / (age * 0.9 + 0.2) * 0.5;
        var pass = age === 0 ? [[3.6, 0.1], [2, 0.22], [1.1, 0.95]] : [[1.4, a * 0.6]];
        for (var p = 0; p < pass.length; p++) {
            pedRgb(0.35, 1.0, 0.5, pass[p][1] * (age === 0 ? 1 : 1)); mgraphics.set_line_width(pass[p][0]);
            for (var i = 0; i < t.length; i++) {
                var x = c.x + 3 + (c.w - 6) * i / (t.length - 1);
                var y = mid - Math.max(-1, Math.min(1, t[i] * PED.gain)) * half;
                if (i === 0) mgraphics.move_to(x, y); else mgraphics.line_to(x, y);
            }
            mgraphics.stroke();
        }
    }
    // glass sheen and corner label
    pedRgb(1, 1, 1, 0.05); mgraphics.rectangle_rounded(c.x + 2, c.y + 2, c.w - 4, 9, 3, 3); mgraphics.fill();
    pedRgb(0.3, 0.9, 0.5, 0.55); mgraphics.select_font_face("Arial Bold");
    pedText("OUT", c.x + 5, c.y + c.h - 4, 7, 0);
}

// ---- knobs ------------------------------------------------------------------------------------------

function pedKnob(k) {
    var x = k.x, y = k.y, r = k.r, n = pedNorm(k.key), on = PED.hover === k.key || (PED.drag && PED.drag.key === k.key);
    var ang = -135 + 270 * n;
    if (!k.big) {
        pedRgb(0.0, 0.08, 0.04, 0.8); mgraphics.set_line_width(2);
        pedRing(x, y, r + 3.5, -135, 135);
        pedRgb(0.95, 0.9, 0.6, 0.95);
        if (n > 0.005) pedRing(x, y, r + 3.5, -135, ang);
    }
    // body: shadow, chrome skirt, dark cap
    pedRgb(0, 0, 0, 0.4); pedCircle(x + 1, y + 2, r + 1); mgraphics.fill();
    pedRgb(0.7, 0.72, 0.76); pedCircle(x, y, r + 0.5); mgraphics.fill();
    pedRgb(0.12, 0.12, 0.14); pedCircle(x, y, r - 1.2); mgraphics.fill();
    // knurl
    pedRgb(0.7, 0.72, 0.76, 0.35); mgraphics.set_line_width(0.6);
    for (var i = 0; i < 16; i++) {
        var a = i * Math.PI / 8;
        mgraphics.move_to(x + Math.cos(a) * (r - 1.4), y + Math.sin(a) * (r - 1.4));
        mgraphics.line_to(x + Math.cos(a) * (r - 0.2), y + Math.sin(a) * (r - 0.2));
        mgraphics.stroke();
    }
    pedRgb(1, 1, 1, 0.1); pedCircle(x - r * 0.25, y - r * 0.3, r * 0.5); mgraphics.fill();
    // pointer
    var ar = ang * Math.PI / 180, sx = Math.sin(ar), cy = -Math.cos(ar);
    pedRgb(0.97, 0.95, 0.85); mgraphics.set_line_width(k.big ? 2.2 : 1.6);
    mgraphics.move_to(x + sx * r * 0.25, y + cy * r * 0.25);
    mgraphics.line_to(x + sx * (r - 1.8), y + cy * (r - 1.8));
    mgraphics.stroke();
    // label / value
    mgraphics.select_font_face("Arial Bold");
    var ly = k.big ? PED.drive.y + 44 : y + 21;
    if (k.big) ly = 108;
    if (on) { pedRgb(1.0, 0.95, 0.6); pedText(pedFormat(k.key), x, ly, 7, 1); }
    else { pedRgb(0.93, 0.97, 0.9, 0.92); pedText(k.label, x, ly, 7, 1); }
}

// LED ring around the DRIVE knob: lit segments follow the model's saturation and the input peak.
function pedLedRing() {
    var d = PED.drive, segs = 21, lvl = PED.level, lit = Math.round(lvl * segs);
    for (var i = 0; i < segs; i++) {
        var a = (-135 + 270 * i / (segs - 1)) * Math.PI / 180;
        var x = d.x + Math.sin(a) * 31, y = d.y - Math.cos(a) * 31;
        var f = i / (segs - 1);
        var cr = f < 0.6 ? 0.2 + f * 1.2 : 1.0, cg = f < 0.6 ? 1.0 : 1.0 - (f - 0.6) * 2.3, cb = 0.2;
        var on = i < lit, pk = i === Math.round(PED.peakHold * (segs - 1)) && PED.peakHold > 0.05;
        if (on || pk) {
            pedRgb(cr, cg, cb, 0.18); pedCircle(x, y, 4.2); mgraphics.fill();
            pedRgb(cr, cg, cb, 1); pedCircle(x, y, 2.3); mgraphics.fill();
            pedRgb(1, 1, 1, 0.5); pedCircle(x - 0.5, y - 0.6, 0.8); mgraphics.fill();
        } else {
            pedRgb(0.0, 0.1, 0.05, 0.85); pedCircle(x, y, 2.3); mgraphics.fill();
            pedRgb(cr, cg, cb, 0.12); pedCircle(x, y, 1.4); mgraphics.fill();
        }
    }
}

// ---- model footswitch, LEDs, cab strip, normalize ---------------------------------------------------

function pedModelCount() { return amp.fileModel ? 4 : 3; }
function pedLedPos(i) { return { x: 94, y: 128 + i * 9.5 }; }
var PED_MODEL_LABELS = ["CLEAN", "CRUNCH", "LEAD", "FILE"];

function pedFootswitch() {
    var f = PED.foot, down = PED.drag && PED.drag.key === "foot";
    // status LED above the switch, pulses with the output peak
    var j = amp.dsp.ready ? PED.led : 0.05;
    pedRgb(0.1, 0.1, 0.12); pedCircle(f.x, 117, 5.5); mgraphics.fill();
    for (var k = 3; k >= 1; k--) { pedRgb(1.0, 0.2, 0.1, 0.1 * j * k); pedCircle(f.x, 117, 4 + k * 2.5 * j); mgraphics.fill(); }
    pedRgb(0.4 + 0.6 * j, 0.04 + 0.1 * j, 0.03); pedCircle(f.x, 117, 4); mgraphics.fill();
    pedRgb(1, 0.85, 0.8, 0.3 + 0.5 * j); pedCircle(f.x - 1, 116, 1.2); mgraphics.fill();
    // switch: hex nut, chrome dome
    pedRgb(0, 0, 0, 0.4); pedCircle(f.x + 1, f.y + 2, f.r + 4); mgraphics.fill();
    pedRgb(0.55, 0.58, 0.62); pedCircle(f.x, f.y, f.r + 3.2); mgraphics.fill();
    pedRgb(0.82, 0.84, 0.88); pedCircle(f.x, f.y, f.r + 1.5); mgraphics.fill();
    pedRgb(0.32, 0.34, 0.38); pedCircle(f.x, f.y, f.r - 0.5 + (down ? 0 : 0.5)); mgraphics.fill();
    pedRgb(0.85, 0.87, 0.9); pedCircle(f.x, f.y + (down ? 1 : 0), f.r - 2); mgraphics.fill();
    pedRgb(1, 1, 1, down ? 0.15 : 0.45); pedCircle(f.x - 3.5, f.y - 4 + (down ? 1 : 0), 5); mgraphics.fill();
    pedRgb(0.3, 0.32, 0.36, 0.5); pedCircle(f.x + 3, f.y + 4, 4); mgraphics.fill();
    // model LEDs
    var sel = Math.round(ampP.model), nm = ampModelNames(), have = pedModelCount();
    mgraphics.select_font_face("Arial Bold");
    for (var i = 0; i < 4; i++) {
        var p = pedLedPos(i), on = i === sel, avail = i < have;
        if (on) { pedRgb(1.0, 0.7, 0.2, 0.2); pedCircle(p.x, p.y, 4.6); mgraphics.fill(); }
        pedRgb(0.0, 0.07, 0.04); pedCircle(p.x, p.y, 3); mgraphics.fill();
        if (on) pedRgb(1.0, 0.75, 0.25); else pedRgb(0.3, 0.2, 0.08, avail ? 0.9 : 0.4);
        pedCircle(p.x, p.y, 2.2); mgraphics.fill();
        if (on) pedRgb(1.0, 0.95, 0.7); else pedRgb(0.85, 0.95, 0.85, avail ? 0.75 : 0.35);
        var lab = i === 3 && nm[3] && amp.fileModel ? "FILE" : PED_MODEL_LABELS[i];
        pedText(lab, p.x + 7, p.y + 2.8, 7, 0);
    }
}

function pedCabRects() {
    var out = [], names = AMP_PARAMS.cab[8];
    for (var i = 0; i < 4; i++) out.push({ i: i, x: 132 + i * 21, y: 124, w: 20, h: 13, label: names[i].toUpperCase() });
    return out;
}
function pedNormRect() { return { x: 132, y: 143, w: 62, h: 13 }; }
function pedLoadRect() { return { x: 224, y: 120, w: 52, h: 14 }; }

function pedCabNorm() {
    mgraphics.select_font_face("Arial Bold");
    pedRgb(0.93, 0.97, 0.9, 0.92); pedText("CAB", 132, 120, 7, 0);
    var cab = Math.round(ampP.cab), rs = pedCabRects();
    pedRgb(0.0, 0.08, 0.04, 0.9); mgraphics.rectangle_rounded(131, 123, 86, 15, 3, 3); mgraphics.fill();
    for (var i = 0; i < rs.length; i++) {
        var r = rs[i], on = r.i === cab;
        if (on) { pedRgb(0.95, 0.85, 0.5); mgraphics.rectangle_rounded(r.x + 1, r.y + 1, r.w - 1, r.h, 2, 2); mgraphics.fill(); }
        if (on) pedRgb(0.12, 0.08, 0.02); else pedRgb(0.8, 0.95, 0.8, PED.hover === "cab" + i ? 1 : 0.7);
        pedText(r.label, r.x + r.w / 2 + 0.5, r.y + 10, 7, 1);
    }
    var n = pedNormRect(), on2 = ampP.normalize > 0.5;
    pedRgb(0.0, 0.08, 0.04, 0.9); mgraphics.rectangle_rounded(n.x, n.y, 20, n.h, 6.5, 6.5); mgraphics.fill();
    pedRgb(on2 ? 0.95 : 0.5, on2 ? 0.85 : 0.6, on2 ? 0.5 : 0.55); pedCircle(n.x + (on2 ? 13.5 : 6.5), n.y + 6.5, 4.6); mgraphics.fill();
    pedRgb(0.93, 0.97, 0.9, 0.92); pedText("NORM", n.x + 25, n.y + 10, 7, 0);
}

// ---- plate (model name) / load / title --------------------------------------------------------------

function pedPlate() {
    var x = 250, y = 10, w = 100, h = 56;
    pedRgb(0.0, 0.06, 0.03, 0.85); mgraphics.rectangle_rounded(x, y, w, h, 4, 4); mgraphics.fill();
    pedRgb(0.95, 0.9, 0.6, 0.6); mgraphics.set_line_width(0.75); mgraphics.rectangle_rounded(x + 0.5, y + 0.5, w - 1, h - 1, 4, 4); mgraphics.stroke();
    mgraphics.select_font_face("Arial Bold");
    pedRgb(0.95, 0.9, 0.6, 0.7); pedText("MODEL", x + 6, y + 12, 7, 0);
    var name = amp.model.name ? amp.model.name : "none";
    pedRgb(0.97, 0.95, 0.85); pedText(pedFit(name.toUpperCase(), 11, w - 12), x + 6, y + 27, 11, 0);
    pedRgb(0.6, 0.9, 0.7, 0.9);
    pedText(pedFit(amp.model.label || amp.model.kind || "", 7, w - 12), x + 6, y + 38, 7, 0);
    if (amp.model.error) { pedRgb(1.0, 0.45, 0.35); pedText(pedFit("ERR " + amp.model.error, 7, w - 12), x + 6, y + 49, 7, 0); }
    else if (amp.dsp.error) { pedRgb(1.0, 0.45, 0.35); pedText(pedFit("DSP " + amp.dsp.error, 7, w - 12), x + 6, y + 49, 7, 0); }
    else if (!amp.dsp.ready) { pedRgb(1.0, 0.75, 0.3); pedText("DSP loading", x + 6, y + 49, 7, 0); }
    else { pedRgb(0.6, 0.9, 0.7, 0.6); pedText((amp.model.kind || "") + (amp.model.layers ? " " + amp.model.layers + "L" : ""), x + 6, y + 49, 7, 0); }
}

function pedTitle() {
    var l = pedLoadRect();
    pedRgb(0, 0, 0, 0.35); mgraphics.rectangle_rounded(l.x + 0.5, l.y + 1.5, l.w, l.h, 3, 3); mgraphics.fill();
    pedRgb(0.78, 0.8, 0.84, PED.hover === "load" ? 1 : 0.88); mgraphics.rectangle_rounded(l.x, l.y, l.w, l.h, 3, 3); mgraphics.fill();
    pedRgb(0.12, 0.13, 0.16); mgraphics.select_font_face("Arial Bold");
    pedText("LOAD .nam", l.x + l.w / 2, l.y + 10, 7, 1);
    pedRgb(0.97, 0.94, 0.8);
    mgraphics.select_font_face("Arial Black");
    pedText("AMP PEDAL", 224, 152, 16, 0);
    mgraphics.select_font_face("Arial Bold");
    pedRgb(0.97, 0.94, 0.8, 0.7);
    pedText("NEURAL OVERDRIVE", 224, 161, 7, 0);
    // printed lightning bolt
    pedRgb(0.97, 0.94, 0.8, 0.9);
    mgraphics.move_to(330, 122); mgraphics.line_to(318, 138); mgraphics.line_to(325, 138); mgraphics.line_to(321, 150);
    mgraphics.line_to(336, 132); mgraphics.line_to(328, 132); mgraphics.line_to(334, 122); mgraphics.close_path(); mgraphics.fill();
}

// ---- frame ------------------------------------------------------------------------------------------

function pedUpdate() {
    var target = Math.min(1, ampTel.sat * 0.55 + ampTel.in_pk * 0.9);
    PED.level += (target - PED.level) * 0.4;
    PED.peakHold = Math.max(PED.peakHold - 0.02, Math.min(1, target));
    var led = Math.min(1, 0.15 + ampTel.out_pk * 1.6);
    PED.led += (led - PED.led) * 0.45;
    pedPushTrace(pedTrace(0));
}

function paint() {
    pedUpdate();
    pedEnamel();
    pedCrt();
    pedPlate();
    pedLedRing();
    for (var i = 0; i < PED.knobs.length; i++) pedKnob(PED.knobs[i]);
    pedCabNorm();
    pedFootswitch();
    pedTitle();
}

function ampFaceFrame() { return true; }
function ampFaceChanged(what) { }

// ---- interaction ------------------------------------------------------------------------------------

function pedIn(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

/** @param {number} x @param {number} y */
function pedHit(x, y) {
    for (var i = 0; i < PED.knobs.length; i++) {
        var k = PED.knobs[i], dx = x - k.x, dy = y - k.y, rr = k.r + 4;
        if (dx * dx + dy * dy <= rr * rr) return k.key;
    }
    var f = PED.foot, fx = x - f.x, fy = y - f.y;
    if (fx * fx + fy * fy <= (f.r + 4) * (f.r + 4)) return "foot";
    for (i = 0; i < 4; i++) { var p = pedLedPos(i); if (x >= p.x - 5 && x <= p.x + 36 && Math.abs(y - p.y) <= 4.7) return "model" + i; }
    var cs = pedCabRects();
    for (i = 0; i < cs.length; i++) if (pedIn(x, y, cs[i])) return "cab" + i;
    if (pedIn(x, y, pedNormRect())) return "norm";
    if (pedIn(x, y, pedLoadRect())) return "load";
    return "";
}

function onclick(x, y, but, cmd, shift) {
    var h = pedHit(x, y);
    PED.drag = null;
    if (!h) return;
    if (h === "foot") {
        var n = pedModelCount();
        ampSet("model", (Math.round(ampP.model) + 1) % n);
        PED.drag = { key: "foot" };
    } else if (h.indexOf("model") === 0) {
        var m = Number(h.slice(5));
        if (m === 3 && !amp.fileModel) ampBrowse(); else ampSet("model", m);
    } else if (h.indexOf("cab") === 0) ampSet("cab", Number(h.slice(3)));
    else if (h === "norm") ampSet("normalize", ampP.normalize > 0.5 ? 0 : 1);
    else if (h === "load") ampBrowse();
    else PED.drag = { key: h, y: y, v: pedNorm(h) };
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift) {
    if (!PED.drag) return;
    if (!but) { PED.drag = null; mgraphics.redraw(); return; }
    var d = PED.drag;
    if (d.key === "foot") return;
    var s = AMP_PARAMS[d.key];
    var n = Math.max(0, Math.min(1, d.v + (d.y - y) / (shift ? 600 : 140)));
    ampSet(d.key, s[2] + n * (s[3] - s[2]));
    mgraphics.redraw();
}

function ondblclick(x, y) {
    var h = pedHit(x, y);
    if (h && AMP_PARAMS[h]) ampSet(h, AMP_PARAMS[h][4]);
    mgraphics.redraw();
}

function onidle(x, y) {
    var h = pedHit(x, y);
    if (h !== PED.hover) { PED.hover = h; mgraphics.redraw(); }
}

function onidleout() { PED.hover = ""; mgraphics.redraw(); }

function preview() {
    ampPreviewSetup(0.75);
    PED.hist = [];
    for (var b = 160; b >= 0; b -= 40) pedPushTrace(pedTrace(b));
    PED.level = 0.62; PED.peakHold = 0.8; PED.led = 0.85;
    ampP.input = 8; ampP.bass = 6.5; ampP.mid = 4.5; ampP.treble = 7; ampP.presence = 6; ampP.gate = -60; ampP.output = -3; ampP.mix = 100;
}
