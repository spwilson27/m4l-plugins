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

for (var i = 0; i < LINE_COUNT; i++) {
    meters.push(0);
    phases.push(i * 0.41);
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
    mgraphics.redraw();
}

function set_character(v) {
    currentCharMode = Math.max(0, Math.min(CHAR_MODES.length - 1, v | 0));
    config = buildConfig(currentSeed, currentCharMode);
    pokeConfig();
    if (charInitOnce) outlet(0, "bang");
    charInitOnce = true;
    mgraphics.redraw();
}

function set_viz_mode(v) {
    vizOverlay = (v | 0) ? 1 : 0;
    mgraphics.redraw();
}

function meterSample(chunk, index) {
    if (typeof chunk === "number") return index === 0 ? chunk : 0;
    if (!chunk || !chunk.length || index >= chunk.length) return 0;
    var v = chunk[index];
    return v > 0 ? v : 0;
}

function pullMeters() {
    if (!meterBuf) return;
    var chunk = meterBuf.peek(1, 0, LINE_COUNT);
    for (var i = 0; i < LINE_COUNT; i++) {
        var v = meterSample(chunk, i);
        // Rise quickly when a line is hit, fall a little slower than the audio tail.
        var coef = v > meters[i] ? 0.55 : 0.18;
        meters[i] = meters[i] + (v - meters[i]) * coef;
    }
}

function loadbang() {
    if (typeof Task === "function") {
        meterTask = new Task(function () {
            pullMeters();
            mgraphics.redraw();
        }, this);
        meterTask.interval = 33;
        meterTask.repeat();
    }
    mgraphics.redraw();
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
    mgraphics.set_source_rgba(col[0], col[1], col[2], alpha);
    mgraphics.set_line_width(active ? 1.3 : 0.8);
    var steps = 16;
    for (var s = 0; s <= steps; s++) {
        var t = s / steps;
        var y = y0 + (y1 - y0) * t;
        var pin = Math.sin(t * Math.PI);
        var xOff = Math.sin(phases[phaseIdx] + t * Math.PI * harmonic) * amp * pin;
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
}
