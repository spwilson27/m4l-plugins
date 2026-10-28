// Deviate face prelude: what every face canvas gets before its own script. scripts/build_deviate.py concatenates, per canvas:
//   `var DV_FACE / DV_ROLE / DV_THEMED / DV_CANVAS_ID` constants, deviate_config.js, [spectral_theme.js for `theme: "ableton"` faces],
//   this file, then the canvas's own files. A face is a pure display / controller: it never touches the gen, the engine or the
//   IR bank. Contract and examples: scripts/deviate_faces/README.md.
//
// Receives (inlet 0):
//   set_<key> <value>                              raw parameter values, only for the keys the canvas lists in "keys"
//   names <scope> <ctl> <ir> <spec> <hook> <state>  buffer~ / bus names of this device instance (from loadbang)
//   state dsp <ready> <error|->  |  state midi <routing|->  |  state ui <ints...>   the state bus
// Sends (outlet 0):
//   dvSend(key, value) -> `param <key> <value>`: drives the live.* parameter object (undo, automation, echo to every face)
//   dvCmd(name, ...)   -> `cmd <name> ...`: "hit" (a manual hit, as if a MIDI note arrived) | "ui" <ints> (this face's saved integers)
// Telemetry: dvPoll(fps) reads buffer ---deviatescope into `dvTel` (layout DV_SCOPE in deviate_config.js) and calls
//   onFrame(dvTel) when the gen's FRAMES counter moved (then mgraphics.redraw() unless onFrame returns false). Polling slows to
//   100 ms about 3 s after silence. A face that draws the waveform ring / the spectrum asks for them with dvNeed({wave: true, spec: true}).
// Hooks a face may define: paint(), preview(), onFrame(t), onParam(key, v), onState(kind), onclick / ondrag / ... as in any v8ui.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

/** raw parameter values (units of the parameter) @type {{[key: string]: number}} */
var dvP = {};
var dvNames = { scope: "", ctl: "", ir: "", spec: "", test: "", state: "" };
var dvState = { dsp: { ready: 0, error: "" }, midi: "", ui: [] };
var dvWant = { wave: false, spec: false };
var dvAnimUntil = 0;

var DVC = {
    bg: [0.075, 0.075, 0.075, 1], frame: [0.20, 0.23, 0.28, 1], text: [0.80, 0.84, 0.90, 1], dim: [0.45, 0.50, 0.58, 1],
    amber: [0.97, 0.68, 0.26, 1], coral: [0.98, 0.42, 0.38, 1], green: [0.40, 0.88, 0.52, 1],
};

/**
 * Parsed telemetry. `s` is the raw 64..160 header floats the last poll read; the rest is derived. `pk` are SMOOTHED display peaks
 * (instant attack, ~120 ms release): i input, t transient, b body, l long (tail), o output, d dry. `hitNew` / `serialNew` are true
 * for the one poll in which a new hit / a new draw was seen. `ageMs` is -1 when idle.
 */
var dvTel = {
    s: null, frames: -1, alive: -1, active: false, idleSince: 0, hitNew: false, serialNew: false, hits: 0, serial: 0, ageMs: -1, gate: 1, src: 0,
    split: 0, latency: 256, asleep: 0, reroll: 0, trS: 0.05, ringEnv: 0, irTag: 0, fast: 0, slow: 0, thr: 0, pageApplied: 0, sr: 48000,
    metas: [0, 0, 0, 0, 0, 0, 0, 0], draws: [0, 0, 0, 0, 0, 0, 0, 0], hidden: [], waveHead: 0, wave: null, spec: null,
    pk: { i: 0, t: 0, b: 0, l: 0, o: 0, d: 0 }, lastParseMs: 0, lastHitMs: 0, lastSerialMs: 0, ring: 0,
};

function dvNum(x, d) {
    var n = Number(x);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
}

