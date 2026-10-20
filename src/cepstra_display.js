// Cepstra display: dot-matrix CEPSTRUM — the signed real Mid cepstrum c[n] against LINEAR quefrency (n = 0 at the
// left edge, 20 ms at the right), zero line at mid-height, one stem of dots per column, with the draggable cutoff bar.
// This v8ui is interactive (it is the only part of the face that handles the mouse); the controls on the left
// are drawn by the face v8ui (ignoreclick) under transparent live.* widgets. src/cepstra_config.js is prepended.
//
// Messages in:  setbuffer <scopeBufName>, set_res <pct>, set_mode <0|1|2>, set_quality <0|1|2>, midi_note <n>
// Messages out: ["res", pct]  (patcher mirrors it into the Res dial with `set` and into gen)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var ORIGIN_X = 290;   // this v8ui sits at x = 290 of the 520 px device (used to continue the outer frame)
var DEVICE_W = 520;
var ORANGE = [1.0, 0.56, 0.10];
var BLUE = [0.30, 0.58, 1.0];
var GREEN = [0.22, 0.92, 0.46];
var WHITE = [0.94, 0.94, 0.94];
var MONO = "Courier New";

var scopeBuf = null;
var uiTask = null;
var uiIdleFrames = 0;
var dragging = false;

var curRes = DEFAULT_RES_PCT;
var curMode = 0;
var curQuality = 1;
var curMidiNote = -1;

var cepRaw = [];      // telemetry (signed c[n] per column, QUEF_SENTINEL beyond N/2)
var cepDisp = [];     // lightly smoothed copy (0.5 one-pole)
var cepValid = [];
for (var qi = 0; qi < NUM_QUEF; qi++) { cepRaw.push(QUEF_SENTINEL); cepDisp.push(0); cepValid.push(false); }
var refGain = 1;      // slowly adapting auto-gain reference (p95 of |c| for n >= 2)
var readoutTask = null;
var readoutOn = false;
var lagSamps = 123;
var f0Hz = 0;
var voiced = 0;
var levelLin = 0;
var nFft = 2048;
var srNow = 44100;

function emit(msg, v) { outlet(0, [msg, v]); }

function showReadout() {
    readoutOn = true;
    if (typeof Task === "function") {
        if (readoutTask) readoutTask.cancel();
        readoutTask = new Task(function () { readoutOn = false; mgraphics.redraw(); }, this);
        readoutTask.schedule(1000);
    }
}

function set_res(v) {
    v = clamp(Number(v), 0, 100);
    if (v !== curRes) showReadout();
    curRes = v;
    mgraphics.redraw();
}
function set_mode(v) { curMode = clamp(Math.round(Number(v)), 0, 2); mgraphics.redraw(); }
function set_quality(v) { curQuality = clamp(Math.round(Number(v)), 0, 2); nFft = fftSizeForQuality(curQuality); mgraphics.redraw(); }
function midi_note(v) { curMidiNote = Number(v); mgraphics.redraw(); }

function setbuffer(scopeName) {
    if (scopeName) scopeBuf = new Buffer("" + scopeName);
}

