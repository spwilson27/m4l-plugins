// Scatter face (v8ui). scripts/build_scatter.py concatenates src/scatter_config.js in front of
// this file, so SCATTER_MACRO_KEYS / SCATTER_MACRO_DEFS / SCATTER_GLOBALS / SCATTER_LATENCY are
// already defined. The build also replaces __SCATTER_CORE_TEXT__ with the JSON-encoded text of
// src/scatter_core.genexpr (or the marked placeholder passthrough core when the core is absent)
// and __SCATTER_CORE_HASH__ with its short hash.
//
// The v8ui owns ONLY the centre scope canvas. Every live.* control (header Sens / Rand / Mix /
// Split Mode, the two columns of macro wings, footer Seed / Lock / Reroll) is a real patcher
// widget placed by build_scatter.py outside this canvas; the patcher forwards each parameter
// value in as set_<name>(v) and this script forwards already-scaled gen messages out outlet 0
// to the gen hub, exactly like the Fill face.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var SCATTER_W = 608;
var SCATTER_H = 169;
var SCATTER_SCOPE = [168, 26, 272, 118]; // x, y, w, h of this v8ui canvas inside the device
var SCATTER_LATENCY_LABEL = "5120";

// gen key + scale for every parameter the patcher can send in. Macros and globals are /100
// (percent), seed / splitmode / lock / reroll stay native. The Master Rand parameter arrives
// as set_rand and leaves as the gen message "master".
var SCATTER_OUT = {
    sens: ["sens", 0.01],
    rand: ["master", 0.01],
    mix: ["mix", 0.01],
    splitmode: ["splitmode", 1],
    seed: ["seed", 1],
    lock: ["lock", 1],
    reroll: ["reroll", 1],
    snap: ["snap", 0.01], snapr: ["snapr", 0.01],
    body: ["body", 0.01], bodyr: ["bodyr", 0.01],
    metal: ["metal", 0.01], metalr: ["metalr", 0.01],
    motion: ["motion", 0.01], motionr: ["motionr", 0.01],
    space: ["space", 0.01], spacer: ["spacer", 0.01],
    grit: ["grit", 0.01], gritr: ["gritr", 0.01],
    warp: ["warp", 0.01], warpr: ["warpr", 0.01],
    ring: ["ring", 0.01], ringr: ["ringr", 0.01]
};
var SCATTER_PARAM_ORDER = ["sens", "seed", "rand", "mix", "splitmode", "lock",
    "snap", "snapr", "body", "bodyr", "metal", "metalr", "motion", "motionr",
    "space", "spacer", "grit", "gritr", "warp", "warpr", "ring", "ringr"];
var scatterValues = {
    sens: 45, rand: 50, mix: 100, splitmode: 0, seed: 0, lock: 0, reroll: 0,
    snap: 50, snapr: 25, body: 50, bodyr: 25, metal: 30, metalr: 25,
    motion: 35, motionr: 25, space: 30, spacer: 20, grit: 20, gritr: 15,
    warp: 25, warpr: 20, ring: 40, ringr: 20
};

function scatterOnParam(key, v) {
    var spec = SCATTER_OUT[key];
    if (!spec) return;
    var x = Number(v) || 0;
    scatterValues[key] = x;
    outlet(0, spec[0], x * spec[1]);
    if (key === "reroll" && x > 0) mgraphics.redraw();
}

function set_sens(v) { scatterOnParam("sens", v); }
function set_rand(v) { scatterOnParam("rand", v); }
function set_mix(v) { scatterOnParam("mix", v); }
function set_splitmode(v) { scatterOnParam("splitmode", v); }
function set_seed(v) { scatterOnParam("seed", v); }
function set_lock(v) { scatterOnParam("lock", v); }
function set_reroll(v) { scatterOnParam("reroll", v); }
function set_snap(v) { scatterOnParam("snap", v); }
function set_snapr(v) { scatterOnParam("snapr", v); }
function set_body(v) { scatterOnParam("body", v); }
function set_bodyr(v) { scatterOnParam("bodyr", v); }
function set_metal(v) { scatterOnParam("metal", v); }
function set_metalr(v) { scatterOnParam("metalr", v); }
function set_motion(v) { scatterOnParam("motion", v); }
function set_motionr(v) { scatterOnParam("motionr", v); }
function set_space(v) { scatterOnParam("space", v); }
function set_spacer(v) { scatterOnParam("spacer", v); }
function set_grit(v) { scatterOnParam("grit", v); }
function set_gritr(v) { scatterOnParam("gritr", v); }
function set_warp(v) { scatterOnParam("warp", v); }
function set_warpr(v) { scatterOnParam("warpr", v); }
function set_ring(v) { scatterOnParam("ring", v); }
function set_ringr(v) { scatterOnParam("ringr", v); }