function dvRefreshTheme() {
    DVC.bg = dvTheme("live_lcd_bg", [0.075, 0.075, 0.075, 1]);
    DVC.text = dvTheme("live_lcd_control_fg", [0.80, 0.84, 0.90, 1]);
    DVC.dim = dvTheme("live_lcd_title", [0.45, 0.50, 0.58, 1]);
    DVC.coral = dvTheme("live_alert", [0.98, 0.42, 0.38, 1]);
}

/** A Live theme colour with a fallback (max.getcolor is absent in Node / the preview renderer). */
function dvTheme(name, fallback) {
    try {
        if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
            var c = max.getcolor(name);
            if (c && c.length >= 3) return [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1];
        }
    } catch (e) {}
    return fallback;
}

// ---- parameters ------------------------------------------------------------------------------------------------------
/** The current raw value of a parameter (its default until the first set_<key> arrives). */
function dvParam(key, dflt) {
    if (key in dvP) return dvP[key];
    var i = DV_PARAM_INDEX[key];
    if (i !== undefined) return Number(DV_PARAMS[i][5]);
    return dflt === undefined ? 0 : dflt;
}

/** A raw value (or the current one) as 0..1 over the parameter's range. */
function dvNorm(key, v) {
    var i = DV_PARAM_INDEX[key];
    if (i === undefined) return 0;
    var lo = Number(DV_PARAMS[i][3]), hi = Number(DV_PARAMS[i][4]);
    var x = v === undefined ? dvParam(key) : v;
    return hi > lo ? dvClamp((x - lo) / (hi - lo), 0, 1) : 0;
}

/** Inverse of dvNorm. */
function dvDenorm(key, n) {
    var i = DV_PARAM_INDEX[key];
    if (i === undefined) return 0;
    var lo = Number(DV_PARAMS[i][3]), hi = Number(DV_PARAMS[i][4]);
    return lo + (hi - lo) * dvClamp(n, 0, 1);
}

function dvSend(key, value) {
    outlet(0, "param", key, value);
}

function dvCmd(name, ...rest) {
    outlet(0, "cmd", name, ...rest);
}

/** A manual hit (as if a MIDI note arrived): what a canvas with role "hit" does on a click. */
function dvManualHit() {
    dvCmd("hit");
}

/** Save this face's own small integer state with the Set (blob section "UI"); arrives again as dvState.ui after a reload. */
function dvSaveUi(ints) {
    outlet(0, "cmd", "ui", ...ints);
}

/** The meta draw values to show: the drifted metas, or the Values before the first draw. */
function dvMetaValue(i) {
    return dvTel.serial > 0 || dvTel.hits > 0 ? dvTel.metas[i] : dvClamp(dvParam("v_" + DV_META_KEYS[i]), 0, 100);
}

// ---- messages from the patcher ------------------------------------------------------------------------------------------------
function anything() {
    var name = messagename;
    var a = arguments;
    if (!name) return;
    if (name.indexOf("set_") === 0) {
        var key = name.substring(4);
        dvP[key] = a.length ? dvNum(a[0]) : 0;
        if (typeof onParam === "function") onParam(key, dvP[key]);
        mgraphics.redraw();
    } else if (name === "state" && a.length) {
        var kind = String(a[0]);
        if (kind === "dsp") {
            dvState.dsp.ready = Number(a[1]) ? 1 : 0;
            dvState.dsp.error = a[2] === "-" || a[2] === undefined ? "" : String(a[2]).replace(/_/g, " ");
        } else if (kind === "midi") {
            dvState.midi = a[1] === "-" || a[1] === undefined ? "" : String(a[1]).replace(/_/g, " ");
        } else if (kind === "ui") {
            dvState.ui = Array.prototype.slice.call(a, 1).map(function (v) { return dvNum(v); });
        }
        if (typeof onState === "function") onState(kind);
        mgraphics.redraw();
    }
}

