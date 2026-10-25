// Cepstra display: dot-matrix CEPSTRUM — the signed real Mid cepstrum c[n] against LINEAR quefrency (n = 0 at the
// left edge, 20 ms at the right), zero line at mid-height, one stem of dots per column, with the draggable cutoff bar.
// This is the only v8ui of the device. The controls on the left are normal live.* widgets; this script also holds
// the Mid/Side Lock follower and the exclusive AUTO / MIDI logic. src/cepstra_config.js is prepended.
//
// Messages in:  setbuffer <scopeBufName>, set_res <pct>, set_mode <0|1|2>, set_quality <0|1|2>, set_gate <pct>,
//               set_gmode <0 Spec | 1 Ceps>, midi_note <n>
// Messages in (more): set_mid / set_side <st>, set_lock <0|1>, set_auto / set_midi <0|1>
// Messages out: ["res", pct], ["mid"|"side", st] (Lock follower), ["auto"|"midi", 0|1], ["resmode", 0|1|2];
//   the patcher mirrors each into its live object with `prepend set` (silent) and into gen

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;

var ORANGE = [1.0, 0.56, 0.10];
var BLUE = [0.30, 0.58, 1.0];
var GREEN = [0.22, 0.92, 0.46];
var WHITE = [0.94, 0.94, 0.94];
var MONO = "Courier New";

var scopeBuf = null;
var scopeBufName = "---cepscope";
var uiTask = null;
var uiIdleFrames = 0;
var dragging = false;

var curRes = DEFAULT_RES_PCT;
var curMode = 0;
var curQuality = 1;
var curGatePct = 0;
var curMix = 100;
var curMid = 0;
var curSide = 0;
var curLock = 0;
var curGmode = 0;   // 0 Spec, 1 Ceps
var gateThr = 0;    // Ceps gate threshold (|c| units, from the scope)
var curMidiNote = -1;
var lastScopeFrame = -1;
var scopeHave = false;

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
// AUTO / MIDI: two exclusive toggles that map onto resmode (0 Manual, 1 Auto, 2 MIDI). The hidden resmode tab and
// the toggles are only ever changed with `set` (silent), so nothing loops.
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

// Mid / Side with Lock: works for the dial itself, automation and macros. Whichever changed, the follower moves by
// the same delta with a silent `set` (+ gen), so it never echoes back into set_mid / set_side.
function set_lock(v) { curLock = Number(v) > 0.5 ? 1 : 0; }

function set_mid(v) {
    var r = applyLock(curLock, "mid", Number(v), curMid, curSide);
    var followed = r.side !== curSide;
    curMid = r.mid;
    curSide = r.side;
    if (followed) emit("side", curSide);
}

function set_side(v) {
    var r = applyLock(curLock, "side", Number(v), curMid, curSide);
    var followed = r.mid !== curMid;
    curSide = r.side;
    curMid = r.mid;
    if (followed) emit("mid", curMid);
}
function set_gate(v) { curGatePct = clamp(Number(v), 0, 100); mgraphics.redraw(); }
function set_mix(v) { curMix = clamp(Number(v), 0, 100); }
function set_gmode(v) { curGmode = clamp(Math.round(Number(v)), 0, 1); mgraphics.redraw(); }
function set_quality(v) { curQuality = clamp(Math.round(Number(v)), 0, 2); nFft = fftSizeForQuality(curQuality); mgraphics.redraw(); }
function midi_note(v) { curMidiNote = Number(v); mgraphics.redraw(); }

function setbuffer(scopeName) {
    if (scopeName) {
        scopeBufName = "" + scopeName;
        scopeBuf = new Buffer(scopeBufName);
        scopeHave = false;
    }
}

// peek(start, count). A test mock may ignore the range and return the whole buffer.
function peekSpan(buf, start, count) {
    var v = buf.peek(1, start, count);
    if (typeof v === "number") return [v];
    if (!v || !v.length) return null;
    if (v.length === count) return v;
    if (v.length > start) return v.slice(start, start + count);
    return null;
}