function scatterResendAll() {
    for (var i = 0; i < SCATTER_PARAM_ORDER.length; i++) {
        var k = SCATTER_PARAM_ORDER[i];
        if (k === "reroll") continue;
        var spec = SCATTER_OUT[k];
        outlet(0, spec[0], (Number(scatterValues[k]) || 0) * spec[1]);
    }
}

// ---------- deferred DSP (AGENTS 1d, Fill pattern) ----------
// The device ships without gen~. loadbang writes the embedded core to
// /tmp/scatter_core_<hash>.gendsp and creates gen~ on the scatter_genin hub; parameters are
// resent until the gen~ reports alive (the hub echoes "alive" back into inlet 0 as dspalive).
// @ts-ignore: build-time placeholder, replaced by scripts/build_scatter.py
var SCATTER_CORE_TEXT = __SCATTER_CORE_TEXT__;
var SCATTER_CORE_HASH = "__SCATTER_CORE_HASH__";
var scatterDsp = { ready: 0, error: "", tries: 0 };
var scatterPollTask = null;
var scatterResendTask = null;

function scatterGendspJson() {
    var codebox = {
        box: {
            id: "obj-gen", maxclass: "codebox", numinlets: 2, numoutlets: 2,
            patching_rect: [50.0, 50.0, 800.0, 600.0], code: SCATTER_CORE_TEXT
        }
    };
    var in1 = { box: { id: "obj-in1", maxclass: "inlet", numinlets: 0, numoutlets: 1, patching_rect: [50.0, 20.0, 30.0, 30.0], index: 1 } };
    var in2 = { box: { id: "obj-in2", maxclass: "inlet", numinlets: 0, numoutlets: 1, patching_rect: [120.0, 20.0, 30.0, 30.0], index: 2 } };
    var out1 = { box: { id: "obj-out1", maxclass: "outlet", numinlets: 1, numoutlets: 0, patching_rect: [50.0, 700.0, 30.0, 30.0], index: 1 } };
    var out2 = { box: { id: "obj-out2", maxclass: "outlet", numinlets: 1, numoutlets: 0, patching_rect: [120.0, 700.0, 30.0, 30.0], index: 2 } };
    var lines = [
        { patchline: { source: ["obj-in1", 0], destination: ["obj-gen", 0] } },
        { patchline: { source: ["obj-in2", 0], destination: ["obj-gen", 1] } },
        { patchline: { source: ["obj-gen", 0], destination: ["obj-out1", 0] } },
        { patchline: { source: ["obj-gen", 1], destination: ["obj-out2", 0] } }
    ];
    return JSON.stringify({ patcher: { fileversion: 1, appversion: { major: 9 }, rect: [0, 0, 900, 760], boxes: [in1, in2, codebox, out1, out2], lines: lines } });
}

function scatterWriteGendsp() {
    var path = "/tmp/scatter_core_" + SCATTER_CORE_HASH + ".gendsp";
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) { scatterDsp.error = "gendsp write failed"; return path; }
    f.writestring(scatterGendspJson());
    f.close();
    return path;
}

function scatterCreateGen() {
    var hub = this.patcher.getnamed("scatter_genin");
    if (!hub) { scatterDsp.error = "hub missing"; return; }
    var path = scatterWriteGendsp();
    if (scatterDsp.error) return;
    var gen = this.patcher.newobject("newobj", hub.rect[0], hub.rect[1] + 60, 220, 20, "@text", "gen~ " + path);
    if (!gen) { scatterDsp.error = "DSP failed"; return; }
    gen.varname = "scatter_gen";
    this.patcher.connect(hub, 0, gen, 0);
    this.patcher.connect(hub, 1, gen, 1);
    var outHub = this.patcher.getnamed("scatter_genout");
    if (outHub) {
        this.patcher.connect(gen, 0, outHub, 0);
        this.patcher.connect(gen, 1, outHub, 1);
    }
    scatterResendAll();
}

function dspalive(v) {
    if (Number(v) > 0) {
        scatterDsp.ready = 1;
        scatterDsp.error = "";
        scatterResendAll();
        mgraphics.redraw();
    }
}

function scatterResendTick() {
    if (scatterDsp.ready) return;
    scatterDsp.tries += 1;
    if (scatterDsp.tries > 40) {
        scatterDsp.error = "DSP failed";
        if (scatterResendTask) scatterResendTask.cancel();
        mgraphics.redraw();
        return;
    }
    scatterResendAll();
}

// ---------- telemetry + paint ----------
// buffer~ #0-scatterscope slots: 0 in peak, 1 out peak, 2 transient env, 3 hit count,
// 4 tail env, 5 frame counter, 6..21 sixteen display energies.
var scatterTele = { slots: [], energy: [], frame: -1 };
var scatterScopeBuf = null;