function names(scopeName, ctlName, irName, specName, testName, stateName) {
    dvNames.scope = String(scopeName === undefined ? "" : scopeName);
    dvNames.ctl = String(ctlName === undefined ? "" : ctlName);
    dvNames.ir = String(irName === undefined ? "" : irName);
    dvNames.spec = String(specName === undefined ? "" : specName);
    dvNames.test = String(testName === undefined ? "" : testName);
    dvNames.state = String(stateName === undefined ? "" : stateName);
}

// ---- telemetry --------------------------------------------------------------------------------------------------------------------
var dvBufs = {};
/** @param {string} name  a buffer~ name from dvNames */
function dvBuf(name) {
    if (!name || typeof Buffer === "undefined") return null;
    if (!dvBufs[name]) {
        try { dvBufs[name] = new Buffer(name); } catch (e) { return null; }
    }
    return dvBufs[name];
}

/** Ask for the optional (more expensive) telemetry parts: {wave: true} (256 min/max blocks), {spec: true} (32-band spectrum of the output). */
function dvNeed(w) {
    if (w.wave !== undefined) dvWant.wave = !!w.wave;
    if (w.spec !== undefined) dvWant.spec = !!w.spec;
}

/** Keep redrawing for `ms` more milliseconds (a tween that is still running). */
function dvAnimate(ms) {
    var until = Date.now() + ms;
    if (until > dvAnimUntil) dvAnimUntil = until;
}

/** True while the face should keep redrawing: signal about, a hit still ringing, or a requested tween. */
function dvAnimating() {
    return dvTel.active || dvTel.ageMs >= 0 || Date.now() < dvAnimUntil;
}

/**
 * Parse a scope buffer (a Float32Array / array of DV_SCOPE_SAMPS or at least 160 floats) into dvTel.
 * @param {ArrayLike<number>} s
 * @param {number} [nowMs]
 */
function dvParseScope(s, nowMs) {
    var S = DV_SCOPE, T = dvTel, i;
    var now = nowMs === undefined ? Date.now() : nowMs;
    var dt = T.lastParseMs ? Math.min(1000, Math.max(0, now - T.lastParseMs)) : 0;
    T.lastParseMs = now;
    T.s = s;
    T.sr = dvNum(s[S.SR], 48000) || 48000;
    var hits = Math.round(dvNum(s[S.HITS])), serial = Math.round(dvNum(s[S.DRAW_SERIAL]));
    T.hitNew = T.hits !== hits && T.frames >= 0;
    T.serialNew = T.serial !== serial && T.frames >= 0;
    if (T.hitNew) T.lastHitMs = now;
    if (T.serialNew) T.lastSerialMs = now;
    T.hits = hits; T.serial = serial;
    T.ageMs = dvNum(s[S.ONSET_AGE], -1);
    T.gate = dvNum(s[S.HIT_GATE], 1) > 0.5 ? 1 : 0;
    T.src = dvNum(s[S.HIT_SRC]) > 0.5 ? 1 : 0;
    T.split = dvNum(s[S.SPLIT_MODE]) > 0.5 ? 1 : 0;
    T.latency = dvNum(s[S.LATENCY], 256);
    T.asleep = dvNum(s[S.ASLEEP]) > 0.5 ? 1 : 0;
    T.reroll = Math.round(dvNum(s[S.REROLL]));
    T.trS = dvNum(s[S.TR_S], 0.05);
    T.ringEnv = dvClamp(dvNum(s[S.RING_ENV]), 0, 1);
    T.ring = dvClamp(dvNum(s[S.METAS + DV_RING_META]) / 100, 0, 1);
    T.irTag = Math.round(dvNum(s[S.IR_TAG]));
    T.fast = dvNum(s[S.FAST]); T.slow = dvNum(s[S.SLOW]); T.thr = dvNum(s[S.THR]);
    T.pageApplied = Math.round(dvNum(s[S.PAGE_APPLIED]));
    T.waveHead = Math.round(dvNum(s[S.WAVE_HEAD]));
    for (i = 0; i < 8; i++) {
        T.metas[i] = dvClamp(dvNum(s[S.METAS + i]), 0, 100);
        T.draws[i] = dvClamp(dvNum(s[S.DRAWS + i]), 0, 100);
    }
    if (s.length > dvHiddenSlot(DV_HIDDEN_COUNT - 1)) {
        T.hidden = [];
        for (i = 0; i < DV_HIDDEN_COUNT; i++) T.hidden.push(dvNum(s[dvHiddenSlot(i)]));
    }
    // smoothed display peaks: instant attack, ~120 ms release
    var k = dt > 0 ? Math.exp(-dt / 120) : 0;
    var raw = { i: S.PK_IN, t: S.PK_T, b: S.PK_B, l: S.PK_L, o: S.PK_OUT, d: S.PK_DRY };
    for (var name in raw) {
        var v = dvClamp(dvNum(s[raw[name]]), 0, 4);
        T.pk[name] = Math.max(v, T.pk[name] * k);
    }
    if (s.length >= S.WAVE + DV_WAVE_BLOCKS * DV_WAVE_STRIDE) T.wave = s;
    var sig = dvNum(s[S.PK_IN]) + dvNum(s[S.PK_OUT]);
    if (sig > 0.00002 || T.ageMs >= 0) T.idleSince = now;
    else if (!T.idleSince) T.idleSince = now;
    T.active = now - T.idleSince < 3000;
}

