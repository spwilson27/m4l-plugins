// Tiny Space visualization. tinyspace_config.js is prepended at build time.
// Twenty strings. Left ten are cyan, right ten are amber. Displacement follows
// each delay line's envelope, and the wiggle rate follows that line's length.
// Supports both overlaid (single-field L+R) and split-pane visualization modes.

inlets = 1;
outlets = 1;

// Pixel coordinates. The default relative space is 0..1, which clips every
// string off the canvas and leaves the Live device looking blank.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var cfgBuf = null;
var meterBuf = null;
var currentSeed = 350;
var currentCharMode = 0; // 0 = COMB, 1 = HYBRID, 2 = ROOM
var vizOverlay = 1;      // 1 = Overlaid L+R strings, 0 = Separate L/R panes
var config = buildConfig(currentSeed, currentCharMode);
var meters = [];
var phases = [];
var seededOnce = false;
var charInitOnce = false;
var meterTask = null;
var meterRest = false;

for (var i = 0; i < LINE_COUNT; i++) {
    meters.push(0);
    phases.push(i * 0.41);
}

// String geometry is the same every frame. The phase offset is the only term that moves.
var STRING_STEPS = 16;
var STRING_PI = Math.PI;
var STRING_THETA = [];
var STRING_PIN = [];
for (var stepI = 0; stepI <= STRING_STEPS; stepI++) {
    var stepT = stepI / STRING_STEPS;
    STRING_THETA.push(stepT);
    STRING_PIN.push(Math.sin(stepT * STRING_PI));
}

function setbuffer(cfgName, meterName) {
    if (typeof Buffer !== "function" || typeof Task !== "function") return;
    cfgBuf = new Buffer(cfgName);
    meterBuf = new Buffer(meterName);
    pokeConfig();
}

function pokeConfig() {
    if (!cfgBuf) return;
    cfgBuf.poke(1, 0, configToFloats(config));
}

function set_seed(v) {
    currentSeed = Math.max(0, Math.min(SEED_MAX, v | 0));
    config = buildConfig(currentSeed, currentCharMode);
    pokeConfig();
    if (seededOnce) outlet(0, "bang");
    seededOnce = true;
    meterRest = false;
    mgraphics.redraw();
}

function set_character(v) {
    currentCharMode = Math.max(0, Math.min(CHAR_MODES.length - 1, v | 0));
    config = buildConfig(currentSeed, currentCharMode);
    pokeConfig();
    if (charInitOnce) outlet(0, "bang");
    charInitOnce = true;
    meterRest = false;
    mgraphics.redraw();
}

function set_viz_mode(v) {
    vizOverlay = (v | 0) ? 1 : 0;
    meterRest = false;
    mgraphics.redraw();
}

function meterSample(chunk, index) {
    if (typeof chunk === "number") return index === 0 ? chunk : 0;
    if (!chunk || !chunk.length || index >= chunk.length) return 0;
    var v = chunk[index];
    return v > 0 ? v : 0;
}

function smoothMeter(index, v) {
    // Rise quickly when a line is hit, fall a little slower than the audio tail.
    var coef = v > meters[index] ? 0.55 : 0.18;
    meters[index] = meters[index] + (v - meters[index]) * coef;
}

function pullMeters() {
    if (!meterBuf) return;
    var half = (config.activeCount / 2) | 0;
    var i;
    if (half > 0) {
        var left = meterBuf.peek(1, 0, half);
        var right = meterBuf.peek(1, 10, half);
        for (i = 0; i < half; i++) {
            smoothMeter(i, meterSample(left, i));
            smoothMeter(10 + i, meterSample(right, i));
        }
    }
    for (i = half; i < 10; i++) {
        meters[i] = 0;
        meters[10 + i] = 0;
    }
}

