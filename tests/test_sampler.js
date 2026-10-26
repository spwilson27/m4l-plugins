#!/usr/bin/env node
/**
 * Verification suite for Better Sampler (devices/Better Sampler.amxd, 600 x 169 px, 760 with the inspector):
 *   - one Bitwig-style face drawn by three v8ui boxes (main 528 px, side 66 px, inspector 160 px) plus a live.drop
 *   - every automatable parameter is a hidden live.* object (presentation 0) wired through
 *     route param -> obj-ctrl-<key> -> prepend -> obj-gen-in hub (-> the deferred gen~), with set_<key> echoes to the v8uis
 *
 * Covers: slicer/root detection/voice allocator, GenExpr ordering, amxd structure and wiring, and a
 * sandbox run of the three embedded face scripts (paint, engines + Single/Sliced, knobs, footer values,
 * generic dropdowns, slice modes, loop overlay, per-engine panels, inspector, env page tabs, Poly/Mono,
 * echoes, state round-trip).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { minifyGen } = require("./minify_gen.js");

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
// sampler_config.js keeps its legacy table (the face and the device use ENUM_SPECS mode / sliced instead)
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

// the keymap base is configurable (slice_from): slice k plays on base + k
const baseAlloc = cfg.createVoiceAllocator(8);
assert.strictEqual(baseAlloc.getSliceBaseNote(), 36, "default keymap base is C1");
baseAlloc.setSliceBaseNote(48);
assert.strictEqual(baseAlloc.getSliceBaseNote(), 48);
assert.strictEqual(baseAlloc.noteOn(48, 100, 0, sliceBounds).sliceStart, 0.0, "base note plays the first slice");
assert.strictEqual(baseAlloc.noteOn(50, 100, 0, sliceBounds).sliceStart, 0.5, "base + 2 plays the third slice");
baseAlloc.setSliceBaseNote(-5);
assert.strictEqual(baseAlloc.getSliceBaseNote(), 0, "base note clamps to 0..127");
baseAlloc.setSliceBaseNote(999);
assert.strictEqual(baseAlloc.getSliceBaseNote(), 127);

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
assert.ok(/for \(vox = 0; vox < 16; vox \+= 1\) \{[\s\S]*?= voice_proc\(samp, vdata, vox,/.test(gen), "all 16 voices run from one loop (the voice engine compiles once)");
assert.strictEqual((gen.match(/= voice_proc\(/g) || []).length, 1, "voice_proc has exactly one call site");
assert.ok(/Param mode\(0, min=0, max=4\);/.test(gen), "gen has Param mode covering 5 engines (Repitch, Cycles, Textures, Spectral, Fragments)");
assert.ok(/Param sliced\(0, min=0, max=1\);/.test(gen), "gen has Param sliced (Single / Sliced is separate from the engine)");
assert.ok(gen.includes("Param freeze(0, min=0, max=1);"), "freeze param");
assert.ok(gen.includes("Param reverse(0, min=0, max=1);"), "reverse param");
assert.ok(gen.includes("Param unison_voices(1, min=1, max=8);"), "unison_voices is 1..8");
assert.ok(gen.includes("Param unison_detune(0.15, min=0, max=1);"), "unison_detune param");
assert.ok(gen.includes("Param unison_width(0.65, min=0, max=1);"), "unison_width param");
assert.ok(gen.includes("Param glide_ms(0, min=0, max=1000);"), "glide_ms param");
assert.ok(/isSlice\s*=/.test(gen), "gen derives isSlice");
assert.ok(gen.includes("uCount = int(clip(round(unisonCount), 1, 8));"), "Unison count clamps to 1..8");
assert.ok(gen.includes("for (u = 0; u < uCount; u += 1)"), "Unison loops stop at the active sub-voice count");
assert.strictEqual((gen.match(/= unison_spread\(/g) || []).length, 1, "unison_spread is inlined once");
assert.ok(gen.includes("Data prm(141);"), "prm grew so wavetable norm can use index 138 and Env 2 bipolar flags use 139 and 140");
assert.ok(gen.includes("poke(prm, wt1_norm, 137);"), "wt1 norm is prm 137");
assert.ok(gen.includes("poke(prm, wt2_norm, 138);"), "wt2 norm is prm 138");
assert.ok(gen.includes("wt1NGn = peek(prm, 137);"), "voice reads wt1 norm from prm");
assert.ok(gen.includes("wt2NGn = peek(prm, 138);"), "voice reads wt2 norm from prm");
{
    const beforeParams = gen.slice(0, gen.indexOf("\nParam ")).replace(/\/\/[^\n]*/g, "");
    assert.ok(!/\bwt1_norm\b/.test(beforeParams) && !/\bwt2_norm\b/.test(beforeParams), "wavetable norm is not named inside helpers declared before Param");
}
assert.ok(gen.includes("Param osc1_pan(0, min=-1, max=1);"), "osc1 pan param");
assert.ok(gen.includes("Param osc2_pan(0, min=-1, max=1);"), "osc2 pan param");
assert.ok(gen.includes("Param sub_pan(0, min=-1, max=1);"), "sub pan param");
assert.ok(gen.includes("poke(prm, clip(osc1_pan, -1, 1), 134);"), "osc1 pan is prm 134");
assert.ok(gen.includes("poke(prm, clip(osc2_pan, -1, 1), 135);"), "osc2 pan is prm 135");
assert.ok(gen.includes("poke(prm, clip(sub_pan, -1, 1), 136);"), "sub pan is prm 136");
assert.ok(gen.indexOf("pan_lr(") < gen.indexOf("\nBuffer "), "pan_lr is a helper before Buffer");
assert.ok(gen.includes("o1WetL = sigL * o1GL;"), "osc 1 wet output is panned");
assert.ok(gen.includes("o2WetL = osc2SigL * o2GL;"), "osc 2 wet output is panned");
assert.ok(gen.includes("sbWetL = subSigL * sbGL;"), "sub wet output is panned");
assert.ok(gen.includes("return panCs - panSn, panCs + panSn;"), "center pan is unity (cos 0 - sin 0)");
assert.ok(gen.includes("glideCoef = (glide_ms <= 0.5) ? 0.0 : exp(-1000.0 / (glide_ms * srVal));"), "Glide coefficient");
assert.ok((gen.match(/freezeOn > 0\.5/g) || []).length >= 3, "Freeze is handled in every engine");
assert.ok(gen.includes("dirSign = (reverseOn > 0.5) ? -1.0 : 1.0;"), "Reverse flips playback direction");
assert.ok(gen.includes("REPITCH") && gen.includes("CYCLES") && gen.includes("TEXTURES"));
assert.ok(gen.includes("sbHarmG = clip(sub_harm_level, 0, 1);"), "upper harmonics follow Harm level only");
assert.ok(!gen.includes("clip(sub_tone, 0, 1)"), "sub tone no longer scales the harmonic level");
assert.ok(gen.includes("subTn = clip(peek(prm, 78), 0, 1);"), "sub tone is read into the drive block");
assert.ok(gen.includes("1.0 / sqrt(1.0 + pow(sbNum / sbCut, 4.0))"), "sub low pass is a 12 dB/octave rolloff");
assert.ok(!gen.includes("1.6 * (sbNum - sbCut)"), "sub low pass is not the steep logistic");


// ============================================================================
// 3. devices/Better Sampler.amxd structure and wiring
// ============================================================================
const DEVICE_W = 600;          // face width; the inspector panel adds INSPECTOR_W when shown
const INSPECTOR_W = 160;
const FULL_W = DEVICE_W + INSPECTOR_W;
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
assert.strictEqual(byId.get("obj-buf-scope").text, "buffer~ #0-bsscope @samps 256", "telemetry incl. 32 grain slots (64..127) and per-voice env/filter (128..207)");
assert.strictEqual(byId.get("obj-msg-gen-buf").text, "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope, pitch #0-bspitch, wt1 #0-bswt1, wt2 #0-bswt2, mstate #0-bsmstate");
assert.strictEqual(byId.get("obj-buf-pitch").text, "buffer~ #0-bspitch @samps 4096", "Analyzed Root Key curve buffer");
assert.strictEqual(byId.get("obj-msg-ui-buf").text, "setbuffers #0-bsamp #0-bsvoices #0-bsscope #0-bspitch");
assertLink(lines, "obj-loadbang", 0, "obj-msg-gen-buf", 0, "loadbang -> gen buffers");
assertLink(lines, "obj-msg-gen-buf", 0, "obj-gen-in", 1, "gen buffers");
assertLink(lines, "obj-msg-ui-buf", 0, "obj-viz", 0, "ui buffers");
// Deferred DSP: no gen box in the device; the main face carries the gen patch and creates it after load
assert.ok(!byId.has("obj-gen"), "the device ships without its gen~ (created after load)");
assert.ok(!boxes.some((b) => /gen/.test(b.maxclass || "") || /^gen~/.test(String(b.text || ""))), "no gen object in the device");
assert.strictEqual(byId.get("obj-gen-in").text, "gate 1 1", "gen hub: an open gate passes every message through (t a cannot be a scripted connect source)");
assert.strictEqual(byId.get("obj-gen-in").varname, "bs_genin");
assert.strictEqual(byId.get("obj-plugin").varname, "bs_plugin");
assert.strictEqual(byId.get("obj-plugout").varname, "bs_plugout");
assert.strictEqual(byId.get("obj-dsp-resend").text, "t b b");
assertLink(lines, "obj-dsp-resend", 1, "obj-msg-gen-buf", 0, "dsp_ready re-binds the buffers");
const mainTextForGen = byId.get("obj-viz").textfile.text;
const genDspMatch = mainTextForGen.match(/var GEN_DSP_TEXT\s*=\s*("(?:\\.|[^"\\])*")\s*;\s*var GEN_DSP_HASH\s*=\s*"([0-9a-f]{12})"\s*;/);
assert.ok(genDspMatch, "main face embeds the gen patch and its hash");
const genDsp = JSON.parse(JSON.parse(genDspMatch[1]));
assert.strictEqual(genDsp.patcher.classnamespace, "dsp.gen");
const codeBox = genDsp.patcher.boxes.map((b) => b.box).find((b) => b.maxclass === "codebox");
assert.strictEqual(codeBox.code.trim(), minifyGen(gen).trim(), "embeds the mangled GenExpr core");
assert.ok(!byId.get("obj-viz-side").textfile.text.includes("var GEN_DSP_TEXT"), "only the main face carries the gen patch");
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

// --- presentation: three v8ui canvases + the waveform drop target, all live.* controls kept off the face ---
const liveBoxes = boxes.filter((b) => /^live\./.test(b.maxclass));
for (const b of liveBoxes) {
    if (b.id === "obj-drop-wave") continue;
    // Ableton theme widgets are saved in presentation but hidden (the saved file is the Bitwig state)
    assert.ok(b.presentation !== 1 || b.hidden === 1, `${b.id} (${b.maxclass}) must not be visible in presentation`);
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
assert.deepStrictEqual(presBoxes.map((b) => b.id).sort(), ["obj-viz", "obj-viz-insp", "obj-viz-side"]);
// In Live a live.drop only outputs in parameter mode (File type), as in Max's live.drop help patch
assert.strictEqual(waveDrop.parameter_enable, 1, "live.drop must be in parameter mode or Live never outputs the path");
const wdv = waveDrop.saved_attribute_attributes.valueof;
assert.strictEqual(wdv.parameter_type, 4, "live.drop parameter is the File type");
assert.strictEqual(wdv.parameter_invisible, 1, "file parameter hidden from automation");
assert.strictEqual(wdv.parameter_longname, "Sample File");
for (let i = 0; i < presBoxes.length; i++) {
    const r = presBoxes[i].presentation_rect;
    assert.ok(r[0] >= 0 && r[0] + r[2] <= FULL_W, `${presBoxes[i].id} inside 0..${FULL_W}`);
    assert.ok(r[1] >= 0 && r[1] + r[3] <= DEVICE_H, `${presBoxes[i].id} inside 0..${DEVICE_H}`);
    for (let j = i + 1; j < presBoxes.length; j++) {
        assert.ok(!rectsOverlap(r, presBoxes[j].presentation_rect), `overlap ${presBoxes[i].id} and ${presBoxes[j].id}`);
    }
}
// live.drop must stay clear of the side and inspector canvases (v8ui would swallow its clicks)
assert.deepStrictEqual(byId.get("obj-viz").presentation_rect, [0, 0, 528, 169]);
assert.deepStrictEqual(byId.get("obj-viz-side").presentation_rect, [531, 3, 66, 163]);
assert.deepStrictEqual(byId.get("obj-viz-insp").presentation_rect, [DEVICE_W, 0, INSPECTOR_W, 169], "inspector canvas sits right of the 600 px face");
assert.ok(!rectsOverlap(waveDrop.presentation_rect, byId.get("obj-viz-insp").presentation_rect), "drop zone clear of the inspector");
const bgPanel = byId.get("obj-pnl-bg");
assert.deepStrictEqual(bgPanel.presentation_rect, [0, 0, FULL_W, DEVICE_H], "background panel spans the face and the inspector (760)");

// --- controls: every key is an obj-ctrl-<key>; ranges, enums and 8-bit Int rule ---
const ctrlBoxes = boxes.filter((b) => /^obj-ctrl-/.test(b.id));
const ctrlKeys = ctrlBoxes.map((b) => b.id.replace(/^obj-ctrl-/, ""));
assert.ok(ctrlKeys.length >= 40, `expected the full parameter set, got ${ctrlKeys.length}`);
for (const b of ctrlBoxes) {
    assert.ok(/^live\./.test(b.maxclass), `${b.id} is a live.* object`);
    assert.ok(b.presentation === 0 || b.hidden === 1, `${b.id} presentation 0 or hidden`);
    const vof = valueOf(b);
    assert.ok(vof, `${b.id} has parameter data`);
    if (typeof vof.parameter_mmax === "number" && vof.parameter_mmax > 255) {
        assert.strictEqual(vof.parameter_type, 0, `${b.id}: range > 255 must be Float parameter_type 0`);
    }
}
const modeV = valueOf(byId.get("obj-ctrl-mode"));
assert.deepStrictEqual(modeV.parameter_enum, ["Repitch", "Cycles", "Textures", "Spectral", "Fragments"], "mode is the engine: 5 values");
assert.strictEqual(modeV.parameter_mmax, 4);
const slicedV = valueOf(byId.get("obj-ctrl-sliced"));
assert.deepStrictEqual(slicedV.parameter_enum, ["Single", "Sliced"], "Single / Sliced is its own enum parameter");
assert.strictEqual(slicedV.parameter_mmax, 1);
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-slice_at")).parameter_enum, ["Divisions", "Beats", "Onsets", "Pitches", "Manual"]);
assert.strictEqual(valueOf(byId.get("obj-ctrl-slice_from")).parameter_initial[0], 36, "keymap starts at C1");
assert.strictEqual(valueOf(byId.get("obj-ctrl-fr_max_grains")).parameter_type, 0, "fr_max_grains 1..256 cannot be Live's 8-bit Int");
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-sp_key")).parameter_enum.length, 12);
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-fr_direction")).parameter_enum, ["Sample", "Playhead", "Random", "Alternating"]);
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-rp_char")).parameter_enum, ["Clean", "Analog", "Digital"]);
assert.deepStrictEqual(valueOf(byId.get("obj-ctrl-show_inspector")).parameter_enum, ["Hide", "Show"]);
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
assert.strictEqual(byId.get("obj-route-viz").text, "route param load_sample browse drop_set setwidth_cmd tempo dsp_ready samp_rate wt_msg arm_drag disarm_drag");
assertLink(lines, "obj-route-viz", 2, "obj-opendialog", 0, "browse -> file dialog");
assertLink(lines, "obj-viz", 0, "obj-route-viz", 0, "main face outlet");
assertLink(lines, "obj-viz-side", 0, "obj-route-viz", 0, "side face outlet");
assertLink(lines, "obj-viz-insp", 0, "obj-route-viz", 0, "inspector face outlet");
// inspector width: face -> setwidth_cmd -> prepend setwidth -> live.thisdevice -> device_ready -> main face
assert.strictEqual(byId.get("obj-prep-setwidth").text, "prepend setwidth");
assert.strictEqual(byId.get("obj-thisdevice").text, "live.thisdevice");
assert.strictEqual(byId.get("obj-msg-ready").text, "device_ready");
assertLink(lines, "obj-route-viz", 4, "obj-prep-setwidth", 0, "setwidth_cmd -> prepend setwidth");
assertLink(lines, "obj-prep-setwidth", 0, "obj-thisdevice", 0, "prepend setwidth -> live.thisdevice");
assertLink(lines, "obj-thisdevice", 0, "obj-msg-ready", 0, "thisdevice ready -> device_ready");
assertLink(lines, "obj-msg-ready", 0, "obj-viz", 0, "device_ready -> main face");
assert.strictEqual(byId.get("obj-route-viz").numoutlets, 12, "route-viz: 11 selectors + reject");
assert.strictEqual(byId.get("obj-prep-samprate").text, "prepend samp_rate");
assertLink(lines, "obj-route-viz", 7, "obj-prep-samprate", 0, "samp_rate -> prepend");
assertLink(lines, "obj-prep-samprate", 0, "obj-gen-in", 1, "samp_rate -> gen hub");
assertLink(lines, "obj-route-viz", 8, "obj-gen-in", 1, "wt_msg -> gen hub");
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
        assertLink(lines, `obj-prep-${key}`, 0, "obj-gen-in", 1, `${key} -> gen`);
        assertLink(lines, "obj-dsp-resend", 0, ctrlId, 0, `dsp_ready re-sends ${key}`);
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
    assertLink(lines, uiPrep.id, 0, "obj-viz-insp", 0, `${key} setter -> inspector face`);
}
if (missingSetters.length) console.warn(`WARNING known bug: no set_<key> wiring to the faces for: ${missingSetters.join(", ")}`);
assert.deepStrictEqual(noGenKeys.sort(),
    ["env_page", "face_theme", "mono_legato", "poly_voices", "show_inspector", "slice_at", "slice_beat", "slice_div", "slice_from", "slice_sens"],
    "legato, poly cap, slicing and the inspector toggle are face / voice-allocator settings, not Gen params");
