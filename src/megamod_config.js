// Mega Modulator — shared pure model: constants, state, serialization, buffer layouts, curve math,
// modulator reference implementations, learn helpers. Node-requirable; prepended (together with
// src/megamod_mapper.js) into every UI script at build time.
//
// =====================================================================================
// API CONTRACT (read this before writing src/megamod_ui.js)
// =====================================================================================
// Build order inside each UI script:  megamod_config.js + megamod_mapper.js + megamod_ui.js.
// All three are ONE v8ui script scope, so UI code may use every const/function of config and the
// global `MM` object. Do NOT redeclare names that exist in config/mapper (prefix UI helpers with `ui`).
// The mapper owns these Max entry points; a UI must NOT define them:
//   getvalueof, setvalueof, setnames, init_lom
// The UI script MUST define:
//   paint()                         mgraphics drawing (call mgraphics.redraw() when it should refresh)
//   onclick/ondrag/ondblclick/onidle/onidleout/onwheel/onkeydown ... as needed (all optional)
// The UI script MAY define (called by the mapper if present):
//   uiReady()                       once names + LOM + state are all available (after load/restore);
//                                   call MM.requestWidth(w) here
//   uiTelemetry(frame)              after each telemetry poll (~30 fps), frame = MM.readTelemetry()
//   uiChanged(ev)                   after any model change; ev = {kind, mod, id}
//                                   kind: "load" | "mods" | "mod" | "param" | "mapping" | "learn" | "ui" | "targets" | "full"
//                                   ("full" = a learn/add was refused because all 256 mapping slots are in use)
// Equivalent registry: MM.on("change"|"telemetry"|"ready", fn).
//
// MM API (all mutating calls fire "change" and request a redraw; each call is one undoable gesture
// unless it says otherwise — call MM.commit() at gesture end for drags, see below):
//   MM.state                        live state object (see STATE MODEL). Read freely; mutate via API.
//   MM.addModulator(type[, slot])   -> slot index or -1 (full). type = MOD_LFO..MOD_MSEG
//   MM.removeModulator(i)           also deletes its mappings
//   MM.setModType(i, type)          resets params to that type's defaults, keeps name/color/mappings
//   MM.setParam(i, key, v)          key in MOD_PARAM_KEYS ("rate","sync","syncDiv","shape","phase","retrig",
//                                   "bipolar","depth","attack","release","gain","smooth","steps","glide",
//                                   "oneshot","seed","loopOn","loopStart","loopEnd","enabled"); clamps
//   MM.setName(i, s) / MM.setColor(i, idx)
//   MM.setSteps(i, arr) / MM.setStep(i, k, v01)     Steps values 0..1
//   MM.setMsegPoints(i, points)     [{x,y,curve,sCurve}] 0..1; sanitized (pure model in config)
//   MM.retrigger(i)                 restart a modulator (LFO/Random/Steps/MSEG phase)
//   MM.armLearn(i, multi)           learn: next selected Live parameter (single) or every one (multi)
//   MM.disarmLearn()                MM.learn = {armed, mod, multi} (read-only)
//   MM.addMapping(i, target)        target {path, name, trackName, deviceName, paramName, id?} -> mapping|null
//                                   (null also when the pool is full: MM.mappingCapacity().free === 0; a learn that
//                                   hits a full pool fires change kind "full" and adds nothing)
//   MM.mappingCapacity()            -> {used, max: MAX_MAPPINGS (256), free}
//   MM.MAX_MAPPINGS                 256
//   MM.mappingSlot(id)              the pool slot 0..255 of a mapping (-1 if none)
//   MM.updateMapping(id, patch)     keys: min / max (0..1, Remote), mode ("mod"|"remote"), polarity (1 "+", 0 "±", -1 "−"), range (0..1; the Mod depth),
//                                   shape (MSEG points [{x,y,curve,sCurve}], the transfer curve), enabled,
//                                   mod (retarget slot)
//   MM.deleteMapping(id)
//   MM.mappingsFor(i) / MM.allMappings() / MM.getMapping(id)
//   MM.mappingStatus(id)            "ok" | "missing" | "disabled" | "pending"
//   MM.readTelemetry()              -> {frame, bpm, beat, playing, mods:[{out(-1..1), phase(0..1), u(0..1), aux}]} x MAX_MODS
//   MM.setUI(patch) / MM.getUI()    opaque JSON-able `state.ui` (merged shallowly). Persisted. UI-only data.
//   MM.requestWidth(w)              device width in px (clamped 120..1600), re-emitted on load/ready
//   MM.commit()                     end of a drag gesture: notifyclients() so Live saves the Set (setters during a
//                                   drag only mark dirty; discrete actions commit by themselves)
//   MM.emitAux(...args)             outlet 1 -> extra boxes declared in scripts/megamod_layout.json
//   MM.modCount() / MM.freeSlot()   helpers
//   MM.demo()                       fills a demo state (used by previews/tests)
// Preview mock (scripts/render_preview.py) supports ONLY this mgraphics subset:
//   set_source_rgba, set_line_width, rectangle, rectangle_rounded, move_to, line_to, curve_to, close_path,
//   arc (full circles only), ellipse (as circle), fill, fill_preserve, stroke, select_font_face,
//   set_font_size, show_text, text_measure, save/restore/translate/rotate, size, init, redraw
//   (stroke does not preserve the path; rects/arcs/rrects follow translate only; define `preview()` to set up
//   the state the preview should show; it is called before paint()).
// Entry points per device (patch -> script): messages `setnames`, `init_lom` come from the patch; outlet 0 = [width <px>] / [gen <msg...>] (route width gen), outlet 1 = aux for extra boxes.
//
// =====================================================================================
// STATE MODEL (persisted in blob param "MegaModState")
// =====================================================================================
// state = {
//   schema: 6,                  // 1 = per-mapping curve fields (migrated to `shape`); < 4 = invert / bipolar / min / max baked into `shape` + polarity; 4 = remote polarity / range / amount (-> min / max in 5); < 6 = amount folded into range (see MIGRATION)
//   mods: [ModSlot|null] x MAX_MODS,
//   mappings: [Mapping],
//   nextMapId: int,
//   ui: {}                      // UI-private, opaque, JSON-able (expanded modulator, inspector open, ...)
// }
// ModSlot = {type, name, color(0..15), enabled(0/1), p:{rate,sync,syncDiv,shape,phase,retrig,bipolar,depth,
//            attack,release,gain,smooth,steps,glide,oneshot,seed,loopOn,loopStart,loopEnd},
//            points:[{x,y,curve,sCurve}], stepVals:[32 x 0..1]}
// Mapping = {id, mod, enabled, mode:"mod"|"remote", polarity(1 "+" | 0 "±" | -1 "−"), range(0..1, default 0.5; the Mod depth, there is no separate amount),
//            min(0..1), max(0..1) (Remote only: independent absolute limits of the target parameter, min > max inverts; defaults 0 / 1; polarity / range are ignored in Remote but kept),
//            shape:[{x,y,curve,sCurve}] (editable MSEG transfer curve, x = modulator 0..1, y = output 0..1), target:{path,name,trackName,deviceName,paramName}}   (runtime-only: slot, pid, missing)
//
// MAPPING POOL (no runtime scripting: live.modulate~ / live.remote~ created by scripting never attach in Live):
//   The device file holds MAX_MAPPINGS = 256 pre-built slots. Slot k = router gen floor(k/32), outlet k%32 ->
//   live.modulate~ (varname mm_mod_k) AND live.remote~ (mm_rem_k); `prepend id` boxes mm_mid_k / mm_rid_k feed their
//   right inlets. A mapping owns the lowest free slot: its curve table lives at buffer~ ---mmcurve[k*256 ..],
//   route[2k] (buffer~ ---megamodroute) = source modulator index when active else -1, and the live id is sent to
//   the box of the active mode (the other gets 0). Router output = table lookup of the selected engine outlet.
//
// OUTPUT CONVENTION (engine outlet k, normalized -1..1):
//   every generator yields u in 0..1; bipolar: out = depth*(2u-1); unipolar: out = 2*depth*u - 1
//   (a unipolar modulator rests at -1 and spans the full table range up to 2*depth-1).
//   Mapping lookup input x in -1..1 -> mod value m = (x+1)/2 in 0..1 ->
//   y = evalMseg(shape, u);  signed modulation  o = range * (polarity === 0 ? 2y - 1 : polarity * y)  (-1..1).
//   Mod:    mappingOutput = o  (the offset live.modulate~ gets).
//   Remote (schema 5): live.remote~ @normalized gets an ABSOLUTE 0..1 value  clamp(min + (max - min) * y, 0, 1)  (min / max independent, min > max inverts).
//           Schema 4 remote mappings migrate exactly (a = amount, r = range): "+": min 0, max a*r;  "−": min 1, max 1 - a*r;
//           "±": min 0.5 - a*r/2, max 0.5 + a*r/2  (each clamped to 0..1; a clamp changes the response, e.g. a*r > 1 or a < 0 on "+").
//   MIGRATION (schema < 6, Mod and Remote alike): amount is folded into range, range' = clamp(|amount| * range, 0, 1); amount < 0 swaps "+" <-> "−"
//   or, for "±", flips the shape vertically (y -> 1 - y; the segment easing is a fraction of the y span, so curve / sCurve stay as they are).
//   Exact (tables within 1e-9). Schema 4 Remote limits are derived from the OLD amount * range first.
//   MIGRATION (schema < 4): the old affine parts are baked into the shape's point y values (an affine map of the
//   y values affinely maps evalMseg for every curve / sCurve, since the segment easing is independent of y):
//   Mod: y' = lo + (hi-lo)*(invert ? 1-y : y) (lo/hi = min/max for schema 3, 0/1 before), polarity = bipolar ? 0 : 1, range 1;
//   Remote: y' = min + (max-min)*(invert ? 1-y : y), polarity 1, range 1, amount 1 (so v = y').
// =====================================================================================