function loadbang() {
    if (typeof Task === "function") {
        meterTask = new Task(function () {
            if (!meterBuf) {
                mgraphics.redraw();
                return;
            }
            pullMeters();
            var maxMeter = 0;
            for (var i = 0; i < LINE_COUNT; i++) {
                if (meters[i] > maxMeter) maxMeter = meters[i];
            }
            // One resting frame, then leave the canvas alone until audio or a seed change.
            if (maxMeter < 1e-4 && meterRest) return;
            meterRest = maxMeter < 1e-4;
            mgraphics.redraw();
        }, this);
        meterTask.interval = 33;
        meterTask.repeat();
    }
    mgraphics.redraw();
}

// Deferred DSP (AGENTS.md 1d). The device ships without gen~; one Task tick after
// live.thisdevice writes /tmp/tinyspace_core_<hash>.gendsp, creates gen~ @gen <file>
// and wires ts_genin -> gen, ts_plugin -> gen -> ts_plugout. Until then the outputs
// stay unconnected, so the device is silent. The gen drops messages while it compiles,
// so buffer bindings, the seed config and every gen parameter are re-sent until the
// frame counter in ---tsmeters (meterBuf) slot 20 moves, then once more after 300 ms.
var tsHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var tsDsp = {
    ready: 0,
    error: "",
    createdAt: 0,
    counter0: -1,
    task: null,
    confirmTask: null,
    settleTask: null,
    retries: 0,
    armed: 0,
    readyMs: 0
};
var TS_DSP_RETRIES = 2;
var TS_DSP_CLAIM_MS = 15000;
var TS_DSP_QUEUE_POLL_MS = 100;
var TS_DSP_CONFIRM_MS = 150;
var TS_DSP_SETTLE_MS = 300;
var TS_DSP_FIRST_TIMEOUT_MS = 3500;
var TS_DSP_TIMEOUT_MS = 6000;
var tsDspToken = Math.random();
var TS_PARAM_NAMES = ["Size", "Damp", "Width", "Mix", "Feedback", "PreDly", "Mod", "XFeed", "HP", "LP"];

function tsDspTimeout() {
    return tsDsp.retries === 0 ? TS_DSP_FIRST_TIMEOUT_MS : TS_DSP_TIMEOUT_MS;
}