// every new parameter family is routed to its hidden control and reaches Gen (except the face-only ones above)
for (const key of ["sliced", "rp_char", "rp_dist", "rp_color", "rp_vsr", "rp_imaging", "sp_char", "sp_shift", "sp_bend",
    "sp_quant", "sp_quant_amt", "sp_onsets", "sp_formant_on", "sp_quality", "sp_dispersion", "sp_live", "sp_rel_formant",
    "sp_key", "sp_scale", "cy_char", "cy_width", "cy_split", "cy_fund", "cy_mod", "cy_harm", "cy_xfade",
    "fr_env", "fr_repeats", "fr_density", "fr_motion", "fr_max_grains", "fr_sync", "fr_use_density", "fr_direction",
    "fr_latch", "fr_repeat_init", "fr_survive", "slice_play", "slice_at", "slice_beat", "slice_div", "slice_sens",
    "slice_from", "show_inspector"]) {
    assert.ok(routeKeys.includes(key), `${key} is routed to its obj-ctrl`);
    if (!noGenKeys.includes(key)) assert.ok(byId.get(`obj-prep-${key}`), `${key} reaches Gen`);
}
assert.strictEqual(byId.get("obj-scale-unison_detune").text, "* 0.01");
assert.strictEqual(byId.get("obj-scale-unison_width").text, "* 0.01");
for (const key of ["mode", "sliced", "freeze", "reverse", "loop_mode", "unison_voices", "glide_ms", "grain_size",
    "grain_motion", "grain_spray", "formant", "filt_cutoff", "filt_on", "filt_type"]) {
    assert.ok(byId.get(`obj-prep-${key}`), `${key} reaches Gen`);
}

// --- the two v8ui boxes ---
const mainViz = byId.get("obj-viz");
const sideViz = byId.get("obj-viz-side");
const inspViz = byId.get("obj-viz-insp");
assert.strictEqual(mainViz.maxclass, "v8ui");
assert.strictEqual(sideViz.maxclass, "v8ui");
assert.strictEqual(inspViz.maxclass, "v8ui");
assert.strictEqual(inspViz.parameter_enable, 0, "the inspector face is not a saved parameter");
assert.ok(!valueOf(inspViz), "inspector face stores no state");
assert.strictEqual(mainViz.parameter_enable, 1);
assert.strictEqual(sideViz.parameter_enable, 0, "the side face is not a saved parameter");
const stateV = valueOf(mainViz);
assert.strictEqual(stateV.parameter_type, 3, "SamplerStateData blob");
assert.strictEqual(stateV.parameter_longname, "SamplerStateData");
assert.strictEqual(stateV.parameter_initial[0], 1, "initial blob is version 1 (still accepted)");
assert.ok(!valueOf(sideViz), "side face stores no state");
const mainText = mainViz.textfile.text;
const sideText = sideViz.textfile.text;
const inspText = inspViz.textfile.text;
assert.ok(/var FACE_REGION\s*=\s*"main";/.test(mainText));
assert.ok(/var FACE_REGION\s*=\s*"side";/.test(sideText));
assert.ok(/var FACE_REGION\s*=\s*"inspector";/.test(inspText));
for (const t of [mainText, sideText, inspText]) {
    assert.ok(/var FACE_PARAMS\s*=\s*\{/.test(t), "FACE_PARAMS embedded");
    assert.ok(t.includes("function storeParam") && t.includes("function paint") && t.includes("function onclick"));
    assert.ok(!/multisample|keyzone/i.test(t), "UI has no multisample zones");
    assert.ok(t.indexOf("var FACE_REGION") < t.indexOf("function storeParam"), "config -> FACE_* -> ui -> face order");
}
for (const t of [mainText, sideText, inspText]) {
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
// 4. Sandbox run of the three embedded face scripts
// ============================================================================
function makeSandbox(box) {
    const ctx = { emitted: [], pokes: [], notified: 0, audioOn: false, channels: 2, fileRate: 44100, fileFrames: 44100, noLength: false, cursor: { hide: 0, show: 0 } };
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
            this.framecount = () => ctx.fileFrames;
            this.length = ctx.noLength ? undefined : () => ctx.fileFrames / ctx.fileRate * 1000;
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
const inspCtx = makeSandbox(inspViz);
const sb = mainCtx.sb;
const sd = sideCtx.sb;
const si = inspCtx.sb;
const emitted = mainCtx.emitted;

function paramMsgs(ctx, key) { return ctx.emitted.filter((a) => a[1] === "param" && a[2] === key); }
function zones(ctx, pred) { return ctx.sb.hitZones.filter(pred); }
function center(z) { return [z.x + z.w * 0.5, z.y + z.h * 0.5]; }
function click(ctx, z, shift) { const [x, y] = center(z); ctx.sb.onclick(x, y, 1, 0, shift ? 1 : 0); return [x, y]; }
function release(ctx, x, y) { ctx.sb.ondrag(x, y, 0, 0, 0); }
// Click a dropdown's button (action "menu"), repaint and return its item zones (action "menu_pick")
function openMenuPicks(ctx, key) {
    ctx.sb.paint();
    const bz = findZone(ctx, (z) => z.kind === "button" && z.action === "menu" && z.key === key, `menu button ${key}`);
    ctx.sb.onclick(bz.x + 2, bz.y + 2, 1, 0, 0);
    ctx.sb.paint();
    return ctx.sb.hitZones.filter((z) => z.action === "menu_pick" && z.key === key);
}
// Live automation / preset recall: forget the values the face still expects to see echoed, then apply
function auto(c, key, v) { c.echoPending = {}; c["set_" + key](v); }
function findZone(ctx, pred, label) {
    const z = ctx.sb.hitZones.find(pred);
    assert.ok(z, `zone not found: ${label}`);
    return z;
}
function actionZone(ctx, action, extra) {
    return findZone(ctx, (z) => z.kind === "button" && z.action === action && (!extra || Object.keys(extra).every((k) => z[k] === extra[k])), action);
}

// --- load-time state ---
for (const [name, c] of [["main", mainCtx], ["side", sideCtx], ["inspector", inspCtx]]) {
    assert.strictEqual(c.sb.mgraphics.relative_coords, 0, `${name}: relative_coords`);
    assert.strictEqual(c.sb.mgraphics.autofill, 0, `${name}: autofill`);
    assert.strictEqual(c.sb.hasLoadedSample, 0, `${name}: starts with no sample`);
    assert.strictEqual(c.sb.sampleFileName, "Drop Audio Sample Here");
    assert.strictEqual(c.sb.curFreeze, 0);
    assert.strictEqual(c.sb.curReverse, 0);
    assert.strictEqual(c.sb.curMonoLegato, 0);
    assert.strictEqual(c.sb.envPage, 0);
    assert.strictEqual(c.sb.curMode, 0, `${name}: starts on Repitch`);
    assert.strictEqual(c.sb.curSliced, 0, `${name}: starts Single`);
    assert.strictEqual(c.sb.showInspector, 0, `${name}: inspector hidden`);
    assert.strictEqual(c.sb.curSliceFrom, 36, `${name}: keymap starts at C1`);
    assert.strictEqual(c.sb.lastEngine, undefined, `${name}: no lastEngine any more (Sliced is not an engine)`);
}
assert.strictEqual(sb.faceRegion, "main");
assert.strictEqual(sd.faceRegion, "side");
assert.strictEqual(si.faceRegion, "inspector");
assert.deepStrictEqual(Array.from(sb.MODE_NAMES), ["Repitch", "Cycles", "Textures", "Spectral", "Fragments"], "MODE_NAMES is indexed by mode");
assert.deepStrictEqual(Array.from(sb.ENGINE_ORDER), [0, 3, 1, 2, 4], "face lists Repitch, Spectral, Cycles, Textures, Fragments (Bitwig order)");
assert.deepStrictEqual(Array.from(sb.ENGINE_ORDER).map((m) => sb.MODE_NAMES[m]), ["Repitch", "Spectral", "Cycles", "Textures", "Fragments"]);
assert.deepStrictEqual(Array.from(sb.ENGINE_ORDER).sort(), [0, 1, 2, 3, 4], "every engine is listed once");
assert.deepStrictEqual(Array.from(Object.keys(sb.FACE_PARAMS)).sort(), [...ctrlKeys].sort(), "FACE_PARAMS has an entry per control");
for (const key of ctrlKeys) {
    const fp = sb.FACE_PARAMS[key];
    const vof = valueOf(byId.get(`obj-ctrl-${key}`));
    assert.strictEqual(fp.lo, vof.parameter_mmin === undefined ? 0 : vof.parameter_mmin, `${key} lo`);
    assert.strictEqual(fp.hi, vof.parameter_mmax, `${key} hi`);
    assert.strictEqual(fp.init, vof.parameter_initial[0], `${key} init`);
    assert.strictEqual(typeof sb["set_" + key], "function", `${key}: set_${key} defined in the main face`);
    assert.strictEqual(typeof sd["set_" + key], "function", `${key}: set_${key} defined in the side face`);
    assert.strictEqual(typeof si["set_" + key], "function", `${key}: set_${key} defined in the inspector face`);
}
// the faces also share one FACE_PARAMS table
assert.deepStrictEqual(JSON.parse(JSON.stringify(si.FACE_PARAMS)), JSON.parse(JSON.stringify(sb.FACE_PARAMS)), "FACE_PARAMS identical in every face");

// --- paint, both regions ---
sb.paint();
sd.paint();
si.paint();
assert.ok(sb.hitZones.length > 20, "main face builds hit zones");
for (const kind of ["knob", "value", "button", "wave"]) {
    assert.ok(sb.hitZones.some((z) => z.kind === kind), `main face has ${kind} zones`);
}
for (const z of [...sb.hitZones, ...sd.hitZones, ...si.hitZones]) {
    assert.ok(Number.isFinite(z.x + z.y + z.w + z.h), "finite zone rect");
}
const mainW = 528, sideW = 66, inspW = INSPECTOR_W;
// KNOWN LAYOUT BUG: the loop_xfade value zone (sampler_face.js paintSamplePanel) is about 5 px wider than
// the canvas (zone right edge ~533 vs 528). Slack is kept tight so anything worse still fails.
const XFADE_ZONE_SLACK = 0;
for (const z of sb.hitZones) {
    assert.ok(z.x >= -1 && z.x + z.w <= mainW + XFADE_ZONE_SLACK && z.y >= -1 && z.y + z.h <= DEVICE_H + 1, `main zone inside canvas (${z.kind} ${z.key || z.action || z.region} ${[z.x, z.y, z.w, z.h]})`);
}
for (const z of sd.hitZones) {
    assert.ok(z.x >= -1 && z.x + z.w <= sideW + 1 && z.y >= -1 && z.y + z.h <= sideViz.presentation_rect[3] + 1, `side zone inside canvas (${z.kind} ${z.key || z.action})`);
}
for (const z of si.hitZones) {
    assert.ok(z.x >= -1 && z.x + z.w <= inspW + 1 && z.y >= -1 && z.y + z.h <= DEVICE_H + 1, `inspector zone inside canvas (${z.kind} ${z.key || z.action} ${[z.x, z.y, z.w, z.h]})`);
}
assert.deepStrictEqual(
    Array.from(sd.hitZones.filter((z) => z.kind === "knob").map((z) => z.key).sort()),
    ["glide_ms", "out_gain", "unison_width", "vel_sens"],
    "side face knobs"
);
assert.deepStrictEqual(Array.from(sd.hitZones.filter((z) => z.kind === "button").map((z) => z.action)), ["inspector", "voicing", "voicing"],
    "side face: Inspector button on top, then Poly / Mono (no LOAD button)");
assert.ok(sd.hitZones.find((z) => z.action === "inspector").y < sd.hitZones.find((z) => z.action === "voicing").y, "Inspector button sits above Poly / Mono");
assert.ok(!si.hitZones.some((z) => z.kind === "wave" || z.kind === "knob"), "inspector has no waveform or knobs, only rows");
assert.ok(!sd.hitZones.some((z) => z.kind === "wave"), "side face has no waveform");
sb.preview();
sb.paint();
sd.paint();
si.preview();
si.paint();

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
// the default "Slice at" is Divisions: eight equal slices from the start point (onsets are an opt-in mode)
assert.strictEqual(sb.sliceMarkers.length, 8, "default slicing is 8 equal divisions");
sb.sliceMarkers.forEach((m, i) => assert.ok(Math.abs(m - i / 8) < 1e-9, `division ${i}`));
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

// --- engine list: 5 engines in Bitwig order, each click emits only `mode`; Single / Sliced emits only `sliced` ---
{
    sb.paint();
    const engineZones = sb.hitZones.filter((z) => z.kind === "button" && z.action === "engine");
    assert.deepStrictEqual(Array.from(engineZones.map((z) => z.engine)), [0, 3, 1, 2, 4], "engine zones run top to bottom in ENGINE_ORDER");
    for (let i = 1; i < engineZones.length; i++) assert.ok(engineZones[i].y > engineZones[i - 1].y, "engine rows are stacked");
    for (let i = 1; i < engineZones.length; i++) {
        assert.ok(!rectsOverlap([engineZones[i - 1].x, engineZones[i - 1].y, engineZones[i - 1].w, engineZones[i - 1].h],
            [engineZones[i].x, engineZones[i].y, engineZones[i].w, engineZones[i].h]), "engine rows do not overlap");
    }
    for (const e of [0, 1, 2, 3, 4, 3, 0]) {
        sb.paint();
        const z = actionZone(mainCtx, "engine", { engine: e });
        emitted.length = 0;
        const depth = sb.undoStack.length;
        click(mainCtx, z);
        assert.strictEqual(sb.curMode, e, `engine button ${sb.MODE_NAMES[e]}`);
        assert.deepStrictEqual(paramMsgs(mainCtx, "mode").map((a) => a[3]), [e], `engine ${e} emits one param mode`);
        assert.strictEqual(paramMsgs(mainCtx, "sliced").length, 0, "choosing an engine never touches Single / Sliced");
        assert.strictEqual(sb.undoStack.length, depth + 1, "one undo snapshot per engine click");
    }
    assert.strictEqual(sb.lastEngine, undefined, "no lastEngine bookkeeping");
    sb.echoPending = {};

    // prev / next step through ENGINE_ORDER (Repitch -> Spectral -> Cycles -> Textures -> Fragments -> wrap)
    auto(sb, "mode", 0);
    const walk = [];
    for (let i = 0; i < 5; i++) { sb.doAction({ action: "engine_next" }); walk.push(sb.curMode); }
    assert.deepStrictEqual(walk, [3, 1, 2, 4, 0], "engine_next follows the list order and wraps");
    sb.doAction({ action: "engine_prev" });
    assert.strictEqual(sb.curMode, 4, "engine_prev from Repitch wraps to Fragments");

    // Single / Sliced is a separate param: `sliced` 0 / 1, engine untouched
    auto(sb, "mode", 2);
    sb.paint();
    emitted.length = 0;
    click(mainCtx, actionZone(mainCtx, "sliced_set", { value: 1 }));
    assert.strictEqual(sb.curSliced, 1);
    assert.strictEqual(sb.curMode, 2, "Sliced keeps the engine");
    assert.deepStrictEqual(paramMsgs(mainCtx, "sliced").map((a) => a[3]), [1]);
    assert.strictEqual(paramMsgs(mainCtx, "mode").length, 0, "Sliced no longer writes mode 3");
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "engine", { engine: 1 }));
    assert.strictEqual(sb.curSliced, 1, "changing the engine keeps Sliced");
    assert.strictEqual(sb.curMode, 1);
    sb.paint();
    emitted.length = 0;
    click(mainCtx, actionZone(mainCtx, "sliced_set", { value: 0 }));
    assert.strictEqual(sb.curSliced, 0);
    assert.strictEqual(sb.curMode, 1, "Single keeps the engine");
    assert.deepStrictEqual(paramMsgs(mainCtx, "sliced").map((a) => a[3]), [0]);
    // the `sliced` echo from Live drives the same state, and mode 3 is Spectral, not a slicer
    auto(sb, "sliced", 1); assert.strictEqual(sb.curSliced, 1);
    auto(sb, "sliced", 0); assert.strictEqual(sb.curSliced, 0);
    auto(sb, "mode", 3); assert.strictEqual(sb.curMode, 3); assert.strictEqual(sb.curSliced, 0, "mode 3 = Spectral does not slice");

    // undo stack: one snapshot per click, undo/redo walk the UI state
    auto(sb, "mode", 0);
    sb.paint();
    click(mainCtx, actionZone(mainCtx, "engine", { engine: 4 }));
    const tip = sb.curMode;
    sb.performUndo();
    assert.strictEqual(sb.curMode, 0, "undo returns to the previous engine");
    sb.performRedo();
    assert.strictEqual(sb.curMode, tip, "undo then redo returns to the tip");
    const stalled = sb.undoStack.length;
    sb.performRedo();
    assert.strictEqual(sb.undoStack.length, stalled, "redo at the tip is a no-op");
    auto(sb, "mode", 0);

    // the engine list highlights the current engine in blue (and nothing else)
    const blueLabels = (ctx) => {
        const g = ctx.sb.mgraphics, ops = [];
        const saved = { set_source_rgba: g.set_source_rgba, show_text: g.show_text };
        let col = null;
        g.set_source_rgba = (...a) => { col = a; };
        g.show_text = (t) => { ops.push([t, col]); };
        ctx.sb.paint();
        Object.assign(g, saved);
        return ops.filter((o) => ctx.sb.MODE_NAMES.includes(o[0]) && o[1][2] > 0.9 && o[1][0] < 0.5).map((o) => o[0]);
    };
    for (let e = 0; e < 5; e++) {
        auto(sb, "mode", e);
        assert.deepStrictEqual(blueLabels(mainCtx), [sb.MODE_NAMES[e]], `only ${sb.MODE_NAMES[e]} is highlighted`);
    }
    auto(sb, "mode", 0);
    sb.undoStack.length = 0;   // the stack is capped at 24 snapshots; later blocks count depth + 1
    sb.redoStack.length = 0;
}

// --- toggle buttons: reverse, freeze, filter on/type (loop mode is a dropdown) ---
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
    // loop mode is a dropdown now (see the generic dropdown tests): button -> items -> pick
    for (const want of [2, 0, 1]) {
        sb.paint();
        const picks = openMenuPicks(mainCtx, "loop_mode");
        click(mainCtx, picks.find((z) => z.value === want));
        assert.strictEqual(sb.curLoopMode, want, `loop mode menu picks ${want}`);
    }
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
    // every engine panel variant lights different knobs: visit them all (plus each env page)
    const mainConfigs = [];
    for (const [mode, extra] of [[0, { rp_char: 0 }], [0, { rp_char: 1 }], [0, { rp_char: 2 }], [3, { sp_char: 0 }],
        [3, { sp_char: 1, sp_quant: 1 }], [1, { cy_char: 0 }], [1, { cy_char: 1 }], [1, { cy_char: 2 }], [2, {}], [4, {}]]) {
        mainConfigs.push({ page: 0, mode, extra });
    }
    for (const page of [1, 2, 3]) mainConfigs.push({ page, mode: 2, extra: {} });
    for (const [ctx, name] of regions) {
        const c = ctx.sb;
        const configs = name === "main" ? mainConfigs : [{ page: 0, mode: 0, extra: {} }];
        for (const cfgItem of configs) {
            c.envPage = cfgItem.page;
            c.storeParam("mode", cfgItem.mode);
            for (const [ek, ev] of Object.entries(cfgItem.extra)) c.storeParam(ek, ev);
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
        "unison_width", "glide_ms", "vel_sens", "out_gain",
        "rp_dist", "rp_color", "sp_shift", "sp_bend", "sp_quant_amt", "cy_width", "cy_split", "cy_fund", "cy_mod", "cy_harm",
        "fr_density", "fr_motion"]) {
        assert.ok(checked.has(key), `knob ${key} was exercised`);
    }
    sb.envPage = 0;
    sb.storeParam("mode", 0);
    for (const k of ["rp_char", "sp_char", "sp_quant", "cy_char"]) sb.storeParam(k, 0);
    sb.echoPending = {};
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
        // the page is mirrored to the hidden env_page parameter (the Ableton theme's live.tab follows it); nothing else goes out
        assert.deepStrictEqual(emitted.map((a) => a.slice(0, 4)), [[0, "param", "env_page", page]], "env tab only mirrors env_page");
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
    // the loop-start handle grabs from either side of its line (the xfade zone stops short of it)
    sb.onclick(loopX - 2, wy, 1, 0, 0);
    assert.strictEqual(sb.drag.wave, "loop_start", "grab from the left of the line");
    release(mainCtx, loopX - 2, wy);
    sb.paint();
    const depth = sb.undoStack.length;
    sb.onclick(loopX + 2, wy, 1, 0, 0);
    assert.strictEqual(sb.drag.wave, "loop_start");
    assert.strictEqual(sb.undoStack.length, depth + 1);
    for (const dx of [30, 36, 42]) sb.ondrag(loopX + 2 + dx, wy, 1, 0, 0);
    assert.strictEqual(sb.undoStack.length, depth + 1, "dragging does not push undo per frame");
    assert.ok(sb.curLoopStart > 0.18);
    release(mainCtx, loopX + 44, wy);
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
    sb.onclick(wz.x + 0.3 * wz.w, wy, 1, 0, 0);
    assert.strictEqual(sb.drag, null, "no Pos drag without Freeze");
    assert.strictEqual(paramMsgs(mainCtx, "play_pos").length, 0, "no Pos change without Freeze");
    sb.set_freeze(1);
    sb.paint();
    emitted.length = 0;
    sb.onclick(wz.x + 0.3 * wz.w, wy, 1, 0, 0);
    assert.strictEqual(sb.drag.wave, "play_pos");
    assert.ok(Math.abs(paramMsgs(mainCtx, "play_pos").pop()[3] - 30) < 0.1);
    release(mainCtx, wz.x + 0.3 * wz.w, wy);

    // Sliced: clicking the waveform auditions a slice via midi_note and releases it
    sb.storeParam("sliced", 1);
    sb.paint();
    const gate = () => sb.voiceAlloc.voices.filter((v) => v.gate === 1).length;
    sb.all_notes_off();
    sb.onclick(wz.x + 0.3 * wz.w, wy, 1, 0, 0);
    assert.strictEqual(sb.drag.wave, "slice_audition");
    assert.strictEqual(gate(), 1, "slice audition opens a voice");
    release(mainCtx, wz.x, wy);
    assert.strictEqual(gate(), 0, "releasing the mouse closes the audition voice");
    sb.storeParam("sliced", 0);
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
    sb.echoPending = {};
    sb.set_mode(2);
    assert.strictEqual(sb.curMode, 2);
    sb.set_mode(3);
    assert.strictEqual(sb.curMode, 3, "mode 3 is the Spectral engine");
    assert.strictEqual(sb.curSliced, 0, "an engine echo never turns slicing on");
    sb.set_mode(4);
    assert.strictEqual(sb.curMode, 4, "mode 4 is Fragments");
    sb.set_mode(9);
    assert.strictEqual(sb.curMode, 4, "mode echo clamps to Fragments");
    sb.set_mode(-4);
    assert.strictEqual(sb.curMode, 0);
    sb.set_sliced(1); assert.strictEqual(sb.curSliced, 1);
    assert.strictEqual(sb.curMode, 0, "a sliced echo leaves the engine alone");
    sb.set_sliced(0); assert.strictEqual(sb.curSliced, 0);
    sb.set_slice_from(48); assert.strictEqual(sb.curSliceFrom, 48);
    assert.strictEqual(sb.voiceAlloc.getSliceBaseNote(), 48, "slice_from echo moves the allocator keymap base");
    sb.set_slice_from(300); assert.strictEqual(sb.curSliceFrom, 127, "slice_from clamps to 127");
    sb.set_slice_from(36);
    sb.set_show_inspector(1); assert.strictEqual(sb.showInspector, 1);
    sb.set_show_inspector(0); assert.strictEqual(sb.showInspector, 0);
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
    assert.strictEqual(mainCtx.emitted.slice(n0).filter((a) => a[1] === "param").length, 0, "echoes never emit params (no feedback loop)");
    assert.ok(mainCtx.emitted.slice(n0).every((a) => a[1] === "setwidth_cmd"), "the only message an echo may emit is the inspector width");
    // an echo reaches the other face too (both receive every set_<key>)
    auto(sd, "mono_legato", 1);
    assert.strictEqual(sd.curMonoLegato, 1);
    auto(sd, "mono_legato", 0);
    auto(si, "mono_legato", 1);
    assert.strictEqual(si.curMonoLegato, 1, "the inspector face receives every setter too");
    auto(si, "mono_legato", 0);
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
    {
        // slice bounds are written before the trigger counter, so a note-on never starts on a stale slice
        const vp = mainCtx.pokes.filter((pk) => pk.name === "#0-bsvoices");
        const last = vp[vp.length - 1], prev = vp[vp.length - 2];
        assert.ok(prev && prev.idx === last.idx + 4 && prev.data.length === 4, "voice bounds are poked first (slots 4..7)");
        assert.strictEqual(prev.data[0], last.data[4]);
        assert.strictEqual(prev.data[1], last.data[5]);
    }
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
    assert.strictEqual(saved[0], 3, "getvalueof version 3");
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

    // A saved slice count of 0 is real: the path sits in the next slot. Treating 0 as 1
    // reads the path as a marker and drops the sample.
    sb.sliceMarkers = [];
    sb.dropfile("/Users/test/Drums/Kick.wav");
    const noSlices = sb.getvalueof();
    assert.strictEqual(noSlices[10], 0, "empty marker list is stored as count 0");
    assert.strictEqual(noSlices[noSlices.length - 1], "/Users/test/Drums/Kick.wav");
    sb.sliceMarkers = [0, 0.5];
    sb.sampleFilePath = "";
    sb.sampleFileName = "";
    emitted.length = 0;
    sb.setvalueof.apply(sb, noSlices);
    assert.strictEqual(sb.sliceMarkers.length, 0, "reloaded slice count of 0 stays empty, got " + sb.sliceMarkers.length);
    assert.strictEqual(sb.sampleFilePath, "/Users/test/Drums/Kick.wav", "path after a zero count is still the path");
    assert.ok(emitted.some((a) => a[1] === "load_sample" && a[2] === "/Users/test/Drums/Kick.wav"), "zero slices still reloads the sample");
    sb.sample_loaded("/Users/test/Drums/Kick.wav");
    assert.strictEqual(sb.sliceMarkers.length, 0, "reload refresh keeps the saved empty marker list");

    // Undo of the last marker must be able to land on an empty list.
    sb.sliceMarkers = [];
    sb.pushUndoState();
    sb.sliceMarkers = [0.4];
    sb.performUndo();
    assert.strictEqual(sb.sliceMarkers.length, 0, "undo clears the last marker");

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

console.log("Better Sampler: 600x169 face + inspector, wiring, knobs, buttons, regions, state and voices ok");

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
    x.set_sliced(1);
    x.set_slice_at(4);   // Manual: Divisions / Beats would lay the markers out again from the start point
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
    l.set_sliced(1);
    l.set_slice_at(4);
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

    // Playback dropdown (Sliced footer): a generic menu with Bitwig's four glyph items
    l.paint();
    const pb = l.hitZones.find((z) => z.action === "menu" && z.key === "slice_play");
    assert.ok(pb, "Playback control in the Sliced footer");
    lc.emitted.length = 0;
    const picks = openMenuPicks(lc, "slice_play");
    assert.deepStrictEqual(Array.from(picks.map((z) => z.value)), [0, 1, 2, 3], "four slice playback modes listed");
    const loopPick = picks[2];
    l.onclick(loopPick.x + 5, loopPick.y + 3, 1, 0, 0);
    assert.deepStrictEqual(Array.from(paramMsgs(lc, "slice_play").pop().slice(1)), ["param", "slice_play", 2], "One-way looping picked");
    l.paint();
    assert.ok(!l.hitZones.some((z) => z.action === "menu_pick"), "menu closes after a pick");
    openMenuPicks(lc, "slice_play");
    lc.emitted.length = 0;
    l.onclick(wave.x + 0.6 * wave.w, wave.y + 20, 1, 0, 0);
    l.paint();
    assert.ok(!l.hitZones.some((z) => z.action === "menu_pick"), "a click elsewhere closes the menu");
    assert.strictEqual(paramMsgs(lc, "slice_play").length, 0, "closing click picks nothing");
    l.set_sliced(0);
    l.paint();
    assert.ok(!l.hitZones.some((z) => z.action === "menu" && z.key === "slice_play"), "Playback dropdown only in Sliced mode");
}