const MEGAMOD_VERSION = 6; // schema version of the JSON state
const MAX_MODS = 16;

// ---- engine buffer layouts (contract with src/megamod_engine.genexpr; tests parse the genexpr) ----
const CFG_STRIDE = 24; // floats per slot in buffer~ ---megamodcfg
const CF_TYPE = 0; // 0 none, 1 LFO, 2 Env, 3 Random, 4 Steps, 5 MSEG
const CF_ENABLED = 1;
const CF_RATE = 2; // Hz (free) — cycles/s; Steps: steps/s
const CF_SYNC = 3; // 1 = tempo synced
const CF_SYNCDIV = 4; // index into SYNC_BEATS (length of a cycle / of one step)
const CF_SHAPE = 5; // LFO shape 0 sine,1 tri,2 saw up,3 saw down,4 square
const CF_PHASE = 6; // 0..1 phase offset
const CF_RETRIG = 7; // 1 = restarts on transport start / retrigger message
const CF_BIPOLAR = 8;
const CF_DEPTH = 9; // 0..1
const CF_ATTACK = 10; // ms
const CF_RELEASE = 11; // ms
const CF_GAIN = 12; // dB (env follower)
const CF_SMOOTH = 13; // 0..1 (random glide fraction of a cycle)
const CF_STEPS = 14; // step count 1..32
const CF_GLIDE = 15; // 0..1 (steps glide fraction of a step)
const CF_ONESHOT = 16; // 1 = run once from retrigger then hold (MSEG/Steps/LFO)
const CF_SEED = 17;
const CF_LOOPON = 18; // MSEG window on
const CF_LOOPSTART = 19;
const CF_LOOPEND = 20;
const CFG_FLOATS = MAX_MODS * CFG_STRIDE;

const MSEG_TABLE = 1024; // samples per slot in buffer~ ---megamodmseg
const MSEG_FLOATS = MAX_MODS * MSEG_TABLE;
const STEPS_MAX = 32; // per slot in buffer~ ---megamodsteps
const STEPS_FLOATS = MAX_MODS * STEPS_MAX;

// buffer~ ---megamodscope: per slot SCOPE_STRIDE floats [out, phase, u, aux]; header from SCOPE_HEADER
const SCOPE_STRIDE = 4;
const SCOPE_HEADER = 64; // [0] frame counter [1] sr [2] beat [3] bpm [4] playing
const SCOPE_FRAME = 64;
const SCOPE_SR = 65;
const SCOPE_BEAT = 66;
const SCOPE_BPM = 67;
const SCOPE_PLAYING = 68;
const SCOPE_SAMPS = 128;