function numAt(chunk, idx) {
    if (typeof chunk === "number") return idx === 0 ? chunk : 0;
    if (!chunk || !chunk.length || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (v === v) ? v : 0;
}

// Returns true while something is moving / audible so v8ui keeps redrawing; false when silent and settled.
function pullScope() {
    if (!scopeBuf) return false;
    var chunk = scopeBuf.peek(1, 0, SCOPE_SAMPS);
    levelLin = numAt(chunk, 258);
    var silent = levelLin < 0.00001;
    lagSamps = numAt(chunk, 256) || lagSamps;
    f0Hz = numAt(chunk, 257);
    voiced = numAt(chunk, 261) > 0.5 ? 1 : 0;
    var n = numAt(chunk, 260);
    if (n > 0) nFft = n;
    var b;
    for (b = 0; b < NUM_QUEF; b++) {
        var raw = numAt(chunk, b);
        cepRaw[b] = raw;
        cepValid[b] = Math.abs(raw) < QUEF_SENTINEL;
    }
    if (!silent) refGain = adaptRef(refGain, Math.max(percentileAbs(cepRaw, 1, 0.95), 0.02));
    var moving = false;
    for (b = 0; b < NUM_QUEF; b++) {
        var target = (silent || !cepValid[b]) ? 0 : cepRaw[b];
        var d = target - cepDisp[b];
        cepDisp[b] += d * 0.5;
        if (Math.abs(d) > 0.004) moving = true;
    }
    if (moving || !silent) {
        uiIdleFrames = 0;
        return true;
    }
    uiIdleFrames = Math.min(uiIdleFrames + 1, 100);
    return uiIdleFrames <= 2;
}

function loadbang() {
    if (typeof Task === "function") {
        uiTask = new Task(function () {
            if (pullScope()) mgraphics.redraw();
        }, this);
        uiTask.interval = 33;
        uiTask.repeat();
    }
    mgraphics.redraw();
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [230, 169];
    return [s[0], s[1]];
}

// Display geometry in this v8ui's own coordinates (absolute x 296..512 minus ORIGIN_X)
function layoutRegions() {
    var cs = canvasSize();
    return { w: cs[0], h: cs[1], disp: { x: 6, y: 6, w: 216, h: 154, plotY: 30, plotH: 125, splitY: 8 } };
}

function periodSamplesNow() {
    if (curMode === 1 && f0Hz > 20) return srNow / f0Hz;
    if (curMode === 2 && curMidiNote >= 0) return midiPeriodSamples(curMidiNote, srNow);
    return 0;
}

// The lag the bar shows: live telemetry when audio runs, otherwise the value implied by Res.
function displayLagSamples() {
    if (levelLin >= 0.00001 && lagSamps > 0) return lagSamps;
    return lifterLagSamples(curMode, curRes / 100, srNow, nFft, periodSamplesNow());
}

function barAxis01() {
    return msToAxis01(lagToMs(displayLagSamples(), srNow));
}


function setResFromDisplayX(x) {
    var r = layoutRegions();
    var t = clamp((x - r.disp.x) / r.disp.w, 0, 1);
    var res01 = axis01ToRes(curMode, t, srNow, nFft, periodSamplesNow());
    var v = Math.round(res01 * 1000) / 10;
    if (v === curRes) return;
    curRes = v;
    showReadout();
    emit("res", v);
    mgraphics.redraw();
}

function onclick(x, y) {
    var r = layoutRegions();
    dragging = false;
    if (x >= r.disp.x && x <= r.disp.x + r.disp.w && y >= 0 && y <= r.h) {
        dragging = true;
        setResFromDisplayX(x);
    }
}

function ondrag(x, y) {
    if (dragging) setResFromDisplayX(x);
}

function ondblclick() {
    curRes = DEFAULT_RES_PCT;
    emit("res", curRes);
    mgraphics.redraw();
}

function noteName(n) {
    var names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    var m = Math.round(n);
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

// Static demo state (used by the screenshot preview when no scope buffer is bound).
function preview() {
    // Realistic synthetic vowel cepstrum: dense decaying bipolar formant scatter near n = 0, a clear positive pitch
    // peak at 1/f0 with decaying rahmonics at multiples, and a thin noisy floor elsewhere.
    var f0 = 120;
    var per = 1000 / f0;
    var seed = 7;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; }
    for (var b = 0; b < NUM_QUEF; b++) {
        var ms = (b + 0.5) * QUEF_MAX_MS / NUM_QUEF;
        var c = 2.6 * Math.exp(-ms / 1.7) * Math.cos(2 * Math.PI * ms / 0.9 + 0.6) + 1.2 * Math.exp(-ms / 3.2) * Math.cos(2 * Math.PI * ms / 2.3 + 2.0);
        for (var m = 1; m <= 2; m++) c += (0.55 / m) * Math.exp(-Math.pow((ms - per * m) / 0.16, 2));
        c += 0.014 * rnd() * (1 + 3 * Math.exp(-ms / 3));
        if (b === 0) c = 11;
        cepRaw[b] = c;
        cepValid[b] = true;
    }
    refGain = Math.max(percentileAbs(cepRaw, 1, 0.95), 0.02);
    for (var b2 = 0; b2 < NUM_QUEF; b2++) cepDisp[b2] = cepRaw[b2];
    curMode = 1;
    curRes = DEFAULT_RES_PCT;
    f0Hz = 120;
    voiced = 1;
    levelLin = 0.35;
    lagSamps = (0.3 + 0.7 * DEFAULT_RES_PCT / 100) * srNow / f0;
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers

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

function drawDisplay(r) {
    var d = r.disp;
    var step = 5;
    var cols = Math.floor(d.w / step);
    var rows = Math.floor(d.plotH / step);
    var mid = Math.floor(rows / 2);
    var half = mid;
    var barT = barAxis01();
    var barX = d.x + barT * d.w;
    var tracked = curMode !== 0;

    // Split bar: FORMANTS (orange) | HARMONICS (blue)
    textAt("FORMANTS", d.x + 1, d.splitY + 8, 7.5, ORANGE, 1.0);
    textAt("HARMONICS", d.x + d.w - textW("HARMONICS", 7.5) - 5, d.splitY + 8, 7.5, BLUE, 1.0);
    var by = d.splitY + 15;
    lineSeg(d.x, by, barX, by, ORANGE, 1.0, 1.6);
    lineSeg(d.x, by - 3, d.x, by + 3, ORANGE, 1.0, 1.4);
    lineSeg(barX, by, d.x + d.w, by, BLUE, 1.0, 1.6);
    lineSeg(d.x + d.w, by - 3, d.x + d.w, by + 3, BLUE, 1.0, 1.4);

    // Dot-matrix grid
    dotGrid(d.x, d.plotY, d.w, rows * step, step, 0.15);

    // Signed cepstrum: one stem of dots per column from the centre (zero) line to the value
    var gx = d.x + step * 0.5;
    var gy = d.plotY + step * 0.5;
    var silent = scopeBuf ? levelLin < 0.00001 : false;
    for (var j = 0; j < cols; j++) {
        var cx = gx + j * step;
        var colMs = ((j + 0.5) / cols) * QUEF_MAX_MS;
        var c = cx < barX ? ORANGE : BLUE;
        var rng = columnRange(j, cols);
        var pooled = poolSigned(cepDisp, rng[0], rng[1]);
        var valid = false;
        for (var q = rng[0]; q < rng[1]; q++) if (cepValid[q]) valid = true;
        // zero line: always drawn, dotted, orange left of the cutoff and blue right of it
        fillRect(cx - 1.1, gy + mid * step - 1.1, 2.2, 2.2, c, valid ? 0.55 : 0.2);
        if (!valid || silent) continue;
        var h = (j === 0 ? (pooled.v < 0 ? -1 : 1) : cepstrumDisplayHeight(pooled.v, refGain));
        var off = Math.round(h * half);
        if (off === 0) continue;
        var dir = off > 0 ? -1 : 1; // positive values go up
        var n = Math.abs(off);
        for (var k = 1; k < n; k++) fillRect(cx - 0.8, gy + (mid + dir * k) * step - 0.8, 1.6, 1.6, c, 0.34);
        fillRect(cx - 1.7, gy + (mid + dir * n) * step - 1.7, 3.4, 3.4, c, 1.0);
    }

    // Pitch-period peak marker (Auto / MIDI): a small green tick at the pitch column
    var per = periodSamplesNow();
    if (per > 0) {
        var px = d.x + msToAxis01(lagToMs(per, srNow)) * d.w;
        var ty = d.plotY + 4;
        polyFill([[px, ty], [px + 3, ty + 4], [px, ty + 8], [px - 3, ty + 4]], GREEN, 1.0);
        lineSeg(px, ty + 9, px, ty + 14, GREEN, 0.9, 1.2);
        var lab = curMode === 2 && curMidiNote >= 0 ? noteName(curMidiNote) : (Math.round(srNow / per) + "Hz");
        var lx = clamp(px + 5, d.x, d.x + d.w - textW(lab, 7) - 1);
        textAt(lab, lx, ty + 8, 7, GREEN, 1.0);
    }

    // Lifter cutoff bar: spans the plot and the split bar. Solid when manual, dashed + diamond when tracked.
    var top = d.splitY + 2;
    var bot = d.plotY + d.plotH;
    var ms = lagToMs(displayLagSamples(), srNow);
    var midY = d.plotY + d.plotH / 2;
    if (!tracked) {
        lineSeg(barX, top, barX, bot, WHITE, 1.0, 2);
        fillRect(barX - 3, midY - 8, 6, 16, WHITE, 1.0);
        lineSeg(barX - 1, midY - 4, barX - 1, midY + 4, [0, 0, 0], 1.0, 1);
        lineSeg(barX + 1, midY - 4, barX + 1, midY + 4, [0, 0, 0], 1.0, 1);
    } else {
        col([0.85, 0.95, 1.0], 0.95);
        mgraphics.set_line_width(1.6);
        for (var y3 = top; y3 < bot; y3 += 7) {
            mgraphics.move_to(barX, y3);
            mgraphics.line_to(barX, Math.min(y3 + 4, bot));
            mgraphics.stroke();
        }
        polyFill([[barX, midY - 7], [barX + 5, midY], [barX, midY + 7], [barX - 5, midY]], [0.85, 0.95, 1.0], 1.0);
    }
    // Small ms / Hz readout while dragging or for ~1 s after a change
    if (dragging || readoutOn) {
        var mtxt = ms.toFixed(1) + "ms " + Math.round(1000 / Math.max(ms, 0.05)) + "Hz";
        var mx = barX + 7 + textW(mtxt, 7) > d.x + d.w ? barX - 7 - textW(mtxt, 7) : barX + 7;
        textAt(mtxt, mx, d.plotY + d.plotH - 5, 7, WHITE, 0.9);
    }
}

function paint() {
    if (!scopeBuf && !cepValid[100]) preview();
    var r = layoutRegions();
    var w = r.w;
    var h = r.h;
    // Outer frame: the rounded device frame continues across the two v8ui halves
    mgraphics.set_source_rgba(0, 0, 0, 1);
    mgraphics.rectangle_rounded(1.5 - ORIGIN_X, 1.5, DEVICE_W - 3, h - 3, 9, 9);
    mgraphics.fill();
    mgraphics.set_line_width(1.2);
    mgraphics.set_source_rgba(0.24, 0.24, 0.24, 1);
    mgraphics.rectangle_rounded(1.5 - ORIGIN_X, 1.5, DEVICE_W - 3, h - 3, 9, 9);
    mgraphics.stroke();
    drawDisplay(r);
}