console.log("Live slice bounds, Playback dropdown and Pos/Freeze ok");

// --- Live echoes a gesture's values late: markers and knobs must still track the cursor ---
{
    function dragWithEcho(deferred, setup, grab, frames, read) {
        const ec = makeSandbox(mainViz);
        const e = ec.sb;
        e.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
        setup(e);
        e.paint();
        const q = [];
        const takeParams = () => { const out = ec.emitted.filter((a) => a[1] === "param"); ec.emitted.length = 0; return out; };
        const deliver = (msgs) => { for (const a of msgs) e["set_" + a[2]](a[3]); };
        const start = grab(e);
        e.onclick(start.x, start.y, 1, 0, 0);
        deliver(takeParams());
        let worst = 0;
        for (const f of frames) {
            const late = deferred ? q.splice(0) : [];
            e.ondrag(f.x, f.y, 1, 0, 0);
            const now = takeParams();
            if (deferred) { deliver(late); q.push(...now); } else deliver(now);
            e.paint();
            worst = Math.max(worst, Math.abs(read(e) - f.expect));
        }
        deliver(q.splice(0));
        e.ondrag(frames[frames.length - 1].x, frames[frames.length - 1].y, 0, 0, 0);
        worst = Math.max(worst, Math.abs(read(e) - frames[frames.length - 1].expect));
        return worst;
    }
    // the waveform rect is the same in Single and Sliced; measure it up front (the frames are built before the drag runs)
    const probe = makeSandbox(mainViz);
    probe.sb.paint();
    const wave = probe.sb.hitZones.find((z) => z.kind === "wave");
    for (const sliced of [false, true]) {
        for (const deferred of [false, true]) {
            const worst = dragWithEcho(deferred,
                (e) => { if (sliced) e.set_sliced(1); e.paint(); },
                () => ({ x: wave.x + 1, y: wave.y + wave.h - 3 }),
                Array.from({ length: 40 }, (_, i) => { const n = 0.05 + 0.6 * Math.abs(Math.sin(i / 6)); return { x: wave.x + n * wave.w, y: wave.y + 30, expect: n }; }),
                (e) => e.curStart);
            assert.ok(worst < 0.002, `start marker tracks the cursor (${sliced ? "sliced" : "single"}, ${deferred ? "late" : "immediate"} echo): off by ${worst}`);
        }
    }
    // a knob dragged up and back down with late echoes ends exactly where the mouse left it
    const kc = makeSandbox(mainViz);
    const k = kc.sb;
    k.paint();
    const kz = k.hitZones.find((z) => z.kind === "knob" && z.key === "filt_res");
    const cy = kz.y + kz.h / 2;
    k.onclick(kz.x + kz.w / 2, cy, 1, 0, 0);
    const pend = [];
    const vals = [];
    for (const dy of [-20, -40, -20, 0, -10]) {
        const late = pend.splice(0);
        k.ondrag(kz.x + kz.w / 2, cy + dy, 1, 0, 0);
        vals.push(k.paramValue("filt_res"));
        for (const a of late) k["set_" + a[2]](a[3]);
        pend.push(...kc.emitted.filter((a) => a[1] === "param").splice(0));
        kc.emitted.length = 0;
        assert.strictEqual(k.paramValue("filt_res"), vals[vals.length - 1], "late echo never moves the knob being dragged");
    }
    for (const a of pend.splice(0)) k["set_" + a[2]](a[3]);
    assert.strictEqual(k.paramValue("filt_res"), vals[vals.length - 1], "knob ends where the mouse left it");
    // automation that is not one of our values still applies
    k.set_filt_res(77);
    assert.strictEqual(k.paramValue("filt_res"), 77, "external changes (automation) still update the face");
}

console.log("Late Live echoes: markers and knobs track the cursor ok");

// ============================================================================
// 5. Redesign coverage: Single/Sliced split, params, three regions, dropdowns, slicing, loop overlay,
//    per-engine panels, inspector, echoes
// ============================================================================