const MAX_MAPPINGS = 256; // saved mapping-slot pool: 256 live.modulate~ + 256 live.remote~ in the device file
const CURVE_REGION = 256; // samples per mapping transfer table in buffer~ ---mmcurve (FIXED: MAX_MAPPINGS x 256 samples)
const CURVE_SAMPS = MAX_MAPPINGS * CURVE_REGION;
const ROUTE_SAMPS = 512; // buffer~ ---megamodroute: [2k] = source modulator index or -1 (off), [2k+1] spare
const ROUTE_OFF = -1;
const ROUTERS = 8; // router gen.codebox~ boxes (16 signal inlets, 32 outlets each): slot k = router floor(k/32), outlet k%32
const ROUTER_SLOTS = MAX_MAPPINGS / ROUTERS;

const BUF_CFG = "megamodcfg";
const BUF_MSEG = "megamodmseg";
const BUF_STEPS = "megamodsteps";
const BUF_SCOPE = "megamodscope";
const BUF_CURVE = "mmcurve";
const BUF_ROUTE = "megamodroute";

const MOD_NONE = 0;
const MOD_LFO = 1;
const MOD_ENV = 2;
const MOD_RANDOM = 3;
const MOD_STEPS = 4;
const MOD_MSEG = 5;
const MOD_TYPE_NAMES = ["None", "LFO", "Envelope", "Random", "Steps", "MSEG"];
const MOD_TYPE_SHORT = ["--", "LFO", "ENV", "RND", "STP", "MSG"];

const LFO_SHAPES = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square"];

const CURVE_LINEAR = 0;
const CURVE_EXP = 1;
const CURVE_LOG = 2;
const CURVE_S = 3;
const CURVE_STEPPED = 4;
const CURVE_NAMES = ["Linear", "Exp", "Log", "S-Curve", "Stepped"];

const SYNC_BEATS = [
    0.0625, 0.125, 0.16666667, 0.25, 0.375, 0.33333333, 0.5, 0.75,
    0.66666667, 1.0, 1.5, 2.0, 4.0, 8.0, 16.0, 32.0,
];
const SYNC_LABELS = [
    "1/64", "1/32", "1/16T", "1/16", "1/16.", "1/8T", "1/8", "1/8.",
    "1/4T", "1/4", "1/4.", "1/2", "1 Bar", "2 Bars", "4 Bars", "8 Bars",
];

const MOD_COLORS = [
    [0.28, 0.84, 0.96], [0.96, 0.66, 0.25], [0.55, 0.88, 0.45], [0.95, 0.45, 0.55],
    [0.70, 0.55, 0.98], [0.98, 0.85, 0.30], [0.35, 0.75, 0.70], [0.98, 0.58, 0.40],
    [0.50, 0.70, 0.98], [0.85, 0.50, 0.85], [0.65, 0.90, 0.60], [0.95, 0.70, 0.75],
    [0.45, 0.90, 0.85], [0.90, 0.80, 0.55], [0.60, 0.60, 0.95], [0.80, 0.90, 0.40],
];

const MOD_PARAM_KEYS = [
    "enabled", "rate", "sync", "syncDiv", "shape", "phase", "retrig", "bipolar", "depth", "attack", "release",
    "gain", "smooth", "steps", "glide", "oneshot", "seed", "loopOn", "loopStart", "loopEnd",
];
// key -> [lo, hi, integer?]
const MOD_PARAM_RANGE = {
    enabled: [0, 1, true], rate: [0.01, 40, false], sync: [0, 1, true], syncDiv: [0, 15, true],
    shape: [0, 4, true], phase: [0, 1, false], retrig: [0, 1, true], bipolar: [0, 1, true],
    depth: [0, 1, false], attack: [0.05, 2000, false], release: [0.5, 5000, false], gain: [-24, 36, false],
    smooth: [0, 1, false], steps: [1, 32, true], glide: [0, 1, false], oneshot: [0, 1, true],
    seed: [0, 1000, true], loopOn: [0, 1, true], loopStart: [0, 0.95, false], loopEnd: [0.05, 1, false],
};

const MIN_WIDTH = 120;
const MAX_WIDTH = 1600;

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}
function frac(x) {
    return x - Math.floor(x);
}
function smoothstep01(t) {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
}

// ------------------------------------------------------------------------------------
// MSEG model (extracted from src/mseg_editor.js: points with per-segment curve + S flag)
// ------------------------------------------------------------------------------------
function evalSegmentT(t, curve, sCurve) {
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    if (Math.abs(curve) < 0.001) return t;
    const p = Math.pow(2.0, Math.abs(curve) * 3.6);
    if (sCurve) {
        if (t < 0.5) {
            const u = t * 2.0;
            const shaped = curve > 0.0 ? 1.0 - Math.pow(1.0 - u, p) : Math.pow(u, p);
            return 0.5 * shaped;
        }
        const u = (t - 0.5) * 2.0;
        const shaped = curve > 0.0 ? Math.pow(u, p) : 1.0 - Math.pow(1.0 - u, p);
        return 0.5 + 0.5 * shaped;
    }
    return curve > 0.0 ? 1.0 - Math.pow(1.0 - t, p) : Math.pow(t, p);
}

// Y (0..1) of the MSEG at normalized X (0..1). `points` must be sorted by x (use sanitizeMsegPoints).
function evalMseg(points, nx) {
    if (!points || points.length === 0) return 0.0;
    if (nx <= points[0].x) return points[0].y;
    const last = points[points.length - 1];
    if (nx >= last.x) return last.y;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        if (nx >= p0.x && nx <= p1.x) {
            const dx = p1.x - p0.x;
            if (dx <= 0.00001) return p1.y;
            const u = evalSegmentT((nx - p0.x) / dx, p0.curve || 0.0, p0.sCurve ? 1 : 0);
            return p0.y + (p1.y - p0.y) * u;
        }
    }
    return last.y;
}

