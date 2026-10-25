// Delay+ LFO display (Echo Modulation tab look): L/R waveforms + six shape icons.
// Standalone v8ui. Inputs: names <xfer> <hdr> <scope>, set_<param>, onclick on icons.
mgraphics.init(); mgraphics.relative_coords = 0; mgraphics.autofill = 0;
inlets = 1; outlets = 1;

var shape = 0, phase = 0, moddelay = 0, modfilt = 0, envmix = 0;
var x4 = 0, lfosync = 1, lfohz = 1, lfodiv = 0;
var scopeName = "", scopeBuf = null, lfoL = null, lfoR = null, lfoTask = null;
var page = 0; // Delay+ Page (set_page): 1 = Modulation
var C_L = [0.43, 0.78, 0.94], C_R = [0.96, 0.64, 0.23];
var ICON_H = 16, NICON = 6;

function lfoHash(n) {
    var s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
}
function lfoWave(sh, p) {
    var f = p - Math.floor(p);
    if (sh === 0) return Math.sin(f * 2 * Math.PI);
    if (sh === 1) return f < 0.5 ? f * 4 - 1 : 3 - f * 4;
    if (sh === 2) return f * 2 - 1;
    if (sh === 3) return 1 - f * 2;
    if (sh === 4) return f < 0.5 ? 1 : -1;
    return lfoHash(Math.floor(p * 4));
}
function lfoAmp() {
    var a = Math.max(moddelay, modfilt) / 100;
    if (!(a > 0)) return 0.9;
    return 0.25 + 0.65 * Math.min(1, a);
}
function lfoY(v, y0, h, amp) {
    return y0 + h * 0.5 - v * amp * (h * 0.5 - 4);
}

function anything() {
    var n = messagename;
    if (n === "names") {
        scopeName = arguments.length > 2 ? String(arguments[2]) : "";
        scopeBuf = null;
        startTask();
        return;
    }
    if (n.indexOf("set_") !== 0) return;
    var v = arguments.length ? Number(arguments[0]) : 0;
    if (isNaN(v)) v = 0;
    var k = n.substring(4);
    if (k === "lfoshape") shape = Math.max(0, Math.min(NICON - 1, Math.round(v)));
    else if (k === "phase") phase = v;
    else if (k === "moddelay") moddelay = v;
    else if (k === "modfilt") modfilt = v;
    else if (k === "envmix") envmix = v;
    else if (k === "x4") x4 = v;
    else if (k === "lfosync") lfosync = v;
    else if (k === "lfohz") lfohz = v;
    else if (k === "lfodiv") lfodiv = v;
    else if (k === "page") page = v;
    // Live dots and the waveform redraw on the Modulation page. Opening that page paints once.
    if (page !== 1) return;
    mgraphics.redraw();
}

function startTask() {
    if (lfoTask) return;
    try {
        lfoTask = new Task(lfoFrame, this);
        lfoTask.interval = 33;
        lfoTask.repeat();
    } catch (e) { lfoTask = null; }
}
function lfoFrame() {
    if (!scopeBuf && scopeName) {
        try { scopeBuf = new Buffer(scopeName); } catch (e) { scopeBuf = null; }
    }
    if (!scopeBuf || page !== 1) return; // the live dots only move on the Modulation page
    var a = null;
    try { a = scopeBuf.peek(1, DP_SCOPE.LFO_L, 2); } catch (e2) { a = null; }
    if (!a || a.length < 2 || isNaN(a[0]) || isNaN(a[1])) return;
    if (a[0] === lfoL && a[1] === lfoR) return;
    lfoL = a[0]; lfoR = a[1];
    mgraphics.redraw();
}

function preview() { shape = 0; phase = 180; moddelay = 70; modfilt = 0; }

function iconRect(i, w, h) {
    var cw = Math.min(26, (w - 8) / NICON), tot = cw * NICON;
    return [(w - tot) / 2 + i * cw, h - ICON_H, cw, ICON_H];
}

function onclick(x, y) {
    var w = mgraphics.size[0], h = mgraphics.size[1];
    if (y < h - ICON_H) return;
    for (var i = 0; i < NICON; i++) {
        var r = iconRect(i, w, h);
        if (x >= r[0] && x < r[0] + r[2]) {
            shape = i;
            outlet(0, "lfoshape", i);
            mgraphics.redraw();
            return;
        }
    }
}
function ondblclick(x, y) { onclick(x, y); }