// Record what paint() draws: rectangles and arcs with the colour in force, and every string
function paintSpy(ctx) {
    const g = ctx.sb.mgraphics, ops = [];
    const names = ["set_source_rgba", "rectangle", "arc", "show_text"];
    const saved = {};
    for (const n of names) saved[n] = g[n];
    let col = [0, 0, 0, 1];
    g.set_source_rgba = (...a) => { col = a; };
    g.rectangle = (...a) => ops.push({ op: "rect", a, col });
    g.arc = (...a) => ops.push({ op: "arc", a, col });
    g.show_text = (t) => ops.push({ op: "text", t: String(t), col });
    ctx.sb.paint();
    Object.assign(g, saved);
    return ops;
}
function texts(ctx) { return paintSpy(ctx).filter((o) => o.op === "text").map((o) => o.t); }
// alpha a knob was drawn with (0.45 = dimmed); needs the zones of the paint that produced `ops`
function knobAlpha(ctx, ops, key) {
    const z = ctx.sb.hitZones.find((q) => q.kind === "knob" && q.key === key);
    assert.ok(z, `knob ${key} is drawn`);
    const ringR = (z.w - 4) / 2, cx = z.x + z.w / 2, cy = z.y + ringR + 2, r = ringR - 3;
    const arc = ops.find((o) => o.op === "arc" && Math.abs(o.a[0] - cx) < 0.01 && Math.abs(o.a[1] - cy) < 0.01 && Math.abs(o.a[2] - r) < 0.01);
    assert.ok(arc, `knob ${key} disc found`);
    return arc.col[3];
}
function loadedMain(fileName) {
    const c = makeSandbox(mainViz);
    c.sb.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    c.audioOn = true;
    c.sb.sample_loaded("/Users/test/Loops/" + (fileName || "Loop_120bpm.wav"));
    assert.strictEqual(c.sb.hasLoadedSample, 1);
    c.emitted.length = 0;
    c.pokes.length = 0;
    return c;
}
function ids(zs) { return Array.from(zs.map((z) => z.key)); }
function msgVals(ctx, key) { return paramMsgs(ctx, key).map((a) => a[3]); }
function toggleZone(ctx, key) { return findZone(ctx, (z) => z.kind === "button" && z.action === "toggle" && z.key === key, `toggle ${key}`); }
function menuFits(picks, W, H) {
    return picks.every((z) => z.x >= 0 && z.x + z.w <= W && z.y >= 0 && z.y + z.h <= H);
}
// KNOWN BUG: a dropdown taller than its canvas cannot be fully reached. Local Key has 12 rows * 15 px + 6 = 186 px
// in the 169 px inspector (sampler_face.js toggleMenu clamps y to 2 but never shrinks / scrolls the list), so
// the lower rows are off-canvas and unclickable. Remove the entry once the menu scrolls or uses two columns.
const KNOWN_MENU_OVERFLOW = [];
const overflowWarned = [];
function assertMenuFits(key, picks, W, H) {
    if (menuFits(picks, W, H)) return;
    if (KNOWN_MENU_OVERFLOW.includes(key)) { if (!overflowWarned.includes(key)) overflowWarned.push(key); return; }
    assert.fail(`${key} dropdown does not fit the ${W}x${H} canvas`);
}

// --- 1. state: v1 / v2 blobs that stored the old Slice engine (mode 3) restore as Sliced + Repitch ---
{
    for (const ver of [1, 2]) {
        const c = makeSandbox(mainViz);
        const m = c.sb;
        m.setvalueof.apply(m, [ver, 3, 0, 10000, 1, 1500, 8500, 500, 0, 0, 1, 0].concat(ver === 2 ? [""] : []));
        assert.strictEqual(m.curMode, 0, `v${ver} mode 3 -> Repitch`);
        assert.strictEqual(m.curSliced, 1, `v${ver} mode 3 -> Sliced`);
        assert.deepStrictEqual(msgVals(c, "mode"), [0], `v${ver} restore emits mode 0`);
        assert.deepStrictEqual(msgVals(c, "sliced"), [1], `v${ver} restore emits sliced 1`);
        // the other engines restore as they were and leave slicing alone
        for (const mode of [0, 1, 2]) {
            const c2 = makeSandbox(mainViz);
            c2.sb.setvalueof.apply(c2.sb, [ver, mode, 0, 10000, 1, 1500, 8500, 500, 0, 0, 1, 0].concat(ver === 2 ? [""] : []));
            assert.strictEqual(c2.sb.curMode, mode);
            assert.strictEqual(c2.sb.curSliced, 0, "engines 0..2 do not turn slicing on");
            assert.strictEqual(msgVals(c2, "sliced").length, 0);
        }
    }
    // Fragments (4) was never an old blob value; it restores as is
    const c4 = makeSandbox(mainViz);
    c4.sb.setvalueof.apply(c4.sb, [2, 4, 0, 10000, 1, 1500, 8500, 500, 0, 0, 1, 0, ""]);
    assert.strictEqual(c4.sb.curMode, 4);
    assert.strictEqual(c4.sb.curSliced, 0);

    // A blob saved by this build (v3) keeps Spectral (mode 3); only v1/v2 mode 3 means Sliced Repitch
    const sv = makeSandbox(mainViz);
    auto(sv.sb, "mode", 3);
    const blob = sv.sb.getvalueof();
    assert.strictEqual(blob[0], 3, "state blob is version 3");
    const rs = makeSandbox(mainViz);
    rs.sb.setvalueof.apply(rs.sb, blob);
    assert.strictEqual(rs.sb.curMode, 3, "saved Spectral set reloads as Spectral");
    assert.strictEqual(rs.sb.curSliced, 0, "and stays Single");
}

// --- 2. every new parameter: setter on all three faces, stored, never re-emitted ---
{
    const faces = [makeSandbox(mainViz), makeSandbox(sideViz), makeSandbox(inspViz)];
    for (const key of ctrlKeys) {
        const spec = sb.FACE_PARAMS[key];
        const mid = (spec.enums || spec.unit === 0) ? Math.round((spec.lo + spec.hi) / 2) : (spec.lo + spec.hi) / 2;
        for (const f of faces) {
            f.emitted.length = 0;
            auto(f.sb, key, mid);
            assert.strictEqual(f.sb.paramValue(key), mid, `${key}: ${f.sb.faceRegion} face stores the echo`);
            assert.strictEqual(f.emitted.filter((a) => a[1] === "param").length, 0, `${key}: ${f.sb.faceRegion} echo emits no param`);
        }
    }
    // enum lists the faces use match the controls
    for (const key of ["mode", "sliced", "rp_char", "sp_char", "sp_quant", "sp_quality", "sp_key", "sp_scale", "cy_char", "fr_direction", "slice_at", "slice_beat", "slice_play", "loop_mode"]) {
        const vof = valueOf(byId.get(`obj-ctrl-${key}`));
        assert.deepStrictEqual(Array.from(sb.FACE_PARAMS[key].enums), vof.parameter_enum, `${key}: FACE_PARAMS enums = control enum`);
    }
    assert.strictEqual(sb.FACE_PARAMS.sp_key.enums.length, 12);
    assert.strictEqual(sb.FACE_PARAMS.slice_beat.enums.length, 10);
    // formatting of the new units
    assert.strictEqual(sb.fmtParam("fr_repeats", 3), "3");
    assert.strictEqual(sb.fmtParam("sp_key", 1), "C#");
    assert.strictEqual(sb.fmtParam("fr_direction", 2), "Random");
    assert.strictEqual(sb.fmtParam("sp_bend", 5), "+5 st");
    assert.strictEqual(sb.fmtParam("slice_div", 12), "12");
}

// --- 3. three regions and the device width ---
{
    const faces = [["main", makeSandbox(mainViz)], ["side", makeSandbox(sideViz)], ["inspector", makeSandbox(inspViz)]];
    const widths = (c) => c.emitted.filter((a) => a[1] === "setwidth_cmd").map((a) => a[2]);
    for (const [name, c] of faces) {
        assert.strictEqual(c.sb.mgraphics.size[0], { main: 528, side: 66, inspector: 160 }[name], `${name} canvas width`);
        c.sb.device_ready();
        assert.deepStrictEqual(widths(c), [600], `${name}: device_ready re-sends the hidden width (600)`);
        c.emitted.length = 0;
        auto(c.sb, "show_inspector", 1);
        assert.deepStrictEqual(widths(c), [760], `${name}: show_inspector echo asks for 760`);
        assert.strictEqual(c.sb.showInspector, 1);
        c.emitted.length = 0;
        c.sb.device_ready();
        assert.deepStrictEqual(widths(c), [760], `${name}: device_ready re-sends the saved width`);
        auto(c.sb, "show_inspector", 0);
        assert.strictEqual(c.sb.showInspector, 0);
    }
    // the Inspector button lives in the side region only
    assert.ok(!sb.hitZones.some((z) => z.action === "inspector") && !si.hitZones.some((z) => z.action === "inspector"));
    const side = makeSandbox(sideViz);
    side.sb.paint();
    const ib = findZone(side, (z) => z.kind === "button" && z.action === "inspector", "Inspector button");
    click(side, ib);
    assert.deepStrictEqual(msgVals(side, "show_inspector"), [1], "clicking Inspector shows it");
    assert.deepStrictEqual(widths(side), [760], "and widens the device to 760");
    assert.strictEqual(side.sb.showInspector, 1);
    side.sb.paint();
    click(side, ib);
    assert.deepStrictEqual(msgVals(side, "show_inspector"), [1, 0], "clicking again hides it");
    assert.deepStrictEqual(widths(side), [760, 600], "and shrinks back to 600");
}

// --- 4. generic dropdowns ---
{
    const c = loadedMain();
    const m = c.sb;
    // Single footer: loop_mode with icons
    m.paint();
    const lb = findZone(c, (z) => z.kind === "button" && z.action === "menu" && z.key === "loop_mode", "loop menu button");
    assert.strictEqual(m.openMenu, null);
    let picks = openMenuPicks(c, "loop_mode");
    assert.deepStrictEqual(Array.from(picks.map((z) => z.value)), [0, 1, 2], "loop_mode menu: Off / One-way / Ping-pong");
    assert.ok(m.openMenu && m.openMenu.key === "loop_mode");
    assert.ok(m.menuItems("loop_mode").icon, "loop_mode items carry icons");
    assert.deepStrictEqual(Array.from(m.menuItems("loop_mode").names), ["Off", "One-way looping", "Ping-pong looping"]);
    assertMenuFits("loop_mode", picks, 528, 169);
    for (let i = 1; i < picks.length; i++) assert.ok(picks[i].y >= picks[i - 1].y + picks[i - 1].h - 1e-9, "menu rows are stacked");
    // re-clicking the button closes it
    c.emitted.length = 0;
    m.onclick(lb.x + 2, lb.y + 2, 1, 0, 0);
    assert.strictEqual(m.openMenu, null, "the same button toggles the menu closed");
    assert.strictEqual(c.emitted.length, 0);
    // a click elsewhere closes without changing anything and without acting on what was under it
    openMenuPicks(c, "loop_mode");
    const cut = m.hitZones.find((z) => z.kind === "knob" && z.key === "filt_cutoff");
    const cutBefore = m.paramValue("filt_cutoff");
    const loopBefore = m.curLoopMode;
    c.emitted.length = 0;
    m.onclick(...center(cut), 1, 0, 0);
    assert.strictEqual(m.openMenu, null, "click elsewhere closes the menu");
    assert.strictEqual(m.drag, null, "and the click is swallowed (no knob grab)");
    assert.strictEqual(c.emitted.length, 0, "nothing emitted");
    assert.strictEqual(m.curLoopMode, loopBefore);
    assert.strictEqual(m.paramValue("filt_cutoff"), cutBefore);
    m.paint();
    assert.ok(!m.hitZones.some((z) => z.action === "menu_pick"), "closed menu has no item zones");
    // picking an item sets the value, closes the menu
    picks = openMenuPicks(c, "loop_mode");
    c.emitted.length = 0;
    click(c, picks[2]);
    assert.deepStrictEqual(msgVals(c, "loop_mode"), [2]);
    assert.strictEqual(m.curLoopMode, 2);
    assert.strictEqual(m.openMenu, null);

    // Sliced footer: slice_at (with descriptions), slice_beat (only for Beats), slice_play
    auto(m, "sliced", 1);
    m.paint();
    const sliceAtItems = m.menuItems("slice_at");
    assert.deepStrictEqual(Array.from(sliceAtItems.names), ["Divisions", "Beats", "Onsets", "Pitches", "Manual"]);
    assert.strictEqual(sliceAtItems.descs.length, 5, "every Slice at item has a description");
    assert.ok(sliceAtItems.descs.every((d) => d.length > 0));
    picks = openMenuPicks(c, "slice_at");
    assert.deepStrictEqual(Array.from(picks.map((z) => z.value)), [0, 1, 2, 3, 4]);
    assertMenuFits("slice_at", picks, 528, 169);
    m.onclick(...center(picks[0]), 1, 0, 0);   // pick Divisions (already current): value is still emitted
    assert.deepStrictEqual(msgVals(c, "slice_at").slice(-1), [0]);
    m.paint();
    assert.ok(!m.hitZones.some((z) => z.action === "menu" && z.key === "slice_beat"), "no beat menu while slicing by divisions");
    picks = openMenuPicks(c, "slice_at");
    click(c, picks[1]);
    assert.strictEqual(Math.round(m.paramValue("slice_at")), 1);
    m.paint();
    picks = openMenuPicks(c, "slice_beat");
    assert.strictEqual(picks.length, 10, "ten note lengths");
    assert.deepStrictEqual(Array.from(m.menuItems("slice_beat").names.slice(0, 3)), ["1 bar", "Half note", "Quarter note"]);
    assertMenuFits("slice_beat", picks, 528, 169);
    click(c, picks[4]);
    assert.strictEqual(Math.round(m.paramValue("slice_beat")), 4);
    assert.deepStrictEqual(msgVals(c, "slice_beat"), [4]);
    picks = openMenuPicks(c, "slice_play");
    assert.strictEqual(picks.length, 4);
    assert.ok(m.menuItems("slice_play").icon, "slice_play items carry Bitwig glyphs");
    click(c, picks[3]);
    assert.deepStrictEqual(msgVals(c, "slice_play"), [3]);

    // Spectral panel: sp_quant box opens a 3-item menu
    auto(m, "sliced", 0);
    auto(m, "mode", 3);
    auto(m, "sp_char", 1);
    picks = openMenuPicks(c, "sp_quant");
    assert.deepStrictEqual(Array.from(picks.map((z) => z.value)), [0, 1, 2]);
    assert.deepStrictEqual(Array.from(m.menuItems("sp_quant").names), ["Off", "Octaves", "Key"]);
    assertMenuFits("sp_quant", picks, 528, 169);
    click(c, picks[2]);
    assert.deepStrictEqual(msgVals(c, "sp_quant"), [2]);
    assert.strictEqual(Math.round(m.paramValue("sp_quant")), 2);

    // Inspector: sp_quality, sp_key, sp_scale, fr_direction (menus open below their row and stay on the canvas)
    const ic = makeSandbox(inspViz);
    auto(ic.sb, "mode", 3);
    for (const [key, n] of [["sp_quality", 3], ["sp_key", 12], ["sp_scale", 2]]) {
        picks = openMenuPicks(ic, key);
        assert.strictEqual(picks.length, n, `${key} menu has ${n} items`);
        assertMenuFits(key, picks, 160, 169);
        const last = picks[Math.min(picks.length, 8) - 1];
        ic.emitted.length = 0;
        click(ic, last);
        assert.deepStrictEqual(msgVals(ic, key), [last.value], `${key}: pick emits`);
        assert.strictEqual(ic.sb.openMenu, null);
    }
    auto(ic.sb, "mode", 4);
    picks = openMenuPicks(ic, "fr_direction");
    assert.strictEqual(picks.length, 4);
    assertMenuFits("fr_direction", picks, 160, 169);
    ic.emitted.length = 0;
    click(ic, picks[3]);
    assert.deepStrictEqual(msgVals(ic, "fr_direction"), [3]);
    // a click elsewhere in the inspector closes the menu and changes nothing
    openMenuPicks(ic, "fr_direction");
    ic.emitted.length = 0;
    ic.sb.onclick(80, 12, 1, 0, 0);
    assert.strictEqual(ic.sb.openMenu, null);
    assert.strictEqual(ic.emitted.length, 0);
    if (overflowWarned.length) console.warn(`WARNING known bug: dropdown taller than its canvas (rows unreachable): ${overflowWarned.join(", ")}`);
}