function defaultMsegPoints() {
    return [
        { x: 0, y: 0, curve: 0, sCurve: 0 },
        { x: 0.5, y: 1, curve: 0, sCurve: 0 },
        { x: 1, y: 0, curve: 0, sCurve: 0 },
    ];
}

function sanitizeMsegPoints(pts) {
    let out = Array.isArray(pts)
        ? pts.map((p, i) => ({
            x: clamp(num(p && p.x, 0), 0, 1), y: clamp(num(p && p.y, 0), 0, 1),
            curve: clamp(num(p && p.curve, 0), -1, 1), sCurve: p && p.sCurve ? 1 : 0, _i: i,
        }))
        : [];
    if (out.length < 2) return defaultMsegPoints();
    out.sort((a, b) => (Math.abs(a.x - b.x) < 1e-6 ? a._i - b._i : a.x - b.x));
    out = out.slice(0, 256);
    out[0].x = 0;
    out[out.length - 1].x = 1;
    return out.map((p) => ({ x: p.x, y: p.y, curve: p.curve, sCurve: p.sCurve }));
}

function msegTable(points, size) {
    const n = size || MSEG_TABLE;
    const pts = sanitizeMsegPoints(points);
    const t = new Array(n);
    for (let i = 0; i < n; i++) t[i] = evalMseg(pts, i / (n - 1));
    return t;
}

// ------------------------------------------------------------------------------------
// Modulator defaults + clamping
// ------------------------------------------------------------------------------------
function defaultParams(type) {
    const p = {
        rate: 1, sync: 1, syncDiv: 9, shape: 0, phase: 0, retrig: 0, bipolar: 1, depth: 1,
        attack: 5, release: 120, gain: 0, smooth: 0, steps: 8, glide: 0, oneshot: 0, seed: 1,
        loopOn: 0, loopStart: 0, loopEnd: 1,
    };
    if (type === MOD_ENV) { p.bipolar = 0; }
    if (type === MOD_RANDOM) { p.rate = 2; p.syncDiv = 6; p.bipolar = 1; }
    if (type === MOD_STEPS) { p.rate = 4; p.syncDiv = 3; p.bipolar = 1; p.sync = 1; }
    if (type === MOD_MSEG) { p.bipolar = 0; p.syncDiv = 12; p.rate = 0.5; }
    return p;
}

function defaultStepVals() {
    const v = [];
    for (let i = 0; i < STEPS_MAX; i++) v.push([0.1, 0.9, 0.4, 0.7, 0.2, 1.0, 0.5, 0.0][i % 8]);
    return v;
}

function makeModSlot(type, slot) {
    const idx = slot || 0;
    return {
        type,
        name: MOD_TYPE_NAMES[type] + " " + (idx + 1),
        color: idx % MOD_COLORS.length,
        enabled: 1,
        p: defaultParams(type),
        points: defaultMsegPoints(),
        stepVals: defaultStepVals(),
    };
}

function clampParam(key, v) {
    const r = MOD_PARAM_RANGE[key];
    if (!r) return v;
    const x = clamp(num(v, r[0]), r[0], r[1]);
    return r[2] ? Math.round(x) : x;
}

// ------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------
function defaultState() {
    const mods = [];
    for (let i = 0; i < MAX_MODS; i++) mods.push(null);
    return { schema: MEGAMOD_VERSION, mods, mappings: [], nextMapId: 1, ui: {} };
}

function sanitizeTarget(t) {
    const o = t || {};
    return {
        path: String(o.path || ""), name: String(o.name || o.paramName || ""),
        trackName: String(o.trackName || ""), deviceName: String(o.deviceName || ""),
        paramName: String(o.paramName || o.name || ""),
    };
}

// ---- mapping transfer shape (an MSEG: x = modulator 0..1, y = output 0..1; first/last point pinned to x 0 / 1) ----
function linearShape() {
    return [{ x: 0, y: 0, curve: 0, sCurve: 0 }, { x: 1, y: 1, curve: 0, sCurve: 0 }];
}
function sanitizeShape(pts) {
    return Array.isArray(pts) && pts.length >= 2 ? sanitizeMsegPoints(pts) : linearShape();
}
// The shape equivalent of a legacy (schema 1) curve: type CURVE_*, amount 0..1, steps 2..16. Exp / Log / S with a
// power up to 2^3.6 are ONE segment (exact: same power law as evalSegmentT); stronger ones are 32 segments with a per-segment
// bend fitted at the segment midpoint; Stepped is hard steps (2 points per step, 0.0001 apart at the edges).
function curveToShape(type, amt, steps) {
    const t = clamp(Math.round(num(type, 0)), 0, 4);
    const a = clamp(num(amt, 0.5), 0, 1);
    const pt = (x, y, curve, sCurve) => ({ x, y, curve: curve || 0, sCurve: sCurve ? 1 : 0 });
    if (t === CURVE_STEPPED) {
        const n = clamp(Math.round(num(steps, 4)), 2, 16);
        const out = [];
        for (let k = 0; k < n; k++) {
            const lv = Math.min(1, k / (n - 1));
            out.push(pt(k === 0 ? 0 : k / n, lv));
            out.push(pt(k === n - 1 ? 1 : (k + 1) / n - 0.0001, lv));
        }
        return out;
    }
    if (t === CURVE_LINEAR) return linearShape();
    const cmag = (4 * a) / 3.6; // power 2^(4a) = 4^(2a)  ==  2^(3.6 * cmag)
    if (cmag <= 1) {
        if (cmag < 0.001) return linearShape();
        if (t === CURVE_EXP) return [pt(0, 0, -cmag), pt(1, 1)];
        if (t === CURVE_LOG) return [pt(0, 0, cmag), pt(1, 1)];
        return [pt(0, 0, -cmag, 1), pt(1, 1)];
    }
    const N = 32;
    const f = (x) => shapeCurve(x, t, a, 4);
    const out = [];
    for (let i = 0; i < N; i++) {
        const x0 = i / N;
        const y0 = f(x0);
        const y1 = f((i + 1) / N);
        let c = 0;
        if (y1 - y0 > 1e-6) {
            const tm = clamp((f((x0 + 0.5 / N)) - y0) / (y1 - y0), 1e-4, 1 - 1e-4);
            if (tm < 0.5) c = -clamp(Math.log2(Math.log(tm) / Math.log(0.5)) / 3.6, 0, 1);
            else c = clamp(Math.log2(Math.log(1 - tm) / Math.log(0.5)) / 3.6, 0, 1);
            if (Math.abs(tm - 0.5) < 0.01) c = 0;
        }
        out.push(pt(x0, y0, c));
    }
    out.push(pt(1, 1));
    return out;
}
// A mapping's shape: its own points, else (schema 1 / hand-written) the legacy curve fields, else linear.
function mappingShape(m) {
    if (m && Array.isArray(m.shape) && m.shape.length >= 2) return sanitizeMsegPoints(m.shape);
    if (m && (m.curve !== undefined || m.curveAmt !== undefined || m.curveSteps !== undefined)) {
        return sanitizeShape(curveToShape(m.curve, m.curveAmt, m.curveSteps));
    }
    return linearShape();
}