var dvPollTask = null;
var dvPollMs = 33;
var dvPollFps = 30;
function dvPoll(fps) {
    if (typeof Task === "undefined" || dvPollTask) return;
    dvPollFps = fps || 30;
    dvPollMs = Math.round(1000 / dvPollFps);
    dvPollTask = new Task(dvFrame, this);
    dvPollTask.interval = dvPollMs;
    dvPollTask.repeat();
}

function dvFrame() {
    var b = dvBuf(dvNames.scope);
    if (!b) return;
    var n = dvWant.wave ? DV_SCOPE_SAMPS : DV_SCOPE.HIDDEN2 + 16;
    var s = b.peek(1, 0, n);
    if (!s || s.length < 64) return;
    var frames = dvNum(s[DV_SCOPE.FRAMES], -1);
    var moved = frames !== dvTel.frames;
    dvTel.alive = dvNum(s[DV_SCOPE.ALIVE], -1);
    if (!moved) {
        // frozen frames (asleep): the display peaks fall back by themselves, redraw only while something still animates
        var now = Date.now();
        if (dvTel.lastParseMs && now - dvTel.lastParseMs > 50) {
            var k = Math.exp(-Math.min(1000, now - dvTel.lastParseMs) / 120);
            for (var name in dvTel.pk) dvTel.pk[name] *= k;
            dvTel.lastParseMs = now;
            dvTel.hitNew = false;
            dvTel.serialNew = false;
            if (now - dvTel.idleSince > 3000) dvTel.active = false;
            if (dvAnimating()) mgraphics.redraw();
        }
        dvSetPollRate();
        return;
    }
    dvParseScope(s);
    dvTel.frames = frames;
    if (dvWant.spec) dvTel.spec = dvSpectrum32();
    dvSetPollRate();
    var again = typeof onFrame === "function" ? onFrame(dvTel) : true;
    if (again !== false && (dvAnimating() || dvTel.hitNew || dvTel.serialNew)) mgraphics.redraw();
}

function dvSetPollRate() {
    if (!dvPollTask) return;
    var want = dvTel.active ? dvPollMs : 100;
    if (dvPollTask.interval !== want) dvPollTask.interval = want;
}