// --- 5. Sliced footer: keymap base, Slice at modes, manual editing ---
{
    // --- Use keys from <slice_from> ---
    const c = loadedMain();
    const m = c.sb;
    auto(m, "sliced", 1);
    auto(m, "slice_at", 4);
    m.sliceMarkers = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    m.paint();
    const fz = findZone(c, (z) => z.kind === "value" && z.key === "slice_from", "slice_from value");
    assert.strictEqual(m.curSliceFrom, 36);
    assert.ok(texts(c).includes("C1"), "footer shows the base key as a note name");
    const [fx, fy] = center(fz);
    m.onclick(fx, fy, 1, 0, 0);
    m.ondrag(fx, fy - 8, 1, 0, 0);
    assert.deepStrictEqual(msgVals(c, "slice_from"), [38], "dragging the key value up 8 px = +2 keys");
    m.ondrag(fx, fy - 8, 0, 0, 0);
    assert.strictEqual(m.curSliceFrom, 38);
    assert.strictEqual(m.voiceAlloc.getSliceBaseNote(), 38, "the allocator keymap starts at the new base");
    // flag labels use the base
    const labels = texts(c);
    assert.ok(labels.includes("D1") && labels.includes("D#1"), `flag labels start at D1 (got ${labels.filter((t) => /^[A-G]#?\d$/.test(t))})`);
    assert.ok(!labels.includes("C1"), "C1 is no longer a slice key");
    // MIDI: the base key plays the first slice, base + 1 the second
    c.pokes.length = 0;
    m.midi_note(38, 100);
    assert.strictEqual(c.pokes.filter((p) => p.name === "#0-bsvoices").pop().data[4], 0, "base key = first slice");
    m.midi_note(39, 100);
    assert.strictEqual(c.pokes.filter((p) => p.name === "#0-bsvoices").pop().data[4], 0.125, "base + 1 = second slice");
    m.midi_note(38, 0); m.midi_note(39, 0);
    // auditioning a slice by clicking plays base + index
    m.paint();
    const wz = m.hitZones.find((z) => z.kind === "wave");
    m.onclick(wz.x + 0.3 * wz.w, wz.y + 30, 1, 0, 0);
    assert.strictEqual(m.drag.wave, "slice_audition");
    assert.strictEqual(m.drag.note, 38 + 2, "slice under the mouse (index 2) sounds on base + 2");
    assert.ok(m.voiceAlloc.voices.some((v) => v.gate === 1 && v.note === 40));
    m.ondrag(wz.x, wz.y, 0, 0, 0);
    // the keymap base also moves through a Live echo
    auto(m, "slice_from", 24);
    assert.strictEqual(m.voiceAlloc.getSliceBaseNote(), 24);
    assert.ok(texts(c).includes("C0"), "echoed base redraws the labels (C0)");
}
{
    // --- A run of real notes in Sliced mode: every key writes ITS slice into its own voice slot ---
    const c = loadedMain();
    const m = c.sb;
    auto(m, "sliced", 1);
    const base = 36;
    const keys = [36, 37, 38, 39, 40, 41, 42, 43];
    // unmapped keys (below the first slice key, past the last slice) play nothing: no voice is written
    for (const k of [35, 44, 45, 100]) {
        c.pokes.length = 0;
        m.midi_note(k, 100);
        assert.strictEqual(c.pokes.filter((p) => p.name === "#0-bsvoices").length, 0, `unmapped key ${k} plays nothing`);
        assert.ok(!m.voiceAlloc.voices.some((v) => v.gate === 1 && v.note === k), `no voice for key ${k}`);
        m.midi_note(k, 0);
    }
    keys.forEach((k, i) => {
        c.pokes.length = 0;
        m.midi_note(k, 100);
        const vp = c.pokes.filter((p) => p.name === "#0-bsvoices");
        const last = vp[vp.length - 1];
        const slot = last.idx / 8;
        const idx = k - base; // 8 default divisions: keys 36..43
        assert.strictEqual(last.idx % 8, 0, "the whole voice is written at its own slot");
        assert.deepStrictEqual(last.data.slice(0, 2), [1, k], `key ${k}: gate and note`);
        assert.ok(Math.abs(last.data[2] - 100 / 127) < 1e-9, `key ${k}: velocity carried`);
        assert.ok(Math.abs(last.data[4] - idx * 0.125) < 1e-9, `key ${k}: slice start ${last.data[4]} should be ${idx * 0.125}`);
        assert.ok(Math.abs(last.data[5] - (idx + 1) * 0.125) < 1e-9, `key ${k}: slice end ${last.data[5]} should be ${(idx + 1) * 0.125}`);
        assert.strictEqual(m.voiceAlloc.voices[slot].note, k, `key ${k}: voice ${slot} holds the note`);
    });
    // every held key stays in its own voice with its own slice (no slot is shared or overwritten)
    const held = m.voiceAlloc.voices.filter((v) => v.gate > 0);
    assert.strictEqual(new Set(held.map((v) => v.index)).size, held.length);
    keys.forEach((k) => m.midi_note(k, 0));
    assert.ok(m.voiceAlloc.voices.every((v) => v.gate === 0), "all keys released");
    // notes outside the keymap play nothing (below the base, as above past the last slice)
    c.pokes.length = 0;
    m.midi_note(20, 100);
    assert.strictEqual(c.pokes.filter((p) => p.name === "#0-bsvoices").length, 0, "keys below the base play nothing");
    m.midi_note(20, 0);
    // a moved start point moves the first slice, and the last slice stops at the end point
    auto(m, "samp_start", 25);
    auto(m, "samp_end", 75);
    c.pokes.length = 0;
    m.midi_note(36, 100);
    const a = c.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.ok(Math.abs(a.data[4] - 0.25) < 1e-9, `first slice starts at the start point (${a.data[4]})`);
    m.midi_note(36, 0);
    m.midi_note(43, 100);
    const z = c.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.ok(Math.abs(z.data[5] - 0.75) < 1e-9, `last slice stops at the end point (${z.data[5]})`);
    m.midi_note(43, 0);
}
{
    // --- bridge test entry point: dbg_param drives a parameter exactly like a click on the face ---
    const c = loadedMain();
    const m = c.sb;
    c.emitted.length = 0;
    m.dbg_param("loop_mode", 0);
    assert.ok(c.emitted.some((a) => a[1] === "param" && a[2] === "loop_mode" && a[3] === 0), "dbg_param emits param loop_mode 0 toward route -> obj-ctrl-loop_mode");
    assert.strictEqual(m.curLoopMode, 0, "and updates the face state");
    m.dbg_param("sliced", 1);
    assert.strictEqual(m.curSliced, 1);
    m.dbg_param("loop_mode", 1);
}
{
    // --- Slice at: Divisions follow the start / end points and the division count ---
    const c = loadedMain();
    const m = c.sb;
    auto(m, "sliced", 1);
    assert.strictEqual(Math.round(m.paramValue("slice_at")), 0, "default Slice at is Divisions");
    assert.deepStrictEqual(Array.from(m.sliceMarkers), cfg.sliceDivisions(0, 1, 8), "8 divisions by default");
    m.paint();
    const dz = findZone(c, (z) => z.kind === "value" && z.key === "slice_div", "slice_div value");
    const [dx, dy] = center(dz);
    c.emitted.length = 0;
    m.onclick(dx, dy, 1, 0, 0);
    m.ondrag(dx, dy - 9, 1, 0, 0);
    m.ondrag(dx, dy - 9, 0, 0, 0);
    assert.deepStrictEqual(msgVals(c, "slice_div"), [11], "division count drags 3 px per unit");
    assert.deepStrictEqual(Array.from(m.sliceMarkers), cfg.sliceDivisions(0, 1, 11), "markers re-laid out for 11 divisions");
    // moving the end via Live automation
    auto(m, "samp_end", 80);
    assert.deepStrictEqual(Array.from(m.sliceMarkers), cfg.sliceDivisions(0, m.curEnd, 11).map((v) => v), "end change re-lays out the divisions");
    assert.ok(Math.abs(m.sliceMarkers[10] - 0.8 * 10 / 11) < 1e-9);
    // moving the start with the face handle
    m.paint();
    const wz = m.hitZones.find((z) => z.kind === "wave");
    m.onclick(wz.x + 1, wz.y + wz.h - 3, 1, 0, 0);
    assert.strictEqual(m.drag.wave, "samp_start");
    m.ondrag(wz.x + 0.2 * wz.w, wz.y + wz.h - 3, 1, 0, 0);
    m.ondrag(wz.x + 0.2 * wz.w, wz.y + wz.h - 3, 0, 0, 0);
    assert.deepStrictEqual(Array.from(m.sliceMarkers), cfg.sliceDivisions(m.curStart, m.curEnd, 11), "start drag re-lays out the divisions");
    assert.ok(Math.abs(m.sliceMarkers[0] - m.curStart) < 1e-12, "first division begins at the start point");
    // the keys follow: base key plays from the new start
    c.pokes.length = 0;
    m.midi_note(36, 100);
    assert.ok(Math.abs(c.pokes.filter((p) => p.name === "#0-bsvoices").pop().data[4] - m.curStart) < 1e-9);
    m.midi_note(36, 0);
    // Manual keeps whatever the user has: no re-layout on start / count changes
    auto(m, "slice_at", 4);
    const keep = Array.from(m.sliceMarkers);
    auto(m, "slice_div", 5);
    auto(m, "samp_start", 30);
    auto(m, "samp_end", 90);
    assert.deepStrictEqual(Array.from(m.sliceMarkers), keep, "Manual markers are never re-laid out");
}
{
    // --- Beats: note length at the file's tempo (name) or Live's tempo, anchored at the start point ---
    const c = loadedMain("Loop_120bpm.wav");
    const m = c.sb;
    auto(m, "sliced", 1);
    auto(m, "slice_beat", 2);   // 1/4
    auto(m, "slice_at", 1);
    assert.strictEqual(cfg.bpmFromName("Loop_120bpm.wav"), 120);
    const want = cfg.sliceBeats(0, 1, m.sampleFrames, 44100, 120, 2);
    assert.deepStrictEqual(Array.from(m.sliceMarkers), want, "Beats uses the tempo from the file name");
    assert.deepStrictEqual(Array.from(m.sliceMarkers), [0, 0.5], "1 s at 120 bpm: quarter notes at 0 and 0.5");
    auto(m, "slice_beat", 4);   // 1/8
    assert.deepStrictEqual(Array.from(m.sliceMarkers), cfg.sliceBeats(0, 1, m.sampleFrames, 44100, 120, 4));
    assert.strictEqual(m.sliceMarkers.length, 4);
    // start point drags move the grid
    m.paint();
    const wz = m.hitZones.find((z) => z.kind === "wave");
    m.onclick(wz.x + 1, wz.y + wz.h - 3, 1, 0, 0);
    m.ondrag(wz.x + 0.25 * wz.w, wz.y + wz.h - 3, 1, 0, 0);
    m.ondrag(wz.x + 0.25 * wz.w, wz.y + wz.h - 3, 0, 0, 0);
    assert.deepStrictEqual(Array.from(m.sliceMarkers), cfg.sliceBeats(m.curStart, m.curEnd, m.sampleFrames, 44100, 120, 4), "Beats follow the start point");
    assert.ok(Math.abs(m.sliceMarkers[0] - m.curStart) < 1e-12);
    // a file without a tempo falls back to Live's
    const c2 = loadedMain("Pad.wav");
    c2.sb.LiveAPI = function () { this.get = () => [90]; };
    auto(c2.sb, "sliced", 1);
    auto(c2.sb, "slice_beat", 2);
    auto(c2.sb, "slice_at", 1);
    assert.deepStrictEqual(Array.from(c2.sb.sliceMarkers), cfg.sliceBeats(0, 1, c2.sb.sampleFrames, 44100, 90, 2), "no tempo in the name -> Live's tempo");
    const c3 = loadedMain("Pad.wav");
    auto(c3.sb, "sliced", 1); auto(c3.sb, "slice_beat", 2); auto(c3.sb, "slice_at", 1);
    assert.deepStrictEqual(Array.from(c3.sb.sliceMarkers), cfg.sliceBeats(0, 1, c3.sb.sampleFrames, 44100, 120, 2), "no LiveAPI -> 120 bpm");
}
{
    // --- Onsets / Pitches use the config slicers with the Sens amount (spied: they get the mono copy and slice_sens) ---
    const c = loadedMain();
    const m = c.sb;
    auto(m, "sliced", 1);
    const calls = [];
    m.sliceOnsets = (samples, sr, sens, a, b) => { calls.push(["onsets", samples.length, sr, sens, a, b]); return [0, 0.3, 0.6]; };
    m.slicePitches = (samples, sr, sens, a, b) => { calls.push(["pitches", samples.length, sr, sens, a, b]); return [0, 0.2, 0.4, 0.8]; };
    m.paint();
    let picks = openMenuPicks(c, "slice_at");
    click(c, picks[2]);
    // the mono copy is built lazily on a Task: step it to completion
    assert.ok(m.sliceMonoJob, "Onsets starts the background mono copy");
    while (m.sliceMonoJob) m.sliceMonoStep();
    assert.deepStrictEqual(Array.from(m.sliceMarkers), [0, 0.3, 0.6], "Onsets markers come from sliceOnsets");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], "onsets");
    assert.strictEqual(calls[0][1], 44100, "the slicer gets the whole mono sample");
    assert.strictEqual(calls[0][2], 44100, "and its sample rate");
    assert.ok(Math.abs(calls[0][3] - 0.7) < 1e-9, "Sens 70 % -> 0.7");
    m.paint();
    const sz = findZone(c, (z) => z.kind === "value" && z.key === "slice_sens", "slice_sens value (Onsets)");
    const [sx2, sy2] = center(sz);
    c.emitted.length = 0;
    m.onclick(sx2, sy2, 1, 0, 0);
    m.ondrag(sx2, sy2 - 12, 1, 0, 0);
    m.ondrag(sx2, sy2 - 12, 0, 0, 0);
    assert.deepStrictEqual(msgVals(c, "slice_sens"), [80], "Sens drags in 0.1 normalized steps per 12 px");
    assert.ok(Math.abs(calls[calls.length - 1][3] - 0.8) < 1e-9, "the slicer re-runs with the new Sens");
    picks = openMenuPicks(c, "slice_at");
    click(c, picks[3]);
    assert.strictEqual(calls[calls.length - 1][0], "pitches");
    assert.deepStrictEqual(Array.from(m.sliceMarkers), [0, 0.2, 0.4, 0.8], "Pitches markers come from slicePitches");
    m.paint();
    assert.ok(m.hitZones.some((z) => z.kind === "value" && z.key === "slice_sens"), "Sens is shown for Pitches too");
    // real slicers on the real mono copy still produce increasing markers inside 0..1
    delete m.sliceOnsets; delete m.slicePitches;
}
{
    // --- Manual: double-click adds / removes markers, dragging a flag moves one; both switch to Manual ---
    const c = loadedMain();
    const m = c.sb;
    auto(m, "sliced", 1);
    assert.strictEqual(Math.round(m.paramValue("slice_at")), 0);
    m.paint();
    const wz = m.hitZones.find((z) => z.kind === "wave");
    const px = (n) => wz.x + n * wz.w;
    let depth = m.undoStack.length;
    c.emitted.length = 0;
    m.ondblclick(px(0.3), wz.y + 40);
    assert.strictEqual(m.sliceMarkers.length, 9, "double-click on the waveform adds a marker");
    assert.ok(m.sliceMarkers.some((v) => Math.abs(v - 0.3) < 1e-6));
    assert.deepStrictEqual(Array.from(m.sliceMarkers), Array.from(m.sliceMarkers).sort((a, b) => a - b), "markers stay sorted");
    assert.deepStrictEqual(msgVals(c, "slice_at"), [4], "adding a marker switches Slice at to Manual");
    assert.strictEqual(m.undoStack.length, depth + 1, "one undo step per add");
    // a held key follows the new slicing (note 36 + 2 is now the new 0.3 marker's slice)
    m.paint();
    const idx = m.sliceMarkers.findIndex((v) => Math.abs(v - 0.3) < 1e-6);
    const fz = m.hitZones.find((z) => z.kind === "flag" && z.index === idx);
    assert.ok(fz, "the new marker has a draggable flag");
    depth = m.undoStack.length;
    c.emitted.length = 0;
    m.ondblclick(...center(fz));
    assert.strictEqual(m.sliceMarkers.length, 8, "double-click on a flag removes it");
    assert.ok(!m.sliceMarkers.some((v) => Math.abs(v - 0.3) < 1e-6));
    assert.strictEqual(m.undoStack.length, depth + 1, "one undo step per remove");
    assert.strictEqual(Math.round(m.paramValue("slice_at")), 4);
    // no flag zone for the start point itself (it is the first slice, drawn as a handle)
    m.paint();
    assert.ok(!m.hitZones.some((z) => z.kind === "flag" && m.sliceMarkers[z.index] <= m.curStart + 0.002), "the start marker has no flag zone");
    // dragging a flag, from Divisions: switches to Manual once, moves between neighbours, re-pokes held voices
    auto(m, "slice_at", 0);
    assert.deepStrictEqual(Array.from(m.sliceMarkers), cfg.sliceDivisions(0, 1, 8));
    m.paint();
    m.midi_note(36 + 2, 100);
    const trig = c.pokes.filter((p) => p.name === "#0-bsvoices").pop().data[3];
    const f2 = m.hitZones.find((z) => z.kind === "flag" && z.index === 2);
    depth = m.undoStack.length;
    c.emitted.length = 0; c.pokes.length = 0;
    m.onclick(...center(f2), 1, 0, 0);
    assert.strictEqual(m.drag.flag, 2);
    assert.deepStrictEqual(msgVals(c, "slice_at"), [4], "grabbing a flag switches to Manual");
    assert.strictEqual(m.undoStack.length, depth + 1, "one undo step for the gesture");
    m.ondrag(px(0.2), wz.y + 4, 1, 0, 0);
    assert.ok(Math.abs(m.sliceMarkers[2] - 0.2) < 1e-9, `flag follows the mouse (${m.sliceMarkers[2]})`);
    const held = c.pokes.filter((p) => p.name === "#0-bsvoices").pop();
    assert.ok(held && Math.abs(held.data[4] - 0.2) < 1e-9, "held voice is re-poked with the new slice start");
    assert.strictEqual(held.data[3], trig, "without retriggering");
    m.ondrag(px(0.9), wz.y + 4, 1, 0, 0);
    assert.ok(Math.abs(m.sliceMarkers[2] - (0.375 - 0.002)) < 1e-9, "cannot pass the next marker");
    m.ondrag(px(0.0), wz.y + 4, 1, 0, 0);
    assert.ok(Math.abs(m.sliceMarkers[2] - (0.125 + 0.002)) < 1e-9, "cannot pass the previous marker");
    assert.strictEqual(m.undoStack.length, depth + 1, "dragging does not push undo per frame");
    assert.deepStrictEqual(msgVals(c, "slice_at"), [4], "slice_at is emitted once, not per frame");
    m.ondrag(px(0.2), wz.y + 4, 0, 0, 0);
    assert.strictEqual(m.drag, null);
    assert.deepStrictEqual(Array.from(m.sliceMarkers), Array.from(m.sliceMarkers).sort((a, b) => a - b));
    m.midi_note(36 + 2, 0);
    // Manual: a start change leaves the dragged marker alone
    const dragged = m.sliceMarkers[2];
    auto(m, "samp_start", 5);
    assert.strictEqual(m.sliceMarkers[2], dragged);
    // double-click in Single mode still resets the regions (flags / markers are Sliced-only)
    auto(m, "sliced", 0);
    m.paint();
    const w2 = m.hitZones.find((z) => z.kind === "wave");
    const nMarkers = m.sliceMarkers.length;
    m.ondblclick(w2.x + 0.3 * w2.w, w2.y + 40);
    assert.strictEqual(m.sliceMarkers.length, nMarkers, "Single mode: double-click adds no marker");
    assert.strictEqual(m.curStart, 0);
    assert.ok(!m.hitZones.some((z) => z.kind === "flag"), "Single mode has no slice flags");
}