function defaultMapping(id, mod, target) {
    return {
        id, mod, enabled: 1, mode: "mod", polarity: 0, range: 0.5, min: 0, max: 1,
        shape: linearShape(), target: sanitizeTarget(target),
    };
}

// Schema < 4 mapping -> schema 4 fields (see MIGRATION in the API contract). `schema` = the state's schema (undefined = unknown, treat
// like < 3 for Mod mappings only when a min/max would otherwise be applied: raw objects with min/max keep them).
function migrateLegacyMapping(m, schema) {
    const remote = m && m.mode === "remote";
    const shape = mappingShape(m);
    const oldRange = remote || schema === 3 || schema === undefined;
    const lo = oldRange ? clamp(num(m && m.min, 0), 0, 1) : 0;
    const hi = oldRange ? clamp(num(m && m.max, 1), 0, 1) : 1;
    const inv = m && m.invert;
    const pts = shape.map((p) => {
        const y = inv ? 1 - p.y : p.y;
        return { x: p.x, y: lo + (hi - lo) * y, curve: p.curve, sCurve: p.sCurve };
    });
    const out = Object.assign({}, m, { shape: pts, range: 1 });
    if (remote) { out.polarity = 1; out.amount = 1; }
    else out.polarity = m && (m.bipolar === 0 || m.bipolar === false) ? 1 : 0;
    return out;
}

// Schema 4 remote (polarity / range / amount) -> schema 5 absolute min / max (exact; clamped to 0..1).
function remoteLimitsFromV4(polarity, range, amount) {
    const ar = amount * range;
    let lo, hi;
    if (polarity === 0) { lo = 0.5 - ar / 2; hi = 0.5 + ar / 2; }
    else if (polarity < 0) { lo = 1; hi = 1 - ar; }
    else { lo = 0; hi = ar; }
    return { min: clamp(lo, 0, 1), max: clamp(hi, 0, 1) };
}

function sanitizeMapping(m, schema) {
    let derive = false; // remote mapping whose min / max must be derived from polarity / range / amount
    let legacy = false;
    if (m && m.polarity === undefined && (schema === undefined || schema < 4)) {
        m = migrateLegacyMapping(m, schema);
        legacy = true;
        derive = m.mode === "remote"; // legacy remote: polarity 1, range 1, amount 1 -> min 0, max 1 (the old limits are in the shape)
        m = Object.assign({}, m, { min: undefined, max: undefined });
    } else if (m && schema === 4) {
        derive = m.mode === "remote";
    }
    const d = defaultMapping(Math.max(1, Math.round(num(m && m.id, 1))), clamp(Math.round(num(m && m.mod, 0)), 0, MAX_MODS - 1), m && m.target);
    d.enabled = m && (m.enabled === 0 || m.enabled === false) ? 0 : 1;
    d.mode = m && m.mode === "remote" ? "remote" : "mod";
    d.polarity = clamp(Math.round(num(m && m.polarity, 0)), -1, 1);
    d.range = clamp(num(m && m.range, 0.5), 0, 1);
    d.shape = mappingShape(m);
    // schema < 6 carried a separate amount (-1..1, default 0.5): fold it into range (see MIGRATION)
    const fold = legacy || (schema !== undefined && schema < 6);
    const amount = fold ? clamp(num(m && m.amount, 0.5), -1, 1) : 1;
    if (derive) {
        const lim = remoteLimitsFromV4(d.polarity, d.range, amount);
        d.min = lim.min; d.max = lim.max;
    } else {
        d.min = clamp(num(m && m.min, 0), 0, 1);
        d.max = clamp(num(m && m.max, 1), 0, 1);
    }
    if (fold) {
        d.range = clamp(Math.abs(amount) * d.range, 0, 1);
        if (amount < 0) {
            if (d.polarity !== 0) d.polarity = -d.polarity;
            else d.shape = d.shape.map((p) => ({ x: p.x, y: 1 - p.y, curve: p.curve, sCurve: p.sCurve }));
        }
    }
    return d;
}

function sanitizeMod(m, slot) {
    if (!m || typeof m !== "object") return null;
    const type = clamp(Math.round(num(m.type, 0)), 1, 5);
    const base = makeModSlot(type, slot);
    base.name = typeof m.name === "string" && m.name ? m.name.slice(0, 32) : base.name;
    base.color = clamp(Math.round(num(m.color, base.color)), 0, MOD_COLORS.length - 1);
    base.enabled = m.enabled === 0 ? 0 : 1;
    const src = m.p || {};
    for (const k of Object.keys(base.p)) base.p[k] = clampParam(k, num(src[k], base.p[k]));
    if (base.p.loopEnd < base.p.loopStart + 0.05) base.p.loopEnd = Math.min(1, base.p.loopStart + 0.05);
    base.points = sanitizeMsegPoints(m.points);
    if (Array.isArray(m.stepVals)) {
        for (let i = 0; i < STEPS_MAX; i++) base.stepVals[i] = clamp(num(m.stepVals[i], base.stepVals[i]), 0, 1);
    }
    return base;
}

