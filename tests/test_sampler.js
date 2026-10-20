#!/usr/bin/env node
/**
 * Comprehensive verification suite for Better Sampler (.amxd):
 *   - devices/Better Sampler.amxd          (720 x 169 px Standard 4-Panel Workstation)
 *   - devices/Better Sampler Standard.amxd (720 x 169 px Standard 4-Panel Workstation)
 *   - devices/Better Sampler Compact.amxd  (622 x 169 px Compact Simpler-Sized Edition)
 *   - devices/Better Sampler Expanded.amxd (788 x 169 px Wide Flagship Studio Edition)
 *
 * Covers:
 *  1. All 4 playback modes (Repitch, Cycles, Textures, Slice) plus Freeze and Reverse
 *  2. 16-voice polyphony, oldest-voice stealing, unison 1..8, and Mono/Legato/Glide
 *     single-trigger stack behavior
 *  3. Sample import via live.drop -> sample_loaded / dropfile, root-note estimation,
 *     and transient slices, with no preloaded library and no multisample zones
 *  4. Filt/Amp and Mod/Uni collapse wired to live.thisdevice setwidth and thispatcher,
 *     including set_panel_filt(0) sliding Mod/Uni left into Filt/Amp's slot
 *  5. Layout, zero-overlap, #0- isolation, background panel z-order,
 *     getvalueof/setvalueof, and undo/redo across all 3 UI sizes
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

function widthExprFor(variant) {
    const minW = cfg.computeSamplerDynamicLayout(variant, 0, 0).deviceWidth;
    const filtW = cfg.computeSamplerDynamicLayout(variant, 1, 0).deviceWidth;
    const modW = cfg.computeSamplerDynamicLayout(variant, 0, 1).deviceWidth;
    return `expr ${Math.round(minW)} + $i1 * ${Math.round(filtW - minW)} + $i2 * ${Math.round(modW - minW)}`;
}

function modePillCenter(canvasW, modeIndex) {
    const isExpanded = canvasW >= 312;
    const isCompact = canvasW <= 255;
    const badgeW = isCompact ? 58.0 : 64.0;
    const badgeX = canvasW - badgeW - 3.0;
    const matrixW = (!isCompact && canvasW >= 280) ? 38.0 : 0.0;
    const modeAreaW = badgeX - matrixW - 6.0;
    const modeCellW = Math.min(isExpanded ? 54.0 : 42.0, Math.floor((modeAreaW - 6.0) / 4.0));
    const mx = 3.0 + modeIndex * (modeCellW + 2.0);
    return { x: mx + modeCellW * 0.5, badgeX, modeCellW };
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

const FULL_WIDTH = { compact: 622, standard: 720, expanded: 788 };
for (const variant of ["compact", "standard", "expanded"]) {
    const open = cfg.computeSamplerDynamicLayout(variant, 1, 1);
    const noMod = cfg.computeSamplerDynamicLayout(variant, 1, 0);
    const noFilt = cfg.computeSamplerDynamicLayout(variant, 0, 1);
    const minLay = cfg.computeSamplerDynamicLayout(variant, 0, 0);
    assert.strictEqual(open.deviceWidth, FULL_WIDTH[variant], `${variant} full width`);
    assert.ok(open.deviceWidth > noMod.deviceWidth, `${variant}: hiding Mod/Uni shrinks width`);
    assert.ok(noMod.deviceWidth > minLay.deviceWidth, `${variant}: hiding Filt/Amp shrinks width further`);
    assert.strictEqual(
        noFilt.modUniX,
        open.filtAmpX,
        `${variant}: collapsed Filt/Amp slides Mod/Uni into the Filt/Amp x slot`
    );
    assert.ok(noFilt.modUniX < open.modUniX, `${variant}: Mod/Uni x decreases when Filt/Amp collapses`);
    assert.strictEqual(noFilt.deviceWidth, minLay.deviceWidth + noFilt.modUniW + 4);
}

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
// 3. All 4 .amxd variants
// ============================================================================
const VARIANT_FILES = [
    ["Better Sampler.amxd", "standard", 720, 2],
    ["Better Sampler Standard.amxd", "standard", 720, 2],
    ["Better Sampler Compact.amxd", "compact", 622, 0],
    ["Better Sampler Expanded.amxd", "expanded", 788, 3],
];

const GEN_PARAM_KEYS = [
    "mode", "freeze", "reverse", "loop_mode",
    "unison_voices", "unison_detune", "unison_width", "glide_ms",
    "grain_size", "grain_motion", "grain_spray", "formant",
    "filt_cutoff", "filt_on", "filt_type",
];

for (const [fileName, variant, expectedW, previewMode] of VARIANT_FILES) {
    const amxdPath = path.join(ROOT, "devices", fileName);
    assert.ok(fs.existsSync(amxdPath), `Missing built device: ${amxdPath}`);
    const raw = fs.readFileSync(amxdPath);

    assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", `${fileName}: invalid ampf magic`);
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "iiii", `${fileName}: expected Max Instrument 'iiii'`);
    const jsonLen = raw.readUInt32LE(28);
    assert.strictEqual(jsonLen, raw.length - 32, `${fileName}: JSON payload byte length mismatch`);

    const doc = JSON.parse(raw.slice(32).toString("utf8"));
    const p = doc.patcher;
    assert.strictEqual(p.openinpresentation, 1, `${fileName}: presentation mode`);
    assert.strictEqual(p.openrect[0], 0, `${fileName}: openrect x`);
    assert.strictEqual(p.openrect[1], 0, `${fileName}: openrect y`);
    assert.strictEqual(p.openrect[2], expectedW, `${fileName}: width`);
    assert.strictEqual(p.openrect[3], 169.0, `${fileName}: height 169`);
    assert.strictEqual(
        cfg.computeSamplerDynamicLayout(variant, 1, 1).deviceWidth,
        expectedW,
        `${fileName}: openrect width matches the expanded layout`
    );

    const boxes = p.boxes.map((b) => b.box);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const lines = p.lines;

    assert.strictEqual(byId.get("obj-buf-samp").text, "buffer~ #0-bsamp 1000 2", `${fileName}: empty user sample buffer`);
    assert.strictEqual(byId.get("obj-buf-voices").text, "buffer~ #0-bsvoices @samps 128");
    assert.strictEqual(byId.get("obj-buf-scope").text, "buffer~ #0-bsscope @samps 64");
    assert.strictEqual(byId.get("obj-msg-gen-buf").text, "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope");
    assert.strictEqual(byId.get("obj-gen").code.trim(), gen.trim(), `${fileName}: embeds the current GenExpr core`);

    for (const b of boxes) {
        const text = String(b.text || "");
        if (/^(buffer~|send|receive)\b/.test(text)) {
            assert.ok(text.includes("#0-"), `${fileName}: instance object must use #0- (${text})`);
        }
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
    assert.ok(!/sfplay~/i.test(stripped), `${fileName}: no sfplay~ sample library`);
    assert.ok(!/multisample|keyzone/i.test(stripped), `${fileName}: no multisample zone objects`);
    assert.ok(!/\.(wav|aiff|aif|flac|mp3)\b/i.test(stripped), `${fileName}: no preloaded audio file`);
    assert.ok(!/replace\s+\//i.test(stripped), `${fileName}: loadbang must not replace a library sample`);

    const firstPanelIdx = boxes.findIndex((b) => b.maxclass === "panel");
    const lastNonPanelIdx = boxes.map((b) => b.maxclass !== "panel").lastIndexOf(true);
    assert.ok(firstPanelIdx > lastNonPanelIdx, `${fileName}: panels are at the end of boxes`);
    for (const b of boxes.filter((x) => x.maxclass === "panel")) {
        assert.strictEqual(b.background, 1, `${fileName}: panel ${b.id} background: 1`);
    }

    const presWidgets = boxes.filter((b) => b.presentation === 1 && !b.hidden && b.maxclass !== "panel");
    for (let i = 0; i < presWidgets.length; i++) {
        const a = presWidgets[i];
        const ra = a.presentation_rect;
        assert.ok(ra[0] >= 0 && ra[0] + ra[2] <= expectedW + 0.01, `${fileName}: ${a.id} outside horizontal bounds`);
        assert.ok(ra[1] >= 0 && ra[1] + ra[3] <= 169.0, `${fileName}: ${a.id} outside 0..169`);
        for (let j = i + 1; j < presWidgets.length; j++) {
            const b = presWidgets[j];
            assert.ok(
                !rectsOverlap(ra, b.presentation_rect),
                `${fileName}: overlap ${a.id} and ${b.id}`
            );
        }
        const vof = valueOf(a);
        if (vof && typeof vof.parameter_mmax === "number" && vof.parameter_mmax > 255) {
            assert.strictEqual(vof.parameter_type, 0, `${fileName}: ${a.id} range > 255 must be Float parameter_type 0`);
        }
        if ((a.appearance === 2 || a.appearance === 3) && a.activeslidercolor && a.activebgcolor) {
            assert.strictEqual(a.activeslidercolor[3], 1, `${fileName}: ${a.id} slider fill must be opaque`);
            for (let c = 0; c < 3; c++) {
                const ceiling = a.activebgcolor[c] * 0.62 + 0.38 + 0.03;
                assert.ok(
                    a.activeslidercolor[c] <= ceiling + 1e-6,
                    `${fileName}: ${a.id} activeslidercolor must be pre-blended`
                );
            }
        }
        if (a.appearance === 3 && vof) {
            assert.ok(vof.parameter_mmin < 0 && vof.parameter_mmax > 0, `${fileName}: ${a.id} bipolar range`);
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
    assert.strictEqual(glideV.parameter_mmin, 0);
    assert.strictEqual(glideV.parameter_mmax, 1000);
    assert.strictEqual(glideV.parameter_type, 0, "glide 0..1000 cannot use Live's 8-bit Int type");
    const polyV = valueOf(byId.get("obj-ctrl-poly_voices"));
    assert.strictEqual(polyV.parameter_mmin, 1);
    assert.strictEqual(polyV.parameter_mmax, 16);

    assert.strictEqual(byId.get("obj-drop").maxclass, "live.drop", `${fileName}: sample import drop target`);
    assert.strictEqual(byId.get("obj-prep-replace").text, "prepend replace");
    assert.strictEqual(byId.get("obj-prep-loaded").text, "prepend sample_loaded");
    assert.strictEqual(byId.get("obj-prep-midi").text, "prepend midi_note");
    assertLink(lines, "obj-drop", 0, "obj-prep-replace", 0, fileName);
    assertLink(lines, "obj-drop", 0, "obj-prep-loaded", 0, fileName);
    assertLink(lines, "obj-prep-replace", 0, "obj-buf-samp", 0, fileName);
    assertLink(lines, "obj-buf-samp", 1, "obj-prep-loaded", 0, fileName);
    assertLink(lines, "obj-prep-loaded", 0, "obj-viz", 0, fileName);
    assertLink(lines, "obj-route-viz", 2, "obj-prep-replace", 0, fileName);
    assertLink(lines, "obj-midiin", 0, "obj-midiparse", 0, fileName);
    assertLink(lines, "obj-midiparse", 0, "obj-prep-midi", 0, fileName);
    assertLink(lines, "obj-prep-midi", 0, "obj-viz", 0, fileName);

    assert.strictEqual(byId.get("obj-toggle-filt").text, "Filt/Amp");
    assert.strictEqual(byId.get("obj-toggle-mod").text, "Mod/Uni");
    assert.deepStrictEqual(valueOf(byId.get("obj-toggle-filt")).parameter_enum, ["Hide", "Show"]);
    assert.deepStrictEqual(valueOf(byId.get("obj-toggle-mod")).parameter_enum, ["Hide", "Show"]);
    assert.strictEqual(byId.get("obj-prep-pfilt").text, "prepend set_panel_filt");
    assert.strictEqual(byId.get("obj-prep-pmod").text, "prepend set_panel_mod");
    assert.strictEqual(byId.get("obj-prep-setwidth").text, "prepend setwidth");
    assert.strictEqual(byId.get("obj-thisdevice").text, "live.thisdevice");
    assert.strictEqual(byId.get("obj-thispatcher").text, "thispatcher");
    assert.strictEqual(byId.get("obj-expr-width").text, widthExprFor(variant), `${fileName}: setwidth expression`);
    assert.strictEqual(byId.get("obj-inv-filt").text, "== 0");
    assert.strictEqual(byId.get("obj-inv-mod").text, "== 0");
    assert.strictEqual(byId.get("obj-prep-hide-filt").text, "prepend hidden");
    assert.strictEqual(byId.get("obj-prep-hide-mod").text, "prepend hidden");

    assertLink(lines, "obj-toggle-filt", 0, "obj-prep-pfilt", 0, fileName);
    assertLink(lines, "obj-prep-pfilt", 0, "obj-viz", 0, fileName);
    assertLink(lines, "obj-toggle-filt", 0, "obj-pak-vis", 0, fileName);
    assertLink(lines, "obj-toggle-filt", 0, "obj-inv-filt", 0, fileName);
    assertLink(lines, "obj-inv-filt", 0, "obj-prep-hide-filt", 0, fileName);
    assertLink(lines, "obj-toggle-mod", 0, "obj-prep-pmod", 0, fileName);
    assertLink(lines, "obj-prep-pmod", 0, "obj-viz", 0, fileName);
    assertLink(lines, "obj-toggle-mod", 0, "obj-pak-vis", 1, fileName);
    assertLink(lines, "obj-toggle-mod", 0, "obj-inv-mod", 0, fileName);
    assertLink(lines, "obj-inv-mod", 0, "obj-prep-hide-mod", 0, fileName);
    assertLink(lines, "obj-pak-vis", 0, "obj-expr-width", 0, fileName);
    assertLink(lines, "obj-expr-width", 0, "obj-prep-setwidth", 0, fileName);
    assertLink(lines, "obj-prep-setwidth", 0, "obj-thisdevice", 0, fileName);
    assertLink(lines, "obj-route-viz", 3, "obj-thispatcher", 0, fileName);
    assertLink(lines, "obj-route-viz", 4, "obj-prep-setwidth", 0, fileName);
    assertLink(lines, "obj-prep-hide-filt", 0, "obj-pnl-filt", 0, fileName);
    assertLink(lines, "obj-prep-hide-filt", 0, "obj-ctrl-filt_cutoff", 0, fileName);
    assertLink(lines, "obj-prep-hide-mod", 0, "obj-pnl-mod", 0, fileName);
    assertLink(lines, "obj-prep-hide-mod", 0, "obj-ctrl-unison_voices", 0, fileName);
    assertLink(lines, "obj-prep-hide-mod", 0, "obj-ctrl-glide_ms", 0, fileName);
    assertLink(lines, "obj-prep-hide-mod", 0, "obj-ctrl-mono_legato", 0, fileName);

    for (const key of GEN_PARAM_KEYS) {
        const prep = byId.get(`obj-prep-${key}`);
        const uiPrep = byId.get(`obj-uiprep-${key}`);
        assert.ok(prep, `${fileName}: missing gen prep for ${key}`);
        assert.ok(uiPrep, `${fileName}: missing UI prep for ${key}`);
        assert.strictEqual(prep.text, `prepend ${key}`);
        assert.strictEqual(uiPrep.text, `prepend set_${key}`);
        assertLink(lines, `obj-prep-${key}`, 0, "obj-gen", 0, fileName);
        assertLink(lines, `obj-uiprep-${key}`, 0, "obj-viz", 0, fileName);
        const scale = byId.get(`obj-scale-${key}`);
        if (scale) {
            assertLink(lines, `obj-ctrl-${key}`, 0, `obj-scale-${key}`, 0, fileName);
            assertLink(lines, `obj-scale-${key}`, 0, `obj-prep-${key}`, 0, fileName);
        } else {
            assertLink(lines, `obj-ctrl-${key}`, 0, `obj-prep-${key}`, 0, fileName);
        }
        assertLink(lines, `obj-ctrl-${key}`, 0, `obj-uiprep-${key}`, 0, fileName);
    }
    assert.strictEqual(byId.get("obj-scale-unison_detune").text, "* 0.01");
    assert.strictEqual(byId.get("obj-scale-unison_width").text, "* 0.01");
    assert.ok(!byId.has("obj-prep-mono_legato"), `${fileName}: legato is a voice-allocator flag, not a Gen param`);
    assert.strictEqual(byId.get("obj-uiprep-mono_legato").text, "prepend set_mono_legato");
    assertLink(lines, "obj-ctrl-mono_legato", 0, "obj-uiprep-mono_legato", 0, fileName);
    assertLink(lines, "obj-uiprep-mono_legato", 0, "obj-viz", 0, fileName);
    assert.strictEqual(byId.get("obj-uiprep-poly_voices").text, "prepend set_poly_voices");
    assertLink(lines, "obj-uiprep-poly_voices", 0, "obj-viz", 0, fileName);

    const stateV = valueOf(byId.get("obj-viz"));
    assert.strictEqual(stateV.parameter_type, 3, `${fileName}: SamplerStateData blob`);
    assert.strictEqual(stateV.parameter_longname, "SamplerStateData");
    assert.strictEqual(stateV.parameter_initial[0], 1, `${fileName}: serialized state version`);

    const uiText = byId.get("obj-viz").textfile.text;
    const onclickAt = uiText.indexOf("function onclick");
    const ondragAt = uiText.indexOf("function ondrag");
    const ondblAt = uiText.indexOf("function ondblclick");
    assert.ok(onclickAt >= 0 && ondragAt > onclickAt && ondblAt > ondragAt, `${fileName}: mouse handlers`);
    assert.ok(uiText.slice(onclickAt, ondragAt).includes("pushUndoState("), `${fileName}: undo pushed on click`);
    assert.ok(!uiText.slice(ondragAt, ondblAt).includes("pushUndoState("), `${fileName}: drag must not push undo per frame`);
    assert.ok(uiText.slice(ondblAt, ondblAt + 500).includes("pushUndoState("), `${fileName}: undo pushed on double-click`);
    assert.ok(uiText.includes('DEFAULT_UI_VARIANT = "' + variant + '"'), `${fileName}: embedded variant`);
    assert.ok(uiText.includes("function sample_loaded") && uiText.includes("function dropfile"));
    assert.ok(uiText.includes("function set_panel_filt") && uiText.includes("MOD_PANEL_BASE_RECTS"));
    assert.ok(!/multisample|keyzone/i.test(uiText), `${fileName}: UI has no multisample zones`);

    const vizBox = byId.get("obj-viz");
    const emitted = [];
    const pokes = [];
    let notified = 0;
    let audioOn = false;
    const sandbox = {
        mgraphics: {
            size: [vizBox.presentation_rect[2], vizBox.presentation_rect[3]],
            relative_coords: 1,
            autofill: 1,
            init() {},
            redraw() {},
            set_source_rgba() {},
            set_line_width() {},
            rectangle() {},
            rectangle_rounded() {},
            move_to() {},
            line_to() {},
            curve_to() {},
            close_path() {},
            arc() {},
            fill() {},
            stroke() {},
            select_font_face() {},
            set_font_size() {},
            show_text() {},
        },
        inlets: 1,
        outlets: 1,
        outlet: (...args) => emitted.push(args),
        notifyclients: () => { notified++; },
        arrayfromargs: (args) => Array.from(args),
        Buffer: function (name) {
            this.name = String(name || "");
            this.framecount = () => 44100;
            this.peek = (ch, start, len) => {
                const n = Math.max(1, len || 1);
                const out = new Float32Array(n);
                if (!audioOn) return out;
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
            this.poke = (ch, idx, data) => {
                pokes.push({ name: this.name, ch, idx, data: Array.from(data) });
            };
            this.send = () => {};
        },
        Task: function () { this.schedule = () => {}; },
        Math, Number, String, Array, Object,
    };

    vm.createContext(sandbox);
    vm.runInContext(uiText, sandbox);

    assert.strictEqual(sandbox.mgraphics.relative_coords, 0, `${fileName}: relative_coords`);
    assert.strictEqual(sandbox.mgraphics.autofill, 0, `${fileName}: autofill`);
    assert.strictEqual(sandbox.uiVariant, variant, `${fileName}: uiVariant`);
    assert.strictEqual(sandbox.hasLoadedSample, 0, `${fileName}: starts with no sample`);
    assert.strictEqual(sandbox.sampleFileName, "Drop Audio Sample Here");
    assert.strictEqual(sandbox.curFreeze, 0);
    assert.strictEqual(sandbox.curReverse, 0);
    assert.strictEqual(sandbox.curUnisonVoices, 1);
    assert.strictEqual(sandbox.curMonoLegato, 0);
    assert.strictEqual(sandbox.curGlideMs, 0);
    sandbox.paint();

    emitted.length = 0;
    sandbox.dropfile("/Users/test/Drums/Kick_01.wav");
    assert.strictEqual(sandbox.sampleFileName, "Kick_01.wav");
    assert.strictEqual(sandbox.hasLoadedSample, 0, "dropfile arms the path and does not pretend audio is decoded");
    assert.ok(emitted.some((a) => a[1] === "load_sample" && a[2] === "/Users/test/Drums/Kick_01.wav"));
    const beforeDropCount = emitted.length;
    sandbox.dropfile("");
    assert.strictEqual(emitted.length, beforeDropCount, "empty dropfile is ignored");

    sandbox.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope");
    assert.strictEqual(sandbox.hasLoadedSample, 0, "Silent buffer does not count as a loaded sample");
    audioOn = true;
    const notesBefore = notified;
    sandbox.sample_loaded("/Users/test/Drums/Kick_01.wav");
    assert.ok(notified > notesBefore, "sample_loaded notifies Live");
    assert.strictEqual(sandbox.hasLoadedSample, 1);
    assert.ok(Math.abs(sandbox.detectedRootMidi - 69) <= 1, `${fileName}: imported 440 Hz window -> A3, got ${sandbox.detectedRootMidi}`);
    assert.strictEqual(sandbox.sliceMarkers[0], 0);
    assert.ok(sandbox.sliceMarkers.length >= 4 && sandbox.sliceMarkers.length <= 16);
    assert.ok(sandbox.sliceMarkers.some((s) => Math.abs(s - 0.1) < 0.02), `${fileName}: transient slices replace the default grid`);

    const canvasW = sandbox.mgraphics.size[0];
    const badgeHit = modePillCenter(canvasW, 0);
    emitted.length = 0;
    sandbox.onclick(badgeHit.badgeX + 4, 8);
    assert.strictEqual(sandbox.curRootNote, sandbox.detectedRootMidi);
    assert.ok(emitted.some((a) => a[1] === "root_note" && a[2] === sandbox.curRootNote));

    sandbox.set_freeze(1);
    assert.strictEqual(sandbox.curFreeze, 1);
    sandbox.set_freeze(0);
    assert.strictEqual(sandbox.curFreeze, 0);
    sandbox.set_reverse(1);
    assert.strictEqual(sandbox.curReverse, 1);
    sandbox.set_reverse(0.2);
    assert.strictEqual(sandbox.curReverse, 0);
    sandbox.set_mode(0);
    sandbox.set_mode(1);
    sandbox.set_mode(2);
    sandbox.set_mode(3);
    sandbox.set_mode(9);
    assert.strictEqual(sandbox.curMode, 3, "set_mode clamps to Slice");
    sandbox.set_mode(-4);
    assert.strictEqual(sandbox.curMode, 0);

    sandbox.set_unison_voices(8);
    assert.strictEqual(sandbox.curUnisonVoices, 8);
    sandbox.set_unison_voices(0);
    assert.strictEqual(sandbox.curUnisonVoices, 1, "unison clamps to at least 1");
    sandbox.set_unison_voices(12);
    assert.strictEqual(sandbox.curUnisonVoices, 8, "unison clamps to at most 8");
    sandbox.set_unison_detune(40);
    sandbox.set_unison_width(90);
    assert.strictEqual(sandbox.curUnisonDetune, 40);
    assert.strictEqual(sandbox.curUnisonWidth, 90);
    sandbox.set_glide_ms(250);
    assert.strictEqual(sandbox.curGlideMs, 250);
    sandbox.set_glide_ms(0);
    assert.strictEqual(sandbox.curGlideMs, 0);
    sandbox.set_poly_voices(16);
    assert.strictEqual(sandbox.curPolyVoices, 16);
    sandbox.set_poly_voices(4);
    assert.strictEqual(sandbox.voiceAlloc.getMaxVoices(), 4);

    sandbox.all_notes_off();
    sandbox.set_mono_legato(0);
    sandbox.set_poly_voices(16);
    for (let n = 0; n < 16; n++) sandbox.midi_note(36 + n, 100);
    assert.strictEqual(sandbox.voiceAlloc.voices.filter((v) => v.gate === 1).length, 16, `${fileName}: 16-voice poly`);
    const oldestBefore = sandbox.voiceAlloc.voices.reduce((a, b) => (a.age <= b.age ? a : b));
    const stolenNote = oldestBefore.note;
    const stolenIndex = oldestBefore.index;
    sandbox.midi_note(90, 120);
    const heldNotes = sandbox.voiceAlloc.voices.filter((v) => v.gate === 1).map((v) => v.note);
    assert.strictEqual(heldNotes.length, 16);
    assert.strictEqual(sandbox.voiceAlloc.voices[stolenIndex].note, 90);
    assert.ok(heldNotes.includes(90));
    assert.ok(!heldNotes.includes(stolenNote), `${fileName}: 17th note steals the oldest voice`);

    pokes.length = 0;
    sandbox.all_notes_off();
    sandbox.set_mono_legato(1);
    sandbox.set_glide_ms(180);
    sandbox.midi_note(60, 100);
    const uiTrig = sandbox.voiceAlloc.voices[0].trigCount;
    sandbox.midi_note(64, 96);
    sandbox.midi_note(67, 110);
    assert.strictEqual(sandbox.voiceAlloc.voices[0].note, 67);
    assert.strictEqual(sandbox.voiceAlloc.voices[0].trigCount, uiTrig, `${fileName}: UI legato is single-trigger`);
    assert.ok(sandbox.voiceAlloc.voices.slice(1).every((v) => v.gate === 0));
    const legatoPoke = pokes.filter((pk) => pk.name === "#0-bsvoices").pop();
    assert.ok(legatoPoke, `${fileName}: legato note is written into #0-bsvoices`);
    assert.strictEqual(legatoPoke.data[0], 1);
    assert.strictEqual(legatoPoke.data[1], 67);
    assert.strictEqual(legatoPoke.data[3], uiTrig);
    assert.ok(legatoPoke.data[4] >= 0 && legatoPoke.data[5] > legatoPoke.data[4]);
    sandbox.midi_note(67, 0);
    assert.strictEqual(sandbox.voiceAlloc.voices[0].note, 64);
    assert.strictEqual(sandbox.voiceAlloc.voices[0].gate, 1);
    sandbox.midi_note(64, 0);
    sandbox.midi_note(60, 0);
    assert.strictEqual(sandbox.voiceAlloc.voices[0].gate, 0);
    sandbox.set_mono_legato(0);

    const modBase = sandbox.MOD_PANEL_BASE_RECTS;
    assert.ok(modBase && modBase["obj-pnl-mod"], `${fileName}: Mod/Uni base rects embedded`);
    const openLay = cfg.computeSamplerDynamicLayout(variant, 1, 1);
    assert.strictEqual(modBase["obj-pnl-mod"][0], openLay.modUniX);

    emitted.length = 0;
    sandbox.set_panel_filt(0);
    const collapsed = cfg.computeSamplerDynamicLayout(variant, 0, 1);
    const shiftX = collapsed.filtAmpW + 4.0;
    const sends = emitted.filter((a) => a[1] === "patcher_cmd" && a[2] === "script" && a[3] === "sendbox" && a[5] === "presentation_rect");
    assert.strictEqual(sends.length, Object.keys(modBase).length, `${fileName}: every Mod/Uni box is moved`);
    for (const msg of sends) {
        const base = modBase[msg[4]];
        assert.ok(base, `${fileName}: sendbox target ${msg[4]}`);
        assert.ok(Math.abs(msg[6] - (base[0] - shiftX)) < 1e-6, `${fileName}: ${msg[4]} slides left by filt width`);
        assert.strictEqual(msg[7], base[1]);
        assert.strictEqual(msg[8], base[2]);
        assert.strictEqual(msg[9], base[3]);
    }
    const panelMsg = sends.find((a) => a[4] === "obj-pnl-mod");
    assert.strictEqual(panelMsg[6], collapsed.modUniX, `${fileName}: Mod/Uni panel occupies the Filt/Amp slot`);
    assert.ok(panelMsg[6] < modBase["obj-pnl-mod"][0]);
    const widthCmd = emitted.find((a) => a[1] === "setwidth_cmd");
    assert.strictEqual(widthCmd[2], collapsed.deviceWidth);
    const winSize = emitted.find((a) => a[1] === "patcher_cmd" && a[2] === "window" && a[3] === "size");
    assert.strictEqual(winSize[6], collapsed.deviceWidth);
    assert.strictEqual(winSize[7], 169);
    assert.ok(emitted.some((a) => a[1] === "patcher_cmd" && a[2] === "window" && a[3] === "exec"));

    emitted.length = 0;
    sandbox.set_panel_filt(1);
    const restored = emitted.find((a) => a[4] === "obj-pnl-mod" && a[5] === "presentation_rect");
    assert.strictEqual(restored[6], openLay.modUniX, `${fileName}: showing Filt/Amp restores Mod/Uni`);
    assert.strictEqual(emitted.find((a) => a[1] === "setwidth_cmd")[2], expectedW);

    sandbox.set_panel_mod(0);
    assert.strictEqual(
        emitted.filter((a) => a[1] === "setwidth_cmd").pop()[2],
        cfg.computeSamplerDynamicLayout(variant, 1, 0).deviceWidth
    );
    sandbox.set_panel_filt(0);
    assert.strictEqual(
        emitted.filter((a) => a[1] === "setwidth_cmd").pop()[2],
        cfg.computeSamplerDynamicLayout(variant, 0, 0).deviceWidth
    );
    sandbox.set_panel_filt(1);
    sandbox.set_panel_mod(1);

    sandbox.preview();
    sandbox.paint();
    assert.strictEqual(sandbox.curMode, previewMode, `${fileName}: preview showcases mode ${previewMode}`);
    assert.strictEqual(sandbox.curUnisonVoices, 4);
    const undoBeforeModes = sandbox.undoStack.length;
    for (let mi = 0; mi < 4; mi++) {
        const hit = modePillCenter(canvasW, mi);
        const before = sandbox.curMode;
        const depth = sandbox.undoStack.length;
        emitted.length = 0;
        sandbox.onclick(hit.x, 8);
        assert.strictEqual(sandbox.curMode, mi, `${fileName}: mode pill ${mi}`);
        assert.strictEqual(sandbox.undoStack.length, depth + 1, `${fileName}: one undo snapshot per mode click`);
        assert.deepStrictEqual(sandbox.undoStack[sandbox.undoStack.length - 1].curMode, before);
        assert.ok(emitted.some((a) => a[1] === "param" && a[2] === "mode" && a[3] === mi));
        sandbox.paint();
    }
    assert.strictEqual(sandbox.bottomTab, 3, `${fileName}: Slice mode opens the slice strip`);
    assert.strictEqual(sandbox.undoStack.length, undoBeforeModes + 4);
    sandbox.performUndo();
    assert.strictEqual(sandbox.curMode, 2, `${fileName}: undo restores the previous mode pill`);
    sandbox.performRedo();
    assert.strictEqual(sandbox.curMode, 3, `${fileName}: redo returns to Slice`);
    const stalled = sandbox.undoStack.length;
    sandbox.performRedo();
    assert.strictEqual(sandbox.undoStack.length, stalled, "redo at the tip is a no-op");

    sandbox.set_mode(0);
    sandbox.curLoopMode = 1;
    sandbox.curLoopStart = 0.18;
    sandbox.curLoopEnd = 0.78;
    sandbox.curStart = 0.04;
    sandbox.curEnd = 0.96;
    const wfW = canvasW - 8.0;
    const loopX = 4.0 + 0.18 * wfW;
    const dragDepth = sandbox.undoStack.length;
    sandbox.onclick(loopX, 40);
    assert.strictEqual(sandbox.dragTarget, "loop_start");
    assert.strictEqual(sandbox.undoStack.length, dragDepth + 1);
    sandbox.ondrag(loopX + 30, 40, 1);
    sandbox.ondrag(loopX + 36, 40, 1);
    sandbox.ondrag(loopX + 42, 40, 1);
    assert.strictEqual(sandbox.undoStack.length, dragDepth + 1, `${fileName}: dragging does not push undo per frame`);
    assert.ok(sandbox.curLoopStart > 0.18);
    sandbox.performUndo();
    assert.ok(Math.abs(sandbox.curLoopStart - 0.18) < 1e-9, `${fileName}: undo restores the loop start`);

    const dblDepth = sandbox.undoStack.length;
    const notesAtDbl = notified;
    sandbox.ondblclick(20, 40);
    assert.strictEqual(sandbox.undoStack.length, dblDepth + 1, `${fileName}: double-click pushes one undo state`);
    assert.strictEqual(sandbox.curStart, 0);
    assert.strictEqual(sandbox.curEnd, 1);
    assert.strictEqual(sandbox.curLoopStart, 0.15);
    assert.strictEqual(sandbox.curLoopEnd, 0.85);
    assert.ok(notified > notesAtDbl);

    const saved = sandbox.getvalueof();
    assert.strictEqual(saved[0], 2, `${fileName}: getvalueof version`);
    assert.strictEqual(saved[1], sandbox.curMode);
    sandbox.setvalueof(0, 3, 0, 10000, 0, 0, 10000, 0, 0, 0, 1, 0);
    assert.strictEqual(sandbox.curMode, saved[1], `${fileName}: version 0 payload is ignored`);
    sandbox.setvalueof(1, 0);
    assert.strictEqual(sandbox.curMode, saved[1], `${fileName}: short v1 payload is ignored`);
    sandbox.setvalueof(1, 1, 2000, 9000, 2, 2000, 7000, 800, 2500, 3, 4, 0, 1000, 5000, 8000);
    assert.strictEqual(sandbox.curMode, 1);
    assert.ok(Math.abs(sandbox.curStart - 0.2) < 1e-9);
    assert.ok(Math.abs(sandbox.curEnd - 0.9) < 1e-9);
    assert.strictEqual(sandbox.curLoopMode, 2);
    assert.strictEqual(sandbox.bottomTab, 3);
    const expectSlices = [0, 0.1, 0.5, 0.8];
    assert.strictEqual(sandbox.sliceMarkers.length, expectSlices.length);
    for (let si = 0; si < expectSlices.length; si++) {
        assert.ok(Math.abs(sandbox.sliceMarkers[si] - expectSlices[si]) < 1e-4, `${fileName}: slice ${si}`);
    }
    const roundTrip = sandbox.getvalueof();
    sandbox.setvalueof(1, 0, 0, 10000, 0, 0, 10000, 0, 0, 0, 1, 0);
    sandbox.setvalueof.apply(sandbox, roundTrip);
    assert.strictEqual(sandbox.curMode, 1);
    assert.strictEqual(sandbox.sliceMarkers.length, expectSlices.length);
    for (let si = 0; si < expectSlices.length; si++) {
        assert.ok(Math.abs(sandbox.sliceMarkers[si] - expectSlices[si]) < 1e-4, `${fileName}: round-trip slice ${si}`);
    }

    // v2 state: the sample path round-trips and reloads into buffer~ via load_sample
    {
        const wavPath = "/Users/test/My Samples/Snare 02.wav";
        sandbox.dropfile(wavPath);
        const v2 = sandbox.getvalueof();
        assert.strictEqual(v2[0], 2);
        assert.strictEqual(v2[v2.length - 1], wavPath, `${fileName}: path stored last`);
        sandbox.setvalueof(1, 0, 0, 10000, 0, 0, 10000, 0, 0, 0, 1, 0);
        emitted.length = 0;
        sandbox.setvalueof.apply(sandbox, v2);
        assert.strictEqual(sandbox.sampleFileName, "Snare 02.wav");
        assert.strictEqual(sandbox.sampleFilePath, wavPath);
        assert.ok(emitted.some((a) => a[1] === "load_sample" && a[2] === wavPath), `${fileName}: restore sends load_sample`);
        audioOn = true;
        sandbox.sample_loaded(wavPath);
        assert.strictEqual(sandbox.sliceMarkers.length, expectSlices.length, `${fileName}: restored slices survive the reload refresh`);
        // v1 blob: still parses, never emits a load
        emitted.length = 0;
        sandbox.setvalueof(1, 2, 1000, 9000, 0, 0, 10000, 0, 0, 0, 2, 0, 5000);
        assert.strictEqual(sandbox.curMode, 2);
        assert.ok(!emitted.some((a) => a[1] === "load_sample"), `${fileName}: v1 blob does not load`);
        // v2 with an empty path does not load
        sandbox.setvalueof.apply(sandbox, v2.slice(0, -1).concat([""]));
        assert.ok(!emitted.some((a) => a[1] === "load_sample"), `${fileName}: empty path does not load`);
    }
    sandbox.paint();

    console.log(`[${fileName}] ${expectedW}x169 ${variant} layout, import, voices, and panel slide ok`);
}

console.log("All Better Sampler tests passed across all 3 size variants!");