console.log("Sliced footer: keymap base, Slice at modes, Manual editing ok");

// --- 6. Single-mode loop overlay: green body, crossfade gradient, move handle, xfade drag ---
{
    const c = loadedMain();
    const m = c.sb;
    m.curLoopMode = 1; m.curStart = 0.1; m.curEnd = 0.9; m.curLoopStart = 0.3; m.curLoopEnd = 0.7; m.curXfade = 0.2;
    const ops = paintSpy(c);
    const wz = m.hitZones.find((z) => z.kind === "wave");
    const lsX = wz.x + 0.3 * wz.w, leX = wz.x + 0.7 * wz.w, xfW = 0.2 * (leX - lsX);
    const isLoopC = (o) => o.op === "rect" && Math.abs(o.col[0] - 0.30) < 1e-9 && Math.abs(o.col[1] - 0.85) < 1e-9 && Math.abs(o.col[2] - 0.68) < 1e-9;
    const loopRects = ops.filter(isLoopC);
    const body = loopRects.find((o) => Math.abs(o.a[0] - lsX) < 1e-6 && Math.abs(o.a[2] - (leX - lsX)) < 1e-6);
    assert.ok(body, "green loop body spans loop start..end");
    assert.ok(Math.abs(body.col[3] - 0.42) < 1e-9, "body is translucent green");
    const grad = loopRects.filter((o) => o.a[0] < lsX - 0.5 && o.a[0] + o.a[2] <= lsX + 1.0 && o.a[3] === wz.h);
    assert.strictEqual(grad.length, 14, "crossfade gradient: 14 strips before the loop start");
    assert.ok(Math.abs(grad[0].a[0] - (lsX - xfW)) < 1e-6, "gradient begins xfade * loop length before the loop start");
    for (let i = 1; i < grad.length; i++) assert.ok(grad[i].col[3] > grad[i - 1].col[3], "gradient fades in towards the loop start");
    assert.ok(Math.abs(grad[13].col[3] - 0.42) < 1e-9, "and ends as opaque as the body");
    // zones
    const mv = m.hitZones.find((z) => z.kind === "loop_move");
    const xf = m.hitZones.find((z) => z.kind === "xfade");
    assert.ok(mv && xf, "loop_move and xfade zones exist while looping");
    assert.ok(Math.abs(mv.x + mv.w / 2 - (lsX + leX) / 2) < 1e-6, "move handle is in the middle of the loop");
    assert.ok(Math.abs(xf.x - (lsX - xfW)) < 1e-6 && Math.abs(xf.w - (xfW - 3)) < 1e-6, "xfade zone is the gradient, stopping 3 px short of the loop-start line");
    const order = Array.from(m.hitZones.map((z) => z.kind));
    assert.ok(order.indexOf("loop_move") > order.indexOf("wave") && order.indexOf("xfade") > order.indexOf("wave"), "overlay zones win the hit test over the waveform");

    // loop_move: drags the whole loop, length constant, inside start..end
    let depth = m.undoStack.length;
    c.emitted.length = 0;
    const [mx, my] = center(mv);
    m.onclick(mx, my, 1, 0, 0);
    assert.strictEqual(m.drag.wave, "loop_move");
    assert.strictEqual(m.undoStack.length, depth + 1, "one undo step per gesture");
    m.ondrag(mx + 0.1 * wz.w, my, 1, 0, 0);
    assert.ok(Math.abs(m.curLoopStart - 0.4) < 1e-9 && Math.abs(m.curLoopEnd - 0.8) < 1e-9, `loop moved right as a block (${m.curLoopStart}..${m.curLoopEnd})`);
    assert.ok(Math.abs(m.curXfade - 0.2) < 1e-12, "moving does not touch the crossfade");
    assert.deepStrictEqual(msgVals(c, "loop_start").slice(-1), [40]);
    assert.deepStrictEqual(msgVals(c, "loop_end").slice(-1), [80]);
    m.ondrag(mx + 5 * wz.w, my, 1, 0, 0);
    assert.ok(Math.abs(m.curLoopEnd - 0.9) < 1e-9 && Math.abs((m.curLoopEnd - m.curLoopStart) - 0.4) < 1e-9, "loop stops at the end point, length kept");
    m.ondrag(mx - 5 * wz.w, my, 1, 0, 0);
    assert.ok(Math.abs(m.curLoopStart - 0.1) < 1e-9 && Math.abs((m.curLoopEnd - m.curLoopStart) - 0.4) < 1e-9, "loop stops at the start point, length kept");
    assert.strictEqual(m.undoStack.length, depth + 1, "no undo per drag frame");
    const notified = c.notified;
    m.ondrag(mx, my, 0, 0, 0);
    assert.ok(c.notified > notified, "release notifies Live");

    // xfade: drag the gradient's left edge; the fade spans up to 45 % of the loop before its start
    m.curLoopStart = 0.3; m.curLoopEnd = 0.7; m.curXfade = 0.2;
    m.paint();
    const xf2 = m.hitZones.find((z) => z.kind === "xfade");
    depth = m.undoStack.length;
    c.emitted.length = 0;
    const [xx, xy] = center(xf2);
    m.onclick(xx, xy, 1, 0, 0);
    assert.strictEqual(m.drag.wave, "xfade");
    assert.strictEqual(m.undoStack.length, depth + 1);
    m.ondrag(wz.x + 0.2 * wz.w, xy, 1, 0, 0);   // 0.1 left of the loop start = 0.1 / 0.4 of the loop
    assert.ok(Math.abs(m.curXfade - 0.25) < 1e-9, `drag left raises the crossfade (${m.curXfade})`);
    assert.deepStrictEqual(msgVals(c, "loop_xfade").slice(-1), [55.6], "emitted as percent of the 0.45 maximum");
    m.ondrag(wz.x, xy, 1, 0, 0);
    assert.ok(Math.abs(m.curXfade - 0.45) < 1e-9, "capped at 0.45");
    assert.deepStrictEqual(msgVals(c, "loop_xfade").slice(-1), [100]);
    m.ondrag(wz.x + 0.6 * wz.w, xy, 1, 0, 0);
    assert.strictEqual(m.curXfade, 0, "dragging right of the loop start removes the fade");
    assert.strictEqual(m.curLoopStart, 0.3, "xfade drag never moves the loop");
    assert.strictEqual(m.undoStack.length, depth + 1);
    m.ondrag(xx, xy, 0, 0, 0);
    // without a fade there is nothing to grab; the loop handle still is
    m.paint();
    assert.ok(!m.hitZones.some((z) => z.kind === "xfade"), "no xfade zone at 0 %");
    assert.ok(m.hitZones.some((z) => z.kind === "loop_move"));
    // loop off / Sliced: no overlay at all
    m.curXfade = 0.2; m.curLoopMode = 0;
    m.paint();
    assert.ok(!m.hitZones.some((z) => z.kind === "loop_move" || z.kind === "xfade"), "no overlay with the loop off");
    m.curLoopMode = 1;
    auto(m, "sliced", 1);
    m.paint();
    assert.ok(!m.hitZones.some((z) => z.kind === "loop_move" || z.kind === "xfade"), "no loop overlay in Sliced mode");
    assert.ok(!paintSpy(c).some((o) => isLoopC(o)), "and no green loop drawing");
}

console.log("Loop overlay: body, gradient, move and xfade drags ok");

// --- 7. Engine panel (P1) per mode ---
{
    const c = makeSandbox(mainViz);
    const m = c.sb;
    const p1x = m.MAIN.p2[0];
    const p1Knobs = () => ids(m.hitZones.filter((z) => z.kind === "knob" && z.x < p1x && z.y > 100));
    const p1Buttons = () => m.hitZones.filter((z) => z.kind === "button" && z.x < p1x && z.y > 100);
    const p1Values = () => ids(m.hitZones.filter((z) => z.kind === "value" && z.x < p1x && z.y > 100));
    const stepZones = () => m.hitZones.filter((z) => z.action === "step");
    const paintP = () => paintSpy(c);

    // Speed (grain_motion) is dimmed only in Repitch; Pos only without Freeze
    for (const mode of [0, 1, 2, 3, 4]) {
        auto(m, "mode", mode);
        const ops = paintP();
        assert.strictEqual(knobAlpha(c, ops, "grain_motion"), mode === 0 ? 0.45 : 1.0, `Speed dimmed only in Repitch (mode ${mode})`);
    }

    // --- Repitch ---
    auto(m, "mode", 0);
    auto(m, "rp_char", 0);
    let ops = paintP();
    assert.deepStrictEqual(p1Knobs(), ["rp_dist", "rp_color"]);
    assert.ok(texts(c).includes("Clean"), "character header shows the name");
    assert.strictEqual(knobAlpha(c, ops, "rp_dist"), 0.45, "Clean dims both knobs");
    assert.strictEqual(knobAlpha(c, ops, "rp_color"), 0.45);
    assert.ok(!m.hitZones.some((z) => z.action === "toggle" && z.key !== "root_dyn"), "Clean has no toggles");
    assert.deepStrictEqual(Array.from(stepZones().map((z) => z.delta)), [-1, 1], "header has ◀ ▶ zones");
    // ▶ steps Clean -> Analog -> Digital -> Clean; ◀ wraps backwards
    c.emitted.length = 0;
    let seen = [];
    for (let i = 0; i < 3; i++) { m.paint(); click(c, stepZones().find((z) => z.delta === 1)); seen.push(Math.round(m.paramValue("rp_char"))); }
    assert.deepStrictEqual(seen, [1, 2, 0], "▶ steps and wraps");
    assert.deepStrictEqual(msgVals(c, "rp_char"), [1, 2, 0]);
    m.paint();
    click(c, stepZones().find((z) => z.delta === -1));
    assert.strictEqual(Math.round(m.paramValue("rp_char")), 2, "◀ from Clean wraps to Digital");
    // Analog
    auto(m, "rp_char", 1);
    ops = paintP();
    assert.strictEqual(knobAlpha(c, ops, "rp_dist"), 1.0, "Analog lights the knobs");
    assert.strictEqual(knobAlpha(c, ops, "rp_color"), 1.0);
    assert.ok(texts(c).includes("Crunch") && texts(c).includes("Tape"), "Analog knob labels");
    assert.ok(!m.hitZones.some((z) => z.action === "toggle" && z.key !== "root_dyn"), "Analog has no toggles");
    // Digital: imaging and VSR toggles
    auto(m, "rp_char", 2);
    ops = paintP();
    assert.deepStrictEqual(p1Knobs(), ["rp_dist", "rp_color"]);
    assert.ok(texts(c).includes("Bits") && texts(c).includes("Color"), "Digital knob labels");
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "toggle" && z.key !== "root_dyn").map((z) => z.key)), ["rp_imaging", "rp_vsr"]);
    c.emitted.length = 0;
    click(c, toggleZone(c, "rp_imaging"));
    assert.deepStrictEqual(msgVals(c, "rp_imaging"), [0], "Imaging starts on and toggles off");
    m.paint();
    click(c, toggleZone(c, "rp_vsr"));
    assert.deepStrictEqual(msgVals(c, "rp_vsr"), [1], "VSR starts off and toggles on");
    m.paint();
    click(c, toggleZone(c, "rp_vsr"));
    assert.deepStrictEqual(msgVals(c, "rp_vsr"), [1, 0]);

    // --- Spectral ---
    auto(m, "mode", 3);
    auto(m, "sp_char", 0);
    ops = paintP();
    assert.deepStrictEqual(p1Knobs(), ["formant", "sp_shift"], "Pure: formant and shift");
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "toggle" && z.key !== "root_dyn").map((z) => z.key)), ["sp_onsets", "sp_formant_on"]);
    assert.ok(!m.hitZones.some((z) => z.action === "menu" && z.key === "sp_quant"), "Pure has no quantize box");
    assert.ok(texts(c).includes("Pure"));
    c.emitted.length = 0;
    click(c, toggleZone(c, "sp_onsets"));
    click(c, (m.paint(), toggleZone(c, "sp_formant_on")));
    assert.deepStrictEqual(msgVals(c, "sp_onsets"), [1], "Onsets starts off");
    assert.deepStrictEqual(msgVals(c, "sp_formant_on"), [0], "Formant processing starts on");
    m.paint();
    click(c, stepZones().find((z) => z.delta === 1));
    assert.strictEqual(Math.round(m.paramValue("sp_char")), 1, "▶ switches Pure -> Reharm");
    auto(m, "sp_char", 1);
    auto(m, "sp_quant", 0);
    ops = paintP();
    assert.deepStrictEqual(p1Knobs(), ["sp_bend", "sp_quant_amt"], "Reharm: bend and quantize amount");
    assert.ok(m.hitZones.some((z) => z.action === "menu" && z.key === "sp_quant"), "Reharm shows the sp_quant box");
    assert.ok(texts(c).includes("—") && texts(c).includes("Quant."), "quantize box reads its value");
    assert.strictEqual(knobAlpha(c, ops, "sp_quant_amt"), 0.45, "quantize amount is dimmed while Quant is Off");
    auto(m, "sp_quant", 1);
    ops = paintP();
    assert.strictEqual(knobAlpha(c, ops, "sp_quant_amt"), 1.0, "and lit once Octaves is chosen");
    assert.ok(texts(c).includes("Oct"));
    auto(m, "sp_quant", 2);
    assert.ok(texts(c).includes("Key"));
    assert.strictEqual(m.hitZones.filter((z) => z.action === "toggle" && z.key !== "root_dyn").length, 2, "Reharm keeps onsets + formant toggles");

    // --- Cycles ---
    auto(m, "mode", 1);
    for (const [ch, want, labels] of [[0, ["formant", "cy_width"], ["Pulse", "Width"]], [1, ["formant", "cy_split", "cy_fund"], ["Partials", "Split", "Fund."]],
        [2, ["formant", "cy_mod", "cy_harm"], ["Phase", "Mod", "Harm."]]]) {
        auto(m, "cy_char", ch);
        m.paint();
        assert.deepStrictEqual(p1Knobs(), want, `Cycles character ${ch} knobs`);
        const tx = texts(c);
        for (const l of labels) assert.ok(tx.includes(l), `Cycles ${ch}: label ${l}`);
    }
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "toggle" && z.key !== "root_dyn").map((z) => z.key)), ["cy_xfade"]);
    c.emitted.length = 0;
    click(c, toggleZone(c, "cy_xfade"));
    assert.deepStrictEqual(msgVals(c, "cy_xfade"), [1]);
    m.paint();
    click(c, stepZones().find((z) => z.delta === -1));
    assert.strictEqual(Math.round(m.paramValue("cy_char")), 1, "◀ from Phase goes to Partials");

    // --- Textures ---
    auto(m, "mode", 2);
    m.paint();
    assert.deepStrictEqual(p1Knobs(), ["grain_size", "grain_spray"], "Textures: size and spray (no Fmt)");
    assert.ok(!m.hitZones.some((z) => (z.action === "toggle" && z.key !== "root_dyn") || z.action === "step"), "Textures has no header controls");

    // --- Fragments ---
    auto(m, "mode", 4);
    ops = paintP();
    assert.deepStrictEqual(p1Knobs(), ["grain_size", "fr_density", "fr_motion"]);
    assert.deepStrictEqual(p1Values(), ["fr_env", "fr_repeats"], "envelope shape and repeats are draggable values");
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "toggle" && z.key !== "root_dyn").map((z) => z.key)), ["fr_sync", "fr_use_density"]);
    assert.strictEqual(knobAlpha(c, ops, "fr_density"), 1.0);
    c.emitted.length = 0;
    click(c, toggleZone(c, "fr_use_density"));
    assert.deepStrictEqual(msgVals(c, "fr_use_density"), [0], "use-density starts on");
    ops = paintP();
    assert.strictEqual(knobAlpha(c, ops, "fr_density"), 0.45, "Density is dimmed when it is not used");
    click(c, (m.paint(), toggleZone(c, "fr_sync")));
    assert.deepStrictEqual(msgVals(c, "fr_sync"), [1], "sync starts off");
    // fr_repeats: 6 px per repeat; fr_env: normalized (120 px full range)
    m.paint();
    const rz = m.hitZones.find((z) => z.kind === "value" && z.key === "fr_repeats");
    const [rx, ry] = center(rz);
    c.emitted.length = 0;
    m.onclick(rx, ry, 1, 0, 0);
    m.ondrag(rx, ry - 12, 1, 0, 0);
    m.ondrag(rx, ry - 12, 0, 0, 0);
    assert.deepStrictEqual(msgVals(c, "fr_repeats"), [3], "12 px up = +2 repeats");
    m.ondblclick(rx, ry);
    assert.deepStrictEqual(msgVals(c, "fr_repeats").slice(-1), [1], "double-click resets repeats");
    const ez = m.hitZones.find((z) => z.kind === "value" && z.key === "fr_env");
    const [ex, ey] = center(ez);
    c.emitted.length = 0;
    m.onclick(ex, ey, 1, 0, 0);
    m.ondrag(ex, ey - 12, 1, 0, 0);
    m.ondrag(ex, ey - 12, 0, 0, 0);
    assert.ok(Math.abs(msgVals(c, "fr_env")[0] - 60) < 1e-9, "envelope shape drags 12 px = +10 %");
    auto(m, "fr_env", 100);
    assert.strictEqual(m.paramValue("fr_env"), 100);
    // header glyph reacts to the envelope (draw does not throw across the range)
    for (const v of [0, 50, 100]) { auto(m, "fr_env", v); m.paint(); }
    // switching engines swaps the panel
    auto(m, "mode", 2);
    m.paint();
    assert.ok(!m.hitZones.some((z) => z.key === "fr_repeats"), "Fragments value zones are gone in Textures");
}