// ---- spectrum (only when the face asks for it) ------------------------------------------------------------------------------------
var dvTwiddle = null;
/** In-place radix-2 FFT (n = 2048) */
function dvFftFace(re, im, n) {
    var i, j = 0, k, t;
    for (i = 1; i < n; i++) {
        var bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    if (!dvTwiddle || dvTwiddle.n !== n) {
        dvTwiddle = { n: n, c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
        for (k = 0; k < n / 2; k++) { dvTwiddle.c[k] = Math.cos(2 * Math.PI * k / n); dvTwiddle.s[k] = -Math.sin(2 * Math.PI * k / n); }
    }
    for (var len = 2; len <= n; len <<= 1) {
        var half = len >> 1, step = n / len;
        for (i = 0; i < n; i += len) {
            for (k = 0; k < half; k++) {
                var wr = dvTwiddle.c[k * step], wi = dvTwiddle.s[k * step];
                var a = i + k, b = a + half;
                var xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
                re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
            }
        }
    }
}

/**
 * 32 log-spaced bands (40 Hz..18 kHz) of the device output (channel DV_SPEC_CH.OUT of buffer ---deviatespec), in dB (full-scale sine = 0 dB),
 * -100 for silence. Run it only while the face shows a spectrum (dvNeed({spec: true})).
 * @param {number} [channel]  DV_SPEC_CH.IN | T | B | R | OUT
 * @returns {Float32Array}
 */
function dvSpectrum32(channel) {
    var out = new Float32Array(32);
    var b = dvBuf(dvNames.spec);
    var ch = channel === undefined ? DV_SPEC_CH.OUT : channel;
    var n = DV_SPEC_N;
    if (!b) { out.fill(-100); return out; }
    var data = b.peek(ch + 1, 0, n);
    if (!data || data.length < n) { out.fill(-100); return out; }
    var head = dvTel.s ? Math.max(0, Math.round(dvNum(dvTel.s[DV_SCOPE.SPEC_HEAD]))) % n : 0;
    var re = new Float64Array(n), im = new Float64Array(n);
    for (var i = 0; i < n; i++) re[i] = dvNum(data[(head + i) % n]) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
    dvFftFace(re, im, n);
    var sr = dvTel.sr || 48000;
    var f0 = 40, f1 = Math.min(18000, sr * 0.45);
    for (var bnd = 0; bnd < 32; bnd++) {
        var lo = f0 * Math.pow(f1 / f0, bnd / 32), hi = f0 * Math.pow(f1 / f0, (bnd + 1) / 32);
        var k0 = Math.max(1, Math.floor(lo * n / sr)), k1 = Math.max(k0 + 1, Math.ceil(hi * n / sr));
        var m = 0;
        for (var k = k0; k < k1 && k < n / 2; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
        out[bnd] = m > 1e-9 ? dvClamp(20 * Math.log10(m * 4 / n), -100, 0) : -100;
    }
    return out;
}

// ---- drawing helpers (paths only: the preview renderer has no gradients / clip and draws every arc as a full circle) -----------------
function dvColor(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? (c.length > 3 ? c[3] : 1) : a);
}

/** A circle path (no fill / stroke). */
function dvCircle(cx, cy, r) {
    mgraphics.ellipse(cx - r, cy - r, 2 * r, 2 * r);
}

/** A closed polygon path through `pts` ([[x, y], ...]); close = false leaves it open (a polyline). */
function dvPoly(pts, close) {
    if (!pts.length) return;
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    if (close !== false) mgraphics.close_path();
}

/** An annular segment path from angle a0 to a1 (radians, 0 = right, clockwise on screen), radii r0 < r1, approximated with line segments. */
function dvRingSeg(cx, cy, r0, r1, a0, a1, steps) {
    var n = Math.max(2, steps || Math.ceil(Math.abs(a1 - a0) / 0.15));
    var pts = [], i, a;
    for (i = 0; i <= n; i++) { a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]); }
    for (i = n; i >= 0; i--) { a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]); }
    dvPoly(pts, true);
}

function dvText(str, x, y, size, c, bold, a) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    dvColor(c, a);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(str));
}