// Accepts a parsed JSON object of any known schema and returns a clean state.
function normalizeState(obj) {
    const s = defaultState();
    if (!obj || typeof obj !== "object") return s;
    if (Array.isArray(obj.mods)) {
        for (let i = 0; i < MAX_MODS; i++) s.mods[i] = sanitizeMod(obj.mods[i], i);
    }
    const seen = {};
    let maxId = 0;
    if (Array.isArray(obj.mappings)) {
        const schema = Math.round(num(obj.schema, 1));
        for (const raw of obj.mappings) {
            const m = sanitizeMapping(raw, schema);
            if (!s.mods[m.mod] || seen[m.id]) continue;
            seen[m.id] = 1;
            maxId = Math.max(maxId, m.id);
            s.mappings.push(m);
        }
    }
    s.nextMapId = Math.max(maxId + 1, Math.round(num(obj.nextMapId, 1)));
    s.ui = obj.ui && typeof obj.ui === "object" && !Array.isArray(obj.ui) ? JSON.parse(JSON.stringify(obj.ui)) : {};
    return s;
}

function r4(v) {
    return typeof v === "number" ? Math.round(v * 10000) / 10000 : v;
}

function stateToJson(state) {
    return JSON.stringify(state, function (k, v) {
        return typeof v === "number" ? r4(v) : v;
    }, 0);
}

// ---- wire format: Max list for the blob param ----
// v2: [2, nChunks, chunk...]  chunk = <=BLOB_CHUNK chars of base64(utf8(json))   (safe symbols only)
// v1: [1, nChunks, chunk...]  chunk = raw JSON pieces with spaces escaped as "~" (first release draft)
const BLOB_CHUNK = 1000;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Encode(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
            c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
}
function utf8Decode(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        let c;
        if (b < 0x80) c = b;
        else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[++i] & 63);
        else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63);
        else c = ((b & 7) << 18) | ((bytes[++i] & 63) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63);
        if (c >= 0x10000) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
        else s += String.fromCharCode(c);
    }
    return s;
}
function base64Encode(str) {
    const b = utf8Encode(str);
    let out = "";
    for (let i = 0; i < b.length; i += 3) {
        const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < b.length ? B64[n & 63] : "=");
    }
    return out;
}
function base64Decode(s) {
    const bytes = [];
    const clean = String(s).replace(/[^A-Za-z0-9+/]/g, "");
    for (let i = 0; i < clean.length; i += 4) {
        const a = B64.indexOf(clean[i]);
        const b = B64.indexOf(clean[i + 1]);
        const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
        const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
        bytes.push(((a << 2) | (b >> 4)) & 255);
        if (c >= 0) bytes.push((((b & 15) << 4) | (c >> 2)) & 255);
        if (d >= 0) bytes.push((((c & 3) << 6) | d) & 255);
    }
    return utf8Decode(bytes);
}

function serializeState(state, version) {
    const json = stateToJson(state);
    const ver = version || 2;
    const text = ver === 1 ? json.replace(/ /g, "~") : base64Encode(json);
    const chunks = [];
    for (let i = 0; i < text.length; i += BLOB_CHUNK) chunks.push(text.slice(i, i + BLOB_CHUNK));
    return [ver, chunks.length].concat(chunks);
}

// Returns a normalized state, or null when the list is not recognised (caller keeps its current state).
function deserializeState(list) {
    const a = Array.isArray(list) ? list : [];
    if (a.length < 2) return null;
    const ver = Math.round(num(a[0], 0));
    if (ver !== 1 && ver !== 2) return null;
    const n = Math.round(num(a[1], 0));
    let text = "";
    for (let i = 0; i < n && 2 + i < a.length; i++) text += String(a[2 + i]);
    try {
        const json = ver === 1 ? text.replace(/~/g, " ") : base64Decode(text);
        return normalizeState(JSON.parse(json));
    } catch (e) {
        return null;
    }
}

// ------------------------------------------------------------------------------------
// cfg / mseg / steps buffer writers (contract with the genexpr)
// ------------------------------------------------------------------------------------
function slotConfigFloats(mod) {
    const f = new Array(CFG_STRIDE).fill(0);
    if (!mod) return f;
    const p = mod.p;
    f[CF_TYPE] = mod.type;
    f[CF_ENABLED] = mod.enabled ? 1 : 0;
    f[CF_RATE] = p.rate;
    f[CF_SYNC] = p.sync;
    f[CF_SYNCDIV] = p.syncDiv;
    f[CF_SHAPE] = p.shape;
    f[CF_PHASE] = p.phase;
    f[CF_RETRIG] = p.retrig;
    f[CF_BIPOLAR] = p.bipolar;
    f[CF_DEPTH] = p.depth;
    f[CF_ATTACK] = p.attack;
    f[CF_RELEASE] = p.release;
    f[CF_GAIN] = p.gain;
    f[CF_SMOOTH] = p.smooth;
    f[CF_STEPS] = p.steps;
    f[CF_GLIDE] = p.glide;
    f[CF_ONESHOT] = p.oneshot;
    f[CF_SEED] = p.seed;
    f[CF_LOOPON] = p.loopOn;
    f[CF_LOOPSTART] = p.loopStart;
    f[CF_LOOPEND] = p.loopEnd;
    return f;
}

function cfgBufferFloats(state) {
    let out = [];
    for (let i = 0; i < MAX_MODS; i++) out = out.concat(slotConfigFloats(state.mods[i]));
    return out;
}

// ------------------------------------------------------------------------------------
// Modulator reference implementations (mirror src/megamod_engine.genexpr)
// ------------------------------------------------------------------------------------
function lfoShape(shape, ph) {
    switch (shape) {
        case 1: return ph < 0.25 ? 0.5 + 2 * ph : ph < 0.75 ? 1.5 - 2 * ph : 2 * ph - 1.5;
        case 2: return ph;
        case 3: return 1 - ph;
        case 4: return ph < 0.5 ? 1 : 0;
        default: return 0.5 + 0.5 * Math.sin(2 * Math.PI * ph);
    }
}

function randHash01(seed, idx) {
    return frac(Math.sin(idx * 12.9898 + seed * 78.233 + 1.2345) * 43758.5453);
}

function glideValue(prev, cur, fr, g) {
    if (g <= 0.0001) return cur;
    return prev + (cur - prev) * smoothstep01(fr / g);
}

// u (0..1) -> engine output convention (-1..1)
function outputFromU(u, bipolar, depth) {
    return bipolar ? depth * (2 * u - 1) : 2 * depth * u - 1;
}