function numAt(chunk, idx) {
    if (typeof chunk === "number") return idx === 0 ? chunk : 0;
    if (!chunk || !chunk.length || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (v === v) ? v : 0;
}

// Returns true while something is moving / audible so v8ui keeps redrawing; false when silent and settled.
// The frame counter (259) and input level (258) are peeked first. The 264-float telemetry block is read only
// when one of them moved.
function pullScope() {
    if (!scopeBuf) return false;
    var head = peekSpan(scopeBuf, 258, 2);
    if (!head) return false;
    var level = (head[0] === head[0]) ? head[0] : 0;
    var frame = (head[1] === head[1]) ? head[1] : 0;
    var fresh = !scopeHave || frame !== lastScopeFrame || level !== levelLin;
    if (!fresh && uiIdleFrames > 2) return false;
    if (fresh) {
        var chunk = peekSpan(scopeBuf, 0, 264);
        if (!chunk) return false;
        levelLin = numAt(chunk, 258);
        lastScopeFrame = numAt(chunk, 259);
        scopeHave = true;
        lagSamps = numAt(chunk, 256) || lagSamps;
        f0Hz = numAt(chunk, 257);
        voiced = numAt(chunk, 261) > 0.5 ? 1 : 0;
        gateThr = numAt(chunk, 263);
        var n = numAt(chunk, 260);
        if (n > 0) nFft = n;
        for (var b = 0; b < NUM_QUEF; b++) {
            var raw = numAt(chunk, b);
            cepRaw[b] = raw;
            cepValid[b] = Math.abs(raw) < QUEF_SENTINEL;
        }
    }
    var silent = levelLin < 0.00001;
    if (!silent && fresh) refGain = adaptRef(refGain, Math.max(percentileAbs(cepRaw, 1, 0.95), 0.02));
    var moving = false;
    for (var b2 = 0; b2 < NUM_QUEF; b2++) {
        var target = (silent || !cepValid[b2]) ? 0 : cepRaw[b2];
        var d = target - cepDisp[b2];
        cepDisp[b2] += d * 0.5;
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

// Deferred DSP (AGENTS.md 1d). The device ships without gen~. One Task tick after live.thisdevice
// (`init_dsp`) this face writes the embedded patch to /tmp/cepstra_core_<hash>.gendsp, creates
// `gen~ @gen <file>` and wires cep_genin -> gen, cep_plugin -> gen -> cep_plugout. Until then the
// outputs stay silent (plugin~ is not tied to plugout~). The gen drops messages while it compiles,
// so every confirm tick re-sends the buffer binding and the gen parameters from the values held
// here — never a bang, which would flip the live.text toggles.
var cepHost = (typeof patcher !== "undefined" && patcher) ? patcher : null;
var cepDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0 };
var CEP_DSP_RETRIES = 2;
var CEP_DSP_CLAIM_MS = 15000;
var CEP_DSP_QUEUE_POLL_MS = 100;
var CEP_DSP_CONFIRM_MS = 150;
var CEP_DSP_SETTLE_MS = 300;
var CEP_DSP_FIRST_TIMEOUT_MS = 3500;
var CEP_DSP_TIMEOUT_MS = 6000;
var cepDspToken = Math.random();

function cepDspTimeout() {
    return cepDsp.retries === 0 ? CEP_DSP_FIRST_TIMEOUT_MS : CEP_DSP_TIMEOUT_MS;
}

function cepDspPath() {
    return "/tmp/cepstra_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function cepDspWriteFile(path) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === GEN_DSP_TEXT.length;
        rf.close();
        if (have) return true;
    } catch (_) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
    f.close();
    return true;
}

// Alive counter (scope slot 264). It moves every hop, including silence sleep, so a quiet track still confirms.
function cepDspAlive() {
    if (!scopeBufName || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(scopeBufName).peek(1, 264, 1);
        if (typeof v === "number") return v;
        if (!v || !v.length) return -1;
        return v.length === 1 ? Number(v[0]) : Number(v[264]);
    } catch (_) {
        return -1;
    }
}

// Buffer binding and every gen parameter, from the values this face holds. Outlet 1 goes straight to the
// gate hub. Do not bang live.text toggles (a bang flips them).
function cepDspResend() {
    outlet(1, ["scope", scopeBufName || "---cepscope"]);
    outlet(1, ["res", curRes * 0.01]);
    outlet(1, ["midshift", curMid]);
    outlet(1, ["sideshift", curSide]);
    outlet(1, ["gate", curGatePct * 0.01]);
    outlet(1, ["wet", curMix * 0.01]);
    outlet(1, ["quality", curQuality]);
    outlet(1, ["resmode", curMode]);
    outlet(1, ["gatemode", curGmode]);
    outlet(1, ["midinote", curMidiNote]);
}

function cepDspClaim() {
    var q = new Global("cepstra_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== cepDspToken && now - Number(q.t) < CEP_DSP_CLAIM_MS) return false;
    q.owner = cepDspToken;
    q.t = now;
    return true;
}

function cepDspRelease() {
    var q = new Global("cepstra_dspq");
    if (q.owner === cepDspToken) q.owner = 0;
}

function cepDspLoad() {
    if (cepDsp.ready || cepDsp.createdAt || !cepHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!cepDspClaim()) {
        if (!cepDsp.task) cepDsp.task = new Task(cepDspLoad, this);
        cepDsp.task.schedule(CEP_DSP_QUEUE_POLL_MS);
        return;
    }
    try {
        var g = cepHost.getnamed("cep_gen");
        if (!g) {
            var path = cepDspPath();
            if (!cepDspWriteFile(path)) throw new Error("cannot write " + path);
            g = cepHost.newdefault(40, 420, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "cep_gen";
            var hub = cepHost.getnamed("cep_genin");
            var pin = cepHost.getnamed("cep_plugin");
            var pout = cepHost.getnamed("cep_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            cepHost.connect(hub, 0, g, 0);
            cepHost.connect(pin, 0, g, 0);
            cepHost.connect(pin, 1, g, 1);
            cepHost.connect(g, 0, pout, 0);
            cepHost.connect(g, 1, pout, 1);
        }
        cepDsp.createdAt = Date.now();
        cepDsp.counter0 = cepDspAlive();
        cepDspConfirm();
    } catch (err) {
        cepDsp.error = String(err && err.message ? err.message : err);
        cepDspRelease();
        post("Cepstra: DSP load failed: " + cepDsp.error + "\n");
    }
    mgraphics.redraw();
}

function cepDspConfirm() {
    var c = cepDspAlive();
    if (cepDsp.counter0 >= 0 && c >= 0 && c !== cepDsp.counter0) {
        cepDsp.ready = 1;
        cepDsp.error = "";
        cepDspRelease();
        cepDspResend();
        if (typeof Task === "function") {
            if (!cepDsp.settleTask) cepDsp.settleTask = new Task(cepDspResend, this);
            cepDsp.settleTask.schedule(CEP_DSP_SETTLE_MS);
        }
        mgraphics.redraw();
        return;
    }
    if (Date.now() - cepDsp.createdAt > cepDspTimeout() && cepDsp.retries < CEP_DSP_RETRIES) {
        cepDsp.retries++;
        try {
            var old = cepHost.getnamed("cep_gen");
            if (old) cepHost.remove(old);
        } catch (_) {}
        cepDsp.createdAt = 0;
        cepDsp.counter0 = -1;
        cepDspLoad();
        return;
    }
    if (Date.now() - cepDsp.createdAt > cepDspTimeout()) {
        cepDsp.error = "not running";
        cepDspRelease();
        mgraphics.redraw();
        return;
    }
    cepDspResend();
    if (cepDsp.counter0 < 0) cepDsp.counter0 = c;
    if (typeof Task !== "function") return;
    if (!cepDsp.confirmTask) cepDsp.confirmTask = new Task(cepDspConfirm, this);
    cepDsp.confirmTask.schedule(CEP_DSP_CONFIRM_MS);
}

function cepDspSchedule() {
    if (cepDsp.ready || cepDsp.createdAt) return;
    if (typeof Task !== "function") return;
    if (!cepDsp.task) cepDsp.task = new Task(cepDspLoad, this);
    cepDsp.task.schedule(30);
}

function init_dsp() {
    cepDspSchedule();
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [244, 88];
    return [s[0], s[1]];
}

// Display geometry, derived entirely from the v8ui size: a compact split bar on top, the dot plot below it.
function layoutRegions() {
    var cs = canvasSize();
    var w = cs[0], h = cs[1];
    var pad = 4, step = 5;
    var splitY = 3;
    var plotY = splitY + 15;
    var rows = Math.max(3, Math.floor((h - plotY - 3) / step));
    return { w: w, h: h, disp: { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad, plotY: plotY, plotH: rows * step, splitY: splitY } };
}

function periodSamplesNow() {
    if (curMode === 1 && voiced && f0Hz > 20) return srNow / f0Hz;
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
    // The lifter lag clamps at N/2, so Res values past that clamp share one bar.
    // A click on the bar already drawn for the current Res keeps it. A live lag
    // (the bar is not the Res lag) still adopts the position under the pointer.
    if (v !== curRes) {
        var shown = barAxis01();
        var fromRes = msToAxis01(lagToMs(lifterLagSamples(curMode, curRes / 100, srNow, nFft, periodSamplesNow()), srNow));
        if (Math.abs(fromRes - shown) <= 1e-6 && Math.abs(t - shown) <= 0.5 / Math.max(1, r.disp.w)) return;
    }
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
    curGmode = 1;
    curGatePct = 35;
    gateThr = 0.14;
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
    textAt("FORMANTS", d.x + 1, d.splitY + 7, 7, ORANGE, 1.0);
    textAt("HARMONICS", d.x + d.w - textW("HARMONICS", 7) - 2, d.splitY + 7, 7, BLUE, 1.0);
    var by = d.splitY + 10;
    lineSeg(d.x, by, barX, by, ORANGE, 1.0, 1.6);
    lineSeg(d.x, by - 2, d.x, by + 2, ORANGE, 1.0, 1.4);
    lineSeg(barX, by, d.x + d.w, by, BLUE, 1.0, 1.6);
    lineSeg(d.x + d.w, by - 2, d.x + d.w, by + 2, BLUE, 1.0, 1.4);

    // Dot-matrix grid
    dotGrid(d.x, d.plotY, d.w, rows * step, step, 0.15);

    // Signed cepstrum: one stem of dots per column from the centre (zero) line to the value
    var gx = d.x + step * 0.5;
    var gy = d.plotY + step * 0.5;
    var silent = scopeBuf ? levelLin < 0.00001 : false;
    var gateOn = curGmode === 1 && curGatePct > 0.05 && gateThr > 0 && !silent;
    for (var j = 0; j < cols; j++) {
        var cx = gx + j * step;
        var colMs = ((j + 0.5) / cols) * QUEF_MAX_MS;
        var c = cx < barX ? ORANGE : BLUE;
        var bounds = columnBounds(cols, 0.02 * srNow, nFft);
        var rng = bounds[j];
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
        // Ceps gate: harmonic-region stems below the threshold are drawn dimmed (gated out)
        var gatedOut = gateOn && cx >= barX && Math.abs(pooled.v) < gateThr;
        for (var k = 1; k < n; k++) fillRect(cx - 0.8, gy + (mid + dir * k) * step - 0.8, 1.6, 1.6, c, gatedOut ? 0.12 : 0.34);
        fillRect(cx - 1.7, gy + (mid + dir * n) * step - 1.7, 3.4, 3.4, c, gatedOut ? 0.35 : 1.0);
    }

    // Ceps gate threshold: faint +/- dotted lines across the harmonic (blue) region only
    if (gateOn) {
        var th = Math.round(cepstrumDisplayHeight(gateThr, refGain) * half);
        if (th > 0) {
            var startJ = Math.max(0, Math.ceil((barX - gx) / step));
            for (var jj = startJ; jj < cols; jj += 2) {
                var gxx = gx + jj * step;
                fillRect(gxx - 0.8, gy + (mid - th) * step - 0.8, 1.6, 1.6, BLUE, 0.5);
                fillRect(gxx - 0.8, gy + (mid + th) * step - 0.8, 1.6, 1.6, BLUE, 0.5);
            }
        }
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
    var top = d.splitY + 5;
    var bot = d.plotY + d.plotH;
    var ms = lagToMs(displayLagSamples(), srNow);
    var midY = d.plotY + d.plotH / 2;
    if (!tracked) {
        lineSeg(barX, top, barX, bot, WHITE, 1.0, 2);
        fillRect(barX - 3, midY - 7, 6, 14, WHITE, 1.0);
        lineSeg(barX - 1, midY - 3, barX - 1, midY + 3, [0, 0, 0], 1.0, 1);
        lineSeg(barX + 1, midY - 3, barX + 1, midY + 3, [0, 0, 0], 1.0, 1);
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

function drawDspPill(w) {
    if (cepDsp.ready || !(cepDsp.createdAt > 0 || cepDsp.error)) return;
    var bad = !!cepDsp.error;
    var txt = bad ? ("DSP failed: " + String(cepDsp.error)).substring(0, 28) : "DSP loading...";
    var tw = textW(txt, 8);
    var pw = tw + 10;
    var px = Math.max(2, (w - pw) * 0.5);
    fillRect(px, 1, pw, 11, [0.04, 0.05, 0.07], 0.88);
    textAt(txt, px + 5, 9, 8, bad ? [0.95, 0.35, 0.30] : [1.0, 0.72, 0.35], 0.92);
}

function paint() {
    if (!scopeBuf && !cepValid[100]) preview();
    var r = layoutRegions();
    drawDisplay(r);
    drawDspPill(r.w);
}