function scatterPoll() {
    if (!scatterScopeBuf) {
        try { scatterScopeBuf = new Buffer("#0-scatterscope"); } catch (e) { scatterScopeBuf = null; }
    }
    if (!scatterScopeBuf) return;
    var frame = 0;
    try { frame = Number(scatterScopeBuf.peek(0, 5)) || 0; } catch (e) { return; }
    var idle = frame === scatterTele.frame;
    var slots = [];
    for (var i = 0; i < 6; i++) slots.push(Number(scatterScopeBuf.peek(0, i)) || 0);
    var energy = [];
    for (var j = 0; j < 16; j++) energy.push(Math.max(0, Math.min(1, Number(scatterScopeBuf.peek(0, 6 + j)) || 0)));
    scatterTele.slots = slots;
    scatterTele.energy = energy;
    scatterTele.frame = frame;
    if (!idle || slots[0] > 0.001 || slots[1] > 0.001) mgraphics.redraw();
}

function scatterStartPoll() {
    if (scatterPollTask) scatterPollTask.cancel();
    scatterPollTask = new Task(scatterPoll, this);
    scatterPollTask.interval = 90;
    scatterPollTask.repeat();
}

function scColor(name, fallback) {
    var c = this.boxcolor || fallback;
    return fallback;
}

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    // LCD panel
    mgraphics.set_source_rgba(0.09, 0.09, 0.09, 1);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();
    // faint grid
    mgraphics.set_source_rgba(1, 1, 1, 0.07);
    mgraphics.set_line_width(1);
    for (var gx = 1; gx < 8; gx++) { mgraphics.move_to((w / 8) * gx, 0); mgraphics.line_to((w / 8) * gx, h); mgraphics.stroke(); }
    for (var gy = 1; gy < 4; gy++) { mgraphics.move_to(0, (h / 4) * gy); mgraphics.line_to(w, (h / 4) * gy); mgraphics.stroke(); }
    // sixteen energy bars
    var bw = w / 16;
    for (var i = 0; i < 16; i++) {
        var e = scatterTele.energy[i] || 0;
        var bh = e * (h - 34);
        mgraphics.set_source_rgba(1, 0.55, 0.1, 0.9);
        mgraphics.rectangle(i * bw + 2, h - 18 - bh, bw - 4, bh);
        mgraphics.fill();
    }
    // transient / tail envelope traces
    var tEnv = Math.max(0, Math.min(1, scatterTele.slots[2] || 0));
    var tailEnv = Math.max(0, Math.min(1, scatterTele.slots[4] || 0));
    mgraphics.set_source_rgba(0.4, 0.8, 1, 0.95);
    mgraphics.set_line_width(1.5);
    mgraphics.move_to(0, h - 18 - tEnv * (h - 34));
    mgraphics.line_to(w, h - 18 - tEnv * (h - 34));
    mgraphics.stroke();
    mgraphics.set_source_rgba(0.6, 1, 0.6, 0.8);
    mgraphics.move_to(0, h - 18 - tailEnv * (h - 34));
    mgraphics.line_to(w, h - 18 - tailEnv * (h - 34));
    mgraphics.stroke();
    // footer line inside scope: hit count + peaks
    mgraphics.set_source_rgba(0.85, 0.85, 0.85, 1);
    mgraphics.set_font_size(9.5);
    mgraphics.move_to(4, h - 5);
    var hits = Math.round(scatterTele.slots[3] || 0);
    mgraphics.show_text("hits " + hits + "   in " + (scatterTele.slots[0] || 0).toFixed(2) + "  out " + (scatterTele.slots[1] || 0).toFixed(2));
    // DSP pill
    if (!scatterDsp.ready) {
        var label = scatterDsp.error ? "DSP failed" : "DSP loading...";
        mgraphics.set_source_rgba(scatterDsp.error ? 0.7 : 0.45, scatterDsp.error ? 0.15 : 0.4, 0.1, 1);
        mgraphics.rectangle(w - 86, 4, 82, 13);
        mgraphics.fill();
        mgraphics.set_source_rgba(1, 1, 1, 1);
        mgraphics.move_to(w - 82, 14);
        mgraphics.show_text(label);
    }
}

function loadbang() {
    scatterCreateGen();
    scatterStartPoll();
    if (scatterResendTask) scatterResendTask.cancel();
    scatterResendTask = new Task(scatterResendTick, this);
    scatterResendTask.interval = 250;
    scatterResendTask.repeat();
    scatterResendAll();
    mgraphics.redraw();
}

function preview() {
    scatterTele.energy = [0.9, 0.7, 0.55, 0.8, 0.4, 0.3, 0.5, 0.65, 0.35, 0.25, 0.45, 0.3, 0.2, 0.28, 0.15, 0.1];
    scatterTele.slots = [0.8, 0.6, 0.7, 3, 0.5, 12];
    scatterDsp.ready = 1;
    mgraphics.redraw();
}
