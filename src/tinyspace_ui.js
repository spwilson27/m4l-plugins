// Tiny Space visualization. tinyspace_config.js is prepended at build time.
// Twenty strings. Left ten are cyan, right ten are amber. Displacement follows
// each delay line's envelope, and the wiggle rate follows that line's length.

inlets = 1;
outlets = 1;

// Pixel coordinates. The default relative space is 0..1, which clips every
// string off the canvas and leaves the Live device looking blank.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var cfgBuf = null;
var meterBuf = null;
var currentSeed = 1;
var config = buildConfig(currentSeed);
var meters = [];
var phases = [];
var seededOnce = false;
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
    currentSeed = Math.max(0, Math.min(9999, v | 0));
    config = buildConfig(currentSeed);
    pokeConfig();
    if (seededOnce) outlet(0, "bang");
    seededOnce = true;
    mgraphics.redraw();
}

function pullMeters() {
    if (!meterBuf) return;
    for (var i = 0; i < LINE_COUNT; i++) {
        var chunk = meterBuf.peek(1, i, 1);
        var v = chunk && chunk.length ? chunk[0] : 0;
        if (!(v > 0)) v = 0;
        meters[i] = v;
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
    if (!s || s.length < 2) return [344, 132];
    return [s[0], s[1]];
}

function displayEnv(index) {
    if (meterBuf) return meters[index];
    if (!isLineActive(index, config.activeCount)) return 0;
    return 0.28 + 0.72 * Math.abs(Math.sin(index * 1.37 + 0.6));
}

function paint() {
    var wh = canvasSize();
    var w = wh[0];
    var h = wh[1];

    mgraphics.set_source_rgba(0.055, 0.065, 0.078, 1);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    mgraphics.set_source_rgba(0.16, 0.2, 0.24, 1);
    mgraphics.set_line_width(1);
    mgraphics.move_to(w * 0.5, 20);
    mgraphics.line_to(w * 0.5, h - 6);
    mgraphics.stroke();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(9);
    mgraphics.set_source_rgba(0.78, 0.84, 0.9, 1);
    mgraphics.move_to(8, 13);
    mgraphics.show_text(config.activeCount + " lines");

    var top = 22;
    var bot = h - 7;
    var half = w * 0.5;
    var step = (half - 28) / 9;
    var midY = (top + bot) * 0.5;

    for (var i = 0; i < LINE_COUNT; i++) {
        var side = i % 10;
        var x = (i < 10) ? (12 + side * step) : (half + 12 + side * step);
        var active = isLineActive(i, config.activeCount);
        var env = displayEnv(i);
        if (env > 1) env = 1;
        var len = config.lens[i];
        phases[i] += 0.22 * (0.55 + 5.5 / Math.max(1, len));
        var y0 = active ? top : midY - 16;
        var y1 = active ? bot : midY + 16;
        // Resting waves stay visible when a line is quiet. Audio stretches them.
        var vis = active ? Math.sqrt(env) : 0;
        if (vis > 1) vis = 1;
        var amp = active ? (1.8 + vis * 9.5) : 0.35;
        var col = (i < 10) ? [0.28, 0.82, 0.96] : [0.96, 0.64, 0.28];
        var alpha = active ? (0.42 + env * 0.58) : 0.22;
        mgraphics.set_source_rgba(col[0], col[1], col[2], alpha);
        mgraphics.set_line_width(active ? 1.35 : 0.8);
        var steps = 16;
        for (var s = 0; s <= steps; s++) {
            var t = s / steps;
            var y = y0 + (y1 - y0) * t;
            var pin = Math.sin(t * Math.PI);
            var xOff = Math.sin(phases[i] + t * Math.PI * 3) * amp * pin;
            if (s === 0) mgraphics.move_to(x + xOff, y);
            else mgraphics.line_to(x + xOff, y);
        }
        mgraphics.stroke();
    }
}