function dvTextW(str, size, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    return mgraphics.text_measure(String(str))[0];
}

function dvPill(x, y, w, h, fill, alpha) {
    dvColor(fill, alpha);
    mgraphics.rectangle_rounded(x, y, w, h, h, h);
    mgraphics.fill();
}

/** The DSP status pill text for the face header: "" when the DSP runs. */
function dvDspPillText() {
    if (dvState.dsp.ready) return "";
    if (dvState.dsp.error) return "DSP failed: " + (dvState.dsp.error.length > 22 ? dvState.dsp.error.substring(0, 21) + "..." : dvState.dsp.error);
    return "DSP loading...";
}

/** Draws the DSP status pill (nothing when the DSP runs) right-aligned to `right`; returns its width. */
function dvDrawDspPill(right, y, size, palette) {
    var t = dvDspPillText();
    if (!t) return 0;
    var pal = palette || DVC;
    var w = dvTextW(t, size, true) + 10;
    dvPill(right - w, y, w, size + 5, dvState.dsp.error ? pal.coral : pal.amber, 0.9);
    dvText(t, right - w + 5, y + size + 1, size, [0.08, 0.08, 0.08, 1], true);
    return w;
}

/** True when (x, y) lies inside rect [x, y, w, h]. */
function dvInside(px, py, r) {
    return px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3];
}

// ---- preview (scripts/render_deviate_previews.py sets DV_PREVIEW_STATE through the renderer's prelude, default "hit") ------------------
/**
 * Fills dvTel / dvP / dvState with the deterministic preview state and returns the state object. A face's preview() calls this first.
 * @returns {{kind: string, spectral?: boolean, gate?: number, seed?: number, ageMs?: number}}
 */
function dvPreviewBase() {
    var raw = typeof DV_PREVIEW_STATE !== "undefined" ? DV_PREVIEW_STATE : "hit";
    var st = typeof raw === "string" ? { kind: raw } : raw;
    dvState.dsp.ready = 1; dvState.dsp.error = "";
    dvState.midi = "From Max 1";
    var s = dvPreviewTel(st);
    dvTel.frames = -1; dvTel.lastParseMs = 0; dvTel.hits = 0; dvTel.serial = 0;
    dvParseScope(s, 1000);
    dvTel.hitNew = st.kind === "hit"; dvTel.serialNew = st.kind === "hit";
    dvTel.active = st.kind !== "idle"; dvTel.idleSince = 1000;
    if (st.kind === "extreme") for (var i = 0; i < 8; i++) { dvP["v_" + DV_META_KEYS[i]] = i % 2 ? 0 : 100; dvP["r_" + DV_META_KEYS[i]] = i % 2 ? 100 : 0; }
    // pk are smoothed from zero on the first parse: set them to the scope values
    dvTel.pk = { i: dvNum(s[DV_SCOPE.PK_IN]), t: dvNum(s[DV_SCOPE.PK_T]), b: dvNum(s[DV_SCOPE.PK_B]), l: dvNum(s[DV_SCOPE.PK_L]),
        o: dvNum(s[DV_SCOPE.PK_OUT]), d: dvNum(s[DV_SCOPE.PK_DRY]) };
    dvTel.spec = dvFakeSpec(st);
    return st;
}

/** A deterministic, plausible 32-band spectrum (dB) for previews and tests. */
function dvFakeSpec(st) {
    var rng = dvRng(97);
    var out = new Float32Array(32);
    var level = st && st.kind === "idle" ? -90 : st && st.kind === "extreme" ? -12 : -30;
    for (var b = 0; b < 32; b++) {
        var tilt = -b * 0.9;
        out[b] = dvClamp(level + tilt + (st && st.kind === "ring" ? -12 : 0) + (rng() - 0.5) * 8 + (b === 6 || b === 7 ? 8 : 0), -100, 0);
    }
    return out;
}