function tsDspPath() {
    return "/tmp/tinyspace_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function tsDspWriteFile(path) {
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

// Slot 20 of ---tsmeters (meterBuf), written every 32 samples even while the tank is asleep.
function tsDspFrames() {
    if (!meterBuf) return -1;
    try {
        var v = meterBuf.peek(1, 20, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

function tsDspResend() {
    try {
        if (tsHost) {
            var bind = tsHost.getnamed("ts_genbufs");
            if (bind) bind.message("bang");
        }
        pokeConfig();
        if (!tsHost) return;
        for (var i = 0; i < TS_PARAM_NAMES.length; i++) {
            var box = tsHost.getnamed(TS_PARAM_NAMES[i]);
            if (box) box.message("bang");
        }
        var duck = tsHost.getnamed("ts_duck1");
        if (duck) duck.message("bang");
    } catch (_) {}
}

function tsDspClaim() {
    var q = new Global("tinyspace_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== tsDspToken && now - Number(q.t) < TS_DSP_CLAIM_MS) return false;
    q.owner = tsDspToken;
    q.t = now;
    return true;
}

function tsDspRelease() {
    var q = new Global("tinyspace_dspq");
    if (q.owner === tsDspToken) q.owner = 0;
}

function tsDspChanged() {
    meterRest = false;
    mgraphics.redraw();
}

function tsDspLoad() {
    if (tsDsp.ready || tsDsp.createdAt || !tsHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!tsDspClaim()) {
        if (!tsDsp.task) tsDsp.task = new Task(tsDspLoad, this);
        tsDsp.task.schedule(TS_DSP_QUEUE_POLL_MS);
        return;
    }
    try {
        var g = tsHost.getnamed("ts_gen");
        if (!g) {
            var path = tsDspPath();
            if (!tsDspWriteFile(path)) throw new Error("cannot write " + path);
            g = tsHost.newdefault(120, 300, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "ts_gen";
            var hub = tsHost.getnamed("ts_genin");
            var pin = tsHost.getnamed("ts_plugin");
            var pout = tsHost.getnamed("ts_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            tsHost.connect(hub, 0, g, 0);
            tsHost.connect(pin, 0, g, 0);
            tsHost.connect(pin, 1, g, 1);
            tsHost.connect(g, 0, pout, 0);
            tsHost.connect(g, 1, pout, 1);
        }
        tsDsp.createdAt = Date.now();
        tsDsp.counter0 = tsDspFrames();
        tsDspConfirm();
    } catch (err) {
        tsDsp.error = String(err && err.message ? err.message : err);
        tsDspRelease();
        if (typeof post === "function") post("Tiny Space: DSP load failed: " + tsDsp.error + "\n");
    }
    tsDspChanged();
}

function tsDspConfirm() {
    var c = tsDspFrames();
    if (tsDsp.counter0 >= 0 && c >= 0 && c !== tsDsp.counter0) {
        tsDsp.ready = 1;
        tsDsp.error = "";
        tsDsp.readyMs = Date.now() - tsDsp.createdAt;
        tsDspRelease();
        tsDspResend();
        if (!tsDsp.settleTask) tsDsp.settleTask = new Task(tsDspResend, this);
        tsDsp.settleTask.schedule(TS_DSP_SETTLE_MS);
        tsDspChanged();
        return;
    }
    if (Date.now() - tsDsp.createdAt > tsDspTimeout() && tsDsp.retries < TS_DSP_RETRIES) {
        tsDsp.retries++;
        try {
            var old = tsHost.getnamed("ts_gen");
            if (old) tsHost.remove(old);
        } catch (_) {}
        tsDsp.createdAt = 0;
        tsDsp.counter0 = -1;
        tsDspLoad();
        return;
    }
    if (Date.now() - tsDsp.createdAt > tsDspTimeout()) {
        tsDsp.error = "not running";
        tsDspRelease();
        tsDspChanged();
        return;
    }
    tsDspResend();
    if (tsDsp.counter0 < 0) tsDsp.counter0 = c;
    if (!tsDsp.confirmTask) tsDsp.confirmTask = new Task(tsDspConfirm, this);
    tsDsp.confirmTask.schedule(TS_DSP_CONFIRM_MS);
}

function init_dsp() {
    if (tsDsp.ready || tsDsp.createdAt || tsDsp.armed) return;
    tsDsp.armed = 1;
    if (!tsDsp.task) tsDsp.task = new Task(tsDspLoad, this);
    tsDsp.task.schedule(30);
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [152, 62];
    return [s[0], s[1]];
}

function displayEnv(index) {
    if (meterBuf) return meters[index];
    if (!isLineActive(index, config.activeCount)) return 0;
    return 0.28 + 0.72 * Math.abs(Math.sin(index * 1.37 + 0.6));
}

function drawString(x, top, bot, midY, stubHalf, active, env, len, phaseIdx, col, maxSwing, harmonic) {
    var vis = 0;
    if (active) {
        vis = Math.sqrt(env) * 2.4;
        if (vis > 1) vis = 1;
    }
    phases[phaseIdx] += (0.05 + vis * 0.42) * (0.55 + 5.5 / Math.max(1, len));
    var y0 = active ? top : midY - stubHalf;
    var y1 = active ? bot : midY + stubHalf;
    var amp = active ? (0.22 + vis * maxSwing) : 0.22;
    var alpha = active ? (0.34 + vis * 0.66) : 0.18;
    var ySpan = y1 - y0;
    var phase = phases[phaseIdx];
    var harm = STRING_PI * harmonic;
    mgraphics.set_source_rgba(col[0], col[1], col[2], alpha);
    mgraphics.set_line_width(active ? 1.3 : 0.8);
    for (var s = 0; s <= STRING_STEPS; s++) {
        var t = STRING_THETA[s];
        var y = y0 + ySpan * t;
        var xOff = Math.sin(phase + t * harm) * amp * STRING_PIN[s];
        if (s === 0) mgraphics.move_to(x + xOff, y);
        else mgraphics.line_to(x + xOff, y);
    }
    mgraphics.stroke();
}

function paint() {
    var wh = canvasSize();
    var w = wh[0];
    var h = wh[1];

    // Deep pitch-black screen like Undulae Tinyspace
    mgraphics.set_source_rgba(0.035, 0.042, 0.052, 1);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    var top = 5;
    var bot = h - 5;
    var midY = (top + bot) * 0.5;
    var spanH = bot - top;
    var stubHalf = Math.min(13, spanH * 0.22);

    // Subtle horizontal center line
    mgraphics.set_source_rgba(0.09, 0.115, 0.14, 1);
    mgraphics.set_line_width(1);
    mgraphics.move_to(4, midY);
    mgraphics.line_to(w - 4, midY);
    mgraphics.stroke();

    if (vizOverlay) {
        // Overlaid stereo field: 10 positions across the full width, with Left (cyan)
        // and Right (amber) delay lines braided/overlaid at each slot.
        var padX = Math.max(10, w * 0.08);
        var step = (w - padX * 2) / 9;
        var maxSwing = Math.min(11.5, Math.max(4.5, step * 0.88));

        for (var slot = 0; slot < 10; slot++) {
            var baseX = padX + slot * step;
            var idxL = slot;
            var idxR = slot + 10;

            var actL = isLineActive(idxL, config.activeCount);
            var envL = Math.min(1, displayEnv(idxL));
            drawString(
                baseX, top, bot, midY, stubHalf,
                actL, envL, config.lens[idxL], idxL,
                [0.28, 0.82, 0.96], maxSwing, 3.0
            );

            var actR = isLineActive(idxR, config.activeCount);
            var envR = Math.min(1, displayEnv(idxR));
            drawString(
                baseX, top, bot, midY, stubHalf,
                actR, envR, config.lens[idxR], idxR,
                [0.96, 0.64, 0.28], maxSwing, 3.2
            );
        }
    } else {
        // Split-pane L / R view (no text counters or L/R labels)
        mgraphics.set_source_rgba(0.14, 0.18, 0.22, 1);
        mgraphics.set_line_width(1);
        mgraphics.move_to(w * 0.5, 3);
        mgraphics.line_to(w * 0.5, h - 3);
        mgraphics.stroke();

        var half = w * 0.5;
        var padS = Math.max(5, Math.min(10, half * 0.08));
        var stepS = (half - padS * 2) / 9;
        var maxSwingS = Math.min(10.0, Math.max(3.5, stepS * 1.45));

        for (var i = 0; i < LINE_COUNT; i++) {
            var side = i % 10;
            var x = (i < 10) ? (padS + side * stepS) : (half + padS + side * stepS);
            var active = isLineActive(i, config.activeCount);
            var env = Math.min(1, displayEnv(i));
            var col = (i < 10) ? [0.28, 0.82, 0.96] : [0.96, 0.64, 0.28];
            drawString(x, top, bot, midY, stubHalf, active, env, config.lens[i], i, col, maxSwingS, 3.0);
        }
    }
    drawDspPill(w, h);
}

// Shown only after a gen~ create has started or failed, so the static preview stays clean.
function dspPillLabel() {
    if (tsDsp.ready || !(tsDsp.createdAt > 0 || tsDsp.error)) return "";
    if (tsDsp.error) return "DSP failed: " + String(tsDsp.error).substring(0, 24);
    return "DSP loading...";
}

/** @param {number} w @param {number} h */
function drawDspPill(w, h) {
    var label = dspPillLabel();
    if (!label) return;
    var failed = tsDsp.error ? 1 : 0;
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(8);
    var pw = label.length * 4.6 + 8;
    if (pw > w - 6) pw = w - 6;
    var ph = 12;
    var px = w - pw - 3;
    var py = 3;
    mgraphics.set_source_rgba(0.04, 0.05, 0.07, 0.88);
    mgraphics.rectangle(px, py, pw, ph);
    mgraphics.fill();
    mgraphics.set_source_rgba(failed ? 0.95 : 0.95, failed ? 0.42 : 0.72, failed ? 0.32 : 0.28, 1);
    mgraphics.move_to(px + 4, py + 9);
    mgraphics.show_text(label);
}