// Cycle accumulator: cycles (steps for Steps) since retrigger. Free: t seconds; sync: beats since t0.
function cycleAccumulator(p, seconds, beatsSinceRetrig) {
    if (p.sync) return beatsSinceRetrig / Math.max(SYNC_BEATS[clamp(Math.round(p.syncDiv), 0, 15)], 1e-9);
    return seconds * p.rate;
}

// Evaluate a (non-envelope) modulator at accumulator `acc`. Returns {u, out, phase, aux}.
function evalModulator(mod, acc) {
    const p = mod.p;
    let u = 0;
    let phase = 0;
    let aux = 0;
    if (mod.type === MOD_LFO) {
        phase = frac(acc + p.phase);
        if (p.oneshot && acc >= 1) phase = 1 - 1e-9;
        u = lfoShape(Math.round(p.shape), phase);
    } else if (mod.type === MOD_RANDOM) {
        const x = acc + p.phase;
        const idx = Math.floor(x);
        const fr = x - idx;
        u = glideValue(randHash01(p.seed, idx - 1), randHash01(p.seed, idx), fr, p.smooth);
        phase = fr;
        aux = idx;
    } else if (mod.type === MOD_STEPS) {
        const n = clamp(Math.round(p.steps), 1, STEPS_MAX);
        let x = acc + p.phase * n;
        if (p.oneshot) x = Math.min(x, n - 1e-9);
        const k = Math.floor(x);
        const fr = x - k;
        const idx = ((k % n) + n) % n;
        const prevIdx = (idx - 1 + n) % n;
        const sv = mod.stepVals;
        u = glideValue(sv[prevIdx], sv[idx], fr, p.glide);
        phase = (idx + fr) / n;
        aux = idx;
    } else if (mod.type === MOD_MSEG) {
        let ph = p.oneshot ? clamp(acc, 0, 1) : frac(acc + p.phase);
        if (p.oneshot && acc >= 1) ph = 1;
        phase = ph;
        const ls = p.loopOn ? p.loopStart : 0;
        const le = p.loopOn ? Math.max(p.loopEnd, ls + 0.05) : 1;
        const x = ls + ph * (le - ls);
        const tbl = msegTable(mod.points);
        const fi = clamp(x, 0, 1) * (MSEG_TABLE - 1);
        const i0 = Math.floor(fi);
        const i1 = Math.min(MSEG_TABLE - 1, i0 + 1);
        u = tbl[i0] + (tbl[i1] - tbl[i0]) * (fi - i0);
    }
    return { u, out: outputFromU(u, p.bipolar, p.depth), phase, aux };
}

// Envelope follower reference over a mono array: returns {u[], out[]}.
function envelopeFollow(samples, sr, p) {
    const aC = Math.exp(-1000 / (Math.max(p.attack, 0.05) * sr));
    const rC = Math.exp(-1000 / (Math.max(p.release, 0.5) * sr));
    const g = Math.pow(10, p.gain / 20);
    let env = 0;
    const u = [];
    const out = [];
    for (let i = 0; i < samples.length; i++) {
        const x = Math.abs(samples[i]) * g;
        env = x > env ? x + (env - x) * aC : x + (env - x) * rC;
        const uu = clamp(env, 0, 1);
        u.push(uu);
        out.push(outputFromU(uu, p.bipolar, p.depth));
    }
    return { u, out };
}

// ------------------------------------------------------------------------------------
// Mapping transfer tables
// ------------------------------------------------------------------------------------
// LEGACY (schema 1) curve formula. Kept as the reference for the migration (curveToShape) and its tests only.
function shapeCurve(u, type, amt, steps) {
    const x = clamp(u, 0, 1);
    const p = Math.pow(4, clamp(amt, 0, 1) * 2); // 1 .. 16
    switch (type) {
        case CURVE_EXP: return Math.pow(x, p);
        case CURVE_LOG: return 1 - Math.pow(1 - x, p);
        case CURVE_S:
            return x < 0.5 ? 0.5 * Math.pow(2 * x, p) : 1 - 0.5 * Math.pow(2 * (1 - x), p);
        case CURVE_STEPPED: {
            const n = clamp(Math.round(steps), 2, 16);
            return Math.min(1, Math.floor(x * n) / (n - 1));
        }
        default: return x;
    }
}

// Mapping output for engine value x in -1..1 (Mod: signed offset o = range * (...); Remote: absolute 0..1 from min / max).
// Raw objects without `polarity` (hand-written / pre-schema-4) use the legacy invert / bipolar / min / max formula.
function mappingOutput(m, x) {
    const u = clamp((x + 1) / 2, 0, 1);
    let c = evalMseg(m.shape && m.shape.length >= 2 ? m.shape : mappingShape(m), u);
    if (m.polarity === undefined) {
        if (m.invert) c = 1 - c;
        c = num(m.min, 0) + (num(m.max, 1) - num(m.min, 0)) * c;
        if (m.mode === "remote") return clamp(c, 0, 1);
        return m.amount * (m.bipolar ? 2 * c - 1 : c);
    }
    if (m.mode === "remote") {
        const lo = clamp(num(m.min, 0), 0, 1);
        const hi = clamp(num(m.max, 1), 0, 1);
        return clamp(lo + (hi - lo) * c, 0, 1);
    }
    const pol = m.polarity === 0 ? 0 : m.polarity < 0 ? -1 : 1;
    return num(m.range, 0.5) * (pol === 0 ? 2 * c - 1 : pol * c);
}

function mappingTable(m) {
    const t = new Array(CURVE_REGION);
    // lookup~ maps input -1..1 onto index (x+1)/2 * REGION (verified in real Max), clamped to the last sample:
    // sample j holds u = j / REGION, and the last sample holds u = 1 so both endpoints are exact.
    for (let j = 0; j < CURVE_REGION; j++) {
        const u = j === CURVE_REGION - 1 ? 1 : j / CURVE_REGION;
        t[j] = mappingOutput(m, -1 + 2 * u);
    }
    return t;
}

