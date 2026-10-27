// Neural Amp face, laid out like Ableton's Amp: this canvas is the display at the top left (where Amp draws
// its cabinet), the model tabs, the drop zone and the knob row are native Live widgets under it, Output mode,
// Cabinet, Volume and Dry/Wet sit in the right column. The canvas draws the network the model runs: one
// column of nodes per layer, dilated taps between columns (the spread grows with the dilation), dilation
// arcs, node size and brightness from the per-layer activity, and signal pulses that sweep left to right
// faster and brighter with the output level. The input waveform enters at the left, the output waveform
// leaves at the right. Load .nam sits in the display's top-right corner. Colours come from the Live theme.

var NRL = {
    W: 380, H: 89,
    lcd: { x: 0, y: 0, w: 380, h: 89 },
    px0: 52, px1: 328, py0: 26, py1: 55, rows: 7,
    phase: 0, hover: "", act: [], tick: 0
};

sptThemeWatch();

function nrlLoadRect() { return { x: 310, y: 2, w: 67, h: 14 }; }
function nrlIn(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

/** @param {string} s @param {number} maxW @param {number} size */
function nrlFit(s, maxW, size) {
    var t = String(s);
    if (sptTextW(t, size) <= maxW) return t;
    while (t.length > 2 && sptTextW(t + "…", size) > maxW) t = t.slice(0, -1);
    return t + "…";
}

/** Real per-layer dilations (all arrays in order). */
function nrlDils() {
    var d = amp.model.dilations;
    if (d && d.length) return d;
    var n = Math.round(Number(amp.model.layers) || 0);
    var out = [];
    for (var i = 0; i < (n > 0 ? n : 12); i++) out.push(Math.pow(2, i % 8));
    return out;
}

function nrlLayerCount() { return Math.min(nrlDils().length, 40); }

/** Dilation of layer i. */
function nrlDilation(i, n) {
    var d = nrlDils();
    return d[Math.min(i, d.length - 1)] || 1;
}

/** Array boundaries: [{start, count, ch}] over the layer columns. */
function nrlArrays() {
    var a = amp.model.arrays, out = [], at = 0;
    if (a && a.length) {
        for (var i = 0; i < a.length; i++) {
            var c = a[i].dilations ? a[i].dilations.length : 1;
            out.push({ start: at, count: c, ch: a[i].ch });
            at += c;
        }
    }
    return out;
}

function nrlColX(i, n) { return NRL.px0 + (n > 1 ? i * (NRL.px1 - NRL.px0) / (n - 1) : 0.5 * (NRL.px1 - NRL.px0)); }
function nrlRowY(r) { return NRL.py0 + r * (NRL.py1 - NRL.py0) / (NRL.rows - 1); }

function nrlLoadButton() {
    var l = nrlLoadRect(), hv = NRL.hover === "load";
    sptRgba(sptColor(hv ? "live_control_selection" : "live_control_bg"));
    mgraphics.rectangle(l.x, l.y, l.w, l.h);
    mgraphics.fill();
    var fg = sptColor(hv ? "live_lcd_bg" : "live_control_fg");
    // folder glyph
    sptRgba(fg);
    mgraphics.set_line_width(1);
    mgraphics.move_to(l.x + 5.5, l.y + 11);
    mgraphics.line_to(l.x + 5.5, l.y + 3.5);
    mgraphics.line_to(l.x + 9, l.y + 3.5);
    mgraphics.line_to(l.x + 10.5, l.y + 5);
    mgraphics.line_to(l.x + 15.5, l.y + 5);
    mgraphics.line_to(l.x + 15.5, l.y + 11);
    mgraphics.line_to(l.x + 5.5, l.y + 11);
    mgraphics.stroke();
    sptText("Load .nam", l.x + 19, l.y + 10.5, fg, SPT_SIZE_SMALL, 0);
}

/** Smoothed activity per column, resampled when the layer count differs from what the engine reports. */
function nrlActivity(n) {
    var src = ampLayers(), out = [], k = ampTel.out_rms || 0;
    for (var i = 0; i < n; i++) {
        var v = src.length ? Number(src[Math.min(src.length - 1, Math.floor(i * src.length / n))]) || 0 : 0;
        var prev = NRL.act[i] === undefined ? v : NRL.act[i];
        out.push(prev + (v - prev) * 0.4);
    }
    NRL.act = out;
    return out;
}

function nrlWave(vals, x0, x1, yc, amp_, col, a) {
    if (!vals.length) return;
    var pts = [], n = vals.length;
    for (var i = 0; i < n; i++) {
        var v = Math.max(-1, Math.min(1, vals[i] * 1.6));
        pts.push([x0 + (x1 - x0) * i / (n - 1), yc - v * amp_]);
    }
    sptCurve(pts, col, a);
}

function nrlWaveIn() {
    var xy = ampXY(120), v = [];
    for (var i = 0; i < xy.length; i++) v.push(xy[i][0]);
    return v;
}
function nrlWaveOut() {
    var o = ampOutRing(480), v = [];
    for (var i = 0; i + 3 < o.length; i += 4) v.push(Math.max(o[i], o[i + 1], o[i + 2], o[i + 3]) > -Math.min(o[i], o[i + 1], o[i + 2], o[i + 3]) ? Math.max(o[i], o[i + 1], o[i + 2], o[i + 3]) : Math.min(o[i], o[i + 1], o[i + 2], o[i + 3]));
    return v;
}

function nrlNetwork() {
    var L = NRL.lcd;
    sptLcd(L.x, L.y, L.w, L.h, { xs: [], ys: [L.y + 42] });
    var cyan = sptColor("live_display_line_two"), orange = sptColor("live_display_line_one");
    var kind = amp.model.kind, n = nrlLayerCount();
    var lvl = Math.min(1, (ampTel.out_rms || 0) * 5 + (ampTel.sat || 0) * 0.3);
    var act, i, r;
    NRL.phase = (NRL.phase + 0.006 + 0.03 * Math.min(1, (ampTel.out_rms || 0) * 4)) % 1;
    var pulses = [NRL.phase, (NRL.phase + 0.5) % 1];
    function boost(x) {
        var b = 0;
        for (var p = 0; p < pulses.length; p++) {
            var xp = NRL.px0 - 8 + pulses[p] * (NRL.px1 - NRL.px0 + 16);
            var d = (x - xp) / 16;
            b = Math.max(b, Math.exp(-d * d));
        }
        return b * (0.25 + 0.75 * lvl);
    }
    if (kind === "LSTM") {
        n = Math.max(1, Math.min(4, n));
        act = nrlActivity(n);
        for (i = 0; i < n; i++) {
            var cx = NRL.px0 + 20 + i * (NRL.px1 - NRL.px0 - 40) / Math.max(1, n - 1);
            if (n === 1) cx = (NRL.px0 + NRL.px1) / 2;
            var cw = 34, ch = 30, cy = (NRL.py0 + NRL.py1) / 2 - ch / 2;
            var a = Math.min(1, act[i] * 1.4 + boost(cx) * 0.5);
            if (i < n - 1) sptCurve([[cx + cw / 2, cy + ch / 2], [nrlLstmX(i + 1, n) - cw / 2, cy + ch / 2]], cyan, 0.5);
            sptRgba(sptMuted(orange, 0.25 + 0.55 * a));
            mgraphics.rectangle_rounded(cx - cw / 2, cy, cw, ch, 6, 6);
            mgraphics.fill();
            sptRgba(sptMuted(orange, 0.8), 0.4 + 0.6 * a);
            mgraphics.set_line_width(1);
            mgraphics.rectangle_rounded(cx - cw / 2 + 0.5, cy + 0.5, cw - 1, ch - 1, 6, 6);
            mgraphics.stroke();
            // recurrent loop (polyline) above the cell
            var loop = [];
            for (var s = 0; s <= 16; s++) {
                var t = Math.PI * s / 16;
                loop.push([cx + Math.cos(Math.PI - t) * 11, cy - 3 - Math.sin(t) * 9]);
            }
            sptCurve(loop, orange, 0.5 + 0.5 * a);
            sptText("LSTM " + (i + 1), cx, cy + ch / 2 + 3, sptColor("live_lcd_bg"), SPT_SIZE_SMALL, 1);
        }
    } else {
        act = nrlActivity(n);
        // dilated taps between columns
        for (i = 0; i < n - 1; i++) {
            var x0 = nrlColX(i, n), x1 = nrlColX(i + 1, n);
            var dil = nrlDilation(i, n);
            var sp = Math.min(4, Math.round(Math.log(dil) / Math.LN2 * 0.5));
            var a2 = Math.min(1, act[i] * 1.2 + boost(x0) * 0.7);
            for (r = 0; r < NRL.rows; r++) {
                var offs = sp > 0 ? [0, -sp, sp] : [0];
                for (var o = 0; o < offs.length; o++) {
                    var r2 = r + offs[o];
                    if (r2 < 0 || r2 >= NRL.rows) continue;
                    var ya = nrlRowY(r), yb = nrlRowY(r2);
                    sptCurve([[x0, ya], [(x0 + x1) / 2, (ya + yb) / 2], [x1, yb]], offs[o] === 0 ? cyan : orange,
                        (offs[o] === 0 ? 0.1 : 0.06) + (offs[o] === 0 ? 0.4 : 0.22) * a2);
                }
            }
        }
        // dilation arcs from the real values: the arc over layer i spans (and is as tall as) log2(dilation)
        for (i = 0; i < n; i++) {
            var dl = nrlDilation(i, n), lg = Math.log(dl) / Math.LN2;
            if (lg < 1) continue;
            var span = Math.min(n - 1 - i, Math.max(1, Math.round(lg * 0.8)));
            if (span < 1) continue;
            var xa = nrlColX(i, n), xb = nrlColX(i + span, n), ar = [];
            for (var q = 0; q <= 14; q++) {
                var u = q / 14;
                ar.push([xa + (xb - xa) * u, NRL.lcd.y + 23 - Math.sin(Math.PI * u) * (1.5 + lg * 0.9)]);
            }
            sptCurve(ar, orange, 0.18 + 0.5 * Math.min(1, act[i] * 1.3));
        }
        // array boundaries and channel counts
        var arrs = nrlArrays();
        for (var ai = 0; ai < arrs.length; ai++) {
            var A0 = arrs[ai], xs = nrlColX(A0.start, n), xe = nrlColX(Math.min(n - 1, A0.start + A0.count - 1), n);
            if (ai > 0) {
                var bx = (nrlColX(A0.start - 1, n) + xs) / 2;
                sptCurve([[bx, NRL.lcd.y + 20], [bx, NRL.lcd.y + 60]], sptColor("live_lcd_title"), 0.7);
            }
            var by = NRL.lcd.y + 63;
            sptCurve([[xs - 3, by - 3], [xs - 3, by], [xe + 3, by], [xe + 3, by - 3]], sptColor("live_display_scale_text"), 0.9);
            sptText("array " + (ai + 1) + " · " + A0.ch + " ch", (xs + xe) / 2, by + 8.5, sptColor("live_lcd_title"), SPT_SIZE_SMALL, 1);
        }
        // nodes
        for (i = 0; i < n; i++) {
            var x = nrlColX(i, n);
            var aa = Math.min(1, act[i] * 1.5 + boost(x) * 0.55);
            var rad = 1.2 + 1.8 * aa;
            for (r = 0; r < NRL.rows; r++) {
                var wob = 0.6 + 0.4 * Math.sin(i * 1.9 + r * 2.3 + NRL.tick * 0.05 * (0.3 + lvl));
                var na = Math.max(0, Math.min(1, aa * wob));
                sptRgba(sptMix(sptMuted(cyan, 0.55), orange, na), 0.45 + 0.55 * na);
                mgraphics.ellipse(x - rad, nrlRowY(r) - rad, 2 * rad, 2 * rad);
                mgraphics.fill();
            }
        }
    }
    NRL.tick++;
    // waveforms at both ends
    var wc = L.y + 42;
    nrlWave(nrlWaveIn(), 4, NRL.px0 - 8, wc, 20, orange, 0.9);
    nrlWave(nrlWaveOut(), NRL.px1 + 8, L.w - 4, wc, 20, cyan, 0.95);
    // entry / exit gates
    sptCurve([[NRL.px0 - 5, L.y + 19], [NRL.px0 - 5, L.y + 70]], sptColor("live_lcd_frame"), 1);
    sptCurve([[NRL.px1 + 5, L.y + 19], [NRL.px1 + 5, L.y + 70]], sptColor("live_lcd_frame"), 1);
    sptText("in", 4, L.y + 25, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
    sptText("out", L.w - 4, L.y + 25, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 2);
    var dls = nrlDils(), dmin = Math.min.apply(null, dls), dmax = Math.max.apply(null, dls);
    var arrN = nrlArrays().length;
    var cap = kind === "LSTM" ? arrN + " LSTM layers · " + (arrN ? amp.model.arrays[0].ch : 0) + " hidden"
        : arrN + (arrN === 1 ? " array · " : " arrays · ") + dls.length + " layers · d " + dmin + (dmax > dmin ? "–" + dmax : "");
    if (ampP.stereo > 0.5) cap += " · stereo ×2";
    sptText(nrlFit(cap, 230, SPT_SIZE_SMALL), 188, L.y + 11, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 1);
    // gate reduction pill
    if ((ampTel.gate || 1) < 0.5) sptText("gated", nrlLoadRect().x - 5, L.y + 11, sptColor("live_alert"), SPT_SIZE_SMALL, 2);
}

function nrlLstmX(i, n) { return n === 1 ? (NRL.px0 + NRL.px1) / 2 : NRL.px0 + 20 + i * (NRL.px1 - NRL.px0 - 40) / (n - 1); }

function nrlInfo() {
    var y = 84, m = amp.model, txt, col = sptColor("live_lcd_title");
    if (amp.dsp.error) { txt = "DSP: " + amp.dsp.error; col = sptColor("live_alert"); }
    else if (m.error) { txt = m.error; col = sptColor("live_alert"); }
    else if (!amp.dsp.ready) { txt = "DSP loading…"; col = sptColor("live_control_selection"); }
    else {
        var rf = (Number(m.rf) || 0) / 48;
        txt = (m.name || "no model") + "  " + (m.label || "") + "  ·  " + (m.kind || "") + "  ·  receptive field " + rf.toFixed(rf < 10 ? 1 : 0) + " ms";
    }
    sptText(nrlFit(txt, NRL.W - 12, SPT_SIZE_SMALL), 6, y, col, SPT_SIZE_SMALL, 0);
}

function paint() {
    nrlNetwork();
    nrlLoadButton();
    nrlInfo();
}

function ampFaceFrame() { return true; }
function ampFaceChanged(what) { }

function nrlHit(x, y) {
    if (nrlIn(x, y, nrlLoadRect())) return "load";
    return "";
}

function onclick(x, y) {
    var h = nrlHit(x, y);
    if (!h) return;
    if (h === "load") ampBrowse();
    mgraphics.redraw();
}

function ondrag() { }
function ondblclick() { }

function onidle(x, y) {
    var h = nrlHit(x, y);
    if (h !== NRL.hover) { NRL.hover = h; mgraphics.redraw(); }
}
function onidleout() { NRL.hover = ""; mgraphics.redraw(); }

function preview() {
    ampPreviewSetup(0.75);
    NRL.phase = 0.35;
    for (var i = 0; i < 4; i++) nrlActivity(nrlLayerCount());
    ampP.gain = 4; ampP.bass = 6; ampP.mid = 4.5; ampP.treble = 6.5; ampP.presence = 5.5; ampP.cab = 2;
}