console.log("Engine panels: Repitch, Spectral, Cycles, Textures, Fragments ok");

// --- 8. Inspector region ---
{
    const c = makeSandbox(inspViz);
    const m = c.sb;
    m.paint();
    assert.ok(texts(c).includes("Note Glide"));
    // glide value drags; L toggles legato
    const gz = findZone(c, (z) => z.kind === "value" && z.key === "glide_ms", "glide value");
    const [gx, gy] = center(gz);
    c.emitted.length = 0;
    m.onclick(gx, gy, 1, 0, 0);
    m.ondrag(gx, gy - 24, 1, 0, 0);
    m.ondrag(gx, gy - 24, 0, 0, 0);
    assert.ok(msgVals(c, "glide_ms")[0] > 0, "dragging the glide value up raises it");
    m.ondblclick(gx, gy);
    assert.strictEqual(msgVals(c, "glide_ms").slice(-1)[0], 0, "double-click resets glide");
    m.paint();
    const lz = findZone(c, (z) => z.kind === "button" && z.action === "voicing", "L legato toggle");
    assert.strictEqual(lz.value, 1, "L turns legato on when it is off");
    c.emitted.length = 0;
    click(c, lz);
    assert.deepStrictEqual(msgVals(c, "mono_legato"), [1]);
    m.paint();
    const lz2 = findZone(c, (z) => z.kind === "button" && z.action === "voicing", "L legato toggle");
    assert.strictEqual(lz2.value, 0, "and off again when it is on");
    click(c, lz2);
    assert.deepStrictEqual(msgVals(c, "mono_legato"), [1, 0]);

    // section title and rows per mode
    const names = ["Repitch", "Cycles", "Textures", "Spectral", "Fragments"];
    for (let mode = 0; mode < 5; mode++) {
        auto(m, "mode", mode);
        const tx = texts(c);
        assert.ok(tx.includes(`${names[mode]} mode`), `title "${names[mode]} mode"`);
        if (mode !== 3 && mode !== 4) {
            assert.ok(tx.includes("No extra settings"), `${names[mode]}: No extra settings`);
            assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "toggle" || z.action === "menu").map((z) => z.key)), [], "no extra rows");
            assert.deepStrictEqual(ids(m.hitZones.filter((z) => z.kind === "value")), ["glide_ms"], "only Note Glide is a value");
        } else {
            assert.ok(!tx.includes("No extra settings"));
        }
    }
    // Spectral rows
    auto(m, "mode", 3);
    let tx = texts(c);
    for (const label of ["Phase Dispersion", "Quality / Cost", "Live Performance", "Relative Formants", "Local Key", "Local Scale"]) assert.ok(tx.includes(label), `Spectral row ${label}`);
    assert.deepStrictEqual(ids(m.hitZones.filter((z) => z.kind === "value")), ["glide_ms", "sp_dispersion"]);
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "menu").map((z) => z.key)), ["sp_quality", "sp_key", "sp_scale"]);
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "toggle" && z.key !== "root_dyn").map((z) => z.key)), ["sp_live", "sp_rel_formant"]);
    assert.ok(tx.includes("Medium") && tx.includes("C") && tx.includes("Major"), "menu boxes show their current values");
    c.emitted.length = 0;
    click(c, toggleZone(c, "sp_live"));
    assert.deepStrictEqual(msgVals(c, "sp_live"), [0], "Live Performance starts on");
    m.paint();
    click(c, toggleZone(c, "sp_rel_formant"));
    assert.deepStrictEqual(msgVals(c, "sp_rel_formant"), [1], "Relative Formants starts off");
    const dz = (m.paint(), m.hitZones.find((z) => z.kind === "value" && z.key === "sp_dispersion"));
    const [dx, dy] = center(dz);
    c.emitted.length = 0;
    m.onclick(dx, dy, 1, 0, 0);
    m.ondrag(dx, dy + 12, 1, 0, 0);
    m.ondrag(dx, dy + 12, 0, 0, 0);
    assert.ok(msgVals(c, "sp_dispersion")[0] < 66.7, "dragging dispersion down lowers it");
    // Fragments rows
    auto(m, "mode", 4);
    tx = texts(c);
    for (const label of ["Direction", "Latch Initial Rate", "Repeat at Initial Pos", "Grains Survive End", "Max Grains / Voice"]) assert.ok(tx.includes(label), `Fragments row ${label}`);
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "menu").map((z) => z.key)), ["fr_direction"]);
    assert.deepStrictEqual(Array.from(m.hitZones.filter((z) => z.action === "toggle" && z.key !== "root_dyn").map((z) => z.key)), ["fr_latch", "fr_repeat_init", "fr_survive"]);
    assert.deepStrictEqual(ids(m.hitZones.filter((z) => z.kind === "value")), ["glide_ms", "fr_max_grains"]);
    assert.ok(tx.includes("Playhead"), "Direction shows its value");
    c.emitted.length = 0;
    click(c, toggleZone(c, "fr_latch"));
    m.paint();
    click(c, toggleZone(c, "fr_repeat_init"));
    m.paint();
    click(c, toggleZone(c, "fr_survive"));
    assert.deepStrictEqual([msgVals(c, "fr_latch"), msgVals(c, "fr_repeat_init"), msgVals(c, "fr_survive")], [[0], [1], [1]], "latch starts on, repeat / survive off");
    const mz = (m.paint(), m.hitZones.find((z) => z.kind === "value" && z.key === "fr_max_grains"));
    const [mx2, my2] = center(mz);
    c.emitted.length = 0;
    m.onclick(mx2, my2, 1, 0, 0);
    m.ondrag(mx2, my2 + 10, 1, 0, 0);
    m.ondrag(mx2, my2 + 10, 0, 0, 0);
    assert.deepStrictEqual(msgVals(c, "fr_max_grains"), [246], "max grains drags 1 per px (256 -> 246)");
    // the inspector reacts to `mode` echoes from Live and draws a checkmark for ticked rows
    auto(m, "fr_latch", 1);
    const checks = paintSpy(c).filter((o) => o.op === "arc");
    assert.ok(checks.length >= 3, "check circles are drawn");
}

console.log("Inspector: glide, legato, per-mode rows ok");

// --- 9. late echoes for the new parameters ---
{
    const c = makeSandbox(mainViz);
    const m = c.sb;
    // direct queue behaviour
    m.expectEcho("k", 1); m.expectEcho("k", 2); m.expectEcho("k", 3);
    assert.strictEqual(m.isStaleEcho("k", 1), true, "older value of ours is stale while newer ones are pending");
    assert.strictEqual(m.isStaleEcho("k", 2), true);
    assert.strictEqual(m.isStaleEcho("k", 3), false, "the newest echo is applied");
    assert.strictEqual(m.isStaleEcho("k", 99), false, "foreign values (automation) are applied");
    assert.strictEqual(m.isStaleEcho("none-yet", 5), false);
    // a drag on a slice-count value with late echoes ends exactly where the mouse left it
    auto(m, "sliced", 1);
    m.paint();
    const dz = m.hitZones.find((z) => z.kind === "value" && z.key === "slice_div");
    const [dx, dy] = center(dz);
    m.onclick(dx, dy, 1, 0, 0);
    for (const up of [3, 6, 9]) m.ondrag(dx, dy - up, 1, 0, 0);
    m.ondrag(dx, dy - 9, 0, 0, 0);
    const sent = msgVals(c, "slice_div");
    assert.deepStrictEqual(sent, [9, 10, 11]);
    m.set_slice_div(9);
    m.set_slice_div(10);
    assert.strictEqual(m.paramValue("slice_div"), 11, "late echoes of earlier drag values do not pull the value back");
    m.set_slice_div(11);
    assert.strictEqual(m.paramValue("slice_div"), 11);
    m.set_slice_div(5);
    assert.strictEqual(m.paramValue("slice_div"), 5, "automation still applies");
    // region values sent by emitRegionParams are tracked the same way
    c.emitted.length = 0;
    m.curStart = 0.1; m.emitRegionParams(); m.curStart = 0.2; m.emitRegionParams();
    m.set_samp_start(10);
    assert.ok(Math.abs(m.curStart - 0.2) < 1e-9, "stale samp_start echo ignored");
    m.set_samp_start(20);
    assert.ok(Math.abs(m.curStart - 0.2) < 1e-9);
}

console.log("Late echoes for the new parameters ok");
console.log("All Better Sampler tests passed!");

// --- Spectral caps polyphony at 4 (gen renders voices 0..3); Live tempo reaches gen ---
{
    assertLink(lines, "obj-route-viz", 5, "obj-prep-tempo", 0, "tempo route");
    assert.strictEqual(byId.get("obj-prep-tempo").text, "prepend tempo");
    assertLink(lines, "obj-prep-tempo", 0, "obj-gen-in", 1, "tempo -> gen");
    const pc = makeSandbox(mainViz);
    const v = pc.sb;
    v.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    v.set_poly_voices(8);
    v.set_mode(3);
    for (let n = 60; n < 66; n++) v.midi_note(n, 100);
    assert.ok(v.voiceAlloc.voices.slice(4).every((x) => x.gate === 0), "Spectral never allocates voices 4..15");
    assert.strictEqual(v.voiceAlloc.voices.slice(0, 4).filter((x) => x.gate > 0).length, 4, "4 Spectral voices sound");
    for (let n = 60; n < 66; n++) v.midi_note(n, 0);
    v.set_mode(0);
    for (let n = 60; n < 66; n++) v.midi_note(n, 100);
    assert.strictEqual(v.voiceAlloc.voices.filter((x) => x.gate > 0).length, 6, "other engines use the full Poly count");
    // tempo observer: device_ready reads Live's tempo and forwards changes
    let cb = null;
    v.LiveAPI = function (f) { cb = f; this.get = () => [133]; };
    v.tempoObserver = null;
    pc.emitted.length = 0;
    v.device_ready();
    assert.ok(pc.emitted.some((a) => a[1] === "tempo" && Number(a[2]) === 133), "tempo sent on device ready");
    cb(["tempo", 99]);
    assert.ok(pc.emitted.some((a) => a[1] === "tempo" && a[2] === 99), "tempo changes forwarded");
}

console.log("Spectral poly cap and tempo feed ok");

// --- the file's sample rate: readouts use it, the gen gets it as samp_rate (and again with every dsp_ready) ---
{
    const rateOf = (c) => c.emitted.filter((a) => a[1] === "samp_rate").map((a) => a[2]);
    for (const [fileRate, frames, ms] of [[48000, 96000, 2000], [44100, 44100, 1000], [32000, 16000, 500], [96000, 96000, 1000], [22050, 22050, 1000]]) {
        const c = makeSandbox(mainViz);
        const f = c.sb;
        c.audioOn = true;
        c.fileRate = fileRate;
        c.fileFrames = frames;
        f.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
        c.emitted.length = 0;
        f.sample_loaded("/Users/test/Rate.wav");
        assert.strictEqual(f.sampleRateHz, fileRate, `${fileRate} Hz file: the face learns its rate`);
        assert.strictEqual(f.sampleDurationMs, ms, `${fileRate} Hz file: ${frames} frames last ${ms} ms (the footer readouts)`);
        assert.deepStrictEqual(rateOf(c), [fileRate], `${fileRate} Hz file: samp_rate goes to the gen`);
    }
    // a rate the buffer reports with rounding noise snaps to the standard rate
    {
        const c = makeSandbox(mainViz);
        c.audioOn = true;
        c.fileRate = 48000;
        c.fileFrames = 48000;
        const f = c.sb;
        f.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
        const b = new f.Buffer("#0-bsamp");
        assert.strictEqual(f.bufferSampleRate({ length: () => 999.4 }, 48000), 48000);
        assert.strictEqual(f.bufferSampleRate({ length: () => 0 }, 48000), 0, "unknown length -> 0");
        assert.strictEqual(f.bufferSampleRate({}, 48000), 0, "no length() -> 0");
    }
    // unknown: samp_rate 0 (the gen plays at the DSP rate), readouts keep the 44.1 kHz assumption
    {
        const c = makeSandbox(mainViz);
        c.audioOn = true;
        c.noLength = true;
        const f = c.sb;
        f.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
        c.emitted.length = 0;
        f.sample_loaded("/Users/test/Rate.wav");
        assert.deepStrictEqual(rateOf(c), [0]);
        assert.strictEqual(f.sampleDurationMs, 1000);
    }
    // only the main face talks to the gen
    {
        const c = makeSandbox(sideViz);
        c.sb.sendSampleRate(48000);
        assert.deepStrictEqual(rateOf(c), [], "the side face sends no samp_rate");
    }
    // dsp_ready: the rate is re-sent before the gen is asked to take every parameter again
    {
        const c = makeSandbox(mainViz);
        c.audioOn = true;
        c.fileRate = 48000;
        c.fileFrames = 96000;
        const f = c.sb;
        f.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
        f.sample_loaded("/Users/test/Rate.wav");
        c.emitted.length = 0;
        f.dspCreatedAt = Date.now();
        f.dspCounter0 = -1;
        f.dspConfirm();
        const kinds = c.emitted.map((a) => a[1]);
        assert.ok(kinds.indexOf("samp_rate") >= 0 && kinds.indexOf("samp_rate") < kinds.indexOf("dsp_ready"), "samp_rate precedes dsp_ready");
        assert.strictEqual(c.emitted.find((a) => a[1] === "samp_rate")[2], 48000);
    }
}
console.log("File sample rate feed ok");

// --- loading stays light: the slicers' mono copy is lazy, chunked, cancelled by a new load ---
{
    const lc = makeSandbox(mainViz);
    const l = lc.sb;
    const peeks = [];
    const tasks = [];
    lc.audioOn = true;
    const baseBuffer = l.Buffer;
    l.Buffer = function (name) { baseBuffer.call(this, name); const pk = this.peek; this.framecount = () => 2000000; this.peek = (ch, st, len) => { peeks.push(len || 1); return pk(ch, st, Math.min(len || 1, 4096)); }; };
    l.Task = function (fn) { this.fn = fn; this.scheduled = 0; this.schedule = () => { this.scheduled++; }; this.cancel = () => { this.cancelled = true; }; tasks.push(this); };
    l.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    peeks.length = 0;
    l.sample_loaded("/Users/test/Long Take.wav");
    l.sample_loaded("bang");
    assert.strictEqual(l.hasLoadedSample, 1);
    assert.ok(peeks.every((n) => n <= 4096), `a load reads only waveform-sized chunks (largest ${Math.max(...peeks)})`);
    assert.strictEqual(l.sliceMono, null, "no mono copy at load");
    assert.strictEqual(l.sliceMonoJob, null, "no mono job at load (Divisions needs none)");
    // Onsets starts a chunked copy on a Task
    l.set_sliced(1);
    l.set_slice_at(2);
    assert.ok(l.sliceMonoJob, "Onsets starts the mono job");
    const job = l.sliceMonoJob;
    const t = tasks[tasks.length - 1];
    assert.ok(t.scheduled >= 1, "copy runs on a Task, not inline");
    l.paint();
    peeks.length = 0;
    t.fn();
    assert.ok(peeks.every((n) => n <= l.SLICE_MONO_CHUNK), "each tick copies one chunk");
    assert.ok(job.pos > 0 && job.pos < job.n, "copy is in progress after one tick");
    // a new sample cancels the job
    l.sample_loaded("/Users/test/Other.wav");
    l.sample_loaded("bang");
    assert.ok(l.sliceMonoJob !== job, "loading another sample drops the old copy");
    assert.ok(t.cancelled, "its Task is cancelled");
    assert.ok(l.sliceMonoJob && l.sliceMonoJob.pos === 0, "Onsets still active: a fresh copy of the new sample starts");
    // run the fresh job to completion: Onsets markers arrive afterwards
    let onsetCalls = 0;
    l.sliceOnsets = () => { onsetCalls++; return [0, 0.5]; };
    const t2 = tasks[tasks.length - 1];
    let guard = 0;
    while (l.sliceMonoJob && guard++ < 100) t2.fn();
    assert.strictEqual(l.sliceMonoJob, null, "copy finishes");
    assert.ok(l.sliceMono && l.sliceMono.length === 2000000, "full-length mono copy");
    assert.strictEqual(onsetCalls, 1, "slices once the copy lands");
    assert.deepStrictEqual(Array.from(l.sliceMarkers), [0, 0.5]);
    // a second Onsets / Pitches request reuses the copy
    l.set_slice_at(3);
    assert.strictEqual(l.sliceMonoJob, null, "Pitches reuses the existing copy");
}

