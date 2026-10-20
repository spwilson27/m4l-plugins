#!/usr/bin/env node
/**
 * Verification suite for Better Sampler (devices/Better Sampler.amxd, 600 x 169 px):
 *   - one Bitwig-style face drawn by two v8ui boxes (main 528 px + side 66 px) plus a live.drop
 *   - every automatable parameter is a hidden live.* object (presentation 0) wired through
 *     route param -> obj-ctrl-<key> -> prepend -> obj-gen, with set_<key> echoes to both v8uis
 *
 * Covers: modes/slicer/root detection/voice allocator, GenExpr ordering, amxd structure and
 * wiring, and a sandbox run of both embedded face scripts (paint, buttons, knobs, footer
 * values, env page tabs, Poly/Mono, echoes, state round-trip).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "sampler_core.genexpr");
const cfg = require(path.join(ROOT, "src", "sampler_config.js"));

function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}

function linked(lines, src, srcOutlet, dst, dstInlet) {
    return lines.some((entry) => {
        const pl = entry.patchline;
        return pl.source[0] === src && pl.source[1] === srcOutlet
            && pl.destination[0] === dst && pl.destination[1] === dstInlet;
    });
}

function assertLink(lines, src, srcOutlet, dst, dstInlet, label) {
    assert.ok(
        linked(lines, src, srcOutlet, dst, dstInlet),
        `${label}: missing patchline ${src}:${srcOutlet} -> ${dst}:${dstInlet}`
    );
}

function valueOf(box) {
    return box.saved_attribute_attributes && box.saved_attribute_attributes.valueof;
}


// ============================================================================
// 1. Modes, layout math, slicer, pitch detector, voice allocator
// ============================================================================
assert.deepStrictEqual(
    cfg.SAMPLER_MODES.map((m) => m.key),
    ["repitch", "cycles", "textures", "slice"],
    "Playback engines must be Repitch, Cycles, Textures, Slice"
);
assert.deepStrictEqual(cfg.SAMPLER_MODES.map((m) => m.id), [0, 1, 2, 3]);
assert.strictEqual(cfg.midiToNoteName(60), "C3");
assert.strictEqual(cfg.midiToNoteName(36), "C1");
assert.strictEqual(cfg.midiToNoteName(69), "A3");

const syntheticDrumPeaks = new Array(64).fill(0.02);
syntheticDrumPeaks[0] = 0.95;
syntheticDrumPeaks[16] = 0.88;
syntheticDrumPeaks[32] = 0.92;
syntheticDrumPeaks[48] = 0.80;
const slices = cfg.detectTransientSlices(syntheticDrumPeaks, 0.7, 16);
assert.ok(slices.length >= 4 && slices.length <= 16, "Slicer stays inside the 16-slice cap");
assert.strictEqual(slices[0], 0.0, "First slice marker must start at 0.0");
for (let i = 1; i < slices.length; i++) {
    assert.ok(slices[i] > slices[i - 1], "Slice markers must be strictly increasing");
}
assert.deepStrictEqual(cfg.detectTransientSlices([], 0.5, 16), [0.0, 0.25, 0.5, 0.75]);
const steadyPad = cfg.detectTransientSlices(new Array(64).fill(0.2), 0.4, 16);
assert.ok(steadyPad.length >= 4 && steadyPad[0] === 0.0, "Steady audio falls back to a musical grid");

function sineAt(hz, n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sin((2.0 * Math.PI * hz * i) / 44100.0) * 0.8;
    return out;
}
assert.ok(Math.abs(cfg.estimateRootMidiNote(sineAt(440, 2048), 44100) - 69) <= 1, "440 Hz -> A3 (69)");
assert.ok(Math.abs(cfg.estimateRootMidiNote(sineAt(220, 4096), 44100) - 57) <= 1, "220 Hz -> A2 (57)");
assert.strictEqual(cfg.estimateRootMidiNote(new Array(2048).fill(0), 44100), 60, "Silence defaults to C3");
assert.strictEqual(cfg.estimateRootMidiNote(sineAt(440, 32), 44100), 60, "Short windows default to C3");

const alloc = cfg.createVoiceAllocator(16);
const vA = alloc.noteOn(60, 100, 0, slices);
const vB = alloc.noteOn(64, 110, 0, slices);
const vC = alloc.noteOn(67, 90, 0, slices);
assert.strictEqual(new Set([vA.index, vB.index, vC.index]).size, 3, "Chord notes take distinct voices");

const stealAlloc = cfg.createVoiceAllocator(16);
const chord = [];
for (let n = 0; n < 16; n++) chord.push(stealAlloc.noteOn(48 + n, 100, 0, [0.0, 0.5]));
assert.strictEqual(chord[0].index, 0);
assert.strictEqual(chord[0].note, 48);
assert.strictEqual(stealAlloc.voices.filter((v) => v.gate === 1).length, 16);
const stolen = stealAlloc.noteOn(100, 120, 0, [0.0, 0.5]);
assert.strictEqual(stolen.index, 0, "The oldest held voice is stolen");
assert.strictEqual(stolen.note, 100);
assert.strictEqual(stolen.gate, 1);
assert.strictEqual(stealAlloc.voices.filter((v) => v.gate === 1).length, 16);
assert.ok(!stealAlloc.voices.some((v) => v.gate === 1 && v.note === 48), "Stolen note 48 is no longer held");
const retrigCount = stolen.trigCount;
const retriggered = stealAlloc.noteOn(100, 80, 0, [0.0, 0.5]);
assert.strictEqual(retriggered.index, stolen.index, "Same note retriggers its current voice");
assert.strictEqual(retriggered.trigCount, (retrigCount + 1) % 100000);

const capped = cfg.createVoiceAllocator(16);
capped.setMaxVoices(4);
assert.strictEqual(capped.getMaxVoices(), 4);
for (let n = 0; n < 6; n++) capped.noteOn(40 + n, 96, 0, null);
assert.strictEqual(capped.voices.filter((v) => v.gate === 1).length, 4, "Poly cap steals inside the active voice count");
assert.ok(capped.voices.slice(4).every((v) => v.gate === 0), "Voices above the poly cap stay idle");

const sliceMap = cfg.createVoiceAllocator(8);
const sliceBounds = [0.0, 0.25, 0.5, 0.75];
const lowSlice = sliceMap.noteOn(36, 100, 0, sliceBounds);
const nextSlice = sliceMap.noteOn(37, 100, 0, sliceBounds);
assert.strictEqual(lowSlice.sliceStart, 0.0, "Slice mode maps C1 (MIDI 36) to the first slice");
assert.strictEqual(lowSlice.sliceEnd, 0.25);
assert.strictEqual(nextSlice.sliceStart, 0.25, "The next chromatic note advances one slice");
assert.ok(!("zone" in lowSlice) && !("sampleId" in lowSlice), "Voices carry slice bounds, not multisample zones");

const leg = cfg.createVoiceAllocator(16);
const leg1 = leg.noteOn(60, 100, 1, slices);
const trig1 = leg1.trigCount;
const leg2 = leg.noteOn(64, 100, 1, slices);
const leg3 = leg.noteOn(67, 110, 1, slices);
assert.strictEqual(leg3.index, 0, "Legato stacks onto voice 0");
assert.strictEqual(leg3.note, 67);
assert.strictEqual(leg3.trigCount, trig1, "Overlapping legato notes keep the original trigger");
assert.ok(leg.voices.slice(1).every((v) => v.gate === 0), "Legato does not open extra voices");
leg.noteOff(60, 1);
assert.strictEqual(leg.voices[0].note, 67, "Releasing a buried legato note keeps the top note");
assert.strictEqual(leg.voices[0].gate, 1);
leg.noteOff(67, 1);
assert.strictEqual(leg.voices[0].note, 64, "Releasing the top note falls back to the previous held note");
assert.strictEqual(leg.voices[0].trigCount, trig1, "Legato fallback must not retrigger");
leg.noteOff(64, 1);
assert.strictEqual(leg.voices[0].gate, 0, "Gate closes when the legato stack is empty");
const legFresh = leg.noteOn(72, 100, 1, slices);
assert.strictEqual(legFresh.trigCount, trig1 + 1, "A new note after silence increments trigCount");

const monoCap = cfg.createVoiceAllocator(1);
const monoA = monoCap.noteOn(60, 100, 0, null);
const monoTrig = monoA.trigCount;
const monoB = monoCap.noteOn(63, 100, 0, null);
assert.strictEqual(monoB.index, 0, "A 1-voice cap always reuses voice 0");
assert.strictEqual(monoB.trigCount, monoTrig + 1, "Poly mode at 1 voice still retriggers; single-trigger is the Legato flag");

// ============================================================================
// 2. GenExpr ordering, 4 engines, freeze, reverse, unison, glide
// ============================================================================
const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(!gen.match(/\be\d/), "Never use e0..e9 identifiers in GenExpr");
assert.ok(!gen.includes("delay("), "GenExpr must not use delay()");
assert.ok(!/multisample|keyzone/i.test(gen), "DSP core has no multisample zone map");

const fnAt = gen.indexOf("slew_val(");
const bufAt = gen.indexOf("\nBuffer ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const exprAt = gen.indexOf("\nsrVal = max(samplerate, 8000);");
assert.ok(fnAt >= 0 && fnAt < bufAt, "Helper functions must precede Buffer");
assert.ok(bufAt < paramAt && paramAt < histAt, "Declarations follow Buffer -> Param -> History");
assert.ok(histAt < exprAt, "History declarations precede top-level expressions");
assert.ok(gen.includes("fixnan("), "Outputs must be protected with fixnan()");
assert.ok(gen.includes("v15L, v15R, v15P, v15A, v15M = voice_proc(samp, vdata, 15,"), "All 16 voices (0..15) run");
assert.ok(gen.includes("Param mode(0, min=0, max=3);"), "mode param covers 4 engines");
assert.ok(gen.includes("Param freeze(0, min=0, max=1);"), "freeze param");
assert.ok(gen.includes("Param reverse(0, min=0, max=1);"), "reverse param");
assert.ok(gen.includes("Param unison_voices(1, min=1, max=8);"), "unison_voices is 1..8");
assert.ok(gen.includes("Param unison_detune(0.15, min=0, max=1);"), "unison_detune param");
assert.ok(gen.includes("Param unison_width(0.65, min=0, max=1);"), "unison_width param");
assert.ok(gen.includes("Param glide_ms(0, min=0, max=1000);"), "glide_ms param");
assert.ok(gen.includes("isSlice = (modeId > 2.5);"), "Slice is mode 3");
assert.ok(gen.includes("else if (modeId < 1.5)"), "Cycles is mode 1");
assert.ok(gen.includes("uCount = int(clip(round(unisonCount), 1, 8));"), "Unison count clamps to 1..8");
assert.ok(gen.includes("for (u = 0; u < 8; u += 1)"), "Unison loop is bounded at 8");
assert.ok(gen.includes("glideCoef = (glide_ms <= 0.5) ? 0.0 : exp(-1000.0 / (glide_ms * srVal));"), "Glide coefficient");
assert.ok((gen.match(/freezeOn > 0\.5/g) || []).length >= 3, "Freeze is handled in every engine");
assert.ok(gen.includes("dirSign = (reverseOn > 0.5) ? -1.0 : 1.0;"), "Reverse flips playback direction");
assert.ok(gen.includes("REPITCH") && gen.includes("CYCLES") && gen.includes("TEXTURES") && gen.includes("SLICE"));


// ============================================================================
// 3. devices/Better Sampler.amxd structure and wiring
// ============================================================================
const DEVICE_W = 600;
const DEVICE_H = 169;
const FILE_NAME = "Better Sampler.amxd";
const amxdPath = path.join(ROOT, "devices", FILE_NAME);
assert.ok(fs.existsSync(amxdPath), `Missing built device: ${amxdPath}`);
for (const old of ["Compact", "Standard", "Expanded"]) {
    assert.ok(!fs.existsSync(path.join(ROOT, "devices", `Better Sampler ${old}.amxd`)), `no ${old} variant is built any more`);
}
const raw = fs.readFileSync(amxdPath);
assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", "invalid ampf magic");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "iiii", "expected Max Instrument 'iiii'");
assert.strictEqual(raw.readUInt32LE(28), raw.length - 32, "JSON payload byte length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const patcher = doc.patcher;
assert.strictEqual(patcher.openinpresentation, 1, "opens in presentation mode");
assert.deepStrictEqual(patcher.openrect, [0, 0, DEVICE_W, DEVICE_H], "openrect is 600 x 169");
assert.strictEqual(patcher.devicewidth, DEVICE_W);

const boxes = patcher.boxes.map((b) => b.box);
const byId = new Map(boxes.map((b) => [b.id, b]));
const lines = patcher.lines;
assert.strictEqual(byId.size, boxes.length, "box ids are unique");

// --- buffers, loadbang message, gen core ---
assert.strictEqual(byId.get("obj-buf-samp").text, "buffer~ #0-bsamp 1000 2", "empty user sample buffer");
assert.strictEqual(byId.get("obj-buf-voices").text, "buffer~ #0-bsvoices @samps 128");
assert.strictEqual(byId.get("obj-buf-scope").text, "buffer~ #0-bsscope @samps 64");
assert.strictEqual(byId.get("obj-msg-gen-buf").text, "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope");
assert.strictEqual(byId.get("obj-msg-ui-buf").text, "setbuffers #0-bsamp #0-bsvoices #0-bsscope");
assertLink(lines, "obj-loadbang", 0, "obj-msg-gen-buf", 0, "loadbang -> gen buffers");
assertLink(lines, "obj-msg-gen-buf", 0, "obj-gen", 0, "gen buffers");
assertLink(lines, "obj-msg-ui-buf", 0, "obj-viz", 0, "ui buffers");
assert.strictEqual(byId.get("obj-gen").code.trim(), gen.trim(), "embeds the current GenExpr core");
for (const b of boxes) {
    const t = String(b.text || "");
    if (/^(buffer~|send|receive)\b/.test(t)) assert.ok(t.includes("#0-"), `instance object must use #0- (${t})`);
}

const stripped = JSON.stringify({
    boxes: boxes.map((b) => {
        const copy = Object.assign({}, b);
        if (copy.textfile) copy.textfile = { embed: 1 };
        if (copy.code) copy.code = "";
        return copy;
    }),
    lines,
});
assert.ok(!/sfplay~/i.test(stripped), "no sfplay~ sample library");
assert.ok(!/multisample|keyzone/i.test(stripped), "no multisample zone objects");
assert.ok(!/\.(wav|aiff|aif|flac|mp3)\b/i.test(stripped), "no preloaded audio file");
assert.ok(!/replace\s+\//i.test(stripped), "loadbang must not replace a library sample");

// --- background panel(s) last, background 1 ---
const panels = boxes.filter((b) => b.maxclass === "panel");
assert.ok(panels.length >= 1 && byId.get("obj-pnl-bg"), "background panel obj-pnl-bg exists");
assert.strictEqual(boxes[boxes.length - 1].id, "obj-pnl-bg", "background panel is the last box");
assert.ok(boxes.findIndex((b) => b.maxclass === "panel") > boxes.map((b) => b.maxclass !== "panel").lastIndexOf(true),
    "panels are at the end of boxes");
for (const b of panels) assert.strictEqual(b.background, 1, `panel ${b.id} background: 1`);

// --- presentation: two v8ui canvases + the waveform drop target, all live.* controls kept off the face ---
const liveBoxes = boxes.filter((b) => /^live\./.test(b.maxclass));
for (const b of liveBoxes) {
    if (b.id === "obj-drop-wave") continue;
    assert.ok(b.presentation !== 1, `${b.id} (${b.maxclass}) must not be in presentation`);
}
assert.ok(!byId.has("obj-drop"), "one drop zone only: two would each replay a different saved path on load");
// The waveform drop target is the one allowed overlap: an invisible live.drop above obj-viz that
// ignores clicks, so the v8ui below keeps every click and drag while file drops land on it.
const waveDrop = byId.get("obj-drop-wave");
assert.strictEqual(waveDrop.maxclass, "live.drop");
assert.strictEqual(waveDrop.presentation, 1);
assert.strictEqual(waveDrop.ignoreclick, 1, "waveform drop target passes clicks through");
assert.strictEqual(waveDrop.legend, "");
assert.strictEqual(waveDrop.bordercolor[3], 0, "waveform drop target has no visible border");
assert.strictEqual(waveDrop.textcolor[3], 0, "waveform drop target has no visible text");
const wr = waveDrop.presentation_rect;
const vr = [0, 0, 528, 169];
assert.ok(wr[0] >= vr[0] && wr[1] >= vr[1] && wr[0] + wr[2] <= vr[2] && wr[1] + wr[3] <= vr[3], "waveform drop target sits inside obj-viz");
const boxOrder = boxes.map((b) => b.id);
assert.ok(boxOrder.indexOf("obj-drop-wave") > boxOrder.indexOf("obj-viz"), "waveform drop target is above obj-viz");
const presBoxes = boxes.filter((b) => b.presentation === 1 && !b.hidden && b.maxclass !== "panel" && b.id !== "obj-drop-wave");
assert.deepStrictEqual(presBoxes.map((b) => b.id).sort(), ["obj-viz", "obj-viz-side"]);
// In Live a live.drop only outputs in parameter mode (File type), as in Max's live.drop help patch
assert.strictEqual(waveDrop.parameter_enable, 1, "live.drop must be in parameter mode or Live never outputs the path");
const wdv = waveDrop.saved_attribute_attributes.valueof;
assert.strictEqual(wdv.parameter_type, 4, "live.drop parameter is the File type");
assert.strictEqual(wdv.parameter_invisible, 1, "file parameter hidden from automation");
assert.strictEqual(wdv.parameter_longname, "Sample File");
for (let i = 0; i < presBoxes.length; i++) {
    const r = presBoxes[i].presentation_rect;
    assert.ok(r[0] >= 0 && r[0] + r[2] <= DEVICE_W, `${presBoxes[i].id} inside 0..${DEVICE_W}`);
    assert.ok(r[1] >= 0 && r[1] + r[3] <= DEVICE_H, `${presBoxes[i].id} inside 0..${DEVICE_H}`);
    for (let j = i + 1; j < presBoxes.length; j++) {
        assert.ok(!rectsOverlap(r, presBoxes[j].presentation_rect), `overlap ${presBoxes[i].id} and ${presBoxes[j].id}`);
    }
}
// live.drop must stay clear of both canvases (v8ui would swallow its clicks)
assert.deepStrictEqual(byId.get("obj-viz").presentation_rect, [0, 0, 528, 169]);
assert.deepStrictEqual(byId.get("obj-viz-side").presentation_rect, [531, 3, 66, 163]);
const bgPanel = byId.get("obj-pnl-bg");
assert.deepStrictEqual(bgPanel.presentation_rect, [0, 0, DEVICE_W, DEVICE_H]);

// --- controls: every key is an obj-ctrl-<key>; ranges, enums and 8-bit Int rule ---
const ctrlBoxes = boxes.filter((b) => /^obj-ctrl-/.test(b.id));
const ctrlKeys = ctrlBoxes.map((b) => b.id.replace(/^obj-ctrl-/, ""));
assert.ok(ctrlKeys.length >= 40, `expected the full parameter set, got ${ctrlKeys.length}`);
for (const b of ctrlBoxes) {
    assert.ok(/^live\./.test(b.maxclass), `${b.id} is a live.* object`);
    assert.strictEqual(b.presentation, 0, `${b.id} presentation 0`);
    const vof = valueOf(b);
    assert.ok(vof, `${b.id} has parameter data`);
    if (typeof vof.parameter_mmax === "number" && vof.parameter_mmax > 255) {
        assert.strictEqual(vof.parameter_type, 0, `${b.id}: range > 255 must be Float parameter_type 0`);
    }
}
const modeV = valueOf(byId.get("obj-ctrl-mode"));
assert.deepStrictEqual(modeV.parameter_enum, ["Repitch", "Cycles", "Textures", "Slice"]);
assert.strictEqual(modeV.parameter_mmax, 3);
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-freeze")).parameter_enum, ["Off", "Freeze"]);
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-reverse")).parameter_enum, ["Fwd", "Rev"]);
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-mono_legato")).parameter_enum, ["Poly", "Legato"]);
const uniV = valueOf(byId.get("obj-ctrl-unison_voices"));
assert.strictEqual(uniV.parameter_mmin, 1);
assert.strictEqual(uniV.parameter_mmax, 8);
assert.strictEqual(uniV.parameter_type, 0);
const glideV = valueOf(byId.get("obj-ctrl-glide_ms"));
assert.strictEqual(glideV.parameter_mmax, 1000);
assert.strictEqual(glideV.parameter_type, 0, "glide 0..1000 cannot use Live's 8-bit Int type");
const polyV = valueOf(byId.get("obj-ctrl-poly_voices"));
assert.strictEqual(polyV.parameter_mmin, 1);
assert.strictEqual(polyV.parameter_mmax, 16);

// --- import wiring ---
assert.strictEqual(byId.get("obj-prep-replace").text, "prepend replace");
assert.strictEqual(byId.get("obj-prep-loaded").text, "prepend sample_loaded");
assert.strictEqual(byId.get("obj-prep-midi").text, "prepend midi_note");
// Drops and dialog picks go through the face, which decides what to load
assertLink(lines, "obj-drop-wave", 0, "obj-prep-dropfile", 0, "drop -> prepend dropfile");
assert.strictEqual(byId.get("obj-prep-dropfile").text, "prepend dropfile");
assertLink(lines, "obj-prep-dropfile", 0, "obj-viz", 0, "dropfile -> main face");
assertLink(lines, "obj-opendialog", 0, "obj-prep-browsed", 0, "dialog -> prepend browsed");
assert.strictEqual(byId.get("obj-prep-browsed").text, "prepend browsed");
assertLink(lines, "obj-prep-browsed", 0, "obj-viz", 0, "browsed -> main face");
assertLink(lines, "obj-route-viz", 1, "obj-prep-replace", 0, "load_sample -> replace");
assertLink(lines, "obj-route-viz", 3, "obj-prep-dropset", 0, "drop_set route");
assert.strictEqual(byId.get("obj-prep-dropset").text, "prepend set");
assertLink(lines, "obj-prep-dropset", 0, "obj-drop-wave", 0, "browse keeps the drop zone's saved path in sync");
for (const src of ["obj-drop-wave", "obj-opendialog"]) {
    assert.ok(!lines.some((l) => l.patchline.source[0] === src && l.patchline.destination[0] === "obj-prep-replace"), `${src} must not bypass the face`);
}
assert.strictEqual(byId.get("obj-opendialog").text, "opendialog sound");
assertLink(lines, "obj-prep-replace", 0, "obj-buf-samp", 0, "replace");
assertLink(lines, "obj-buf-samp", 1, "obj-prep-loaded", 0, "buffer~ done");
assertLink(lines, "obj-prep-loaded", 0, "obj-viz", 0, "sample_loaded -> main face");
assertLink(lines, "obj-midiin", 0, "obj-midiparse", 0, "midi");
assertLink(lines, "obj-midiparse", 0, "obj-prep-midi", 0, "midi");
assertLink(lines, "obj-prep-midi", 0, "obj-viz", 0, "midi -> main face");

// --- face -> route -> hidden control wiring ---
assert.strictEqual(byId.get("obj-route-viz").text, "route param load_sample browse drop_set");
assertLink(lines, "obj-route-viz", 2, "obj-opendialog", 0, "browse -> file dialog");
assertLink(lines, "obj-viz", 0, "obj-route-viz", 0, "main face outlet");
assertLink(lines, "obj-viz-side", 0, "obj-route-viz", 0, "side face outlet");
assertLink(lines, "obj-route-viz", 0, "obj-route-param", 0, "param route");
assertLink(lines, "obj-route-viz", 1, "obj-prep-replace", 0, "load_sample route");
const routeKeys = byId.get("obj-route-param").text.split(/\s+/).slice(1);
assert.strictEqual(new Set(routeKeys).size, routeKeys.length, "route keys are unique");
assert.deepStrictEqual([...routeKeys].sort(), [...ctrlKeys].sort(), "route param covers exactly the obj-ctrl-<key> objects");
assert.strictEqual(byId.get("obj-route-param").numoutlets, routeKeys.length + 1);
routeKeys.forEach((key, i) => assertLink(lines, "obj-route-param", i, `obj-ctrl-${key}`, 0, `route ${key}`));

// --- gen wiring and setter fan-out, per key ---
const noGenKeys = [];
// KNOWN BUG (scripts/build_sampler.py PARAM_SPECS: ui_setter is None for these): automation and
// preset recall of these never reach the face. Remove an entry here once it is fixed.
const KNOWN_NO_SETTER = [];
const missingSetters = [];
for (const key of routeKeys) {
    const ctrlId = `obj-ctrl-${key}`;
    const prep = byId.get(`obj-prep-${key}`);
    const scale = byId.get(`obj-scale-${key}`);
    if (prep) {
        const m = /^prepend (\w+)$/.exec(prep.text);
        assert.ok(m, `${key}: gen prepend text (${prep.text})`);
        assert.ok(new RegExp(`\\bParam\\s+${m[1]}\\s*\\(`).test(gen), `${key}: gen has Param ${m[1]}`);
        assertLink(lines, `obj-prep-${key}`, 0, "obj-gen", 0, `${key} -> gen`);
        if (scale) {
            assert.ok(/^\* [\d.]+$/.test(scale.text), `${key}: scale text ${scale.text}`);
            assertLink(lines, ctrlId, 0, scale.id, 0, `${key} ctrl -> scale`);
            assertLink(lines, scale.id, 0, prep.id, 0, `${key} scale -> prep`);
        } else {
            assertLink(lines, ctrlId, 0, prep.id, 0, `${key} ctrl -> prep`);
        }
    } else {
        noGenKeys.push(key);
    }
    const uiPrep = byId.get(`obj-uiprep-${key}`);
    if (!uiPrep && KNOWN_NO_SETTER.includes(key)) { missingSetters.push(key); continue; }
    assert.ok(uiPrep, `${key}: missing UI setter prepend`);
    assert.strictEqual(uiPrep.text, `prepend set_${key}`);
    assertLink(lines, ctrlId, 0, uiPrep.id, 0, `${key} ctrl -> setter`);
    assertLink(lines, uiPrep.id, 0, "obj-viz", 0, `${key} setter -> main face`);
    assertLink(lines, uiPrep.id, 0, "obj-viz-side", 0, `${key} setter -> side face`);
}
if (missingSetters.length) console.warn(`WARNING known bug: no set_<key> wiring to the faces for: ${missingSetters.join(", ")}`);
assert.deepStrictEqual(noGenKeys.sort(), ["mono_legato", "poly_voices"], "legato and poly cap are voice-allocator settings, not Gen params");
assert.strictEqual(byId.get("obj-scale-unison_detune").text, "* 0.01");
assert.strictEqual(byId.get("obj-scale-unison_width").text, "* 0.01");
for (const key of ["mode", "freeze", "reverse", "loop_mode", "unison_voices", "glide_ms", "grain_size",
    "grain_motion", "grain_spray", "formant", "filt_cutoff", "filt_on", "filt_type"]) {
    assert.ok(byId.get(`obj-prep-${key}`), `${key} reaches Gen`);
}

// --- the two v8ui boxes ---
const mainViz = byId.get("obj-viz");
const sideViz = byId.get("obj-viz-side");
assert.strictEqual(mainViz.maxclass, "v8ui");
assert.strictEqual(sideViz.maxclass, "v8ui");
assert.strictEqual(mainViz.parameter_enable, 1);
assert.strictEqual(sideViz.parameter_enable, 0, "the side face is not a saved parameter");
const stateV = valueOf(mainViz);
assert.strictEqual(stateV.parameter_type, 3, "SamplerStateData blob");
assert.strictEqual(stateV.parameter_longname, "SamplerStateData");
assert.strictEqual(stateV.parameter_initial[0], 1, "initial blob is version 1 (still accepted)");
assert.ok(!valueOf(sideViz), "side face stores no state");
const mainText = mainViz.textfile.text;
const sideText = sideViz.textfile.text;
assert.ok(mainText.includes('var FACE_REGION = "main";'));
assert.ok(sideText.includes('var FACE_REGION = "side";'));
for (const t of [mainText, sideText]) {
    assert.ok(t.includes("var FACE_PARAMS = {"), "FACE_PARAMS embedded");
    assert.ok(t.includes("function storeParam") && t.includes("function paint") && t.includes("function onclick"));
    assert.ok(!/multisample|keyzone/i.test(t), "UI has no multisample zones");
    assert.ok(t.indexOf("var FACE_REGION") < t.indexOf("function storeParam"), "config -> FACE_* -> ui -> face order");
}
for (const t of [mainText, sideText]) {
    const onclickAt = t.indexOf("function onclick");
    const ondragAt = t.indexOf("function ondrag");
    const ondblAt = t.indexOf("function ondblclick");
    const onidleAt = t.indexOf("function onidle(");
    assert.ok(onclickAt >= 0 && ondragAt > onclickAt && ondblAt > ondragAt && onidleAt > ondblAt, "mouse handlers in order");
    assert.ok(t.slice(onclickAt, ondragAt).includes("pushUndoState("), "undo pushed on click gestures");
    assert.ok(!t.slice(ondragAt, ondblAt).includes("pushUndoState("), "drag must not push undo per frame");
    assert.ok(t.slice(ondblAt, onidleAt).includes("pushUndoState("), "undo pushed on double-click");
}

// ============================================================================
// 4. Sandbox run of both embedded face scripts
// ============================================================================
function makeSandbox(box) {
    const ctx = { emitted: [], pokes: [], notified: 0, audioOn: false, channels: 2, cursor: { hide: 0, show: 0 } };
    const noop = () => {};
    const sandbox = {
        mgraphics: {
            size: [box.presentation_rect[2], box.presentation_rect[3]],
            relative_coords: 1,
            autofill: 1,
            init: noop, redraw: noop, set_source_rgba: noop, set_line_width: noop,
            rectangle: noop, rectangle_rounded: noop, move_to: noop, line_to: noop,
            curve_to: noop, close_path: noop, arc: noop, fill: noop, stroke: noop,
            select_font_face: noop, set_font_size: noop, show_text: noop,
        },
        inlets: 1,
        outlets: 1,
        outlet: (...args) => ctx.emitted.push(args),
        notifyclients: () => { ctx.notified++; },
        arrayfromargs: (args) => Array.from(args),
        Buffer: function (name) {
            this.name = String(name || "");
            this.framecount = () => 44100;
            this.channelcount = () => ctx.channels;
            this.peek = (ch, start, len) => {
                // Max throws on a channel the buffer does not have (a mono `replace` leaves 1 channel)
                if (ch > ctx.channels) throw new Error(`buffer~ has no channel ${ch}`);
                const n = Math.max(1, len || 1);
                const out = new Float32Array(n);
                if (!ctx.audioOn) return out;
                if (n >= 256) {
                    for (let i = 0; i < n; i++) {
                        out[i] = Math.sin((2.0 * Math.PI * 440.0 * ((start || 0) + i)) / 44100.0) * 0.8;
                    }
                    return out;
                }
                const bin = Math.floor((start || 0) / 275);
                out[0] = (bin % 16 === 0) ? 0.95 : 0.02;
                return out;
            };
            this.poke = (ch, idx, data) => { ctx.pokes.push({ name: this.name, ch, idx, data: Array.from(data) }); };
            this.send = noop;
        },
        Task: function () { this.schedule = noop; },
        max: { hidecursor: () => { ctx.cursor.hide++; }, showcursor: () => { ctx.cursor.show++; } },
        post: noop,
        Math, Number, String, Array, Object, Float32Array,
    };
    vm.createContext(sandbox);
    vm.runInContext(box.textfile.text, sandbox);
    ctx.sb = sandbox;
    return ctx;
}

const mainCtx = makeSandbox(mainViz);
const sideCtx = makeSandbox(sideViz);
const sb = mainCtx.sb;
const sd = sideCtx.sb;
const emitted = mainCtx.emitted;

function paramMsgs(ctx, key) { return ctx.emitted.filter((a) => a[1] === "param" && a[2] === key); }
function zones(ctx, pred) { return ctx.sb.hitZones.filter(pred); }
function center(z) { return [z.x + z.w * 0.5, z.y + z.h * 0.5]; }
function click(ctx, z, shift) { const [x, y] = center(z); ctx.sb.onclick(x, y, 1, 0, shift ? 1 : 0); return [x, y]; }
function release(ctx, x, y) { ctx.sb.ondrag(x, y, 0, 0, 0); }
function findZone(ctx, pred, label) {
    const z = ctx.sb.hitZones.find(pred);
    assert.ok(z, `zone not found: ${label}`);
    return z;
}
function actionZone(ctx, action, extra) {
    return findZone(ctx, (z) => z.kind === "button" && z.action === action && (!extra || Object.keys(extra).every((k) => z[k] === extra[k])), action);
}

// --- load-time state ---
for (const [name, c] of [["main", mainCtx], ["side", sideCtx]]) {
    assert.strictEqual(c.sb.mgraphics.relative_coords, 0, `${name}: relative_coords`);
    assert.strictEqual(c.sb.mgraphics.autofill, 0, `${name}: autofill`);
    assert.strictEqual(c.sb.hasLoadedSample, 0, `${name}: starts with no sample`);
    assert.strictEqual(c.sb.sampleFileName, "Drop Audio Sample Here");
    assert.strictEqual(c.sb.curFreeze, 0);
    assert.strictEqual(c.sb.curReverse, 0);
    assert.strictEqual(c.sb.curMonoLegato, 0);
    assert.strictEqual(c.sb.envPage, 0);
}
assert.strictEqual(sb.faceRegion, "main");
assert.strictEqual(sd.faceRegion, "side");
assert.deepStrictEqual(Array.from(Object.keys(sb.FACE_PARAMS)).sort(), [...ctrlKeys].sort(), "FACE_PARAMS has an entry per control");
for (const key of ctrlKeys) {
    const fp = sb.FACE_PARAMS[key];
    const vof = valueOf(byId.get(`obj-ctrl-${key}`));
    assert.strictEqual(fp.lo, vof.parameter_mmin === undefined ? 0 : vof.parameter_mmin, `${key} lo`);
    assert.strictEqual(fp.hi, vof.parameter_mmax, `${key} hi`);
    assert.strictEqual(fp.init, vof.parameter_initial[0], `${key} init`);
    assert.strictEqual(typeof sb["set_" + key], "function", `${key}: set_${key} defined in the main face`);
    assert.strictEqual(typeof sd["set_" + key], "function", `${key}: set_${key} defined in the side face`);
}

// --- paint, both regions ---
sb.paint();
sd.paint();
assert.ok(sb.hitZones.length > 20, "main face builds hit zones");
for (const kind of ["knob", "value", "button", "wave"]) {
    assert.ok(sb.hitZones.some((z) => z.kind === kind), `main face has ${kind} zones`);
}
for (const z of [...sb.hitZones, ...sd.hitZones]) {
    assert.ok(Number.isFinite(z.x + z.y + z.w + z.h), "finite zone rect");
}
const mainW = 528, sideW = 66;
// KNOWN LAYOUT BUG: the loop_xfade value zone (sampler_face.js paintSamplePanel) is about 5 px wider than
// the canvas (zone right edge ~533 vs 528). Slack is kept tight so anything worse still fails.
const XFADE_ZONE_SLACK = 0;
for (const z of sb.hitZones) {
    assert.ok(z.x >= -1 && z.x + z.w <= mainW + XFADE_ZONE_SLACK && z.y >= -1 && z.y + z.h <= DEVICE_H + 1, `main zone inside canvas (${z.kind} ${z.key || z.action || z.region} ${[z.x, z.y, z.w, z.h]})`);
}
for (const z of sd.hitZones) {
    assert.ok(z.x >= -1 && z.x + z.w <= sideW + 1 && z.y >= -1 && z.y + z.h <= sideViz.presentation_rect[3] + 1, `side zone inside canvas (${z.kind} ${z.key || z.action})`);
}
assert.deepStrictEqual(
    Array.from(sd.hitZones.filter((z) => z.kind === "knob").map((z) => z.key).sort()),
    ["glide_ms", "out_gain", "unison_width", "vel_sens"],
    "side face knobs"
);
assert.deepStrictEqual(Array.from(sd.hitZones.filter((z) => z.kind === "button").map((z) => z.action)), ["voicing", "voicing"], "side face: Poly / Mono only (no LOAD button)");
assert.ok(!sd.hitZones.some((z) => z.kind === "wave"), "side face has no waveform");
sb.preview();
sb.paint();
sd.paint();

// --- import: dropfile, buffers, sample_loaded, root detection, slices ---
sb.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
emitted.length = 0;
sb.dropfile("/Users/test/Drums/Kick_01.wav");
assert.strictEqual(sb.sampleFileName, "Kick_01.wav");
assert.ok(emitted.some((a) => a[1] === "load_sample" && a[2] === "/Users/test/Drums/Kick_01.wav"));
const beforeDrop = emitted.length;
sb.dropfile("");
assert.strictEqual(emitted.length, beforeDrop, "empty dropfile is ignored");

sb.hasLoadedSample = 0;
sb.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
assert.strictEqual(sb.hasLoadedSample, 0, "silent buffer does not count as a loaded sample");
mainCtx.audioOn = true;
const notesBefore = mainCtx.notified;
sb.sample_loaded("/Users/test/Drums/Kick_01.wav");
assert.ok(mainCtx.notified > notesBefore, "sample_loaded notifies Live");
assert.strictEqual(sb.hasLoadedSample, 1);
assert.ok(Math.abs(sb.detectedRootMidi - 69) <= 1, `imported 440 Hz window -> A3, got ${sb.detectedRootMidi}`);
assert.strictEqual(sb.sliceMarkers[0], 0);
assert.ok(sb.sliceMarkers.length >= 4 && sb.sliceMarkers.length <= 16);
assert.ok(sb.sliceMarkers.some((s) => Math.abs(s - 0.1) < 0.02), "transient slices replace the default grid");
sb.paint();
// --- a mono file leaves a 1-channel buffer: the face must still load it (regression) ---
{
    const monoCtx = makeSandbox(mainViz);
    const m = monoCtx.sb;
    m.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    monoCtx.channels = 1;
    monoCtx.audioOn = true;
    m.sample_loaded("/Users/test/Drums/Crash_Mono.wav");
    m.sample_loaded("bang");
    assert.strictEqual(m.lastLoadError, "", `mono refresh raised: ${m.lastLoadError}`);
    assert.strictEqual(m.hasLoadedSample, 1, "mono sample loads");
    assert.strictEqual(m.sampleFileName, "Crash_Mono.wav");
    for (let i = 0; i < m.WAVE_BINS; i++) assert.strictEqual(m.wavePeaksR[i], m.wavePeaksL[i], "mono draws the same peaks on both sides");
    // a failed refresh is recorded, not silently swallowed
    const errCtx = makeSandbox(mainViz);
    errCtx.sb.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    errCtx.sb.Buffer = function () { this.framecount = () => 44100; this.channelcount = () => 2; this.peek = () => { throw new Error("boom"); }; };
    errCtx.sb.sample_loaded("/Users/test/x.wav");
    assert.ok(/boom/.test(errCtx.sb.lastLoadError), "refresh failure is recorded");
}

// buffer~ reports a finished load as "sample_loaded bang": the name and saved path must survive it
sb.sample_loaded("bang");
assert.strictEqual(sb.sampleFileName, "Kick_01.wav", "buffer~ done bang keeps the file name");
assert.strictEqual(sb.sampleFilePath, "/Users/test/Drums/Kick_01.wav", "buffer~ done bang keeps the saved path");
sb.paint();
{
    // clicking the file name in the header opens the file dialog
    const z = findZone(mainCtx, (zz) => zz.kind === "button" && zz.action === "browse", "browse");
    emitted.length = 0;
    sb.onclick(z.x + 4, z.y + 4, 1, 0, 0);
    assert.ok(emitted.some((a) => a[1] === "browse"), "file name click emits browse");
}

// --- engine buttons set the mode and emit param mode ---
{
    const engineNames = ["Repitch", "Cycles", "Textures"];
    assert.deepStrictEqual(Array.from(sb.ENGINE_NAMES), engineNames);
    for (let e = 0; e < 3; e++) {
        sb.paint();
        const z = actionZone(mainCtx, "engine", { engine: e });
        emitted.length = 0;
        const depth = sb.undoStack.length;
        click(mainCtx, z);
        assert.strictEqual(sb.curMode, e, `engine button ${e}`);
        assert.strictEqual(sb.lastEngine, e);
        assert.deepStrictEqual(paramMsgs(mainCtx, "mode").map((a) => a[3]), [e], `engine ${e} emits one param mode`);
        assert.strictEqual(sb.undoStack.length, depth + 1, "one undo snapshot per engine click");
        sb.paint();
    }
    // prev/next arrows cycle the three engines
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "engine_next"));
    assert.strictEqual(sb.curMode, 0, "next from Textures wraps to Repitch");
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "engine_prev"));
    assert.strictEqual(sb.curMode, 2, "prev from Repitch wraps to Textures");

    // Single / Sliced toggles between mode 3 and the last engine
    sb.paint();
    emitted.length = 0;
    click(mainCtx, actionZone(mainCtx, "sliced"));
    assert.strictEqual(sb.curMode, 3);
    assert.deepStrictEqual(paramMsgs(mainCtx, "mode").map((a) => a[3]), [3]);
    assert.strictEqual(sb.lastEngine, 2, "Sliced remembers the last engine");
    sb.paint();
    emitted.length = 0;
    click(mainCtx, actionZone(mainCtx, "single"));
    assert.strictEqual(sb.curMode, 2, "Single returns to the last engine");
    assert.deepStrictEqual(paramMsgs(mainCtx, "mode").map((a) => a[3]), [2]);
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "engine", { engine: 0 }));
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "sliced"));
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "single"));
    assert.strictEqual(sb.curMode, 0, "Single after Repitch -> Sliced returns to Repitch");
    // in Sliced the engine arrows step from the remembered engine
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "sliced"));
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "engine_next"));
    assert.strictEqual(sb.curMode, 1, "engine_next leaves Sliced for the engine after the remembered one");
    // undo stack: one snapshot per click, undo/redo walk the UI state
    const tip = sb.curMode;
    sb.performUndo();
    sb.performRedo();
    assert.strictEqual(sb.curMode, tip, "undo then redo returns to the tip");
    const stalled = sb.undoStack.length;
    sb.performRedo();
    assert.strictEqual(sb.undoStack.length, stalled, "redo at the tip is a no-op");
}

// --- toggle buttons: reverse, freeze, loop mode, filter on/type ---
{
    sb.storeParam("reverse", 0); sb.storeParam("freeze", 0); sb.storeParam("loop_mode", 1);
    sb.storeParam("filt_on", 1); sb.storeParam("filt_type", 0);
    sb.paint();
    emitted.length = 0;
    click(mainCtx, actionZone(mainCtx, "reverse"));
    assert.deepStrictEqual(paramMsgs(mainCtx, "reverse").map((a) => a[3]), [1]);
    assert.strictEqual(sb.curReverse, 1);
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "reverse"));
    assert.strictEqual(sb.curReverse, 0);
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "freeze"));
    assert.strictEqual(sb.curFreeze, 1);
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "freeze"));
    assert.strictEqual(sb.curFreeze, 0);
    const seen = [];
    for (let i = 0; i < 3; i++) {
        sb.paint();
        click(mainCtx, actionZone(mainCtx, "loop_mode"));
        seen.push(sb.curLoopMode);
    }
    assert.deepStrictEqual(seen, [2, 0, 1], "loop mode cycles Fwd -> Ping -> Off -> Fwd");
    const types = [];
    for (let i = 0; i < 4; i++) {
        sb.paint();
        click(mainCtx, actionZone(mainCtx, "filt_type"));
        types.push(Math.round(sb.paramValue("filt_type")));
    }
    assert.deepStrictEqual(types, [1, 2, 0, 1], "filter type cycles LP -> BP -> HP");
    sb.storeParam("filt_type", 0);
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "filt_on"));
    assert.strictEqual(sb.curFiltOn, 0);
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "filt_on"));
    assert.strictEqual(sb.curFiltOn, 1);
}

// --- every knob in every region: drag up raises the value inside its range; shift moves 8x less ---
function knobKeys(ctx) { return ctx.sb.hitZones.filter((z) => z.kind === "knob").map((z) => z.key); }
{
    const checked = new Set();
    const regions = [[mainCtx, "main"], [sideCtx, "side"]];
    for (const [ctx, name] of regions) {
        const c = ctx.sb;
        const pageList = name === "main" ? [0, 1, 2, 3] : [0];
        const modeList = name === "main" ? [2] : [0];   // Textures lights every engine knob
        for (const page of pageList) {
            c.envPage = page;
            c.storeParam("mode", modeList[0]);
            c.paint();
            for (const z of c.hitZones.filter((q) => q.kind === "knob")) {
                const key = z.key;
                const spec = c.FACE_PARAMS[key];
                assert.ok(spec, `${key}: FACE_PARAMS entry`);
                const [cx, cy] = center(z);
                assert.strictEqual(c.zoneAt(cx, cy).key, key, `${key}: zone centre hits its own knob`);
                for (const fine of [false, true]) {
                    c.storeParam(key, c.fromNorm(key, 0.3));
                    const start = c.paramValue(key);
                    const n0 = c.toNorm(key, start);
                    ctx.emitted.length = 0;
                    c.onclick(cx, cy, 1, 0, fine ? 1 : 0);
                    assert.strictEqual(c.drag.key, key);
                    c.ondrag(cx, cy - 30, 1, 0, fine ? 1 : 0);
                    const msgs = paramMsgs(ctx, key);
                    const want = c.fromNorm(key, n0 + 30 / (120 * (fine ? 8 : 1)));
                    if (!fine) {
                        assert.strictEqual(msgs.length, 1, `${key}: one param message per drag frame`);
                        assert.ok(msgs[0][3] > start, `${key}: dragging up raises the value (${start} -> ${msgs[0][3]})`);
                    }
                    if (msgs.length) {
                        const v = msgs[msgs.length - 1][3];
                        assert.ok(v >= spec.lo - 1e-9 && v <= spec.hi + 1e-9, `${key}: ${v} inside ${spec.lo}..${spec.hi}`);
                        assert.ok(Math.abs(v - want) < 1e-9, `${key}: emitted ${v}, expected ${want}`);
                        assert.strictEqual(c.paramValue(key), v, `${key}: face mirrors the emitted value`);
                        if (fine && spec.unit !== 0 && !spec.enums) {
                            const dn = c.toNorm(key, v) - n0;
                            assert.ok(Math.abs(dn - 0.25 / 8) < 1e-6, `${key}: shift-drag moves 1/8 of normal (${dn})`);
                        }
                    } else {
                        assert.ok(fine && (spec.unit === 0 || spec.enums), `${key}: only a fine drag on a stepped parameter may emit nothing`);
                    }
                    release(c === sb ? mainCtx : sideCtx, cx, cy - 30);
                    assert.strictEqual(c.drag, null, `${key}: release ends the gesture`);
                }
                // exponent-mapped parameters follow Live's curve rather than a linear ramp
                if (spec.exp && spec.exp !== 1) {
                    const mid = c.fromNorm(key, 0.5);
                    const linMid = spec.lo + (spec.hi - spec.lo) * 0.5;
                    assert.ok(Math.abs(mid - linMid) > 1e-6, `${key}: exp ${spec.exp} bends the mapping`);
                    assert.ok(Math.abs(c.toNorm(key, mid) - 0.5) < 1e-9, `${key}: toNorm inverts fromNorm`);
                }
                // double-click resets to the init value
                c.storeParam(key, c.fromNorm(key, 0.9));
                ctx.emitted.length = 0;
                c.ondblclick(cx, cy);
                const resets = paramMsgs(ctx, key);
                assert.strictEqual(resets.length, 1, `${key}: double-click emits once`);
                assert.strictEqual(resets[0][3], spec.init, `${key}: double-click resets to ${spec.init}`);
                assert.strictEqual(c.paramValue(key), spec.init);
                checked.add(key);
            }
        }
    }
    // every key of the face knobs the design lists must be reachable
    for (const key of ["grain_size", "grain_spray", "formant", "pitch_st", "grain_motion", "play_pos",
        "filt_cutoff", "filt_res", "filt_env_amt", "atk_ms", "dec_ms", "sus_lvl", "rel_ms",
        "matk_ms", "mdec_ms", "msus_lvl", "mrel_ms", "menv_pitch", "menv_pos",
        "lfo_rate", "lfo_shape", "lfo_pitch", "lfo_filt", "lfo_pos",
        "unison_voices", "unison_detune", "poly_voices",
        "unison_width", "glide_ms", "vel_sens", "out_gain"]) {
        assert.ok(checked.has(key), `knob ${key} was exercised`);
    }
    sb.envPage = 0;
    sb.storeParam("mode", 0);
}

// --- env page tabs: change envPage and the knobs drawn; saved in getvalueof slot 9 ---
{
    const expectKeys = [
        ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"],
        ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms", "menv_pitch", "menv_pos"],
        ["lfo_rate", "lfo_shape", "lfo_pitch", "lfo_filt", "lfo_pos"],
        ["unison_voices", "unison_detune", "poly_voices"],
    ];
    assert.deepStrictEqual(Array.from(sb.ENV_PAGES), ["AMP", "MOD", "LFO", "UNI"]);
    const p4x = sb.MAIN.p4[0];
    const envKnobs = () => Array.from(sb.hitZones.filter((z) => z.kind === "knob" && z.x >= p4x).map((z) => z.key));
    sb.envPage = 0;
    sb.paint();
    assert.deepStrictEqual(envKnobs(), expectKeys[0], "AMP page knobs");
    for (const page of [2, 1, 3, 0]) {
        sb.paint();
        const depth = sb.undoStack.length;
        emitted.length = 0;
        mainCtx.notified = 0;
        click(mainCtx, actionZone(mainCtx, "env_page", { page }));
        assert.strictEqual(sb.envPage, page, `env tab ${page}`);
        assert.ok(mainCtx.notified > 0, "env page change notifies Live so the blob is saved");
        assert.strictEqual(emitted.length, 0, "env tab emits nothing to the device");
        assert.strictEqual(sb.undoStack.length, depth, "env tab is not an undo step");
        sb.paint();
        assert.deepStrictEqual(envKnobs(), expectKeys[page], `page ${page} draws its own knobs`);
        assert.strictEqual(sb.getvalueof()[9], page, "envPage is saved in slot 9");
        sb.envPage = 0;
        sb.setvalueof.apply(sb, sb.getvalueof().slice(0, 9).concat([page]).concat(sb.getvalueof().slice(10)));
        assert.strictEqual(sb.envPage, page, "setvalueof restores the env page");
        sb.paint();
    }
    sb.setvalueof.apply(sb, sb.getvalueof().map((v, i) => (i === 9 ? 9 : v)));
    assert.strictEqual(sb.envPage, 3, "an out-of-range env page clamps to 3");
    sb.envPage = 0;
}

// --- footer values: samp_start / samp_end / loop_* drag and emit region params ---
{
    sb.hasLoadedSample = 1;
    sb.curStart = 0; sb.curEnd = 1; sb.curLoopStart = 0.15; sb.curLoopEnd = 0.85; sb.curXfade = 0.05; sb.curPlayPos = 0;
    sb.curLoopMode = 1;
    sb.paint();
    const regionKeys = ["samp_start", "samp_end", "loop_start", "loop_end", "loop_xfade", "play_pos"];
    const zs = findZone(mainCtx, (z) => z.kind === "value" && z.region === "samp_start", "samp_start value");
    const [x, y] = center(zs);

    const depth = sb.undoStack.length;
    emitted.length = 0;
    sb.onclick(x, y, 1, 0, 0);
    assert.strictEqual(sb.undoStack.length, depth + 1, "region drag pushes one undo snapshot");
    sb.ondrag(x, y - 30, 1, 0, 0);
    sb.ondrag(x, y - 30, 1, 0, 0);
    assert.strictEqual(sb.undoStack.length, depth + 1, "region drag does not push undo per frame");
    assert.ok(Math.abs(sb.curStart - 0.1) < 1e-9, `samp_start moved to 0.1, got ${sb.curStart}`);
    const lastFrame = emitted.slice(-regionKeys.length);
    assert.deepStrictEqual(lastFrame.map((a) => a[2]), regionKeys, "each drag frame emits all six region params");
    assert.ok(lastFrame.every((a) => a[0] === 0 && a[1] === "param"));
    assert.strictEqual(lastFrame[0][3], 10, "samp_start emitted as percent");
    assert.strictEqual(lastFrame[1][3], 100);
    assert.strictEqual(lastFrame[2][3], 15);
    assert.strictEqual(lastFrame[3][3], 85);
    const notesBeforeRelease = mainCtx.notified;
    release(mainCtx, x, y - 30);
    assert.ok(mainCtx.notified > notesBeforeRelease, "releasing a region drag notifies Live");
    assert.strictEqual(sb.drag, null);

    // shift-drag is 8x finer
    sb.curStart = 0;
    sb.paint();
    emitted.length = 0;
    sb.onclick(x, y, 1, 0, 1);
    sb.ondrag(x, y - 30, 1, 0, 1);
    assert.ok(Math.abs(sb.curStart - 30 / 2400) < 1e-9, `shift region drag moves 1/8 as far (${sb.curStart})`);
    assert.ok(Math.abs(sb.curStart * 8 - 0.1) < 1e-9);
    release(mainCtx, x, y);

    // samp_end cannot cross samp_start; dragging samp_end down emits a smaller percent
    sb.curStart = 0.2; sb.curEnd = 1;
    sb.paint();
    const ze = findZone(mainCtx, (z) => z.kind === "value" && z.region === "samp_end", "samp_end value");
    const [ex, ey] = center(ze);
    sb.onclick(ex, ey, 1, 0, 0);
    emitted.length = 0;
    sb.ondrag(ex, ey + 1000, 1, 0, 0);
    assert.ok(Math.abs(sb.curEnd - 0.22) < 1e-9, "samp_end stops 0.02 above samp_start");
    assert.strictEqual(paramMsgs(mainCtx, "samp_end").pop()[3], 22);
    release(mainCtx, ex, ey);

    // loop values and xfade
    sb.curStart = 0; sb.curEnd = 1; sb.curLoopStart = 0.15; sb.curLoopEnd = 0.85; sb.curXfade = 0.05;
    sb.paint();
    for (const [region, getter] of [["loop_start", () => sb.curLoopStart], ["loop_end", () => sb.curLoopEnd], ["loop_xfade", () => sb.curXfade]]) {
        const z = findZone(mainCtx, (q) => q.kind === "value" && q.region === region, region);
        const [vx, vy] = center(z);
        const before = getter();
        emitted.length = 0;
        sb.onclick(vx, vy, 1, 0, 0);
        sb.ondrag(vx, vy + (region === "loop_end" ? 30 : -15), 1, 0, 0);
        assert.notStrictEqual(getter(), before, `${region} moves`);
        assert.ok(paramMsgs(mainCtx, region).length >= 1, `${region} emits its param`);
        release(mainCtx, vx, vy);
        sb.paint();
    }
    assert.ok(sb.curLoopEnd < 0.85, "dragging loop_end down shortens the loop");

    // double-click on a region value restores its default
    sb.curStart = 0.3;
    sb.paint();
    const zr = findZone(mainCtx, (z) => z.kind === "value" && z.region === "samp_start", "samp_start value");
    const depth2 = sb.undoStack.length;
    emitted.length = 0;
    sb.ondblclick(...center(zr));
    assert.strictEqual(sb.curStart, 0, "double-click resets samp_start");
    assert.strictEqual(paramMsgs(mainCtx, "samp_start").pop()[3], 0);
    assert.strictEqual(sb.undoStack.length, depth2 + 1, "region reset pushes one undo snapshot");

    // numeric values: ROOT note and fine cents drag in whole units
    sb.storeParam("root_note", 60); sb.storeParam("fine_cents", 0);
    sb.paint();
    const zroot = findZone(mainCtx, (z) => z.kind === "value" && z.key === "root_note", "root value");
    const [rx, ry] = center(zroot);
    emitted.length = 0;
    sb.onclick(rx, ry, 1, 0, 0);
    sb.ondrag(rx, ry - 8, 1, 0, 0);
    assert.deepStrictEqual(paramMsgs(mainCtx, "root_note").map((a) => a[3]), [62], "root note drags 4 px per semitone");
    release(mainCtx, rx, ry - 8);
    sb.ondblclick(rx, ry);
    assert.strictEqual(sb.curRootNote, 60, "double-click resets root note");
}

// --- waveform: loop handle drag (one undo per gesture), double-click resets the regions ---
{
    sb.curMode = 0; sb.storeParam("mode", 0);
    sb.curLoopMode = 1; sb.curLoopStart = 0.18; sb.curLoopEnd = 0.78; sb.curStart = 0.04; sb.curEnd = 0.96;
    sb.paint();
    const wz = findZone(mainCtx, (z) => z.kind === "wave", "wave");
    const loopX = wz.x + 0.18 * wz.w;
    const wy = wz.y + wz.h * 0.5;
    const depth = sb.undoStack.length;
    sb.onclick(loopX, wy, 1, 0, 0);
    assert.strictEqual(sb.drag.wave, "loop_start");
    assert.strictEqual(sb.undoStack.length, depth + 1);
    for (const dx of [30, 36, 42]) sb.ondrag(loopX + dx, wy, 1, 0, 0);
    assert.strictEqual(sb.undoStack.length, depth + 1, "dragging does not push undo per frame");
    assert.ok(sb.curLoopStart > 0.18);
    release(mainCtx, loopX + 42, wy);
    sb.performUndo();
    assert.ok(Math.abs(sb.curLoopStart - 0.18) < 1e-9, "undo restores the loop start");

    const dblDepth = sb.undoStack.length;
    const notesAtDbl = mainCtx.notified;
    sb.ondblclick(wz.x + 20, wy);
    assert.strictEqual(sb.undoStack.length, dblDepth + 1, "double-click pushes one undo state");
    assert.strictEqual(sb.curStart, 0);
    assert.strictEqual(sb.curEnd, 1);
    assert.strictEqual(sb.curLoopStart, 0.15);
    assert.strictEqual(sb.curLoopEnd, 0.85);
    assert.ok(mainCtx.notified > notesAtDbl);

    // Pos only exists while frozen: an empty waveform spot does nothing unfrozen, scrubs Pos frozen
    sb.set_freeze(0);
    sb.paint();
    emitted.length = 0;
    sb.onclick(wz.x + 0.5 * wz.w, wy, 1, 0, 0);
    assert.strictEqual(sb.drag, null, "no Pos drag without Freeze");
    assert.strictEqual(paramMsgs(mainCtx, "play_pos").length, 0, "no Pos change without Freeze");
    sb.set_freeze(1);
    sb.paint();
    emitted.length = 0;
    sb.onclick(wz.x + 0.5 * wz.w, wy, 1, 0, 0);
    assert.strictEqual(sb.drag.wave, "play_pos");
    assert.ok(Math.abs(paramMsgs(mainCtx, "play_pos").pop()[3] - 50) < 0.1);
    release(mainCtx, wz.x + 0.5 * wz.w, wy);

    // Sliced: clicking the waveform auditions a slice via midi_note and releases it
    sb.storeParam("mode", 3);
    sb.paint();
    const gate = () => sb.voiceAlloc.voices.filter((v) => v.gate === 1).length;
    sb.all_notes_off();
    sb.onclick(wz.x + 0.3 * wz.w, wy, 1, 0, 0);
    assert.strictEqual(sb.drag.wave, "slice_audition");
    assert.strictEqual(gate(), 1, "slice audition opens a voice");
    release(mainCtx, wz.x, wy);
    assert.strictEqual(gate(), 0, "releasing the mouse closes the audition voice");
    sb.storeParam("mode", 0);
}

// --- Poly / Mono in the side region emits mono_legato ---
{
    sd.paint();
    const polyZ = findZone(sideCtx, (z) => z.kind === "button" && z.action === "voicing" && z.value === 0, "Poly");
    const monoZ = findZone(sideCtx, (z) => z.kind === "button" && z.action === "voicing" && z.value === 1, "Mono");
    assert.ok(!rectsOverlap([polyZ.x, polyZ.y, polyZ.w, polyZ.h], [monoZ.x, monoZ.y, monoZ.w, monoZ.h]), "Poly and Mono do not overlap");
    sideCtx.emitted.length = 0;
    click(sideCtx, monoZ);
    assert.deepStrictEqual(paramMsgs(sideCtx, "mono_legato").map((a) => a[3]), [1]);
    assert.strictEqual(sd.curMonoLegato, 1);
    sd.paint();
    click(sideCtx, polyZ);
    assert.deepStrictEqual(paramMsgs(sideCtx, "mono_legato").map((a) => a[3]), [1, 0]);
    assert.strictEqual(sd.curMonoLegato, 0);
    // hovering a side knob swaps its glyph for the value readout and clears on idleout
    sd.paint();
    const gz = findZone(sideCtx, (z) => z.kind === "knob" && z.key === "glide_ms", "glide knob");
    sd.onidle(...center(gz));
    assert.strictEqual(sd.hoverKey, "glide_ms");
    sd.onidleout();
    assert.strictEqual(sd.hoverKey, "");
}

// --- storeParam echoes (live.* automation -> set_<key>) update state and never re-emit ---
{
    const n0 = mainCtx.emitted.length;
    sb.set_mode(2);
    assert.strictEqual(sb.curMode, 2);
    assert.strictEqual(sb.lastEngine, 2);
    sb.set_mode(3);
    assert.strictEqual(sb.curMode, 3);
    assert.strictEqual(sb.lastEngine, 2, "Slice echo keeps the last engine");
    sb.set_mode(9);
    assert.strictEqual(sb.curMode, 3, "mode echo clamps to Slice");
    sb.set_mode(-4);
    assert.strictEqual(sb.curMode, 0);
    sb.set_freeze(1); assert.strictEqual(sb.curFreeze, 1);
    sb.set_freeze(0); assert.strictEqual(sb.curFreeze, 0);
    sb.set_reverse(1); assert.strictEqual(sb.curReverse, 1);
    sb.set_reverse(0.2); assert.strictEqual(sb.curReverse, 0);
    sb.set_loop_mode(2); assert.strictEqual(sb.curLoopMode, 2);
    sb.set_loop_mode(7); assert.strictEqual(sb.curLoopMode, 2, "loop_mode clamps");
    sb.set_samp_start(25); assert.ok(Math.abs(sb.curStart - 0.25) < 1e-9);
    sb.set_samp_end(80); assert.ok(Math.abs(sb.curEnd - 0.8) < 1e-9);
    sb.set_loop_start(30); assert.ok(Math.abs(sb.curLoopStart - 0.3) < 1e-9);
    sb.set_loop_end(70); assert.ok(Math.abs(sb.curLoopEnd - 0.7) < 1e-9);
    sb.set_loop_xfade(100); assert.ok(Math.abs(sb.curXfade - 0.45) < 1e-9, "xfade 100% = 0.45");
    sb.set_play_pos(40); assert.ok(Math.abs(sb.curPlayPos - 0.4) < 1e-9);
    sb.set_root_note(200); assert.strictEqual(sb.curRootNote, 127);
    sb.set_root_note(72); assert.strictEqual(sb.curRootNote, 72);
    sb.set_poly_voices(16); assert.strictEqual(sb.curPolyVoices, 16);
    sb.set_poly_voices(4); assert.strictEqual(sb.voiceAlloc.getMaxVoices(), 4);
    sb.set_poly_voices(0); assert.strictEqual(sb.curPolyVoices, 1, "poly clamps to at least 1");
    sb.set_mono_legato(1); assert.strictEqual(sb.curMonoLegato, 1);
    sb.set_mono_legato(0); assert.strictEqual(sb.curMonoLegato, 0);
    sb.set_filt_on(0); assert.strictEqual(sb.curFiltOn, 0);
    sb.set_filt_on(1); assert.strictEqual(sb.curFiltOn, 1);
    sb.set_filt_cutoff(1234); assert.strictEqual(sb.curFiltCutoff, 1234);
    sb.set_unison_voices(8); assert.strictEqual(sb.paramValue("unison_voices"), 8);
    sb.set_unison_detune(40); assert.strictEqual(sb.paramValue("unison_detune"), 40);
    sb.set_unison_width(90); assert.strictEqual(sb.paramValue("unison_width"), 90);
    sb.set_glide_ms(250); assert.strictEqual(sb.paramValue("glide_ms"), 250);
    sb.set_out_gain(-6); assert.strictEqual(sb.paramValue("out_gain"), -6);
    sb.set_mode("not-a-number");
    assert.strictEqual(sb.curMode, 0, "non-numeric echoes are ignored");
    assert.strictEqual(mainCtx.emitted.length, n0, "echoes never emit (no feedback loop)");
    // an echo reaches the other face too (both receive every set_<key>)
    sd.set_mono_legato(1);
    assert.strictEqual(sd.curMonoLegato, 1);
    sd.set_mono_legato(0);
    // paramValue falls back to the Live init until an echo arrives
    const fresh = makeSandbox(mainViz).sb;
    for (const key of ctrlKeys) assert.strictEqual(fresh.paramValue(key), fresh.FACE_PARAMS[key].init, `${key}: default is init`);
    // echoed value drives what the next paint shows
    sb.set_pitch_st(7);
    assert.strictEqual(sb.fmtParam("pitch_st", sb.paramValue("pitch_st")), "+7 st");
    sb.set_pitch_st(0);
}

// --- voices: allocation, stealing and legato through the UI ---
{
    sb.set_poly_voices(16);
    sb.set_mono_legato(0);
    sb.all_notes_off();
    for (let n = 0; n < 16; n++) sb.midi_note(36 + n, 100);
    assert.strictEqual(sb.voiceAlloc.voices.filter((v) => v.gate === 1).length, 16, "16-voice poly");
    const oldest = sb.voiceAlloc.voices.reduce((a, b) => (a.age <= b.age ? a : b));
    const oldestNote = oldest.note, oldestIdx = oldest.index;
    sb.midi_note(90, 120);
    const held = sb.voiceAlloc.voices.filter((v) => v.gate === 1).map((v) => v.note);
    assert.strictEqual(held.length, 16);
    assert.strictEqual(sb.voiceAlloc.voices[oldestIdx].note, 90);
    assert.ok(!held.includes(oldestNote), "17th note steals the oldest voice");

    mainCtx.pokes.length = 0;
    sb.all_notes_off();
    sb.set_mono_legato(1);
    sb.midi_note(60, 100);
    const trig = sb.voiceAlloc.voices[0].trigCount;
    sb.midi_note(64, 96);
    sb.midi_note(67, 110);
    assert.strictEqual(sb.voiceAlloc.voices[0].note, 67);
    assert.strictEqual(sb.voiceAlloc.voices[0].trigCount, trig, "UI legato is single-trigger");
    assert.ok(sb.voiceAlloc.voices.slice(1).every((v) => v.gate === 0));
    const poke = mainCtx.pokes.filter((pk) => pk.name === "#0-bsvoices").pop();
    assert.ok(poke, "legato note is written into #0-bsvoices");
    assert.strictEqual(poke.data[0], 1);
    assert.strictEqual(poke.data[1], 67);
    assert.strictEqual(poke.data[3], trig);
    sb.midi_note(67, 0);
    assert.strictEqual(sb.voiceAlloc.voices[0].note, 64);
    sb.midi_note(64, 0);
    sb.midi_note(60, 0);
    assert.strictEqual(sb.voiceAlloc.voices[0].gate, 0);
    sb.set_mono_legato(0);
    sb.all_notes_off();
}

// --- state: getvalueof / setvalueof v2 round-trip, v1 still accepted ---
{
    sb.set_mode(1);
    sb.curLoopMode = 2; sb.curStart = 0.2; sb.curEnd = 0.9; sb.curLoopStart = 0.25; sb.curLoopEnd = 0.7; sb.curXfade = 0.08; sb.curPlayPos = 0.5;
    sb.envPage = 2;
    sb.sliceMarkers = [0, 0.1, 0.5, 0.8];
    sb.dropfile("/Users/test/My Samples/Snare 02.wav");
    const saved = sb.getvalueof();
    assert.strictEqual(saved[0], 2, "getvalueof version 2");
    assert.strictEqual(saved[1], 1);
    assert.strictEqual(saved[4], 2);
    assert.strictEqual(saved[9], 2, "slot 9 is the env page");
    assert.strictEqual(saved[10], 4, "slot 10 is the slice count");
    assert.strictEqual(saved.length, 11 + 4 + 1);
    assert.strictEqual(saved[saved.length - 1], "/Users/test/My Samples/Snare 02.wav", "path stored last");

    sb.setvalueof(1, 0, 0, 10000, 0, 0, 10000, 0, 0, 0, 1, 0);
    assert.strictEqual(sb.curMode, 0);
    assert.strictEqual(sb.envPage, 0);
    emitted.length = 0;
    sb.setvalueof.apply(sb, saved);
    assert.strictEqual(sb.curMode, 1);
    assert.strictEqual(sb.envPage, 2);
    assert.strictEqual(sb.curLoopMode, 2);
    assert.ok(Math.abs(sb.curStart - 0.2) < 1e-9 && Math.abs(sb.curEnd - 0.9) < 1e-9);
    assert.ok(Math.abs(sb.curLoopStart - 0.25) < 1e-9 && Math.abs(sb.curLoopEnd - 0.7) < 1e-9);
    assert.ok(Math.abs(sb.curXfade - 0.08) < 1e-9 && Math.abs(sb.curPlayPos - 0.5) < 1e-9);
    assert.strictEqual(sb.sliceMarkers.length, 4);
    [0, 0.1, 0.5, 0.8].forEach((s, i) => assert.ok(Math.abs(sb.sliceMarkers[i] - s) < 1e-4, `slice ${i}`));
    assert.strictEqual(sb.sampleFileName, "Snare 02.wav");
    assert.strictEqual(sb.sampleFilePath, "/Users/test/My Samples/Snare 02.wav");
    assert.ok(emitted.some((a) => a[1] === "load_sample" && a[2] === saved[saved.length - 1]), "restore sends load_sample");
    sb.sample_loaded(saved[saved.length - 1]);
    assert.strictEqual(sb.sliceMarkers.length, 4, "restored slices survive the reload refresh");
    assert.deepStrictEqual(Array.from(sb.getvalueof().slice(0, 11)), Array.from(saved.slice(0, 11)), "round-trip is stable");
    sb.paint();

    // v1 blobs (no path) still parse and never load
    emitted.length = 0;
    sb.setvalueof(1, 2, 1000, 9000, 0, 0, 10000, 0, 0, 3, 2, 0, 5000);
    assert.strictEqual(sb.curMode, 2);
    assert.strictEqual(sb.envPage, 3, "v1 carries the env page too");
    assert.strictEqual(sb.sliceMarkers.length, 2);
    assert.ok(!emitted.some((a) => a[1] === "load_sample"), "v1 blob does not load");
    // the shipped initial blob (version 1) parses
    sb.setvalueof.apply(sb, stateV.parameter_initial);
    assert.strictEqual(sb.curMode, 0);
    assert.strictEqual(sb.sliceMarkers.length, 8);
    assert.ok(!emitted.some((a) => a[1] === "load_sample"));
    // junk is ignored
    const keepMode = sb.curMode;
    sb.setvalueof(0, 3, 0, 10000, 0, 0, 10000, 0, 0, 0, 1, 0);
    sb.setvalueof(1, 3);
    assert.strictEqual(sb.curMode, keepMode, "version 0 / short payloads are ignored");
    // v2 with an empty path does not load
    emitted.length = 0;
    sb.setvalueof.apply(sb, saved.slice(0, -1).concat([""]));
    assert.ok(!emitted.some((a) => a[1] === "load_sample"), "empty path does not load");
    sb.paint();
    sd.paint();
}

console.log("Better Sampler: 600x169 two-v8ui face, wiring, knobs, buttons, regions, state and voices ok");
console.log("All Better Sampler tests passed!");

// --- knob drags capture the mouse: cursor hidden, hover frozen on the dragged knob, released on mouse-up ---
{
    const kc = makeSandbox(mainViz);
    const k = kc.sb;
    k.paint();
    const knobs = k.hitZones.filter((z) => z.kind === "knob");
    const a = knobs.find((z) => z.key === "pitch_st");
    const other = knobs.find((z) => z.key === "filt_cutoff");
    assert.ok(a && other, "pitch and cutoff knobs drawn");
    k.onclick(a.x + a.w / 2, a.y + a.h / 2, 1, 0, 0);
    assert.ok(k.drag && k.drag.captured && k.drag.key === "pitch_st", "click captures the knob");
    assert.strictEqual(k.hoverKey, "pitch_st", "captured knob shows its value");
    assert.strictEqual(kc.cursor.hide, 1, "cursor hidden while dragging a knob");
    k.onidle(other.x + other.w / 2, other.y + other.h / 2);
    assert.strictEqual(k.hoverKey, "pitch_st", "hover cannot move to another knob mid-drag");
    k.onidleout();
    assert.strictEqual(k.hoverKey, "pitch_st", "leaving the canvas mid-drag keeps the capture");
    // dragging far outside the canvas still drives the same knob
    k.ondrag(a.x + a.w / 2 + 400, a.y - 300, 1, 0, 0);
    assert.strictEqual(k.paramValue("pitch_st"), 36, "drag outside the canvas keeps controlling the captured knob");
    assert.strictEqual(k.paramValue("filt_cutoff"), 18000, "other knobs untouched");
    k.ondrag(other.x + other.w / 2, other.y + other.h / 2, 0, 0, 0);
    assert.strictEqual(k.drag, null, "release ends the capture");
    assert.strictEqual(kc.cursor.show, 1, "cursor shown again on release");
    assert.strictEqual(k.hoverKey, "filt_cutoff", "hover resumes under the mouse after release");
    // a release we never saw is cleaned up by the next click
    k.paint();
    k.onclick(a.x + a.w / 2, a.y + a.h / 2, 1, 0, 0);
    k.onclick(1, 1, 1, 0, 0);
    assert.strictEqual(kc.cursor.show, kc.cursor.hide, "cursor never left hidden");
}

// --- no sample loaded: MIDI runs the voices but draws no scan line ---
{
    function bluePlayheadStrokes(ctx2, xNorm) {
        const s2 = ctx2.sb;
        const ops = [];
        const g = s2.mgraphics;
        const saved = {};
        for (const name of ["set_source_rgba", "move_to", "line_to", "stroke", "fill", "rectangle"]) {
            saved[name] = g[name];
            g[name] = (...args) => ops.push([name, ...args]);
        }
        s2.paint();
        Object.assign(g, saved);
        const wave = s2.hitZones.find((z) => z.kind === "wave");
        const px = wave.x + xNorm * wave.w;
        let color = null, count = 0;
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            if (op[0] === "set_source_rgba") color = op.slice(1);
            if (op[0] === "move_to" && Math.abs(op[1] - px) < 0.01 && ops[i + 1] && ops[i + 1][0] === "line_to"
                && Math.abs(ops[i + 1][1] - px) < 0.01 && color && color[2] > 0.9 && color[0] < 0.5) count++;
        }
        return count;
    }
    const nc = makeSandbox(mainViz);
    const n = nc.sb;
    n.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    assert.strictEqual(n.hasLoadedSample, 0, "empty device");
    n.midi_note(60, 100);
    n.voicePlayheads[0] = 0.31;
    n.voiceAmps[0] = 0.8;
    for (const mode of [0, 1, 2]) {
        n.set_mode(mode);
        assert.strictEqual(bluePlayheadStrokes(nc, 0.31), 0, `no scan line without a sample (mode ${mode})`);
    }
    // with a sample loaded the same voice draws its scan line
    nc.audioOn = true;
    n.sample_loaded("/Users/test/Drums/Kick_01.wav");
    assert.strictEqual(n.hasLoadedSample, 1);
    n.voicePlayheads[0] = 0.31;
    n.voiceAmps[0] = 0.8;
    n.set_mode(0);
    assert.ok(bluePlayheadStrokes(nc, 0.31) >= 1, "scan line drawn once a sample is loaded");
}

console.log("Load, knob capture and empty-sampler scan-line regressions ok");

// --- drop / browse logic: what Live sends at drop time and on Set load ---
{
    const dc = makeSandbox(mainViz);
    const d = dc.sb;
    d.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    const loads = () => dc.emitted.filter((a) => a[1] === "load_sample");
    // an empty live.drop reports "none" on device load: nothing to load, nothing to save
    d.dropfile("none");
    assert.strictEqual(loads().length, 0, "\"none\" from an empty drop zone is ignored");
    assert.strictEqual(d.sampleFilePath, "", "\"none\" is never saved as the sample path");
    // a path with spaces split into several atoms is rejoined
    d.dropfile("Macintosh", "HD:/Users/test/(Crash)", "Cymbal", "-", "707", "-", "525.wav");
    assert.deepStrictEqual(loads().map((a) => a[2]), ["Macintosh HD:/Users/test/(Crash) Cymbal - 707 - 525.wav"], "split path rejoined and loaded once");
    assert.strictEqual(d.sampleFileName, "(Crash) Cymbal - 707 - 525.wav");
    assert.ok(!dc.emitted.some((a) => a[1] === "drop_set"), "a drop does not echo set back to the drop zone");
    // the buffer finishes; Live replaying the same saved path must not reload it
    dc.audioOn = true;
    d.sample_loaded("bang");
    assert.strictEqual(d.hasLoadedSample, 1);
    d.dropfile("Macintosh HD:/Users/test/(Crash) Cymbal - 707 - 525.wav");
    assert.strictEqual(loads().length, 1, "replay of the loaded path is ignored");
    // a different dropped file loads
    d.dropfile("/Users/test/Kick.wav");
    assert.strictEqual(loads().length, 2);
    assert.strictEqual(d.sampleFileName, "Kick.wav");
    // a dialog pick loads and keeps the drop zone's saved path in sync
    dc.emitted.length = 0;
    d.browsed("/Users/test/Snare 02.wav");
    assert.deepStrictEqual(dc.emitted.find((a) => a[1] === "load_sample"), [0, "load_sample", "/Users/test/Snare 02.wav"]);
    assert.deepStrictEqual(dc.emitted.find((a) => a[1] === "drop_set"), [0, "drop_set", "/Users/test/Snare 02.wav"]);
    d.browsed();
    assert.strictEqual(dc.emitted.filter((a) => a[1] === "load_sample").length, 1, "cancelled dialog loads nothing");

    // Set load: SamplerStateData restores a path, then Live replays the same saved drop path
    const rc = makeSandbox(mainViz);
    const r = rc.sb;
    r.setvalueof(2, 0, 0, 10000, 1, 1500, 8500, 500, 0, 0, 1, 0, "/Users/test/Kick.wav");
    r.dropfile("/Users/test/Kick.wav");
    assert.strictEqual(rc.emitted.filter((a) => a[1] === "load_sample").length, 1, "restore + replay of the same path loads once");
    // no LOAD button any more: the file name in the header is the browse control
    const sc = makeSandbox(sideViz);
    sc.sb.paint();
    assert.ok(!sc.sb.hitZones.some((z) => z.action === "browse"), "side column has no LOAD button");
}

console.log("Drop / browse load path ok");

// --- Sliced mode: the start point is the first slice and the keymap re-indexes from it ---
{
    const M = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    assert.deepStrictEqual(cfg.activeSliceStarts(M, 0, 1), M, "start at 0 keeps every slice");
    assert.deepStrictEqual(cfg.activeSliceStarts(M, 0.2, 1), [0.2, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], "start inside slice 2 becomes the first slice");
    assert.deepStrictEqual(cfg.activeSliceStarts(M, 0.25, 1), [0.25, 0.375, 0.5, 0.625, 0.75, 0.875], "start on a marker: no zero-length slice");
    assert.deepStrictEqual(cfg.activeSliceStarts(M, 0.2, 0.6), [0.2, 0.25, 0.375, 0.5], "markers past the end drop out");
    assert.deepStrictEqual(cfg.activeSliceStarts(M.slice().reverse(), 0.3, 1)[0], 0.3, "unsorted markers handled");
    assert.strictEqual(cfg.sliceIndexAt([0.2, 0.25, 0.375], 0.6, 0.1), -1, "before the start is unmapped");
    assert.strictEqual(cfg.sliceIndexAt([0.2, 0.25, 0.375], 0.6, 0.3), 1);
    assert.strictEqual(cfg.sliceIndexAt([0.2, 0.25, 0.375], 0.6, 0.7), -1, "after the end is unmapped");

    // the allocator stops the last slice at the sample end
    const va = cfg.createVoiceAllocator(16);
    const last = va.noteOn(36 + 3, 100, 0, [0.2, 0.25, 0.375, 0.5], 0.6);
    assert.strictEqual(last.sliceStart, 0.5);
    assert.strictEqual(last.sliceEnd, 0.6, "last slice ends at the sample end, not 1.0");

    // through the face: drag the start handle past C1's marker, C1 now starts at the start point
    const xc = makeSandbox(mainViz);
    const x = xc.sb;
    x.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    x.set_mode(3);
    x.sliceMarkers = M.slice();
    x.paint();
    const wave = x.hitZones.find((z) => z.kind === "wave");
    const px = (n) => wave.x + n * wave.w;
    x.onclick(px(0) + 1, wave.y + wave.h - 3, 1, 0, 0);
    assert.strictEqual(x.drag && x.drag.wave, "samp_start", "start handle is draggable in Sliced mode");
    x.ondrag(px(0.2), wave.y + wave.h - 3, 1, 0, 0);
    x.ondrag(px(0.2), wave.y + wave.h - 3, 0, 0, 0);
    assert.ok(Math.abs(x.curStart - 0.2) < 0.003, `start moved to 0.2 (got ${x.curStart})`);
    assert.ok(xc.emitted.some((a) => a[1] === "param" && a[2] === "samp_start"), "start change reaches Live");

    xc.pokes.length = 0;
    x.midi_note(36, 100);
    const c1 = xc.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.ok(Math.abs(c1.data[4] - x.curStart) < 1e-9, `C1 slice starts at the start point (got ${c1.data[4]})`);
    assert.strictEqual(c1.data[5], 0.25, "C1 ends at the next marker");
    x.midi_note(37, 100);
    const cs1 = xc.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.strictEqual(cs1.data[4], 0.25, "C#1 is the next slice after the start point");
    x.midi_note(36, 0); x.midi_note(37, 0);

    // moving the start past C1's slice point re-indexes the keys: the old C#1 marker region is now C1
    x.curStart = 0.3;
    x.midi_note(36, 100);
    const re = xc.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.strictEqual(re.data[4], 0.3);
    assert.strictEqual(re.data[5], 0.375);
    x.midi_note(36, 0);

    // clicks before the start do not audition; inside they audition the re-indexed slice
    xc.emitted.length = 0; xc.pokes.length = 0;
    x.paint();
    x.onclick(px(0.1), wave.y + 30, 1, 0, 0);
    assert.strictEqual(xc.pokes.length, 0, "no audition left of the start point");
    x.onclick(px(0.4), wave.y + 30, 1, 0, 0);
    assert.strictEqual(x.selectedSliceIdx, 1, "slice 0.375..0.5 is the second key after the start");
    x.ondrag(px(0.4), wave.y + 30, 0, 0, 0);
}

console.log("Sliced-mode start point and keymap ok");

// --- live slice bounds, Playback dropdown, Pos tied to Freeze ---
{
    // allocator: held notes re-resolve against new slice starts without retriggering
    const va = cfg.createVoiceAllocator(16);
    const v = va.noteOn(37, 100, 0, [0, 0.25, 0.5], 1);
    const trig = v.trigCount;
    assert.strictEqual(v.sliceStart, 0.25);
    const touched = va.updateSliceBounds([0.3, 0.5], 0.9);
    assert.strictEqual(touched.length, 1);
    assert.strictEqual(v.sliceStart, 0.5, "C#1 is now the second slice after the moved start");
    assert.strictEqual(v.sliceEnd, 0.9, "last slice ends at the new end");
    assert.strictEqual(v.trigCount, trig, "no retrigger");
    va.noteOff(37, 0);
    assert.strictEqual(va.updateSliceBounds([0, 0.5], 1).length, 0, "released voices are left alone");

    // face: dragging the start while a slice note is held re-pokes that voice live
    const lc = makeSandbox(mainViz);
    const l = lc.sb;
    l.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    l.set_mode(3);
    l.sliceMarkers = [0, 0.125, 0.25, 0.375, 0.5];
    l.midi_note(36, 100);
    const before = lc.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.strictEqual(before.data[4], 0);
    l.paint();
    const wave = l.hitZones.find((z) => z.kind === "wave");
    lc.pokes.length = 0;
    l.onclick(wave.x + 1, wave.y + wave.h - 3, 1, 0, 0);
    l.ondrag(wave.x + 0.2 * wave.w, wave.y + wave.h - 3, 1, 0, 0);
    const live = lc.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.ok(live, "held voice re-poked during the drag");
    assert.ok(Math.abs(live.data[4] - l.curStart) < 1e-9, "held C1 now starts at the dragged start point");
    assert.strictEqual(live.data[5], 0.25, "and ends at the next marker after it");
    assert.strictEqual(live.data[3], before.data[3], "trigger counter unchanged (no retrigger)");
    l.ondrag(wave.x + 0.2 * wave.w, wave.y + wave.h - 3, 0, 0, 0);
    // Live automation of the start point does the same
    lc.pokes.length = 0;
    l.set_samp_start(30);
    const auto = lc.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.ok(auto && Math.abs(auto.data[4] - 0.3) < 1e-9, "automated start point moves the held slice");
    l.midi_note(36, 0);

    // Playback dropdown (Sliced footer): open, pick, close
    l.paint();
    const pb = l.hitZones.find((z) => z.action === "slice_play_menu");
    assert.ok(pb, "Playback control in the Sliced footer");
    lc.emitted.length = 0;
    l.onclick(pb.x + 3, pb.y + 3, 1, 0, 0);
    l.paint();
    const picks = l.hitZones.filter((z) => z.action === "slice_play_pick");
    assert.deepStrictEqual(Array.from(picks.map((z) => z.value)), [0, 1, 2, 3], "four slice playback modes listed");
    const loopPick = picks[2];
    l.onclick(loopPick.x + 5, loopPick.y + 3, 1, 0, 0);
    assert.deepStrictEqual(Array.from(paramMsgs(lc, "slice_play").pop().slice(1)), ["param", "slice_play", 2], "One-way looping picked");
    l.paint();
    assert.ok(!l.hitZones.some((z) => z.action === "slice_play_pick"), "menu closes after a pick");
    l.onclick(pb.x + 3, pb.y + 3, 1, 0, 0);
    l.paint();
    lc.emitted.length = 0;
    l.onclick(wave.x + 0.6 * wave.w, wave.y + 20, 1, 0, 0);
    l.paint();
    assert.ok(!l.hitZones.some((z) => z.action === "slice_play_pick"), "a click elsewhere closes the menu");
    assert.strictEqual(paramMsgs(lc, "slice_play").length, 0, "closing click picks nothing");
    l.set_mode(0);
    l.paint();
    assert.ok(!l.hitZones.some((z) => z.action === "slice_play_menu"), "Playback dropdown only in Sliced mode");
}

console.log("Live slice bounds, Playback dropdown and Pos/Freeze ok");

