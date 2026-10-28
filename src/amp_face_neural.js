// Neural Amp face, laid out like Ableton's Amp: this canvas is the display at the top left (where Amp draws
// its cabinet), the model tabs, the drop zone and the knob row are native Live widgets under it, Output mode,
// Cabinet, Volume and Dry/Wet sit in the right column. The canvas draws the network the model runs: one
// column of nodes per layer, dilated taps between columns (the spread grows with the dilation), dilation
// arcs, node size and brightness from the per-layer activity, and signal pulses that sweep left to right
// faster and brighter with the output level. The input waveform enters at the left, the output waveform
// leaves at the right. The canvas only draws (ignoreclick): an invisible live.drop over it takes .nam files,
// the native Load button sits in the tab row. Colours come from the Live theme.

var NRL = {
    W: 380, H: 78,
    lcd: { x: 0, y: 0, w: 380, h: 78 },
    px0: 52, px1: 328, py0: 13, py1: 46, rows: 8,
    phase: 0, act: [], tick: 0
};

sptThemeWatch();


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
    sptLcd(L.x, L.y, L.w, L.h, { xs: [], ys: [L.y + 30] });
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
                ar.push([xa + (xb - xa) * u, NRL.lcd.y + 10 - Math.sin(Math.PI * u) * (1.5 + lg * 0.9)]);
            }
            sptCurve(ar, orange, 0.18 + 0.5 * Math.min(1, act[i] * 1.3));
        }
        // array boundaries and channel counts
        var arrs = nrlArrays();
        for (var ai = 0; ai < arrs.length; ai++) {
            var A0 = arrs[ai], xs = nrlColX(A0.start, n), xe = nrlColX(Math.min(n - 1, A0.start + A0.count - 1), n);
            if (ai > 0) {
                var bx = (nrlColX(A0.start - 1, n) + xs) / 2;
                sptCurve([[bx, NRL.lcd.y + 7], [bx, NRL.lcd.y + 51]], sptColor("live_lcd_title"), 0.7);
            }
            var by = NRL.lcd.y + 54;
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
    var wc = L.y + 30;
    nrlWave(nrlWaveIn(), 4, NRL.px0 - 8, wc, 22, orange, 0.9);
    nrlWave(nrlWaveOut(), NRL.px1 + 8, L.w - 4, wc, 22, cyan, 0.95);
    // entry / exit gates
    sptCurve([[NRL.px0 - 5, L.y + 5], [NRL.px0 - 5, L.y + 60]], sptColor("live_lcd_frame"), 1);
    sptCurve([[NRL.px1 + 5, L.y + 5], [NRL.px1 + 5, L.y + 60]], sptColor("live_lcd_frame"), 1);
    sptText("in", 4, L.y + 62, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
    sptText("out", L.w - 4, L.y + 62, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 2);
    // gate reduction pill
    if ((ampTel.gate || 1) < 0.5) sptText("gated", L.w - 6, L.y + 10, sptColor("live_alert"), SPT_SIZE_SMALL, 2);
}

// ---- Analog engine: the circuit's signal flow ------------------------------------------------------
// One box per block of the chain (tube stages grouped, tone stack, power stage, speaker, pedal, tape, compressor,
// transformer), lit by its stage activity; a glyph per kind; meters for supply sag, gain reduction and cone excursion.

/** @param {string} kind @param {number} cx @param {number} cy @param {any} col @param {number} a */
function nrlGlyph(kind, cx, cy, col, a) {
    var al = 0.55 + 0.45 * a;
    if (kind === "triode" || kind === "opamp") {
        sptCurve([[cx - 4, cy - 4], [cx + 4, cy], [cx - 4, cy + 4], [cx - 4, cy - 4]], col, al);
    } else if (kind === "pwr" || kind === "ss") {
        sptCurve([[cx - 6, cy - 4], [cx, cy], [cx - 6, cy + 4], [cx - 6, cy - 4]], col, al);
        sptCurve([[cx, cy - 4], [cx + 6, cy], [cx, cy + 4], [cx, cy - 4]], col, al);
    } else if (kind === "tone") {
        for (var i = -1; i <= 1; i++) { sptRgba(col, al); mgraphics.ellipse(cx + i * 5 - 1.5, cy - 1.5, 3, 3); mgraphics.fill(); }
    } else if (kind === "spk") {
        sptCurve([[cx - 5, cy - 2], [cx - 2, cy - 2], [cx + 4, cy - 6], [cx + 4, cy + 6], [cx - 2, cy + 2], [cx - 5, cy + 2], [cx - 5, cy - 2]], col, al);
    } else if (kind === "ts" || kind === "rat" || kind === "muff" || kind === "fuzz") {
        sptCurve([[cx - 5, cy - 4], [cx + 3, cy], [cx - 5, cy + 4], [cx - 5, cy - 4]], col, al);
        sptCurve([[cx + 3, cy - 4], [cx + 3, cy + 4]], col, al);
    } else if (kind === "tape") {
        sptRgba(col, al); mgraphics.set_line_width(1);
        mgraphics.ellipse(cx - 7, cy - 3.5, 7, 7); mgraphics.stroke();
        mgraphics.ellipse(cx, cy - 3.5, 7, 7); mgraphics.stroke();
    } else if (kind === "opto" || kind === "fet") {
        sptRgba(col, al); mgraphics.set_line_width(1);
        mgraphics.ellipse(cx - 4, cy - 4, 8, 8); mgraphics.stroke();
        sptCurve([[cx - 2, cy + 2], [cx + 2, cy - 2]], col, al);
    } else {
        var pts = [];
        for (var q = 0; q <= 16; q++) pts.push([cx - 6 + q * 0.75, cy + Math.sin(q * Math.PI / 4) * 3]);
        sptCurve(pts, col, al);
    }
}

function nrlAnalog() {
    var L = NRL.lcd;
    sptLcd(L.x, L.y, L.w, L.h, { xs: [], ys: [L.y + 30] });
    var cyan = sptColor("live_display_line_two"), orange = sptColor("live_display_line_one");
    var info = amp.analog.info || aaInfo(Math.round(Number(ampP.circuit) || 0));
    var blocks = info.blocks, n = blocks.length;
    var lv = ampLayers(), lvl = Math.min(1, (ampTel.out_rms || 0) * 5);
    NRL.phase = (NRL.phase + 0.006 + 0.03 * Math.min(1, (ampTel.out_rms || 0) * 4)) % 1;
    var x0 = NRL.px0, x1 = NRL.px1, gap = 5, bw = Math.min(46, (x1 - x0 - gap * (n - 1)) / Math.max(1, n));
    var tot = n * bw + (n - 1) * gap, bx0 = (x0 + x1) / 2 - tot / 2, by = 10, bh = 34;
    var mt = ampMeters(), spkOn = ampP.speaker > 0.5;
    for (var i = 0; i < n; i++) {
        var b = blocks[i], bx = bx0 + i * (bw + gap);
        var a = 0;
        for (var k = 0; k < b.slots.length; k++) a = Math.max(a, Number(lv[b.slots[k]]) || 0);
        if (b.kind === "spk") a = Math.min(1, (mt.exc || 0) * 1.5 + lvl * 0.3);
        if (b.kind === "pwr") a = Math.max(a, mt.sag * 4);
        if (b.kind === "opto" || b.kind === "fet") a = Math.max(a, mt.gr);
        var xp = x0 - 8 + NRL.phase * (x1 - x0 + 16), pulse = Math.exp(-Math.pow((bx + bw / 2 - xp) / 20, 2)) * (0.2 + 0.8 * lvl);
        var aa = Math.max(0, Math.min(1, a * 1.3 + pulse * 0.5));
        var off = b.kind === "spk" && !spkOn;
        var col = b.kind === "spk" || b.kind === "pwr" || b.kind === "ss" ? cyan : orange;
        if (i > 0) sptCurve([[bx - gap, by + bh / 2], [bx, by + bh / 2]], sptColor("live_lcd_frame"), 0.9);
        sptRgba(sptMuted(col, off ? 0.08 : 0.12 + 0.45 * aa));
        mgraphics.rectangle_rounded(bx, by, bw, bh, 4, 4);
        mgraphics.fill();
        sptRgba(sptMuted(col, 0.8), off ? 0.25 : 0.45 + 0.55 * aa);
        mgraphics.set_line_width(1);
        mgraphics.rectangle_rounded(bx + 0.5, by + 0.5, bw - 1, bh - 1, 4, 4);
        mgraphics.stroke();
        nrlGlyph(b.kind, bx + bw / 2, by + 12, col, off ? 0 : aa);
        var nm = b.name + (b.n > 1 ? " x" + b.n : "");
        sptText(nrlFit(off ? "off" : nm, bw - 4, SPT_SIZE_SMALL), bx + bw / 2, by + bh - 5, sptColor("live_lcd_title"), SPT_SIZE_SMALL, 1);
    }
    // meters: supply sag, gain reduction (compressors), cone excursion
    // only the meters this circuit has: supply sag (tube power stage), gain reduction (compressor), cone excursion (speaker)
    var meters = [];
    var has = function (k) { for (var q = 0; q < blocks.length; q++) if (blocks[q].kind === k) return true; return false; };
    if (has("pwr")) meters.push(["sag", Math.min(1, mt.sag * 4), orange]);
    if (has("opto") || has("fet")) meters.push(["GR", Math.min(1, mt.gr), cyan]);
    if (has("spk") && spkOn) meters.push(["cone", Math.min(1, mt.exc), cyan]);
    var nm3 = Math.max(1, meters.length), mw = Math.min(120, (x1 - x0 - (nm3 - 1) * 10) / nm3), mx0 = (x0 + x1) / 2 - (nm3 * mw + (nm3 - 1) * 10) / 2;
    for (var m = 0; m < meters.length; m++) {
        var mx = mx0 + m * (mw + 10), my = 52;
        sptText(meters[m][0], mx, my + 4, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
        var tx = mx + 22, tw = mw - 24;
        sptRgba(sptMuted(cyan, 0.15));
        mgraphics.rectangle(tx, my, tw, 4);
        mgraphics.fill();
        var v = Math.max(0, Math.min(1, Number(meters[m][1]) || 0));
        if (v > 0.002) {
            sptRgba(sptMuted(meters[m][2], 0.85));
            mgraphics.rectangle(tx, my, tw * v, 4);
            mgraphics.fill();
        }
    }
    var wc = L.y + 30;
    nrlWave(nrlWaveIn(), 4, NRL.px0 - 8, wc, 22, orange, 0.9);
    nrlWave(nrlWaveOut(), NRL.px1 + 8, L.w - 4, wc, 22, cyan, 0.95);
    sptCurve([[NRL.px0 - 5, L.y + 5], [NRL.px0 - 5, L.y + 60]], sptColor("live_lcd_frame"), 1);
    sptCurve([[NRL.px1 + 5, L.y + 5], [NRL.px1 + 5, L.y + 60]], sptColor("live_lcd_frame"), 1);
    sptText("in", 4, L.y + 62, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
    sptText("out", L.w - 4, L.y + 62, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 2);
    if ((ampTel.gate || 1) < 0.5) sptText("gated", L.w - 6, L.y + 10, sptColor("live_alert"), SPT_SIZE_SMALL, 2);
}

function nrlLstmX(i, n) { return n === 1 ? (NRL.px0 + NRL.px1) / 2 : NRL.px0 + 20 + i * (NRL.px1 - NRL.px0 - 40) / (n - 1); }

function nrlInfo() {
    var y = 74, m = amp.model, txt, col = sptColor("live_lcd_title");
    if (ampIsAnalog()) {
        var info = amp.analog.info || aaInfo(Math.round(Number(ampP.circuit) || 0));
        if (amp.dspA.error) { txt = "DSP: " + amp.dspA.error; col = sptColor("live_alert"); }
        else if (amp.analog.error) { txt = amp.analog.error; col = sptColor("live_alert"); }
        else if (!amp.dspA.ready) { txt = "DSP loading…"; col = sptColor("live_control_selection"); }
        else txt = info.label + "  ·  " + info.blurb + (ampP.stereo > 0.5 ? "  ·  stereo ×2" : "");
        sptText(nrlFit(txt, NRL.W - 12, SPT_SIZE_SMALL), 6, y, col, SPT_SIZE_SMALL, 0);
        return;
    }
    if (amp.dsp.error) { txt = "DSP: " + amp.dsp.error; col = sptColor("live_alert"); }
    else if (m.error) { txt = m.error; col = sptColor("live_alert"); }
    else if (!amp.dsp.ready) { txt = "DSP loading…"; col = sptColor("live_control_selection"); }
    else {
        var rf = (Number(m.rf) || 0) / 48;
        txt = (m.name || "no model") + "  " + (m.label || "") + "  ·  " + (m.kind || "") + "  ·  receptive field " + rf.toFixed(rf < 10 ? 1 : 0) + " ms" + (ampP.stereo > 0.5 ? "  ·  stereo ×2" : "");
        // GPL captures: name the gear, its author and the license instead of the receptive field
        if (m.credit) txt = (m.name || "") + "  ·  " + m.credit + (ampP.stereo > 0.5 ? "  ·  stereo ×2" : "");
    }
    sptText(nrlFit(txt, NRL.W - 12, SPT_SIZE_SMALL), 6, y, col, SPT_SIZE_SMALL, 0);
}

function paint() {
    if (ampIsAnalog()) nrlAnalog();
    else nrlNetwork();
    nrlInfo();
}

function ampFaceFrame() { return true; }
function ampFaceChanged(what) { }

// The canvas is ignoreclick (the .nam drop zone lies over it): no mouse handlers.

function preview() {
    // M4L_AMP_PREVIEW_CIRCUIT (render_preview.py env passthrough, see build) renders the Analog face of that circuit
    var pc = typeof AMP_PREVIEW_CIRCUIT === "number" ? AMP_PREVIEW_CIRCUIT : -1;
    ampPreviewSetup(0.75, pc);
    NRL.phase = 0.35;
    for (var i = 0; i < 4; i++) nrlActivity(nrlLayerCount());
    ampP.gain = 4; ampP.bass = 6; ampP.mid = 4.5; ampP.treble = 6.5; ampP.presence = 5.5; ampP.cab = 2;
}