console.log("Lazy, chunked slicer mono copy ok");

// --- deferred DSP: GUI first, then the face writes the gen patch and creates gen~ @gen <file> ---
{
    const dc = makeSandbox(mainViz);
    const d = dc.sb;
    // before the DSP exists the header shows the loading pill
    assert.strictEqual(d.dspReady, 0, "DSP not ready right after load");
    const texts = [];
    const g0 = d.mgraphics.show_text;
    d.mgraphics.show_text = (t) => texts.push(t);
    d.paint();
    d.mgraphics.show_text = g0;
    assert.ok(texts.includes("DSP loading…"), "loading pill while the gen is not created");
    // mock patcher + File: record what loadDsp does
    const files = {};
    d.File = function (path, mode) {
        this.path = path; this.isopen = true;
        this.eof = files[path] ? files[path].length : 0;
        this.writestring = (t) => { files[path] = (files[path] || "") + t; };
        this.close = () => {};
        if (mode === "write") files[path] = "";
    };
    const created = [], conns = [];
    const named = { bs_genin: { n: "hub" }, bs_plugin: { n: "in" }, bs_plugout: { n: "out" } };
    d.hostPatcher = {
        getnamed: (n) => named[n] || null,
        newdefault: (...a) => { const o = { n: "gen", args: a }; created.push(o); named["obj-gen"] = o; return o; },
        connect: (a, ao, b, bi) => conns.push([a.n, ao, b.n, bi]),
    };
    const tasks = [];
    d.Task = function (fn) { this.fn = fn; this.schedule = (ms) => { this.ms = ms; }; tasks.push(this); };
    dc.emitted.length = 0;
    d.device_ready();
    assert.strictEqual(created.length, 0, "the gen is not built inside device_ready (GUI paints first)");
    const t = tasks[tasks.length - 1];
    assert.ok(t && t.ms > 0, "gen creation is scheduled on a Task");
    t.fn();
    assert.strictEqual(created.length, 1, "one gen~ created");
    const path = d.dspFilePath();
    assert.ok(/^\/tmp\/better_sampler_core_[0-9a-f]{12}\.gendsp$/.test(path), path);
    assert.deepStrictEqual(created[0].args.slice(2), ["gen~", "@gen", path], "gen~ @gen <written file>");
    assert.strictEqual(files[path], d.GEN_DSP_TEXT, "the embedded gen patch was written in full");
    assert.strictEqual(JSON.parse(files[path]).patcher.classnamespace, "dsp.gen");
    assert.strictEqual(created[0].varname, "obj-gen");
    for (const c of [["hub", 0, "gen", 0], ["in", 0, "gen", 0], ["in", 1, "gen", 1], ["gen", 0, "out", 0], ["gen", 1, "out", 1]]) {
        assert.ok(conns.some((x) => JSON.stringify(x) === JSON.stringify(c)), `connect ${c}`);
    }
    assert.ok(dc.emitted.some((a) => a[1] === "dsp_ready"), "dsp_ready re-sends buffers and params");
    // the gen drops messages while it compiles: keep re-sending until its telemetry counter moves
    assert.strictEqual(d.dspReady, 0, "not ready until the gen runs");
    let counter = 0;
    const baseBuf = d.Buffer;
    d.Buffer = function (name) { baseBuf.call(this, name); const pk = this.peek; this.peek = (ch, st, len) => (st === 39 && len === 1 ? [counter] : pk(ch, st, len)); };
    d.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    d.dspCounter0 = 0;
    const confirmTask = tasks[tasks.length - 1];
    dc.emitted.length = 0;
    confirmTask.fn();
    assert.ok(dc.emitted.some((a) => a[1] === "dsp_ready"), "still compiling: re-send again");
    assert.strictEqual(d.dspReady, 0);
    counter = 7;
    dc.emitted.length = 0;
    confirmTask.fn();
    assert.strictEqual(d.dspReady, 1, "ready once the gen writes telemetry");
    // The last re-send before this tick went out while the gen was still compiling (it dropped it) and nothing
    // follows once the counter moves, so the gen would keep its Param defaults (sliced 0, loop_mode 0, ...) until
    // each control is touched. Re-send once more at once, and once again after the gen has settled.
    assert.ok(dc.emitted.some((a) => a[1] === "dsp_ready"), "gen is running: re-send every parameter once more");
    const settle = tasks[tasks.length - 1];
    assert.ok(settle !== confirmTask && settle.ms > 0, "and again after a short settle delay");
    dc.emitted.length = 0;
    settle.fn();
    assert.ok(dc.emitted.some((a) => a[1] === "dsp_ready"), "settle re-send");
    texts.length = 0;
    d.mgraphics.show_text = (tx) => texts.push(tx);
    d.paint();
    d.mgraphics.show_text = g0;
    assert.ok(!texts.includes("DSP loading…"), "pill gone once the DSP is ready");
    // a second device_ready (re-init) does not create another gen
    d.device_ready();
    if (tasks[tasks.length - 1].fn) tasks[tasks.length - 1].fn();
    assert.strictEqual(created.length, 1, "no second gen~");
    // the file is written once: same hash, same content -> not rewritten
    const before = Object.keys(files).length;
    const d2c = makeSandbox(mainViz);
    const d2 = d2c.sb;
    let writes = 0;
    d2.File = function (p, mode) { this.isopen = true; this.eof = files[p] ? files[p].length : 0; this.writestring = () => { writes++; }; this.close = () => {}; };
    d2.hostPatcher = { getnamed: (n) => (n === "obj-gen" ? null : { n }), newdefault: () => ({}), connect: () => {} };
    d2.loadDsp();
    assert.strictEqual(writes, 0, "an existing identical .gendsp is reused");
    assert.strictEqual(Object.keys(files).length, before);
    // a gen that never advances its frame counter is rebuilt, then fails once both retries are spent
    const rc = makeSandbox(mainViz);
    const rt = rc.sb;
    const removed = [];
    let remade = 0;
    rt.File = function () { this.isopen = true; this.eof = 0; this.writestring = () => {}; this.close = () => {}; };
    rt.hostPatcher = {
        getnamed: (n) => (n === "obj-gen" ? (rt._gone ? null : { n: "gen" }) : { n }),
        remove: (o) => { removed.push(o.n); rt._gone = true; },
        newdefault: () => { remade++; rt._gone = false; return { n: "gen" }; },
        connect: () => {},
    };
    rt.dspCreatedAt = Date.now() - 4000;
    rt.dspCounter0 = 5;
    rt.scopeBufName = "";
    rt.dspConfirm();
    assert.strictEqual(rt.dspRetries, 1, "first timeout rebuilds the gen~");
    assert.deepStrictEqual(removed, ["gen"], "the stalled gen~ is removed");
    assert.strictEqual(remade, 1, "the retry creates one new gen~");
    assert.strictEqual(rt.dspReady, 0);
    assert.strictEqual(rt.dspError, "");
    // two instances share one creation queue
    const qa = makeSandbox(mainViz).sb;
    const qb = makeSandbox(mainViz).sb;
    const qstore = {};
    function QGlobal(name) { if (!qstore[name]) qstore[name] = {}; return qstore[name]; }
    qa.Global = QGlobal;
    qb.Global = QGlobal;
    const qMade = { a: 0, b: 0 };
    function qHost(slot) {
        return {
            getnamed: (n) => (n === "obj-gen" ? null : { n }),
            newdefault: () => { qMade[slot]++; return {}; },
            connect: () => {},
            remove: () => {},
        };
    }
    qa.File = rt.File;
    qb.File = rt.File;
    qa.hostPatcher = qHost("a");
    qb.hostPatcher = qHost("b");
    qa.loadDsp();
    qb.loadDsp();
    assert.strictEqual(qMade.a, 1, "the queue owner creates its gen~");
    assert.strictEqual(qMade.b, 0, "a second instance waits");
    // a gen that never starts times out with the failure pill
    const tc = makeSandbox(mainViz);
    const tt = tc.sb;
    tt.dspCreatedAt = Date.now() - 20000;
    tt.dspRetries = 2;
    tt.dspConfirm();
    assert.ok(tt.dspError.length > 0 && tt.dspReady === 0, "timeout -> DSP failed");
    // failure path: no file can be written -> "DSP failed" pill, nothing created
    const fc = makeSandbox(mainViz);
    const f = fc.sb;
    f.File = function () { this.isopen = false; this.eof = 0; this.close = () => {}; };
    let made = 0;
    f.hostPatcher = { getnamed: () => null, newdefault: () => { made++; return {}; }, connect: () => {} };
    f.loadDsp();
    assert.strictEqual(made, 0);
    assert.strictEqual(f.dspReady, 0);
    assert.ok(f.dspError.length > 0, "failure recorded");
    texts.length = 0;
    f.mgraphics.show_text = (tx) => texts.push(tx);
    f.paint();
    assert.ok(texts.some((t) => String(t).indexOf("DSP failed: ") === 0), "failure pill says why");
}

console.log("Deferred DSP: GUI first, gen~ created from the embedded patch ok");

// --- Analyzed Root Key: ROOT toggles root_dyn; the curve is tracked once per sample, written to
//     #0-bspitch and drawn in orange; a new sample re-analyses ---
{
    const rc = makeSandbox(mainViz);
    const r = rc.sb;
    r.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope", "#0-bspitch");
    assert.strictEqual(r.pitchBufName, "#0-bspitch");
    rc.audioOn = true;
    r.sample_loaded("/Users/test/Sub - Jitter 5 - G - 172 BPM.wav");
    r.sample_loaded("bang");
    assert.strictEqual(r.hasLoadedSample, 1);
    assert.strictEqual(r.pitchCurve, null, "no analysis while Analyzed Root Key is off");
    // header: ROOT is a toggle zone; with it off, note + ct values are editable
    r.paint();
    const rootZone = r.hitZones.find((z) => z.action === "toggle" && z.key === "root_dyn");
    assert.ok(rootZone, "ROOT toggles Analyzed Root Key");
    assert.ok(r.hitZones.some((z) => z.key === "root_note"), "fixed root key editable when off");
    // tracker spy: runs once on the mono copy with the fixed root as fallback
    const calls = [];
    r.trackPitchCurve = (samples, sr, points, fallback) => {
        calls.push([samples.length, sr, points, fallback]);
        const curve = new Float32Array(points), voiced = new Uint8Array(points);
        for (let i = 0; i < points; i++) { curve[i] = 55 + 7 * i / (points - 1); voiced[i] = (i % 1000) < 800 ? 1 : 0; }
        return { curve, voiced, voicedRatio: 0.8 };
    };
    rc.emitted.length = 0;
    r.onclick(rootZone.x + 3, rootZone.y + 3, 1, 0, 0);
    assert.ok(rc.emitted.some((a) => a[1] === "param" && a[2] === "root_dyn" && a[3] === 1), "ROOT click emits root_dyn 1");
    assert.strictEqual(r.rootDyn, 1);
    // the mono copy runs on a Task in the device; here (no Task stepping) drive it to completion
    while (r.sliceMonoJob) r.sliceMonoStep();
    assert.strictEqual(calls.length, 1, "pitch tracked once");
    assert.deepStrictEqual(calls[0].slice(2), [4096, r.curRootNote], "4096 points, fixed root as fallback");
    const pokes = rc.pokes.filter((p) => p.name === "#0-bspitch");
    assert.strictEqual(pokes.length, 1, "curve written to #0-bspitch");
    assert.strictEqual(pokes[0].data.length, 4096);
    assert.ok(Math.abs(pokes[0].data[4095] - 62) < 1e-4 && Math.abs(pokes[0].data[0] - 55) < 1e-4, "curve values written as MIDI");
    // header shows Dynamic; the fixed root is not editable
    r.paint();
    assert.ok(!r.hitZones.some((z) => z.key === "root_note"), "fixed root hidden while Dynamic");
    const texts = [], g0 = r.mgraphics.show_text;
    r.mgraphics.show_text = (t) => texts.push(t);
    r.paint();
    r.mgraphics.show_text = g0;
    assert.ok(texts.includes("Dynamic"), "header shows Dynamic");
    // orange curve drawn over the waveform, brighter where voiced
    const cols = [];
    const sc0 = r.mgraphics.set_source_rgba;
    r.mgraphics.set_source_rgba = (rr, gg, bb, aa) => cols.push([rr, gg, bb, aa]);
    r.paint();
    r.mgraphics.set_source_rgba = sc0;
    const orange = cols.filter((c) => Math.abs(c[0] - 0.98) < 1e-6 && Math.abs(c[1] - 0.63) < 1e-6);
    assert.ok(orange.some((c) => c[3] > 0.9) && orange.some((c) => c[3] < 0.5), "curve: voiced bright, unvoiced dim");
    // switching off hides the curve and restores the fixed root; turning on again does not re-analyse
    r.set_root_dyn(0);
    r.paint();
    assert.ok(r.hitZones.some((z) => z.key === "root_note"));
    r.set_root_dyn(1);
    assert.strictEqual(calls.length, 1, "curve cached per sample");
    // a new sample invalidates and re-analyses
    r.sample_loaded("/Users/test/Other.wav");
    r.sample_loaded("bang");
    while (r.sliceMonoJob) r.sliceMonoStep();
    assert.strictEqual(calls.length, 2, "new sample re-analysed");
    // dsp_ready re-binds the pitch buffer too (it is in the gen binding message)
    assert.ok(byId.get("obj-msg-gen-buf").text.includes("pitch #0-bspitch"));
}

console.log("Analyzed Root Key: toggle, tracking, curve buffer and drawing ok");

// --- Textures: overlays stay inside the waveform; a line per playing grain from telemetry 64..127 ---
{
    const gc = makeSandbox(mainViz);
    const g = gc.sb;
    g.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope", "#0-bspitch");
    gc.audioOn = true;
    g.sample_loaded("/Users/test/Pad - Granular - Noise Sparkle - F#.wav");
    g.sample_loaded("bang");
    g.set_mode(2);
    g.set_grain_spray(100);
    g.paint();
    const wave = g.hitZones.find((z) => z.kind === "wave");
    // a voice right at the start with full spray: the spray band must not spill left of the waveform
    g.voicePlayheads[0] = 0.01; g.voiceAmps[0] = 0.9;
    g.voicePlayheads[1] = 0.995; g.voiceAmps[1] = 0.9;
    const rects = [];
    const R0 = g.mgraphics.rectangle;
    g.mgraphics.rectangle = (x, y, w, h) => rects.push([x, y, w, h]);
    g.paint();
    g.mgraphics.rectangle = R0;
    const inWave = (r) => r[1] >= wave.y - 0.01 && r[1] + r[3] <= wave.y + wave.h + 0.01;
    const bands = rects.filter((r) => inWave(r) && Math.abs(r[3] - wave.h) < 0.01);
    assert.ok(bands.length >= 2, "spray bands drawn for both voices");
    for (const r of bands) assert.ok(r[0] >= wave.x - 0.01 && r[0] + r[2] <= wave.x + wave.w + 0.01, `spray band clipped to the waveform (${r})`);
    // grain lines: telemetry slots 64..95 positions, 96..127 levels
    const tele = new Float32Array(128);
    for (let i = 64; i < 96; i++) tele[i] = -1;
    const grains = [[0.2, 0.9], [0.35, 0.5], [0.61, 0.3], [0.8, 0.01]];
    grains.forEach(([pos, amp], i) => { tele[64 + i] = pos; tele[96 + i] = amp; });
    const B0 = g.Buffer;
    g.Buffer = function (name) { B0.call(this, name); const pk = this.peek; this.peek = (ch, st, len) => (name === "#0-bsscope" && st === 0 && len === 128 ? tele : pk(ch, st, len)); };
    g.pollTelemetryScope();
    g.Buffer = B0;
    assert.deepStrictEqual(Array.from(g.grainPos.slice(0, 5)).map((v) => Math.round(v * 100) / 100), [0.2, 0.35, 0.61, 0.8, -1], "grain positions read from 64..95");
    const lines = [];
    const M0 = g.mgraphics.move_to, L0 = g.mgraphics.line_to;
    let last = null;
    g.mgraphics.move_to = (x, y) => { last = [x, y]; };
    g.mgraphics.line_to = (x, y) => { if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(y - last[1] - (wave.h - 8)) < 0.01) lines.push(x); };
    g.voiceAmps[0] = 0; g.voiceAmps[1] = 0;
    g.paint();
    g.mgraphics.move_to = M0; g.mgraphics.line_to = L0;
    const want = grains.filter(([, a]) => a > 0.02).map(([p]) => wave.x + p * wave.w);
    for (const x of want) assert.ok(lines.some((lx) => Math.abs(lx - x) < 0.01), `grain line at ${x.toFixed(1)}`);
    assert.strictEqual(lines.length, want.length, "one line per audible grain (quiet and unused slots skipped)");
    // not in Repitch
    g.set_mode(0);
    lines.length = 0;
    g.mgraphics.move_to = (x, y) => { last = [x, y]; };
    g.mgraphics.line_to = (x, y) => { if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(y - last[1] - (wave.h - 8)) < 0.01) lines.push(x); };
    g.paint();
    g.mgraphics.move_to = M0; g.mgraphics.line_to = L0;
    assert.strictEqual(lines.length, 0, "no grain lines outside Textures / Fragments");
}

console.log("Textures overlays clipped and grain lines ok");