function drawIcon(mg, i, cx, cy, sel) {
    var hw = 6, hh = 4, c = sel ? C_R : dpTheme("live_lcd_title", [0.58, 0.60, 0.64, 1]);
    mg.set_source_rgba(c[0], c[1], c[2], 1);
    mg.set_line_width(sel ? 1.4 : 1.1);
    var n, k, p;
    if (i === 0 || i === 1 || i === 5) {
        for (k = 0; k <= 16; k++) {
            p = k / 16;
            var v = i === 0 ? Math.sin(p * 2 * Math.PI) : i === 1 ? lfoWave(1, p) : 0;
            if (i === 5) v = [0.3, -0.6, 0.8, -0.2][Math.min(3, Math.floor(p * 4))];
            var px = cx - hw + p * 2 * hw, py = cy - v * hh;
            if (i === 5 && k > 0 && Math.floor(p * 4) !== Math.floor((k - 1) / 16 * 4)) {
                mg.line_to(px, py);
            }
            if (k === 0) mg.move_to(px, py); else mg.line_to(px, py);
        }
        mg.stroke();
    } else if (i === 2) {
        mg.move_to(cx - hw, cy + hh); mg.line_to(cx, cy - hh); mg.line_to(cx, cy + hh);
        mg.line_to(cx + hw, cy - hh); mg.stroke();
    } else if (i === 3) {
        mg.move_to(cx - hw, cy - hh); mg.line_to(cx, cy + hh); mg.line_to(cx, cy - hh);
        mg.line_to(cx + hw, cy + hh); mg.stroke();
    } else {
        mg.move_to(cx - hw, cy + hh); mg.line_to(cx - hw, cy - hh); mg.line_to(cx, cy - hh);
        mg.line_to(cx, cy + hh); mg.line_to(cx + hw, cy + hh); mg.line_to(cx + hw, cy - hh);
        mg.stroke();
    }
}

var lfThemeTask = dpThemeWatch();

function paint() {
    C_L = dpTheme("live_display_line_one", [0.43, 0.78, 0.94, 1]);
    C_R = dpTheme("live_display_line_two", [0.96, 0.64, 0.23, 1]);
    var lfBg = dpTheme("live_lcd_bg", [0.075, 0.075, 0.075, 1]);
    var mg = mgraphics, w = mg.size[0], h = mg.size[1];
    mg.set_source_rgba(lfBg[0], lfBg[1], lfBg[2], 1);
    mg.rectangle(0, 0, w, h); mg.fill();
    var wh = h - ICON_H - 4, amp = lfoAmp();
    var dim = (Math.max(moddelay, modfilt) > 0) ? 1 : 0.55;
    var em = Math.max(0, Math.min(1, envmix / 100));
    var cyc = 2, N = Math.max(60, Math.floor(w)), pOff = phase / 360;
    var chans = [[C_L, 0], [C_R, pOff]], ci, k;
    // zero line
    mg.set_source_rgba(0.25, 0.26, 0.29, 1); mg.set_line_width(1);
    mg.move_to(0, wh / 2 + 0.5); mg.line_to(w, wh / 2 + 0.5); mg.stroke();
    var a2 = amp * (1 - em);
    for (ci = 0; ci < 2; ci++) {
        var col = chans[ci][0], off = chans[ci][1];
        mg.set_line_width(2);
        mg.set_source_rgba(col[0], col[1], col[2], dim);
        var prevStep = -1, started = false;
        for (k = 0; k <= N; k++) {
            var px = k / N * w, ph = k / N * cyc + off;
            var v = lfoWave(shape, ph);
            var py = lfoY(v, 1, wh, a2);
            if (shape === 4 || shape === 5 || shape === 2 || shape === 3) {
                // draw vertical edges for discontinuities
                if (started) {
                    var pv = lfoWave(shape, (k - 1) / N * cyc - off);
                    if (Math.abs(v - pv) > 0.6) mg.line_to(px, lfoY(pv, 1, wh, a2));
                }
            }
            if (!started) { mg.move_to(px, py); started = true; } else mg.line_to(px, py);
        }
        mg.stroke();
        // envelope blend line
        if (em > 0) {
            mg.set_source_rgba(col[0], col[1], col[2], 0.35 * em);
            mg.set_line_width(1.5);
            var ey = 1 + wh * 0.5 - 0.5 * amp * em * (wh * 0.5 - 4);
            mg.move_to(0, ey + ci * 2); mg.line_to(w, ey + ci * 2); mg.stroke();
        }
        var lv = ci === 0 ? lfoL : lfoR;
        if (lv !== null && !isNaN(lv)) {
            var dy = lfoY(Math.max(-1, Math.min(1, lv)), 1, wh, a2);
            mg.set_source_rgba(1, 1, 1, 0.9);
            mg.ellipse(w - 8 - ci * 0, dy - 3, 6, 6); mg.fill();
            mg.set_source_rgba(col[0], col[1], col[2], 1);
            mg.ellipse(w - 7, dy - 2, 4, 4); mg.fill();
        }
    }
    // icons
    for (var i = 0; i < NICON; i++) {
        var r = iconRect(i, w, h);
        drawIcon(mg, i, r[0] + r[2] / 2, r[1] + r[3] / 2 + 1, i === shape);
    }
}