// ------------------------------------------------------------------------------------
// Learn / target helpers
// ------------------------------------------------------------------------------------
function targetKey(t) {
    return t && t.path ? String(t.path) : "id:" + (t && t.id);
}
function isSelfTarget(path, ownDevicePath) {
    if (!path || !ownDevicePath) return false;
    const p = String(path).replace(/"/g, "");
    const own = String(ownDevicePath).replace(/"/g, "");
    return p === own || p.indexOf(own + " ") === 0;
}
function findDuplicateMapping(mappings, modIndex, target) {
    const k = targetKey(target);
    for (const m of mappings) if (m.mod === modIndex && targetKey(m.target) === k) return m;
    return null;
}
// lom = {exists(path)->bool, name(path)->string, count(path, child)->int}
function pathParts(path) {
    const m = /^(live_set (?:tracks \d+|return_tracks \d+|master_track))(?: devices (\d+))?(?: parameters (\d+))?/.exec(String(path || ""));
    return m ? { track: m[1], device: m[2] === undefined ? -1 : Number(m[2]), param: m[3] === undefined ? -1 : Number(m[3]) } : null;
}
function resolveTarget(t, lom) {
    if (t.path && lom.exists(t.path)) {
        const nm = lom.name(t.path);
        const pp0 = pathParts(t.path);
        const trackOk = !t.trackName || !pp0 || lom.name(pp0.track) === t.trackName;
        const devOk = !t.deviceName || !pp0 || pp0.device < 0 || lom.name(pp0.track + " devices " + pp0.device) === t.deviceName;
        if ((!t.paramName || nm === t.paramName) && trackOk && devOk) return { ok: true, path: t.path, how: "path" };
    }
    const tracks = [];
    const nT = lom.count("live_set", "tracks");
    for (let i = 0; i < nT; i++) tracks.push("live_set tracks " + i);
    const nR = lom.count("live_set", "return_tracks");
    for (let i = 0; i < nR; i++) tracks.push("live_set return_tracks " + i);
    tracks.push("live_set master_track");
    const pp = pathParts(t.path);
    tracks.sort((a, b) => (pp && a === pp.track ? -1 : pp && b === pp.track ? 1 : 0));
    for (const tp of tracks) {
        if (t.trackName && lom.name(tp) !== t.trackName) continue;
        const nD = lom.count(tp, "devices");
        for (let d = 0; d < nD; d++) {
            const dp = tp + " devices " + d;
            if (t.deviceName && lom.name(dp) !== t.deviceName) continue;
            const nP = lom.count(dp, "parameters");
            for (let q = 0; q < nP; q++) {
                const qp = dp + " parameters " + q;
                if (lom.name(qp) === t.paramName) return { ok: true, path: qp, how: "name" };
            }
        }
    }
    return { ok: false, path: t.path, how: "missing" };
}

// ------------------------------------------------------------------------------------
// Layout helpers for UIs
// ------------------------------------------------------------------------------------
function clampWidth(w) {
    return Math.round(clamp(num(w, 300), MIN_WIDTH, MAX_WIDTH));
}
// Evenly divides w x h into `n` cells of at least minW x minH; returns [{x,y,w,h}] row-major.
function gridLayout(n, w, h, minW, minH, gap) {
    const g = gap === undefined ? 2 : gap;
    const cols = Math.max(1, Math.min(n, Math.floor((w + g) / (minW + g))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cw = (w - g * (cols - 1)) / cols;
    const ch = Math.min(Math.max(minH, (h - g * (rows - 1)) / rows), h);
    const cells = [];
    for (let i = 0; i < n; i++) {
        cells.push({ x: (i % cols) * (cw + g), y: Math.floor(i / cols) * (ch + g), w: cw, h: ch });
    }
    return cells;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        MEGAMOD_VERSION, MAX_MODS, CFG_STRIDE, CF_TYPE, CF_ENABLED, CF_RATE, CF_SYNC, CF_SYNCDIV, CF_SHAPE, CF_PHASE,
        CF_RETRIG, CF_BIPOLAR, CF_DEPTH, CF_ATTACK, CF_RELEASE, CF_GAIN, CF_SMOOTH, CF_STEPS, CF_GLIDE, CF_ONESHOT,
        CF_SEED, CF_LOOPON, CF_LOOPSTART, CF_LOOPEND, CFG_FLOATS, MSEG_TABLE, MSEG_FLOATS, STEPS_MAX, STEPS_FLOATS,
        SCOPE_STRIDE, SCOPE_HEADER, SCOPE_FRAME, SCOPE_SR, SCOPE_BEAT, SCOPE_BPM, SCOPE_PLAYING, SCOPE_SAMPS,
        MAX_MAPPINGS, CURVE_REGION, CURVE_SAMPS, ROUTE_SAMPS, ROUTE_OFF, ROUTERS, ROUTER_SLOTS, BUF_CFG, BUF_MSEG, BUF_STEPS, BUF_SCOPE, BUF_CURVE, BUF_ROUTE,
        MOD_NONE, MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG, MOD_TYPE_NAMES, MOD_TYPE_SHORT, LFO_SHAPES,
        CURVE_LINEAR, CURVE_EXP, CURVE_LOG, CURVE_S, CURVE_STEPPED, CURVE_NAMES, SYNC_BEATS, SYNC_LABELS, MOD_COLORS,
        MOD_PARAM_KEYS, MOD_PARAM_RANGE, MIN_WIDTH, MAX_WIDTH, BLOB_CHUNK,
        clamp, num, frac, smoothstep01, evalSegmentT, evalMseg, defaultMsegPoints, sanitizeMsegPoints, msegTable,
        linearShape, sanitizeShape, curveToShape, mappingShape,
        defaultParams, defaultStepVals, makeModSlot, clampParam, defaultState, sanitizeTarget, defaultMapping,
        sanitizeMapping, migrateLegacyMapping, remoteLimitsFromV4, sanitizeMod, normalizeState, stateToJson, base64Encode, base64Decode, serializeState,
        deserializeState, slotConfigFloats, cfgBufferFloats, lfoShape, randHash01, glideValue, outputFromU,
        cycleAccumulator, evalModulator, envelopeFollow, shapeCurve, mappingOutput, mappingTable, targetKey,
        isSelfTarget, findDuplicateMapping, pathParts, resolveTarget, clampWidth, gridLayout,
    };
}
