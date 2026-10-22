// glitch_config.js — data model for the Glitch device (pure JS: required by Node tests, prepended to the v8ui script).
//
// CONTRACT FOR THE UI (read this first)
// -------------------------------------
// Glitch holds a pool of hidden FX modules that always run in ONE fixed chain order. A "glitch" is a plain JSON object
// that says which modules are on and their settings. The user saves glitches into 8 slots; the engine morphs between
// slots through a WEIGHT VECTOR over the 8 slots. Three ways to make the weights (the MODE, see below):
//   Working  slot 0 of the engine holds the working glitch, weights [1,0,0,0,0,0,0,0]      (UI writes both)
//   Morph    the 8 saved slots, weights = bilinear XY over the 4 corner slots               (UI writes both)
//   Seq      the 8 saved slots, weights computed IN GEN from the host beat by the 16-step slot sequencer
//
//   Chain (GL_INSTANCES, in this order, `pos` = index; GL_NINST = 23):
//     drvA -> filt -> form -> comb -> phas -> crush -> rect -> fm -> corr -> ring -> stut -> time -> gpit -> gstr -> rvs
//     -> shuf -> chop -> spec(STFT N=1024) -> drvB -> dly -> slap -> rev -> wid
//     then master soft limiter -> Mix -> Output (Mix / Output are Live parameters, not part of the glitch)
//   Module TYPES (GL_TYPES, what the user sees and what the allow-list is about): drive (= drvA and drvB), filter, formant,
//     comb, phaser, crush, rectify, fm, corrupt, ring, stutter, time, gpitch, gstretch, revslice, shuffle, chopper, the
//     eight sub-ops of the single `spec` instance (freeze, smear, ccrush, scramble, scatter, mirror, binshift, specgate),
//     delay, slapback, reverb, width.
//
// Param vector: every instance param has a fixed index in a flat Float vector of length GL_NP (glitchLayout().np = 780: 113 module
//   params, then one 29-float MOVEMENT block per chain instance, see MOVEMENT below).
//   Per instance the first param is its `wet` (amount, 0 = bypassed). The `spec` instance has one extra amount per sub-op
//   (frz_amt, smr_amt, cc_amt, sc_amt, sct_amt, mir_amt, bsh_amt, sgl_amt); the sub-op's other params belong to that
//   amount's group. Saved glitches store params BY KEY (not by index), so growing the vector never breaks a saved state.
//   Values are PHYSICAL (Hz, dB, 0..1 ...). Param kinds: "wet" (linear amount), "lin", "log" (blend in log space), "disc"
//   (discrete: mode / division / pattern). A param spec carries: kind, min, max, def, unit, rand [lo0,hi0,lo1,hi1] (the
//   range rolled by Randomize at Chaos 0 and Chaos 1), calm / wild value lists for "disc", choices (names), group.
//
// ENGINE BUFFER `buffer~ #0-glitchslots` (GL_SLOTS_BUF_SAMPS = 9472 floats, bound in gen as `slots #0-glitchslots`):
//   [0 .. 8*NP)                 the 8 slot vectors, slot s at s*NP                                   (NP = 780 -> 0..6239)
//   [WOFF = 8*NP .. +8)         8 weights used in modes Working / Morph (any non-negative numbers, gen normalizes by
//                               their sum; all 0 = defaults = silent FX). IGNORED in Seq mode.         (6240..6247)
//   [SEQ = WOFF+8 .. +24)       the sequencer block, SEQ = glitchLayout().seqOffset = 6248:
//        SEQ+0  mode     0 Working, 1 Morph, 2 Seq (gen uses the sequencer weights only when this is 2)
//        SEQ+1  length   1..16 steps
//        SEQ+2  rate     index into GL_SEQ_RATES (0..9: 1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4T, 1/4, 1/2T, 1/2, 1 bar)
//        SEQ+3  glide    0..1 = fraction of a step that the crossfade from the previous step's slot takes (0 = hard)
//        SEQ+4  curve    0 equal-power (sin / cos, then gen normalizes by the sum) , 1 linear
//        SEQ+5           PACK VERSION: packEngineBuffer() writes a number that changes with every pack. Gen copies the 8 slot vectors
//                        and the constants block (about 9000 floats) only when it moves; weights and the sequencer block are read
//                        every tick. A harness that writes the buffer in pieces must bump it after each write.
//        SEQ+6..7        reserved (0)
//        SEQ+8 .. +16    16 steps: slot index 0..7, or -1 = HOLD (keep the previous step's slot; a leading hold takes the
//                        last step cyclically; a sequence with no slot at all = weights 0 = neutral dry sound)
//   [META = SEQ+24 .. +NP)      per param: kind + 4 * (index of its group's amount param)   (kind 0 wet, 1 lin, 2 log, 3 disc)
//   [DEFS = META+NP .. +NP)     per param: its default value
//   [WBI = DEFS+NP .. +NINST)   per chain position: index of that instance's wet param
//   [MINS .. +NP) [MAXS .. +NP) per param: its minimum and maximum (the movement needs the range of its target)       (ends at endOffset 9415)
//   META / DEFS / WBI / MINS / MAXS are constants of the layout (glitchEngineConstants()); they ride in the buffer instead of being poked by
//   gen's init code because 565 init statements cost gen about 3 s of compile time (measured 2026-10-21: 5.3 ms per statement).
//   The UI writes everything with packEngineBuffer(state) via Buffer.poke(1, 0, array); a harness must write the constants too.
//   Gen re-reads the buffer every ~32 samples.
// SEQUENCER (gen, sample-accurate, transport-locked): step position = host beat / GL_SEQ_RATES[rate]; step index =
//   floor(position) mod length; fraction = position - floor. Weight vector: previous step's slot gets cos(p*pi/2) (curve 0)
//   or 1-p, the current slot sin(p*pi/2) or p, with p = clip(fraction / glide, 0, 1) (p = 1 when glide = 0). A step change
//   forces a control tick, so the slot switch starts on the exact sample of the boundary. The beat comes from plugsync~ ppq
//   (Param ppq, jumps whenever it moves) and free-runs on bpm in between; while the transport is stopped (Param playing = 0,
//   plugsync~ outlet 0) the sequencer clock is HELD, i.e. the current step and glide progress stay as they are. A re-render
//   repeats exactly (no randomness: all of it is arithmetic on the beat). JS twin: seqWeights() below (tested against gen).
// Blend rules (blendVectors(); gen mirrors them exactly, tests/test_glitch.js):
//   wet:  sum(w * v)                         -> a module absent from a slot has wet 0 there, so it fades in / out
//   lin:  sum(w * v) over the slots where the module (group) is ACTIVE, divided by those weights (nothing sweeps from defaults)
//   log:  same, in log space (cutoff, delay time, ...)
//   disc: value of the highest-weight slot where the group is active (ties: lowest slot index)
//   "active" = the group's amount (its wet) > GL_ACTIVE_EPS in that slot. Slots with weight <= 1e-9 are skipped.
//
// ENGINE TELEMETRY `buffer~ #0-glitchscope` (GL_SCOPE_SAMPS = 512 floats, bound in gen as `scope #0-glitchscope`): see GL_SCOPE.
//   Offsets are computed (ACTIVITY / LEVEL / MOVE_* hold one float per chain position). Movement telemetry (every tick, per chain
//   position): MOVE_ON 1 while that instance's movement runs, MOVE_OFS the offset it adds to its target (depth * source, in fractions of
//   the target's range), MOVE_POS the target's normalized position after the movement, MOVE_PH the source phase (LFO: position in the
//   cycle, Steps: position in the pattern, Env: the level, all 0..1). Sequencer telemetry (written every tick):
//   SEQ_ON (1 while Seq mode is active), SEQ_PLAY (transport playing), SEQ_STEP (step index 0..15), SEQ_SLOT (current slot
//   or -1), SEQ_PREV (previous step's slot or -1), SEQ_GLIDE (crossfade progress 0..1, 1 = settled), SEQ_FRAC (position in
//   the step 0..1), SEQ_COUNT (absolute step counter). WEIGHTS holds the normalized weights the engine actually uses.
//
// LIVE PARAMETERS (GL_PARAMS / GL_PARAM_KEYS, real live.* objects kept OFF the face): morphx, morphy, chaos, mix, out,
//   randomize, mutate, mode (Working / Morph / Seq, 3-way enum), seqrate (enum GL_SEQ_RATE_NAMES), glide (%), seqlen (int 1..16).
//   (Movement has no Live parameters of its own: it is part of the glitch / slot state.)
//   The face reports their values with `set_<key>`; the face's state mirrors seqrate / glide / seqlen in state.seq.
//
// STATE (versioned, saved as the v8ui blob GlitchStateData through getvalueof / setvalueof = [GL_STATE_VERSION, json]):
//   { version: 4, slots: [glitch|null x8], corners: [slot index x4] (TL, TR, BL, BR), allow: {type: bool}, chaos 0..1,
//     xy: [x, y] (0..1, y 0 = top), working: glitch (the editable one), audition: "working" | "morph" | "seq", seed: int,
//     ui: { editor, slots, seq, options: 0|1 section flags, sel: selected tile key, optCat, edTab: 0 PARAMS | 1 MOTION tab of the editor },
//     seq: { steps: [16 x (-1 hold | 0..7)], length 1..16, rate 0..9, glide 0..1, curve 0|1 } }
//   Versions: 1 (no ui), 2 (+ ui), 3 (+ seq; new modules), 4 (+ per-module movement, ui.edTab, the Movement allow-list kinds
//   mv_lfo / mv_steps / mv_env). A v1 / v2 blob loads with the sequence EMPTY (all steps -1, length 8, rate 1/8, glide 0) and every
//   new module absent (wet 0, the new spectral sub-op amounts 0) in all slots; a v1..v3 blob has no movement anywhere (`move: null`).
// GLITCH (preset): { version, name, seed, modules: { <instanceId>: { wet, params: {key: value}, move: null | MOVE } }, movement: {} }
//   An absent instance is off. `movement` at glitch level stays reserved (unused).
// MOVEMENT (phase 3): MOVE = { type 1 LFO | 2 Steps | 3 Env, target: param key, depth -1..1, sync 0|1, div 0..15, hz, phase, shape 0..6,
//   glide, nsteps 8|16, steps[16], atk, rel } (see the block above defaultMove()). One source per chain instance; the spectral
//   instance has ONE source shared by its sub-ops (the target decides which sub-op's tile shows it).
//   VECTOR: after the 113 module params, instance k owns 29 floats at mvBase + 29 * k: mv_on, mv_type, mv_target (position of the target in
//   the instance's param list), mv_depth, mv_hz, mv_cpb (cycles per beat = 1 / GL_MV_DIV_BEATS[div]), mv_sync, mv_phase, mv_shape,
//   mv_glide, mv_nsteps (0 = 8, 1 = 16), mv_atk, mv_rel, mv_s0..mv_s15. Blend: mv_depth over the slots where the module is on (a slot
//   without movement counts as depth 0, so movement fades in and out with the morph weights); every other mv_* param only over the slots
//   where mv_on = 1 (log for hz / cpb / atk / rel, linear for phase / glide / steps / depth, highest weight for type / target / shape /
//   sync / nsteps, ties to the lowest slot). Nothing is blended from a slot without movement, so it never dilutes the others.
//   ENGINE: gen evaluates every active source in the 32-sample control tick (gl_move, one call site in one loop over the chain) and
//   adds depth * source to the BLENDED target in normalized space (so log params move in log space), before the per-param smoothing.
//   Sources: LFO shapes sine / tri / saw up / saw down / square / smooth random / S&H; Steps (position = beat * cycles-per-beat + phase
//   * nsteps, glide ramps from the previous step); Env follower of the module's INPUT level (-60..0 dB -> 0..1, attack / release ms).
//   Synced sources are locked to the host beat (phase = beat * cpb + offset, the offset absorbs rate changes so the phase never jumps;
//   cpb is read from the blended target, so a rate that has not changed since the module started has offset 0 = exactly beat * cpb) and
//   HOLD while the transport is stopped (like the sequencer); free (Hz) sources keep running; the follower always runs.
//
// MOVEMENT API: defaultMove, normalizeMove, glitchMoveCandidates(tileKey), glitchMainParam(tileKey), glitchGetMove(g, tileKey),
//   glitchSetMoveType(g, tileKey, 0..3), glitchSetMove(g, tileKey, field, v), glitchSetMoveStep, glMoveFromVector(vec, instId),
//   glMoveTypesAllowed(allowList), rollMovement(g, seed, chaos, allowList), mutateMovement(g, seed, amount, allowList); JS twins of the gen:
//   glMoveLfo, glMoveStepValue, glMoveTick, glMoveApply, glMoveBlock. UI model: glitchMotionLayout(ed, type).
// API: glitchLayout(), defaultGlitch(), randomizeGlitch(seed, chaos, allowList), mutateGlitch(g, seed, amount, allowList),
//   glitchToVector(g), blendVectors(vectors, weights), xyWeights(x, y), cornerSlotWeights(corners, x, y),
//   defaultState(), normalizeState(obj), stateToBlob(state), stateFromBlob(arr), engineVectors(state),
//   engineWeights(state), packEngineBuffer(state), saveToSlot(state, i), recallSlot(state, i), clearSlot(state, i).
//   SEQUENCER: defaultSeq(), normalizeSeq(o), seqWeights(seq, beat) -> { weights[8], idx, cur, prev, prog, frac, abs },
//   seqSlotAt(steps, idx, len), randomizeSequence(seed, chaos, filledSlots, length?) -> { steps[16], length },
//   filledSlots(state) -> [indices], setSeqStep(state, i, slot), setSeqLength / setSeqRate / setSeqGlide (state setters),
//   seqHeader(state) -> the 8 header floats. GL_SEQ_RATES / GL_SEQ_RATE_NAMES / GL_SEQ_MAX.
// UI MODEL (stage 2, section at the end of this file): glitchFaceLayout(ui) (all rects, device width), glitchTiles(vec),
//   glitchEditorRows(key), glitchSetValue / glitchRemoveTile / glitchToggleLock, rerollWorking / mutateWorking (honour locks),
//   GL_PARAMS (the Live parameters), glitchHitMap(ui, nTiles, nRows) (every interactive rect, used by the tests).

var GL_STATE_VERSION = 4;
var GL_GLITCH_VERSION = 1;
var GL_NSLOT = 8;
var GL_FFT_N = 1024;
var GL_LATENCY = 1023; // STFT path N - 1; everything else is aligned to it
var GL_ACTIVE_EPS = 0.0005;
var GL_SLOTS_BUF_SAMPS = 9472; // 8 slot vectors of NP floats + weights + sequencer block + the constants block (see glitchLayout().endOffset)
var GL_SCOPE_SAMPS = 640;
var GL_HOP_CTL = 32; // gen re-blends the weights every 32 samples
var GL_SEQ_MAX = 16;
var GL_SEQ_HDR = 8;
var GL_MODE_NAMES = ["Working", "Morph", "Seq"];

// musical divisions in beats (quarter notes). Shared by Stutter, Time, Chopper, Delay, Corrupt, Reverse, Scatter. gen: gl_div().
var GL_DIV_BEATS = [0.0625, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 2];
var GL_DIV_NAMES = ["1/64", "1/32", "1/16", "1/16.", "1/8", "1/8.", "1/4", "1/2"];
// LFO cycle lengths in beats (Phaser, synced). gen: gl_lfobeats().
var GL_LFO_BEATS = [0.5, 1, 2, 4, 8, 16, 32];
var GL_LFO_NAMES = ["1/8", "1/4", "1/2", "1 bar", "2 bar", "4 bar", "8 bar"];
// sequencer step lengths in beats (1/6 beat = 1/16 triplet ...). gen: gl_seqdiv().
var GL_SEQ_RATES = [0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 4 / 3, 2, 4];
var GL_SEQ_RATE_NAMES = ["1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4", "1/2T", "1/2", "1 bar"];
var GL_SLICE_COUNTS = [2, 4, 8, 16]; // Slice Shuffle: slices per span
var GL_SHUF_SPANS = [1, 2, 4]; // Slice Shuffle: span in beats
var GL_VOWELS = [[800, 1150, 2900], [400, 1600, 2700], [350, 1700, 2700], [450, 800, 2830], [325, 700, 2700]]; // a e i o u (F1..F3 Hz)

var GL_CHOP_PATTERNS = [0xaaaa, 0x8888, 0xf0f0, 0xcccc, 0xb6b6, 0x9249, 0xff00, 0xa5a5, 0xe7e7, 0x8e8e];

// ---- per-module MOVEMENT (phase 3): one optional source per chain instance (LFO / Steps / Envelope follower) that moves one
// continuous param of that instance. Types: 0 Off, 1 LFO, 2 Steps, 3 Env. See the contract in the header.
var GL_MV_TYPE_NAMES = ["Off", "LFO", "Steps", "Env"];
var GL_MV_SHAPE_NAMES = ["Sine", "Tri", "Saw Up", "Saw Dn", "Square", "Smooth Rnd", "S&H"];
var GL_MV_STEPS = 16;
// synced rate = the LFO CYCLE (Steps: one STEP) length in beats, shortest first: 1/32 .. 4 bars with triplets and dotted values
var GL_MV_DIV_BEATS = [0.125, 1 / 6, 0.25, 1 / 3, 0.375, 0.5, 2 / 3, 0.75, 1, 4 / 3, 1.5, 2, 3, 4, 8, 16];
var GL_MV_DIV_NAMES = ["1/32", "1/16T", "1/16", "1/8T", "1/16.", "1/8", "1/4T", "1/8.", "1/4", "1/2T", "1/4.", "1/2", "1/2.", "1 bar", "2 bar", "4 bar"];
var GL_MV_DIV_DEFAULT = { 1: 13, 2: 5, 3: 13 }; // per type: LFO 1 bar, Steps 1/8 per step
var GL_MV_COL = [1.0, 0.36, 0.78]; // the "motion" colour (magenta) used by the tiles, bars and the Motion panel
var GL_MV_PARAM_KEYS = ["mv_on", "mv_type", "mv_target", "mv_depth", "mv_hz", "mv_cpb", "mv_sync", "mv_phase", "mv_shape", "mv_glide", "mv_nsteps", "mv_atk", "mv_rel"];
function glRange(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }

// ---------------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------------
// p(): param spec. rand = [lo0, hi0, lo1, hi1]: the value range at Chaos 0 and Chaos 1 (linear in Chaos; log params
// interpolate the bounds in log space). Discrete params: calm / wild = value lists (Chaos picks `wild` with probability
// Chaos). group = key of the amount param that makes this param active (default: the instance's wet).
function glP(key, name, kind, min, max, def, extra) {
    var o = { key: key, name: name, kind: kind, min: min, max: max, def: def, unit: "", rand: null, calm: null, wild: null, choices: null, group: null };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
}
function glWet(rand) { return glP("wet", "Amount", "wet", 0, 1, 0, { rand: rand || [0.6, 1, 0.35, 1] }); }
function glDriveParams() {
    return [
        glWet(),
        glP("mode", "Mode", "disc", 0, 3, 0, { choices: ["Soft", "Fold", "Hard", "Asym"], calm: [0, 3], wild: [0, 1, 2, 3] }),
        glP("drive", "Drive", "lin", 0, 36, 6, { unit: "dB", rand: [3, 12, 6, 36] }),
        glP("tone", "Tone", "log", 800, 20000, 12000, { unit: "Hz", rand: [4000, 16000, 800, 20000] }),
    ];
}

var GL_INSTANCES = [
    { id: "drvA", type: "drive", name: "Drive A", category: "Distort", params: glDriveParams() },
    { id: "filt", type: "filter", name: "Filter", category: "Filter", params: [
        glWet(),
        glP("type", "Type", "disc", 0, 3, 0, { choices: ["LP", "BP", "HP", "Notch"], calm: [0, 2], wild: [0, 1, 2, 3] }),
        glP("cutoff", "Cutoff", "log", 40, 16000, 2000, { unit: "Hz", rand: [300, 6000, 60, 14000] }),
        glP("res", "Resonance", "lin", 0, 1, 0.3, { rand: [0.1, 0.5, 0.1, 0.95] }),
    ] },
    // 2..3 bandpass formants (a e i o u morph). gen: gl_form.
    { id: "form", type: "formant", name: "Formant", category: "Filter", params: [
        glWet(),
        glP("vowel", "Vowel", "lin", 0, 4, 0, { rand: [0, 4, 0, 4] }),
        glP("shift", "Shift", "lin", -12, 12, 0, { unit: "st", rand: [-3, 3, -12, 12] }),
        glP("res", "Resonance", "lin", 0, 1, 0.5, { rand: [0.3, 0.7, 0.1, 1] }),
    ] },
    // feedback comb (frequency = 1 / delay), damped. gen: gl_comb.
    { id: "comb", type: "comb", name: "Comb", category: "Filter", params: [
        glWet(),
        glP("freq", "Frequency", "log", 40, 4000, 220, { unit: "Hz", rand: [80, 800, 40, 4000] }),
        glP("fb", "Feedback", "lin", -0.95, 0.95, 0.6, { rand: [0.4, 0.85, -0.9, 0.93] }),
        glP("damp", "Damping", "log", 1000, 16000, 8000, { unit: "Hz", rand: [4000, 12000, 1000, 16000] }),
    ] },
    // 2 / 4 / 6 / 8 stage allpass phaser, LFO free (Hz) or locked to the host beat. gen: gl_phas.
    { id: "phas", type: "phaser", name: "Phaser", category: "Filter", params: [
        glWet(),
        glP("stages", "Stages", "disc", 0, 3, 1, { choices: ["2", "4", "6", "8"], calm: [1, 2], wild: [0, 1, 2, 3] }),
        glP("sync", "Rate Mode", "disc", 0, 1, 0, { choices: ["Free", "Sync"], calm: [1], wild: [0, 1] }),
        glP("hz", "Rate", "log", 0.05, 10, 0.5, { unit: "Hz", rand: [0.2, 1.5, 0.05, 8] }),
        glP("div", "Sync Rate", "disc", 0, 6, 3, { choices: GL_LFO_NAMES, calm: [2, 3, 4], wild: [0, 1, 2, 3, 4, 5, 6] }),
        glP("depth", "Depth", "lin", 0, 1, 0.8, { rand: [0.5, 1, 0.3, 1] }),
        glP("fb", "Feedback", "lin", -0.9, 0.9, 0.4, { rand: [0.1, 0.6, -0.85, 0.85] }),
    ] },
    { id: "crush", type: "crush", name: "Crush", category: "Distort", params: [
        glWet(),
        glP("bits", "Bits", "lin", 1, 16, 8, { rand: [5, 10, 1.5, 8] }),
        glP("rate", "Downsample", "log", 1, 64, 4, { unit: "x", rand: [1.5, 6, 1.5, 48] }),
        glP("jitter", "Jitter", "lin", 0, 1, 0, { rand: [0, 0.2, 0, 0.8] }),
    ] },
    // half / full / asymmetric rectifier with a blend, DC blocked. gen: gl_rect.
    { id: "rect", type: "rectify", name: "Rectify", category: "Distort", params: [
        glWet(),
        glP("mode", "Mode", "disc", 0, 2, 1, { choices: ["Half", "Full", "Asym"], calm: [0, 1, 2], wild: [0, 1, 2] }),
        glP("blend", "Blend", "lin", 0, 1, 1, { rand: [0.5, 1, 0.2, 1] }),
    ] },
    // delay-line FM: an oscillator (ratio x 110 Hz) or the input itself modulates a short delay, through zero. gen: gl_fm.
    { id: "fm", type: "fm", name: "FM", category: "Distort", params: [
        glWet(),
        glP("mode", "Source", "disc", 0, 1, 0, { choices: ["Osc", "Self"], calm: [0, 1], wild: [0, 1] }),
        glP("ratio", "Ratio", "log", 0.25, 32, 2, { unit: "x", rand: [0.5, 4, 0.25, 32] }),
        glP("index", "Index", "lin", 0, 1, 0.4, { rand: [0.1, 0.5, 0.1, 1] }),
    ] },
    // seeded bit flips / overflow wrap / sample drops, one decision per beat slot (hash of the absolute slot). gen: gl_corr.
    { id: "corr", type: "corrupt", name: "Corrupt", category: "Distort", params: [
        glWet(),
        glP("div", "Slot", "disc", 0, 7, 3, { choices: GL_DIV_NAMES, calm: [2, 3, 4], wild: [0, 1, 2, 3, 4, 5, 6] }),
        glP("chance", "Chance", "lin", 0, 1, 0.5, { rand: [0.2, 0.6, 0.2, 1] }),
        glP("flips", "Bit Flips", "lin", 0, 1, 0.3, { rand: [0, 0.4, 0, 1] }),
        glP("wrap", "Wrap", "lin", 0, 1, 0, { rand: [0, 0.3, 0, 1] }),
        glP("drop", "Drops", "lin", 0, 1, 0, { rand: [0, 0.3, 0, 0.8] }),
    ] },
    { id: "ring", type: "ring", name: "Ring / Freq Shift", category: "Pitch", params: [
        glWet(),
        glP("mode", "Mode", "disc", 0, 1, 0, { choices: ["Ring", "Shift"], calm: [0, 1], wild: [0, 1] }),
        glP("freq", "Frequency", "lin", -2000, 2000, 200, { unit: "Hz", rand: [40, 300, 20, 1500] }),
    ] },
    { id: "stut", type: "stutter", name: "Stutter", category: "Time", params: [
        glWet(),
        glP("div", "Length", "disc", 0, 7, 2, { choices: GL_DIV_NAMES, calm: [2, 4, 6], wild: [0, 1, 2, 3, 4, 5, 6, 7] }),
        glP("prob", "Chance", "lin", 0, 1, 1, { rand: [0.6, 1, 0.3, 1] }),
        glP("decay", "Decay", "lin", 0, 1, 0.2, { rand: [0, 0.3, 0, 0.8] }),
    ] },
    { id: "time", type: "time", name: "Tape / Reverse", category: "Time", params: [
        glWet(),
        glP("mode", "Mode", "disc", 0, 2, 2, { choices: ["Stop", "Vari", "Rev"], calm: [0, 1, 2], wild: [0, 1, 2] }),
        glP("amt", "Amount", "lin", 0, 1, 0.6, { rand: [0.4, 0.8, 0.2, 1] }),
        glP("div", "Length", "disc", 0, 7, 4, { choices: GL_DIV_NAMES, calm: [4, 5, 6], wild: [2, 3, 4, 5, 6, 7] }),
    ] },
    // Granular Pitch and Granular Stretch share ONE grain engine (gen: gl_grain, a loop of two over one call site), so
    // both have the same param layout (wet, p1, size, p2).
    { id: "gpit", type: "gpitch", name: "Granular Pitch", category: "Pitch", params: [
        glWet(),
        glP("pitch", "Pitch", "lin", -24, 24, 7, { unit: "st", rand: [-7, 7, -24, 24] }),
        glP("size", "Grain Size", "log", 20, 400, 80, { unit: "ms", rand: [40, 160, 20, 400] }),
        glP("jitter", "Jitter", "lin", 0, 1, 0.2, { rand: [0, 0.3, 0, 1] }),
    ] },
    { id: "gstr", type: "gstretch", name: "Granular Stretch", category: "Time", params: [
        glWet(),
        glP("speed", "Speed", "lin", 0, 1, 0.25, { rand: [0.1, 0.5, 0, 0.7] }),
        glP("size", "Grain Size", "log", 20, 400, 120, { unit: "ms", rand: [60, 240, 20, 400] }),
        glP("spread", "Spread", "lin", 0, 1, 0.2, { rand: [0, 0.3, 0, 1] }),
    ] },
    // beat-synced reversed slices, a chance per slice. gen: gl_rvs.
    { id: "rvs", type: "revslice", name: "Reverse Slices", category: "Time", params: [
        glWet(),
        glP("div", "Slice", "disc", 0, 7, 4, { choices: GL_DIV_NAMES, calm: [3, 4, 5, 6], wild: [2, 3, 4, 5, 6, 7] }),
        glP("chance", "Chance", "lin", 0, 1, 0.6, { rand: [0.4, 0.9, 0.2, 1] }),
    ] },
    // the last span is cut into N slices and replayed in a seeded order (one span of latency). gen: gl_shuf.
    { id: "shuf", type: "shuffle", name: "Slice Shuffle", category: "Time", params: [
        glWet(),
        glP("slices", "Slices", "disc", 0, 3, 2, { choices: ["2", "4", "8", "16"], calm: [1, 2], wild: [0, 1, 2, 3] }),
        glP("span", "Span", "disc", 0, 2, 2, { choices: ["1 beat", "2 beats", "1 bar"], calm: [1, 2], wild: [0, 1, 2] }),
        glP("chance", "Chance", "lin", 0, 1, 0.7, { rand: [0.4, 0.9, 0.3, 1] }),
        glP("seed", "Seed", "disc", 0, 63, 0, { choices: null, calm: glRange(0, 7), wild: glRange(0, 63) }),
    ] },
    { id: "chop", type: "chopper", name: "Chopper", category: "Time", params: [
        glWet(),
        glP("pattern", "Pattern", "disc", 0, 65535, 0xaaaa, { patterns: true }),
        glP("div", "Step", "disc", 0, 7, 2, { choices: GL_DIV_NAMES, calm: [2, 4], wild: [1, 2, 3, 4, 5, 6] }),
        glP("smooth", "Smooth", "lin", 0, 1, 0.2, { rand: [0.1, 0.5, 0, 1] }),
    ] },
    { id: "spec", type: "spectral", name: "Spectral", category: "Spectral", params: [
        glWet([0.8, 1, 0.5, 1]),
        glP("frz_amt", "Freeze", "wet", 0, 1, 0, { rand: [0.5, 1, 0.3, 1], group: "frz_amt" }),
        glP("frz_rate", "Freeze Refresh", "disc", 0, 3, 0, { choices: ["Once", "4 beats", "2 beats", "1 beat"], calm: [0, 1], wild: [0, 1, 2, 3], group: "frz_amt" }),
        glP("smr_amt", "Smear", "wet", 0, 1, 0, { rand: [0.4, 0.9, 0.2, 1], group: "smr_amt" }),
        glP("smr_blur", "Blur", "lin", 0, 1, 0.3, { rand: [0, 0.5, 0, 1], group: "smr_amt" }),
        glP("cc_amt", "Cepstral Crush", "wet", 0, 1, 0, { rand: [0.6, 1, 0.4, 1], group: "cc_amt" }),
        glP("cc_coeffs", "Coeffs", "lin", 0, 1, 0.5, { rand: [0.3, 0.8, 0.02, 0.9], group: "cc_amt" }),
        glP("cc_bits", "Bits", "lin", 1, 16, 16, { rand: [8, 16, 2, 12], group: "cc_amt" }),
        glP("sc_amt", "Scramble", "wet", 0, 1, 0, { rand: [0.4, 0.8, 0.3, 1], group: "sc_amt" }),
        glP("sc_mode", "Scramble Mode", "disc", 1, 3, 1, { choices: ["Rev", "Shuf", "Rot"], calm: [1, 3], wild: [1, 2, 3], group: "sc_amt" }),
        // phase 2 sub-ops (all appended after the original ten, each with its own amount)
        glP("sct_amt", "Scatter", "wet", 0, 1, 0, { rand: [0.3, 0.8, 0.2, 1], group: "sct_amt" }),
        glP("sct_w", "Scatter Width", "lin", 2, 32, 8, { unit: "bins", rand: [4, 16, 2, 32], group: "sct_amt" }),
        glP("sct_rate", "Scatter Re-roll", "disc", 0, 7, 5, { choices: GL_DIV_NAMES, calm: [4, 5, 6], wild: [2, 3, 4, 5, 6, 7], group: "sct_amt" }),
        glP("mir_amt", "Mirror", "wet", 0, 1, 0, { rand: [0.3, 0.8, 0.2, 1], group: "mir_amt" }),
        glP("mir_pivot", "Mirror Pivot", "log", 100, 8000, 1500, { unit: "Hz", rand: [400, 3000, 150, 7000], group: "mir_amt" }),
        glP("bsh_amt", "Bin Shift", "wet", 0, 1, 0, { rand: [0.4, 0.9, 0.3, 1], group: "bsh_amt" }),
        glP("bsh_bins", "Shift", "lin", -64, 64, 8, { unit: "bins", rand: [3, 16, 2, 48], group: "bsh_amt" }),
        glP("sgl_amt", "Spec Gate", "wet", 0, 1, 0, { rand: [0.4, 0.9, 0.3, 1], group: "sgl_amt" }),
        glP("sgl_mode", "Gate Mode", "disc", 0, 1, 0, { choices: ["Top-K", "Lofi"], calm: [0, 1], wild: [0, 1], group: "sgl_amt" }),
        glP("sgl_k", "Keep Bins", "log", 1, 256, 32, { rand: [16, 96, 2, 64], group: "sgl_amt" }),
        glP("sgl_step", "Lofi Step", "lin", 1, 24, 6, { unit: "dB", rand: [3, 12, 6, 24], group: "sgl_amt" }),
    ] },
    { id: "drvB", type: "drive", name: "Drive B", category: "Distort", params: glDriveParams() },
    { id: "dly", type: "delay", name: "Delay", category: "Space", params: [
        glWet([0.4, 0.8, 0.3, 1]),
        glP("div", "Time", "disc", 0, 7, 4, { choices: GL_DIV_NAMES, calm: [3, 4, 5, 6], wild: [0, 1, 2, 3, 4, 5, 6, 7] }),
        glP("fb", "Feedback", "lin", 0, 0.95, 0.4, { rand: [0.2, 0.55, 0.1, 0.92] }),
        glP("pp", "Ping Pong", "lin", 0, 1, 0.5, { rand: [0, 1, 0, 1] }),
        glP("damp", "Damping", "log", 500, 16000, 6000, { unit: "Hz", rand: [2500, 10000, 600, 16000] }),
    ] },
    // one short echo, 40..180 ms, with tone and a stereo offset. gen: gl_slap.
    { id: "slap", type: "slapback", name: "Slapback", category: "Space", params: [
        glWet([0.3, 0.7, 0.2, 1]),
        glP("time", "Time", "log", 40, 180, 90, { unit: "ms", rand: [60, 120, 40, 180] }),
        glP("tone", "Tone", "log", 800, 16000, 5000, { unit: "Hz", rand: [2000, 9000, 800, 16000] }),
        glP("offset", "Stereo Offset", "lin", -1, 1, 0.3, { rand: [0, 0.6, -1, 1] }),
    ] },
    { id: "rev", type: "reverb", name: "Reverb", category: "Space", params: [
        glWet([0.2, 0.5, 0.2, 0.9]),
        glP("size", "Size", "lin", 0, 1, 0.5, { rand: [0.3, 0.7, 0.1, 1] }),
        glP("decay", "Decay", "lin", 0, 1, 0.5, { rand: [0.3, 0.7, 0.1, 1] }),
        glP("damp", "Damping", "log", 800, 16000, 5000, { unit: "Hz", rand: [2000, 10000, 800, 16000] }),
        glP("void", "Void", "lin", 0, 1, 0, { rand: [0, 0.2, 0, 1] }),
    ] },
    { id: "wid", type: "width", name: "Width / Gain", category: "Utility", params: [
        glWet([0.8, 1, 0.5, 1]),
        glP("width", "Width", "lin", 0, 2, 1, { rand: [0.7, 1.4, 0, 2] }),
        glP("gain", "Gain", "lin", -12, 6, 0, { unit: "dB", rand: [-3, 2, -9, 6] }),
    ] },
];
var GL_NINST = GL_INSTANCES.length;

// The "main" continuous param of every module: the default movement target and the first param Randomize picks to move.
// (One per instance; a spectral sub-op has its own, GL_MAIN_SUB. Freeze and Scramble have no continuous param.)
var GL_MAIN_PARAM = { drvA: "drive", filt: "cutoff", form: "vowel", comb: "freq", phas: "depth", crush: "bits", rect: "blend", fm: "index", corr: "chance",
    ring: "freq", stut: "decay", time: "amt", gpit: "pitch", gstr: "speed", rvs: "chance", shuf: "chance", chop: "smooth", spec: "smr_blur", drvB: "drive",
    dly: "fb", slap: "tone", rev: "decay", wid: "width" };
var GL_MAIN_SUB = { smear: "smr_blur", ccrush: "cc_coeffs", scatter: "sct_w", mirror: "mir_pivot", binshift: "bsh_bins", specgate: "sgl_k" };
(function markMainParams() {
    for (var i = 0; i < GL_INSTANCES.length; i++) {
        var inst = GL_INSTANCES[i];
        for (var j = 0; j < inst.params.length; j++) inst.params[j].main = inst.params[j].key === GL_MAIN_PARAM[inst.id];
    }
})();

// Movement param specs of one instance (the movement block of the flat vector, GL_MV_PARAM_KEYS order, then 16 step values).
// mv_on is a "wet"-kind flag (1 while the module has movement); every other movement param except mv_depth is only blended over
// the slots where mv_on is set (group = mv_on), so a slot WITHOUT movement does not dilute rate / steps / shape; mv_depth is
// blended over every slot where the module is on (a slot without movement contributes depth 0), so movement fades in and out
// with the morph weights. mv_target is the POSITION of the target param in the instance's param list.
function glMvSpecs(inst) {
    var mainPos = 0;
    for (var i = 0; i < inst.params.length; i++) if (inst.params[i].main) mainPos = i;
    var specs = [
        glP("mv_on", "Motion", "wet", 0, 1, 0),
        glP("mv_type", "Type", "disc", 0, 3, 0, { choices: GL_MV_TYPE_NAMES }),
        glP("mv_target", "Target", "disc", 0, 31, mainPos),
        glP("mv_depth", "Depth", "lin", -1, 1, 0.4),
        glP("mv_hz", "Rate", "log", 0.02, 20, 1, { unit: "Hz" }),
        glP("mv_cpb", "Rate", "log", 0.0625, 8, 0.25),
        glP("mv_sync", "Rate Mode", "disc", 0, 1, 1, { choices: ["Free", "Sync"] }),
        glP("mv_phase", "Phase", "lin", 0, 1, 0),
        glP("mv_shape", "Shape", "disc", 0, 6, 0, { choices: GL_MV_SHAPE_NAMES }),
        glP("mv_glide", "Glide", "lin", 0, 1, 0),
        glP("mv_nsteps", "Steps", "disc", 0, 1, 0, { choices: ["8", "16"] }),
        glP("mv_atk", "Attack", "log", 1, 500, 10, { unit: "ms" }),
        glP("mv_rel", "Release", "log", 5, 2000, 200, { unit: "ms" }),
    ];
    for (var s = 0; s < GL_MV_STEPS; s++) specs.push(glP("mv_s" + s, "Step " + (s + 1), "lin", -1, 1, 0));
    return specs;
}

// Module types: what the user can switch on / off in the Options allow-list.
// instances: where it lives. amountKey: for the spectral sub-ops, the amount param of the single `spec` instance.
var GL_TYPES = [
    { id: "drive", name: "Drive", category: "Distort", instances: ["drvA", "drvB"], weight: 1.2 },
    { id: "filter", name: "Filter", category: "Filter", instances: ["filt"], weight: 1.2 },
    { id: "formant", name: "Formant", category: "Filter", instances: ["form"], weight: 0.8 },
    { id: "comb", name: "Comb", category: "Filter", instances: ["comb"], weight: 0.8 },
    { id: "phaser", name: "Phaser", category: "Filter", instances: ["phas"], weight: 0.7 },
    { id: "crush", name: "Bit / Rate Crush", category: "Distort", instances: ["crush"], weight: 1 },
    { id: "rectify", name: "Rectify", category: "Distort", instances: ["rect"], weight: 0.6 },
    { id: "fm", name: "FM", category: "Distort", instances: ["fm"], weight: 0.6 },
    { id: "corrupt", name: "Corrupt", category: "Distort", instances: ["corr"], weight: 0.8 },
    { id: "ring", name: "Ring / Freq Shift", category: "Pitch", instances: ["ring"], weight: 0.7 },
    { id: "stutter", name: "Stutter", category: "Time", instances: ["stut"], weight: 1 },
    { id: "time", name: "Tape Stop / Reverse", category: "Time", instances: ["time"], weight: 0.8 },
    { id: "gpitch", name: "Granular Pitch", category: "Pitch", instances: ["gpit"], weight: 0.7 },
    { id: "gstretch", name: "Granular Stretch", category: "Time", instances: ["gstr"], weight: 0.6 },
    { id: "revslice", name: "Reverse Slices", category: "Time", instances: ["rvs"], weight: 0.8 },
    { id: "shuffle", name: "Slice Shuffle", category: "Time", instances: ["shuf"], weight: 0.8 },
    { id: "chopper", name: "Chopper", category: "Time", instances: ["chop"], weight: 1 },
    { id: "freeze", name: "Spectral Freeze", category: "Spectral", instances: ["spec"], amountKey: "frz_amt", weight: 0.5 },
    { id: "smear", name: "Spectral Smear", category: "Spectral", instances: ["spec"], amountKey: "smr_amt", weight: 0.6 },
    { id: "ccrush", name: "Cepstral Crush", category: "Spectral", instances: ["spec"], amountKey: "cc_amt", weight: 0.8 },
    { id: "scramble", name: "Cepstral Scramble", category: "Spectral", instances: ["spec"], amountKey: "sc_amt", weight: 0.6 },
    { id: "scatter", name: "Spectral Scatter", category: "Spectral", instances: ["spec"], amountKey: "sct_amt", weight: 0.5 },
    { id: "mirror", name: "Spectral Mirror", category: "Spectral", instances: ["spec"], amountKey: "mir_amt", weight: 0.4 },
    { id: "binshift", name: "Spectral Shift", category: "Spectral", instances: ["spec"], amountKey: "bsh_amt", weight: 0.5 },
    { id: "specgate", name: "Spectral Gate / Lofi", category: "Spectral", instances: ["spec"], amountKey: "sgl_amt", weight: 0.5 },
    { id: "delay", name: "Delay", category: "Space", instances: ["dly"], weight: 1.1 },
    { id: "slapback", name: "Slapback", category: "Space", instances: ["slap"], weight: 0.7 },
    { id: "reverb", name: "Reverb", category: "Space", instances: ["rev"], weight: 1 },
    { id: "width", name: "Width / Gain", category: "Utility", instances: ["wid"], weight: 0.5 },
];

// Movement kinds in the Options allow-list (category "Movement"). mvType = the movement type they enable.
var GL_MOVE_TYPES = [
    { id: "mv_lfo", name: "LFO", category: "Movement", mvType: 1 },
    { id: "mv_steps", name: "Steps", category: "Movement", mvType: 2 },
    { id: "mv_env", name: "Envelope", category: "Movement", mvType: 3 },
];
// Everything the Options view lists, in index order: the module types, then the movement kinds.
/** @type {Array<any>} */
var GL_ALLOW_ITEMS = [].concat(GL_TYPES, GL_MOVE_TYPES);

// ---------------------------------------------------------------------------------------------------------------
// Layout (flat vector indices)
// ---------------------------------------------------------------------------------------------------------------
var GL_KIND_CODE = { wet: 0, lin: 1, log: 2, disc: 3 };

/** @returns {{np:number, instances:Array<any>, params:Array<any>, index:Object<string, number>, base:Object<string, number>, weightsOffset:number, seqOffset:number, metaOffset:number, defsOffset:number, wbOffset:number, minsOffset:number, maxsOffset:number, endOffset:number, ninst:number, mvBase:number, mvN:number, mv:Object<string, number>}} */
function glitchLayout() {
    if (glitchLayout._cache) return glitchLayout._cache;
    var params = [];
    var index = {};
    var base = {};
    var instances = [];
    for (var ii = 0; ii < GL_INSTANCES.length; ii++) {
        var inst = GL_INSTANCES[ii];
        base[inst.id] = params.length;
        var wetIdx = params.length;
        var amountIdx = {};
        for (var pi2 = 0; pi2 < inst.params.length; pi2++) {
            var ps = inst.params[pi2];
            if (ps.kind === "wet") amountIdx[ps.key] = params.length + pi2;
        }
        for (var pj = 0; pj < inst.params.length; pj++) {
            var spec = inst.params[pj];
            var idx = params.length;
            var grp = spec.kind === "wet" ? idx : (spec.group ? amountIdx[spec.group] : wetIdx);
            params.push({ idx: idx, inst: inst.id, instIdx: ii, key: spec.key, kind: spec.kind, kindCode: GL_KIND_CODE[spec.kind], group: grp, def: spec.def, min: spec.min, max: spec.max, spec: spec });
            index[inst.id + "." + spec.key] = idx;
        }
        instances.push({ id: inst.id, pos: ii, base: wetIdx, count: inst.params.length, wet: wetIdx, mv: 0 });
    }
    // the movement blocks, after every instance's own params: instance k at mvBase + mvN * k
    var mvBase = params.length;
    var mvN = 0;
    for (var mi = 0; mi < GL_INSTANCES.length; mi++) {
        var minst = GL_INSTANCES[mi];
        var mvSpecs = glMvSpecs(minst);
        var onIdx = params.length;
        mvN = mvSpecs.length;
        instances[mi].mv = onIdx;
        for (var mj = 0; mj < mvSpecs.length; mj++) {
            var ms = mvSpecs[mj];
            var midx = params.length;
            var mgrp = mj === 0 ? midx : (ms.key === "mv_depth" ? base[minst.id] : onIdx);
            params.push({ idx: midx, inst: minst.id, instIdx: mi, key: ms.key, kind: ms.kind, kindCode: GL_KIND_CODE[ms.kind], group: mgrp, def: ms.def, min: ms.min, max: ms.max, spec: ms, mv: mj });
            index[minst.id + "." + ms.key] = midx;
        }
    }
    var mvOff = {};
    for (var mk = 0; mk < GL_MV_PARAM_KEYS.length; mk++) mvOff[GL_MV_PARAM_KEYS[mk].replace("mv_", "")] = mk;
    mvOff.step0 = GL_MV_PARAM_KEYS.length;
    var np = params.length;
    var seqOff = GL_NSLOT * np + GL_NSLOT;
    var metaOff = seqOff + GL_SEQ_HDR + GL_SEQ_MAX;
    var wbOff = metaOff + 2 * np;
    glitchLayout._cache = { np: np, instances: instances, params: params, index: index, base: base, weightsOffset: GL_NSLOT * np, seqOffset: seqOff, metaOffset: metaOff,
        defsOffset: metaOff + np, wbOffset: wbOff, minsOffset: wbOff + instances.length, maxsOffset: wbOff + instances.length + np, endOffset: wbOff + instances.length + 2 * np,
        ninst: instances.length, mvBase: mvBase, mvN: mvN, mv: mvOff };
    return glitchLayout._cache;
}
glitchLayout._cache = null;

function glInstance(id) {
    for (var i = 0; i < GL_INSTANCES.length; i++) if (GL_INSTANCES[i].id === id) return GL_INSTANCES[i];
    return null;
}
function glType(id) {
    for (var i = 0; i < GL_TYPES.length; i++) if (GL_TYPES[i].id === id) return GL_TYPES[i];
    return null;
}

/** The constants block of the engine buffer: np meta codes (kind + 4 * group index), np defaults, the wet index per chain
 *  position, then np minimums and np maximums (the movement needs the range of its target). */
function glitchEngineConstants() {
    var L = glitchLayout();
    var out = [];
    for (var i = 0; i < L.np; i++) out.push(L.params[i].kindCode + 4 * L.params[i].group);
    for (var j = 0; j < L.np; j++) out.push(L.params[j].def);
    for (var k = 0; k < L.instances.length; k++) out.push(L.instances[k].wet);
    for (var m = 0; m < L.np; m++) out.push(L.params[m].min);
    for (var x = 0; x < L.np; x++) out.push(L.params[x].max);
    return out;
}
// Per-param meta: [kindCode, groupIndex, default, min, max] x np (gen builds Data meta(np, 5) from the engine buffer's constants block).
function glitchMeta() {
    var L = glitchLayout();
    var m = [];
    for (var i = 0; i < L.np; i++) m.push([L.params[i].kindCode, L.params[i].group, L.params[i].def, L.params[i].min, L.params[i].max]);
    return m;
}

// Telemetry buffer layout (floats in buffer~ #0-glitchscope). Written by gen; the UI only reads. Offsets are computed in
// order: single floats, then blocks (ACTIVITY and LEVEL have GL_NINST floats, one per chain position).
var GL_SCOPE = (function () {
    var o = {};
    var p = 0;
    function one(name) { o[name] = p; p += 1; }
    function block(name, len) { o[name] = p; p += len; }
    one("FRAME"); // frame counter (increments every control tick, wraps at 1e6)
    one("SR");
    one("IN_PEAK"); // input peak, decaying
    one("OUT_PEAK"); // output peak (after limiter, before Mix), decaying
    one("SPEC_RUN"); // 1 while the STFT is processing frames
    one("SPEC_MIX"); // 0..1 how much of the audible spectral stage is the STFT path
    block("ACTIVITY", GL_NINST); // smoothed wet of each instance in chain order
    block("LEVEL", GL_NINST); // output peak after each instance (decaying)
    one("BEAT"); // host beat
    one("BPM");
    one("STUT_ENGAGED"); // 0..1
    one("STUT_PHASE"); // position in the repeating loop 0..1
    one("STUT_LEN_BEATS");
    one("CHOP_STEP"); // 0..15
    one("CHOP_GATE"); // current smoothed gate gain 0..1
    one("CHOP_PATTERN");
    one("TIME_MODE");
    one("TIME_PHASE"); // 0..1 cycle phase of the Time module
    block("WEIGHTS", 8); // the (normalized) slot weights the engine uses
    one("SEQ_ON"); // 1 while Seq mode drives the weights
    one("SEQ_PLAY"); // 1 while the host transport plays (the sequencer clock runs)
    one("SEQ_STEP"); // current step index 0..15
    one("SEQ_SLOT"); // slot of the current step (-1 = none)
    one("SEQ_PREV"); // slot of the previous step (-1 = none)
    one("SEQ_GLIDE"); // crossfade progress previous -> current, 0..1 (1 = settled)
    one("SEQ_FRAC"); // position in the step 0..1
    one("SEQ_COUNT"); // absolute step counter (floor of beat / step length)
    block("BANDS_IN", 64); // 0..1 input spectrum (log-spaced bands, -90..0 dB)
    block("BANDS_OUT", 64); // 0..1 spectrum after the spectral ops
    block("CEP_IN", 64); // original cepstrum c[1..64]
    block("CEP_OUT", 64); // crushed cepstrum c'[1..64]
    block("WAVE_IN", 64); // ring of input block peaks (signed max of |x| per 256 samples)
    block("WAVE_OUT", 64); // same for the output
    one("WAVE_HEAD"); // next write slot 0..63 (both rings)
    one("SPEC_FRAMES"); // STFT frames processed (left channel)
    block("MOVE_ON", GL_NINST); // 1 while the instance's movement runs (module on and a source set)
    block("MOVE_OFS", GL_NINST); // the offset the movement adds to its target, in target-range fractions (depth * source)
    block("MOVE_POS", GL_NINST); // the target's normalized position (0..1 on its own curve) AFTER the movement
    block("MOVE_PH", GL_NINST); // source phase: LFO position in its cycle, Steps position in the pattern (both 0..1), Env level (0..1)
    o.END = p + 6;
    return o;
})();
var GL_WAVE_LEN = 64;
var GL_BANDS = 64;
var GL_CEP_BINS = 64;

// ---------------------------------------------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------------------------------------------
function glRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function glClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function glLerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------------------------------------------
// Presets (glitches)
// ---------------------------------------------------------------------------------------------------------------
function defaultParams(inst) {
    var o = {};
    for (var i = 0; i < inst.params.length; i++) if (inst.params[i].kind !== "wet") o[inst.params[i].key] = inst.params[i].def;
    return o;
}
function defaultGlitch() {
    return { version: GL_GLITCH_VERSION, name: "", seed: 0, modules: {}, movement: {} };
}
function glCopy(g) { return JSON.parse(JSON.stringify(g)); }

// Range of a continuous param at a Chaos level.
function randRange(spec, chaos) {
    var r = spec.rand || [spec.min, spec.max, spec.min, spec.max];
    var lo, hi;
    if (spec.kind === "log") {
        lo = Math.exp(glLerp(Math.log(r[0]), Math.log(r[2]), chaos));
        hi = Math.exp(glLerp(Math.log(r[1]), Math.log(r[3]), chaos));
    } else {
        lo = glLerp(r[0], r[2], chaos);
        hi = glLerp(r[1], r[3], chaos);
    }
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    return [glClamp(lo, spec.min, spec.max), glClamp(hi, spec.min, spec.max)];
}
function randValue(spec, chaos, rnd) {
    if (spec.kind === "disc") {
        if (spec.patterns) {
            if (rnd() >= chaos) return GL_CHOP_PATTERNS[Math.floor(rnd() * GL_CHOP_PATTERNS.length)];
            var dens = glLerp(0.5, 0.35, chaos) + rnd() * 0.25;
            var bits = 0;
            for (var b = 0; b < 16; b++) if (rnd() < dens) bits |= 1 << b;
            return bits === 0 ? 1 : bits;
        }
        var set = rnd() < chaos ? spec.wild : spec.calm;
        return set[Math.floor(rnd() * set.length) % set.length];
    }
    var rg = randRange(spec, chaos);
    var u = rnd();
    var v = spec.kind === "log" ? Math.exp(glLerp(Math.log(rg[0]), Math.log(rg[1]), u)) : glLerp(rg[0], rg[1], u);
    if (spec.min < 0 && spec.max > 0 && rg[0] >= 0 && rnd() < 0.5) v = -v;
    return glClamp(v, spec.min, spec.max);
}
function allowed(allowList, typeId) {
    if (!allowList) return true;
    if (Array.isArray(allowList)) return allowList.indexOf(typeId) >= 0;
    return allowList[typeId] !== false && !!allowList[typeId];
}
function allowedTypes(allowList) {
    var out = [];
    for (var i = 0; i < GL_TYPES.length; i++) if (allowed(allowList, GL_TYPES[i].id)) out.push(GL_TYPES[i]);
    return out;
}

// Switch a module type on inside g with random settings. For sub-ops it also turns `spec` on.
function rollType(g, type, chaos, rnd) {
    var which;
    if (type.instances.length > 1) {
        var r = rnd();
        which = r < 0.4 ? [type.instances[0]] : (r < 0.8 ? [type.instances[1]] : type.instances.slice());
    } else which = type.instances;
    for (var wi = 0; wi < which.length; wi++) {
        var inst = glInstance(which[wi]);
        var mod = g.modules[inst.id] || (g.modules[inst.id] = { wet: 0, params: defaultParams(inst), move: null });
        var onlyGroup = type.amountKey || null;
        for (var pi = 0; pi < inst.params.length; pi++) {
            var ps = inst.params[pi];
            if (onlyGroup) {
                if (ps.key === "wet") { mod.wet = randValue(ps, Math.max(chaos, 0.5), rnd); continue; }
                if (ps.key !== onlyGroup && ps.group !== onlyGroup) continue;
                if (ps.kind === "wet") { mod.params[ps.key] = randValue(ps, chaos, rnd); continue; }
                mod.params[ps.key] = randValue(ps, chaos, rnd);
            } else if (ps.key === "wet") {
                mod.wet = randValue(ps, chaos, rnd);
            } else {
                mod.params[ps.key] = randValue(ps, chaos, rnd);
            }
        }
        if (onlyGroup && mod.wet < GL_ACTIVE_EPS) mod.wet = 1;
    }
}

/** Roll a new glitch: typically 3..6 modules, ranges widen with Chaos (0..1). Deterministic for a seed. */
function randomizeGlitch(seed, chaos, allowList) {
    chaos = glClamp(Number(chaos) || 0, 0, 1);
    var rnd = glRng(seed);
    var g = defaultGlitch();
    g.seed = seed >>> 0;
    var pool = allowedTypes(allowList);
    var lo = Math.round(2 + chaos), hi = Math.round(3 + chaos * 3);
    var want = lo + Math.floor(rnd() * (hi - lo + 1));
    want = Math.min(want, pool.length);
    var picked = 0;
    // the four spectral sub-ops share one STFT; keep it to at most 2 of them
    var specCount = 0;
    while (picked < want && pool.length) {
        var tot = 0;
        for (var i = 0; i < pool.length; i++) tot += pool[i].weight;
        var x = rnd() * tot, k = 0;
        for (; k < pool.length - 1; k++) { x -= pool[k].weight; if (x <= 0) break; }
        var t = pool[k];
        pool.splice(k, 1);
        if (t.category === "Spectral") {
            if (specCount >= 2) continue;
            specCount++;
        }
        rollType(g, t, chaos, rnd);
        picked++;
    }
    rollMovement(g, seed, chaos, allowList);
    return g;
}

/** Perturb a glitch (amount 0..1). Continuous params move in their own curve space; discrete flip with a small chance.
 *  With an allowList a module may also be swapped in / out at higher amounts. */
function mutateGlitch(g0, seed, amount, allowList) {
    amount = glClamp(Number(amount) || 0, 0, 1);
    var rnd = glRng(seed);
    var g = glCopy(g0);
    if (amount <= 0) return g;
    for (var id in g.modules) {
        var inst = glInstance(id);
        if (!inst) continue;
        var mod = g.modules[id];
        for (var pi = 0; pi < inst.params.length; pi++) {
            var ps = inst.params[pi];
            var cur = ps.key === "wet" ? mod.wet : mod.params[ps.key];
            if (cur === undefined) continue;
            var nv = cur;
            if (ps.kind === "disc") {
                if (rnd() < amount * 0.3) {
                    if (ps.patterns) nv = cur ^ (1 << Math.floor(rnd() * 16));
                    else nv = ps.wild[Math.floor(rnd() * ps.wild.length) % ps.wild.length];
                }
            } else if (ps.kind === "wet") {
                nv = glClamp(cur + (rnd() * 2 - 1) * amount * 0.35, 0, 1);
            } else if (ps.kind === "log") {
                var lo = Math.log(ps.min), hi = Math.log(ps.max);
                nv = Math.exp(glClamp(Math.log(Math.max(Math.abs(cur), ps.min)) + (rnd() * 2 - 1) * amount * 0.5 * (hi - lo), lo, hi));
            } else {
                nv = glClamp(cur + (rnd() * 2 - 1) * amount * 0.5 * (ps.max - ps.min), ps.min, ps.max);
            }
            if (ps.key === "wet") mod.wet = nv; else mod.params[ps.key] = nv;
        }
    }
    if (amount >= 0.5 && allowList !== undefined && rnd() < amount * 0.4) {
        var pool = allowedTypes(allowList);
        if (pool.length) rollType(g, pool[Math.floor(rnd() * pool.length) % pool.length], 0.5, rnd);
    }
    mutateMovement(g, seed, amount, allowList);
    g.seed = (seed >>> 0);
    return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Movement (phase 3): an optional modulation source per chain instance. A glitch stores it as module.move:
//   { type: 1 LFO | 2 Steps | 3 Env, target: <param key of that instance>, depth: -1..1 (fraction of the target's range, on
//     the target's own curve: log params move in log space), sync: 1 host-beat locked | 0 free (Hz), div: 0..15 index into
//     GL_MV_DIV_BEATS (LFO: cycle length; Steps: step length), hz: 0.02..20, phase: 0..1 of the LFO cycle / the step pattern,
//     shape: 0..6 (LFO), glide: 0..1 fraction of a step spent gliding from the previous step (Steps), nsteps: 8 | 16,
//     steps: [16 x -1..1], atk / rel: ms (Env) }
// null / absent = no movement. In the flat vector it is the movement block (glMvSpecs). The gen evaluates the sources at control
// rate (gl_move) and adds depth * source to the blended target in normalized (curve) space BEFORE the per-param smoothing.
// Sources: LFO -1..1; Steps -1..1 (glide ramps between steps); Env 0..1 (-60..0 dB of the module's INPUT level, so a louder input
// pushes the target up for positive depth). Synced sources use the host beat HELD while the transport is stopped (like the
// sequencer), free (Hz) sources keep running; the follower always runs.
// ---------------------------------------------------------------------------------------------------------------
function glNum(v, def) { var n = Number(v); return isFinite(n) ? n : def; }
function glIsContinuous(spec) { return (spec.kind === "lin" || spec.kind === "log") && !spec.patterns; }
function glMoveMainKey(inst) { return GL_MAIN_PARAM[inst.id] || null; }
/** Continuous param keys of an instance (limited to one spectral sub-op group when `sub` is its amount key). */
function glMoveKeysOf(inst, sub) {
    var out = [];
    for (var i = 0; i < inst.params.length; i++) {
        var ps = inst.params[i];
        if (!glIsContinuous(ps)) continue;
        if (sub && ps.group !== sub) continue;
        out.push(ps.key);
    }
    return out;
}
function glParamPos(inst, key) {
    for (var i = 0; i < inst.params.length; i++) if (inst.params[i].key === key) return i;
    return -1;
}
function glMoveDefaultSteps() {
    var base = [0.9, -0.3, 0.5, -0.9, 0.2, -0.5, 0.7, -0.1];
    var out = [];
    for (var i = 0; i < GL_MV_STEPS; i++) out.push(base[i % 8]);
    return out;
}
function defaultMove(instId, target, type) {
    var inst = glInstance(instId);
    var t = type || 1;
    var zero = [];
    for (var i = 0; i < GL_MV_STEPS; i++) zero.push(0);
    return { type: t, target: target || glMoveMainKey(inst), depth: 0.4, sync: 1, div: GL_MV_DIV_DEFAULT[t], hz: 1, phase: 0, shape: 0, glide: 0, nsteps: 8,
        steps: t === 2 ? glMoveDefaultSteps() : zero, atk: 10, rel: 200 };
}
/** Sanitize a movement object for an instance (null when it is off or damaged). */
function normalizeMove(m, instId) {
    if (!m || typeof m !== "object") return null;
    var inst = glInstance(instId);
    if (!inst) return null;
    var ty = Math.round(glNum(m.type, 0));
    if (ty < 1 || ty > 3) return null;
    var keys = glMoveKeysOf(inst, null);
    var tk = typeof m.target === "string" && keys.indexOf(m.target) >= 0 ? m.target : glMoveMainKey(inst);
    if (!tk || keys.indexOf(tk) < 0) return null;
    var d = defaultMove(instId, tk, ty);
    var o = { type: ty, target: tk };
    o.depth = glClamp(glNum(m.depth, d.depth), -1, 1);
    o.sync = glNum(m.sync, 1) > 0.5 ? 1 : 0;
    o.div = glClamp(Math.round(glNum(m.div, d.div)), 0, GL_MV_DIV_BEATS.length - 1);
    o.hz = glClamp(glNum(m.hz, 1), 0.02, 20);
    o.phase = glClamp(glNum(m.phase, 0), 0, 1);
    o.shape = glClamp(Math.round(glNum(m.shape, 0)), 0, GL_MV_SHAPE_NAMES.length - 1);
    o.glide = glClamp(glNum(m.glide, 0), 0, 1);
    o.nsteps = glNum(m.nsteps, 8) > 12 ? 16 : 8;
    o.atk = glClamp(glNum(m.atk, 10), 1, 500);
    o.rel = glClamp(glNum(m.rel, 200), 5, 2000);
    o.steps = [];
    for (var i = 0; i < GL_MV_STEPS; i++) o.steps.push(glClamp(glNum(m.steps && m.steps[i], 0), -1, 1));
    return o;
}
/** One movement vector entry (key = "mv_..."). */
function glMoveVecValue(mv, key, inst) {
    switch (key) {
        case "mv_on": return 1;
        case "mv_type": return mv.type;
        case "mv_target": return glParamPos(inst, mv.target);
        case "mv_depth": return mv.depth;
        case "mv_hz": return mv.hz;
        case "mv_cpb": return 1 / GL_MV_DIV_BEATS[mv.div];
        case "mv_sync": return mv.sync;
        case "mv_phase": return mv.phase;
        case "mv_shape": return mv.shape;
        case "mv_glide": return mv.glide;
        case "mv_nsteps": return mv.nsteps === 16 ? 1 : 0;
        case "mv_atk": return mv.atk;
        case "mv_rel": return mv.rel;
    }
    return mv.steps[Number(key.substring(4))] || 0;
}
/** The division index whose rate is nearest (in log space) to cycles-per-beat `cpb`. */
function glMoveNearestDiv(cpb) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < GL_MV_DIV_BEATS.length; i++) {
        var d = Math.abs(Math.log(Math.max(cpb, 1e-6)) - Math.log(1 / GL_MV_DIV_BEATS[i]));
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}
/** The movement of instance `instId` in a (plain or blended) vector, or null. */
function glMoveFromVector(v, instId) {
    var L = glitchLayout();
    var inst = glInstance(instId);
    var on = L.index[instId + ".mv_on"];
    if (!inst || on === undefined || !(v[on] > GL_ACTIVE_EPS)) return null;
    var tp = Math.round(v[on + L.mv.target]);
    var tspec = inst.params[tp];
    if (!tspec || !glIsContinuous(tspec)) return null;
    var steps = [];
    for (var i = 0; i < GL_MV_STEPS; i++) steps.push(v[on + L.mv.step0 + i]);
    return normalizeMove({ type: Math.round(v[on + L.mv.type]), target: tspec.key, depth: v[on + L.mv.depth], sync: v[on + L.mv.sync], div: glMoveNearestDiv(v[on + L.mv.cpb]),
        hz: v[on + L.mv.hz], phase: v[on + L.mv.phase], shape: Math.round(v[on + L.mv.shape]), glide: v[on + L.mv.glide], nsteps: v[on + L.mv.nsteps] > 0.5 ? 16 : 8,
        atk: v[on + L.mv.atk], rel: v[on + L.mv.rel], steps: steps }, instId);
}
/** True when key `k` of instance `inst` belongs to the tile (a whole module, or one spectral sub-op's group). */
function glMoveInTile(inst, key, sub) {
    if (!sub) return true;
    var pos = glParamPos(inst, key);
    return pos >= 0 && inst.params[pos].group === sub;
}
/** The candidate targets of a tile key: [{id, name, spec}] (continuous params only). */
function glitchMoveCandidates(key) {
    var info = glitchTileInfo(key);
    if (!info) return [];
    var inst = glInstance(info.inst);
    var keys = glMoveKeysOf(inst, info.sub);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
        var pos = glParamPos(inst, keys[i]);
        out.push({ id: keys[i], name: inst.params[pos].name, spec: inst.params[pos] });
    }
    return out;
}
/** The default movement target of a tile (its "main" param) or null when it has no continuous param (Freeze, Scramble). */
function glitchMainParam(key) {
    var info = glitchTileInfo(key);
    if (!info) return null;
    var k = info.sub ? GL_MAIN_SUB[info.type] : GL_MAIN_PARAM[info.inst];
    return k || null;
}
/** The movement shown for a tile: the instance's movement when its target belongs to the tile (a spectral instance has ONE
 *  movement; a sub-op tile shows it only when the target is one of its params), else null. Returns the stored object. */
function glitchGetMove(g, key) {
    var info = glitchTileInfo(key);
    if (!info || !g || !g.modules) return null;
    var mod = g.modules[info.inst];
    if (!mod || !mod.move) return null;
    return glMoveInTile(glInstance(info.inst), mod.move.target, info.sub) ? mod.move : null;
}
/** Set the movement type of a tile (0 = off). Keeps the other settings when only the type changes. */
function glitchSetMoveType(g, key, type) {
    var info = glitchTileInfo(key);
    type = Math.round(Number(type));
    if (!info || !(type >= 0 && type <= 3)) return false;
    var mod = g.modules[info.inst];
    if (!mod) return false;
    var cur = glitchGetMove(g, key);
    if (type === 0) { if (cur) mod.move = null; return true; }
    var main = glitchMainParam(key);
    if (cur) {
        var old = cur.type;
        cur.type = type;
        if (cur.div === GL_MV_DIV_DEFAULT[old]) cur.div = GL_MV_DIV_DEFAULT[type];
        if (type === 2 && cur.steps.every(function (x) { return x === 0; })) cur.steps = glMoveDefaultSteps();
        mod.move = normalizeMove(cur, info.inst);
        return true;
    }
    if (!main) return false;
    mod.move = defaultMove(info.inst, main, type);
    return true;
}
/** Set one numeric / target field of a tile's movement ("target" takes a param key). */
function glitchSetMove(g, key, field, v) {
    var info = glitchTileInfo(key);
    var cur = glitchGetMove(g, key);
    if (!info || !cur) return false;
    if (field === "target") {
        var ok = false, cands = glitchMoveCandidates(key);
        for (var i = 0; i < cands.length; i++) if (cands[i].id === v) ok = true;
        if (!ok) return false;
        cur.target = v;
    } else if (["depth", "sync", "div", "hz", "phase", "shape", "glide", "nsteps", "atk", "rel"].indexOf(field) >= 0) cur[field] = Number(v);
    else return false;
    g.modules[info.inst].move = normalizeMove(cur, info.inst);
    return true;
}
function glitchSetMoveStep(g, key, i, v) {
    var cur = glitchGetMove(g, key);
    i = Math.floor(Number(i));
    if (!cur || !(i >= 0 && i < GL_MV_STEPS)) return false;
    cur.steps[i] = glClamp(Number(v) || 0, -1, 1);
    return true;
}
/** "1/4" or "2.5 Hz" for the rate of a movement. */
function glitchMoveRateText(mv) {
    if (mv.sync) return GL_MV_DIV_NAMES[mv.div];
    return mv.hz >= 10 ? mv.hz.toFixed(1) + " Hz" : mv.hz.toFixed(2) + " Hz";
}
/** What a tile's motion indicator needs from a (blended) vector: { on, type, target key, depth } or null. */
function glitchTileMove(vec, tile) {
    if (!vec) return null;
    var mv = glMoveFromVector(vec, tile.inst);
    if (!mv || Math.abs(mv.depth) < 0.002) return null;
    var info = glitchTileInfo(tile.key);
    if (!glMoveInTile(glInstance(tile.inst), mv.target, info ? info.sub : null)) return null;
    return mv;
}

// ---- Randomize / Mutate for movement (own RNG streams, so the module rolls of earlier versions are unchanged) ----
function glMoveTypesAllowed(allowList) {
    var out = [];
    for (var i = 0; i < GL_MOVE_TYPES.length; i++) if (allowed(allowList, GL_MOVE_TYPES[i].id)) out.push(GL_MOVE_TYPES[i].mvType);
    return out;
}
/** Targets Randomize may pick on a rolled module: its continuous params (spectral: only those of an active sub-op). */
function glMoveRollKeys(inst, mod) {
    var keys = glMoveKeysOf(inst, null);
    if (inst.id !== "spec") return keys;
    var out = [];
    for (var i = 0; i < keys.length; i++) {
        var ps = inst.params[glParamPos(inst, keys[i])];
        if ((Number(mod.params[ps.group]) || 0) > GL_ACTIVE_EPS) out.push(keys[i]);
    }
    return out;
}
function glRandomMove(inst, mod, chaos, rnd, types) {
    var cands = glMoveRollKeys(inst, mod);
    if (!cands.length) return null;
    var mains = [];
    if (inst.id === "spec") { for (var sk in GL_MAIN_SUB) if (cands.indexOf(GL_MAIN_SUB[sk]) >= 0) mains.push(GL_MAIN_SUB[sk]); }
    else if (cands.indexOf(GL_MAIN_PARAM[inst.id]) >= 0) mains.push(GL_MAIN_PARAM[inst.id]);
    var useMain = rnd() < 0.8 - 0.35 * chaos;
    var pick = rnd();
    var tk = useMain && mains.length ? mains[Math.floor(pick * mains.length) % mains.length] : cands[Math.floor(pick * cands.length) % cands.length];
    var ty = types[Math.floor(rnd() * types.length) % types.length];
    var mv = defaultMove(inst.id, tk, ty);
    var lo = glLerp(0.10, 0.30, chaos), hi = glLerp(0.30, 0.90, chaos);
    var mag = lo + (hi - lo) * rnd();
    var neg = rnd() < 0.3;
    mv.depth = (ty === 3 || !neg) ? mag : -mag;
    var calm = ty === 2 ? [2, 5, 8] : [8, 11, 13, 14];
    var wild = ty === 2 ? [0, 1, 2, 3, 5, 6, 8, 9] : [2, 3, 5, 7, 8, 11, 13, 14, 15];
    var set = rnd() < chaos ? wild : calm;
    mv.div = set[Math.floor(rnd() * set.length) % set.length];
    mv.sync = rnd() < 0.88 ? 1 : 0;
    mv.hz = Math.exp(glLerp(Math.log(0.1), Math.log(6), rnd()));
    mv.phase = Math.floor(rnd() * 4) / 4;
    mv.shape = rnd() < chaos ? Math.floor(rnd() * GL_MV_SHAPE_NAMES.length) % GL_MV_SHAPE_NAMES.length : [0, 1, 2, 3][Math.floor(rnd() * 4) % 4];
    mv.nsteps = rnd() < chaos * 0.6 ? 16 : 8;
    mv.glide = rnd() < 0.4 ? Math.round(rnd() * 8) / 10 : 0;
    mv.atk = Math.exp(glLerp(Math.log(2), Math.log(40), rnd()));
    mv.rel = Math.exp(glLerp(Math.log(60), Math.log(700), rnd()));
    var prev = 0;
    for (var i = 0; i < GL_MV_STEPS; i++) {
        var sv = rnd() < 0.2 ? prev : (rnd() * 2 - 1);
        if (chaos < 0.5) sv = Math.round(sv * 4) / 4;
        mv.steps[i] = sv;
        prev = sv;
    }
    return normalizeMove(mv, inst.id);
}
/** Give some of the glitch's modules a movement: more of them at higher Chaos (10 % .. 60 % of the modules). Deterministic. */
function rollMovement(g, seed, chaos, allowList) {
    var types = glMoveTypesAllowed(allowList);
    var rnd = glRng(((seed >>> 0) ^ 0x4d6f7665) >>> 0);
    var p = 0.1 + 0.5 * chaos;
    for (var ii = 0; ii < GL_INSTANCES.length; ii++) {
        var inst = GL_INSTANCES[ii];
        var mod = g.modules[inst.id];
        if (!mod) continue;
        var r = rnd(); // one draw per module so the others do not shift when a type is switched off
        if (!types.length || r >= p || !(mod.wet > GL_ACTIVE_EPS)) continue;
        var mv = glRandomMove(inst, mod, chaos, rnd, types);
        if (mv) mod.move = mv;
    }
}
/** Perturb the movement of a glitch (amount 0..1): depth and phase nudge, rates step along the division table, steps jitter, shape /
 *  target / type flip with a small chance, and a module without movement may gain one (allow-list permitting). */
function mutateMovement(g, seed, amount, allowList) {
    var types = glMoveTypesAllowed(allowList);
    var rnd = glRng(((seed >>> 0) ^ 0x4d757461) >>> 0);
    for (var ii = 0; ii < GL_INSTANCES.length; ii++) {
        var inst = GL_INSTANCES[ii];
        var mod = g.modules[inst.id];
        if (!mod) continue;
        if (!mod.move) {
            var r = rnd();
            if (types.length && r < 0.12 * amount && mod.wet > GL_ACTIVE_EPS) { var nm = glRandomMove(inst, mod, 0.4, rnd, types); if (nm) mod.move = nm; }
            continue;
        }
        var mv = glCopy(mod.move);
        mv.depth = glClamp(mv.depth + (rnd() * 2 - 1) * amount * 0.3, -1, 1);
        mv.phase = glClamp(mv.phase + (rnd() * 2 - 1) * amount * 0.25, 0, 1);
        if (rnd() < amount * 0.35) mv.div = glClamp(mv.div + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2)), 0, GL_MV_DIV_BEATS.length - 1);
        mv.hz = glClamp(mv.hz * Math.exp((rnd() * 2 - 1) * amount * 0.5), 0.02, 20);
        for (var si = 0; si < GL_MV_STEPS; si++) if (rnd() < amount * 0.5) mv.steps[si] = glClamp(mv.steps[si] + (rnd() * 2 - 1) * amount * 0.6, -1, 1);
        if (rnd() < amount * 0.15) mv.shape = Math.floor(rnd() * GL_MV_SHAPE_NAMES.length) % GL_MV_SHAPE_NAMES.length;
        if (rnd() < amount * 0.12) {
            var cands = glMoveRollKeys(inst, mod);
            if (cands.length) mv.target = cands[Math.floor(rnd() * cands.length) % cands.length];
        }
        if (types.length && rnd() < amount * 0.08) mv.type = types[Math.floor(rnd() * types.length) % types.length];
        mod.move = normalizeMove(mv, inst.id) || mod.move;
    }
}

// ---- JS twins of the gen movement (gl_lfo, gl_stepv, gl_move); tests/test_glitch.js compares them through the transpiler ----
function glMoveHash(x, a) { var v = Math.sin(x * 12.9898 + a) * 43758.5453; return v - Math.floor(v); }
/** LFO value -1..1 at cycle position x (cycles; the integer part seeds the random shapes). */
function glMoveLfo(shape, x, salt) {
    var c = Math.floor(x);
    var ph = x - c;
    var rA = glMoveHash(c + salt, 3.7) * 2 - 1;
    var rB = glMoveHash(c + salt + 1, 3.7) * 2 - 1;
    var sm = 0.5 - 0.5 * Math.cos(ph * 3.141592653589793);
    var tr3 = ph < 0.25 ? 4 * ph : (ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4);
    return shape < 0.5 ? Math.sin(ph * 6.283185307179586) : (shape < 1.5 ? tr3 : (shape < 2.5 ? 2 * ph - 1 : (shape < 3.5 ? 1 - 2 * ph : (shape < 4.5 ? (ph < 0.5 ? 1 : -1) : (shape < 5.5 ? rA + (rB - rA) * sm : rA)))));
}
/** Step value at step position x (steps of the pattern, ns = 8 | 16); glide = fraction of a step spent ramping from the previous step. */
function glMoveStepValue(steps, ns, x, glide) {
    var i0 = Math.floor(x);
    var fr = x - i0;
    var ci = i0 - ns * Math.floor(i0 / ns);
    var pj = ci - 1 < -0.5 ? ns - 1 : ci - 1;
    var cur = steps[ci], prv = steps[pj];
    var pg = glide > 0.0001 ? glClamp(fr / glide, 0, 1) : 1;
    return prv + (cur - prv) * pg;
}
function glMoveState() { return { free: 0, off: 0, prevCpb: 0, env: 0, run: 0 }; }
/** One control tick of a movement source. p = the movement block of the (smoothed) vector in vector units
 *  { type, depth, hz, cpb, sync, phase, shape, glide, nsteps (0 | 1), atk, rel, steps[16] }; k = chain position (the random seed);
 *  bt = the held host beat; lvl = the module's input level (linear peak); tn = samples since the last tick. Returns { sg, ofs, ph }. */
function glMoveTick(st, p, k, bt, lvl, tn, sr) {
    var fa = st.free + p.hz * tn / sr;
    st.free = fa;
    var off = st.run > 0.5 ? st.off + bt * (st.prevCpb - p.cpb) : st.off;
    st.off = off;
    st.prevCpb = p.cpb;
    st.run = 1;
    var xb = p.sync > 0.5 ? bt * p.cpb + off : fa;
    var ns = p.nsteps > 0.5 ? 16 : 8;
    var xl = xb + p.phase;
    var xs = xb + p.phase * ns;
    var lv = Math.max(lvl, 0.000001);
    var un = glClamp((8.685889638065035 * Math.log(lv) + 60) / 60, 0, 1);
    var ca = Math.exp(-tn * 1000 / (sr * Math.max(p.atk, 0.1)));
    var cr = Math.exp(-tn * 1000 / (sr * Math.max(p.rel, 0.1)));
    var env = un > st.env ? un + (st.env - un) * ca : un + (st.env - un) * cr;
    st.env = env;
    var vl = glMoveLfo(p.shape, xl, k * 7.31);
    var vs = glMoveStepValue(p.steps, ns, xs, p.glide);
    var sg = p.type < 1.5 ? vl : (p.type < 2.5 ? vs : env);
    var pxs = xs / ns;
    return { sg: sg, ofs: p.depth * sg, ph: p.type < 1.5 ? xl - Math.floor(xl) : (p.type < 2.5 ? pxs - Math.floor(pxs) : env) };
}
/** Apply an offset (fraction of the target's range on its own curve) to a blended target value. kindCode: 1 lin, 2 log.
 *  Returns { value, pos, ok } (ok = 0 for a wet / discrete / degenerate target, which is left alone). */
function glMoveApply(kindCode, lo, hi, tv, ofs) {
    if (!(kindCode > 0.5 && kindCode < 2.5 && hi > lo)) return { value: tv, pos: 0, ok: 0 };
    var llo = Math.log(Math.max(lo, 0.000000001));
    var lhi = Math.log(Math.max(hi, 0.000000001));
    var nz = kindCode > 1.5 ? (Math.log(Math.max(tv, 0.000000001)) - llo) / Math.max(lhi - llo, 0.000000001) : (tv - lo) / Math.max(hi - lo, 0.000000001);
    var n1 = glClamp(nz + ofs, 0, 1);
    return { value: kindCode > 1.5 ? Math.exp(llo + n1 * (lhi - llo)) : lo + n1 * (hi - lo), pos: n1, ok: 1 };
}
/** The movement block of instance `instId` in a vector as the p object of glMoveTick. */
function glMoveBlock(vec, instId) {
    var L = glitchLayout();
    var on = L.index[instId + ".mv_on"];
    var steps = [];
    for (var i = 0; i < GL_MV_STEPS; i++) steps.push(vec[on + L.mv.step0 + i]);
    return { type: vec[on + L.mv.type], target: vec[on + L.mv.target], depth: vec[on + L.mv.depth], hz: vec[on + L.mv.hz], cpb: vec[on + L.mv.cpb], sync: vec[on + L.mv.sync],
        phase: vec[on + L.mv.phase], shape: vec[on + L.mv.shape], glide: vec[on + L.mv.glide], nsteps: vec[on + L.mv.nsteps], atk: vec[on + L.mv.atk], rel: vec[on + L.mv.rel], steps: steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Vector
// ---------------------------------------------------------------------------------------------------------------
/** glitch -> flat Float vector (length np). Absent modules: wet 0 and default params. */
function glitchToVector(g) {
    var L = glitchLayout();
    var v = new Array(L.np);
    var mvs = {};
    for (var i = 0; i < L.np; i++) {
        var p = L.params[i];
        var mod = g && g.modules ? g.modules[p.inst] : null;
        var val = p.def;
        if (p.mv !== undefined) {
            // movement block: a module without movement contributes depth 0 to the blend (it fades with the morph weights)
            if (mvs[p.inst] === undefined) mvs[p.inst] = mod && mod.move ? normalizeMove(mod.move, p.inst) : null;
            var mvo = mvs[p.inst];
            val = mvo ? glMoveVecValue(mvo, p.key, glInstance(p.inst)) : (p.key === "mv_depth" ? 0 : p.def);
            v[i] = glClamp(isFinite(val) ? val : p.def, p.min, p.max);
            continue;
        }
        if (mod) {
            if (p.key === "wet") val = Number(mod.wet) || 0;
            else if (mod.params && mod.params[p.key] !== undefined) val = Number(mod.params[p.key]);
            if (p.kind === "wet" && p.key !== "wet") val = mod.params && mod.params[p.key] !== undefined ? Number(mod.params[p.key]) : 0;
        } else if (p.kind === "wet") val = 0;
        if (!isFinite(val)) val = p.def;
        v[i] = glClamp(val, p.min, p.max);
    }
    return v;
}
function vectorToGlitch(v) {
    var L = glitchLayout();
    var g = defaultGlitch();
    for (var ii = 0; ii < GL_INSTANCES.length; ii++) {
        var inst = GL_INSTANCES[ii];
        var b = L.base[inst.id];
        if (!(v[b] > GL_ACTIVE_EPS)) continue;
        var mod = { wet: v[b], params: {}, move: null };
        for (var pi = 0; pi < inst.params.length; pi++) if (inst.params[pi].key !== "wet") mod.params[inst.params[pi].key] = v[b + pi];
        mod.move = glMoveFromVector(v, inst.id);
        g.modules[inst.id] = mod;
    }
    return g;
}

/** Morph: vectors = array of vectors (missing / null entries count as the all-off vector), weights = array (any scale). */
function blendVectors(vectors, weights) {
    var L = glitchLayout();
    var np = L.np;
    var n = weights.length;
    var wsum = 0;
    for (var s = 0; s < n; s++) wsum += Math.max(weights[s] || 0, 0);
    var out = new Array(np);
    for (var i = 0; i < np; i++) {
        var p = L.params[i];
        var res = p.def;
        if (wsum > 1e-9) {
            var num = 0, den = 0, bestW = -1, bestV = p.def, bestAll = -1, bestAllV = p.def;
            for (var s2 = 0; s2 < n; s2++) {
                var w = Math.max(weights[s2] || 0, 0) / wsum;
                if (!(w > 1e-9)) continue; // zero-weight slots do not take part (gen skips them too)
                var vec = vectors[s2];
                var v = vec ? vec[i] : p.def;
                var a = vec && vec[p.group] > GL_ACTIVE_EPS ? 1 : 0;
                if (p.kindCode === 0) num += w * (vec ? vec[i] : 0);
                else if (p.kindCode === 1) { num += w * a * v; den += w * a; }
                else if (p.kindCode === 2) { num += w * a * Math.log(Math.max(v, 1e-9)); den += w * a; }
                else {
                    if (a > 0.5 && w > bestW) { bestW = w; bestV = v; }
                    if (w > bestAll) { bestAll = w; bestAllV = v; }
                }
            }
            if (p.kindCode === 0) res = num;
            else if (p.kindCode === 1) res = den > 1e-9 ? num / den : p.def;
            else if (p.kindCode === 2) res = den > 1e-9 ? Math.exp(num / den) : p.def;
            else res = bestW >= 0 ? bestV : bestAllV;
        }
        out[i] = res;
    }
    return out;
}

/** Bilinear weights of the 4 XY corners [TL, TR, BL, BR]; x, y in 0..1 (y = 0 is the top). */
function xyWeights(x, y) {
    x = glClamp(Number(x) || 0, 0, 1);
    y = glClamp(Number(y) || 0, 0, 1);
    return [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y];
}
/** The 4 corner weights spread over the 8 slots (several corners may point at the same slot). */
function cornerSlotWeights(corners, x, y) {
    var w4 = xyWeights(x, y);
    var w = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var c = 0; c < 4; c++) {
        var s = corners[c];
        if (s >= 0 && s < GL_NSLOT) w[s] += w4[c];
    }
    return w;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
function defaultAllow() {
    var a = {};
    for (var i = 0; i < GL_ALLOW_ITEMS.length; i++) a[GL_ALLOW_ITEMS[i].id] = true;
    return a;
}
function defaultState() {
    var slots = [];
    for (var i = 0; i < GL_NSLOT; i++) slots.push(null);
    return { version: GL_STATE_VERSION, slots: slots, corners: [0, 1, 2, 3], allow: defaultAllow(), chaos: 0.5, xy: [0.5, 0.5], working: defaultGlitch(), audition: "working", seed: 1, ui: defaultUi(), seq: defaultSeq() };
}
function normalizeGlitch(g) {
    var out = defaultGlitch();
    if (!g || typeof g !== "object") return out;
    out.name = typeof g.name === "string" ? g.name : "";
    out.seed = Number(g.seed) >>> 0;
    if (g.movement && typeof g.movement === "object") out.movement = g.movement;
    if (g.locks && typeof g.locks === "object") {
        var lk = {}, anyLock = false;
        for (var lkKey in g.locks) if (g.locks[lkKey] && glitchTileInfo(lkKey)) { lk[lkKey] = true; anyLock = true; }
        if (anyLock) out.locks = lk;
    }
    var mods = g.modules && typeof g.modules === "object" ? g.modules : {};
    for (var id in mods) {
        var inst = glInstance(id);
        if (!inst || !mods[id] || typeof mods[id] !== "object") continue;
        var m = { wet: glClamp(Number(mods[id].wet) || 0, 0, 1), params: defaultParams(inst), move: normalizeMove(mods[id].move, id) };
        var src = mods[id].params || {};
        for (var pi = 0; pi < inst.params.length; pi++) {
            var ps = inst.params[pi];
            if (ps.key === "wet" || src[ps.key] === undefined) continue;
            var val = Number(src[ps.key]);
            if (isFinite(val)) m.params[ps.key] = glClamp(val, ps.min, ps.max);
        }
        out.modules[id] = m;
    }
    return out;
}
/** Sanitize any (possibly older or damaged) state object into the current schema. Version history: 1 = slots / morph,
 *  2 = + ui, 3 = + seq and the phase 2 modules. Anything older loads with the sequence empty and the new modules absent. */
function normalizeState(o) {
    var s = defaultState();
    if (!o || typeof o !== "object") return s;
    for (var i = 0; i < GL_NSLOT; i++) s.slots[i] = o.slots && o.slots[i] ? normalizeGlitch(o.slots[i]) : null;
    if (Array.isArray(o.corners) && o.corners.length === 4) for (var c = 0; c < 4; c++) s.corners[c] = glClamp(Math.floor(Number(o.corners[c])) || 0, 0, GL_NSLOT - 1);
    if (o.allow && typeof o.allow === "object") for (var t in s.allow) if (o.allow[t] !== undefined) s.allow[t] = !!o.allow[t];
    s.chaos = glClamp(o.chaos === undefined ? 0.5 : Number(o.chaos) || 0, 0, 1);
    if (Array.isArray(o.xy) && o.xy.length === 2) s.xy = [glClamp(Number(o.xy[0]) || 0, 0, 1), glClamp(Number(o.xy[1]) || 0, 0, 1)];
    s.working = normalizeGlitch(o.working);
    s.audition = o.audition === "morph" ? "morph" : (o.audition === "seq" ? "seq" : "working");
    s.seed = Math.max(1, Math.floor(Number(o.seed)) || 1);
    s.ui = normalizeUi(o.ui);
    s.seq = normalizeSeq(o.seq);
    return s;
}
function stateToBlob(state) { return [GL_STATE_VERSION, JSON.stringify(state)]; }
function stateFromBlob(arr) {
    try {
        if (!arr || arr.length < 2) return defaultState();
        var ver = Number(arr[0]);
        if (!(ver >= 1)) return defaultState();
        // v1 / v2 need no field migration: normalizeState fills `seq` (empty) and the new modules are simply absent;
        // unknown newer versions are read as the latest known
        return normalizeState(JSON.parse(String(arr[1])));
    } catch (e) {
        return defaultState();
    }
}

/** 8 slot vectors the engine should hold (audition "working": the working glitch in slot 0, weight 1). */
function engineVectors(state) {
    var out = [];
    if (state.audition === "working") {
        out.push(glitchToVector(state.working));
        for (var i = 1; i < GL_NSLOT; i++) out.push(glitchToVector(null));
        return out;
    }
    for (var s = 0; s < GL_NSLOT; s++) out.push(glitchToVector(state.slots[s]));
    return out;
}
/** The weights the UI writes (modes Working / Morph; Seq: the weights of the first step, a hint only: gen computes them). */
function engineWeights(state) {
    if (state.audition === "working") return [1, 0, 0, 0, 0, 0, 0, 0];
    if (state.audition === "seq") return seqWeights(state.seq, 0).weights;
    return cornerSlotWeights(state.corners, state.xy[0], state.xy[1]);
}
var glPackVer = 0;
function engineMode(state) { return state.audition === "seq" ? 2 : (state.audition === "morph" ? 1 : 0); }
/** The whole engine buffer as one flat array (poke it into buffer~ #0-glitchslots at index 0). */
function packEngineBuffer(state) {
    var L = glitchLayout();
    var vecs = engineVectors(state);
    var w = engineWeights(state);
    var buf = new Array(GL_SLOTS_BUF_SAMPS);
    for (var i = 0; i < GL_SLOTS_BUF_SAMPS; i++) buf[i] = 0;
    for (var s = 0; s < GL_NSLOT; s++) for (var k = 0; k < L.np; k++) buf[s * L.np + k] = vecs[s][k];
    for (var s2 = 0; s2 < GL_NSLOT; s2++) buf[L.weightsOffset + s2] = w[s2];
    var hdr = seqHeader(state);
    for (var h = 0; h < GL_SEQ_HDR; h++) buf[L.seqOffset + h] = hdr[h];
    // SEQ+5 = a version number that changes with every pack: gen re-reads the 8 slot vectors and the constants only when it moves
    glPackVer = glPackVer % 1000000 + 1;
    buf[L.seqOffset + 5] = glPackVer;
    var steps = normalizeSeq(state.seq).steps;
    for (var q = 0; q < GL_SEQ_MAX; q++) buf[L.seqOffset + GL_SEQ_HDR + q] = steps[q];
    var consts = glitchEngineConstants();
    for (var c = 0; c < consts.length; c++) buf[L.metaOffset + c] = consts[c];
    return buf;
}
function saveToSlot(state, i) { state.slots[i] = glCopy(state.working); state.slots[i].name = state.slots[i].name || ("Glitch " + (i + 1)); return state; }
function recallSlot(state, i) { if (state.slots[i]) state.working = glCopy(state.slots[i]); return state; }
function clearSlot(state, i) { state.slots[i] = null; return state; }

// ---------------------------------------------------------------------------------------------------------------
// Sequencer (phase 2): 16 steps, each a slot (0..7) or hold (-1). The weights are computed in gen from the host beat; this is
// the JS twin (gen: gl_seq / gl_seq_slot / gl_seqdiv, compared in tests/test_glitch.js) plus the state helpers.
// ---------------------------------------------------------------------------------------------------------------
function defaultSeq() {
    var steps = [];
    for (var i = 0; i < GL_SEQ_MAX; i++) steps.push(-1);
    return { steps: steps, length: 8, rate: 4, glide: 0, curve: 0 };
}
function normalizeSeq(o) {
    var d = defaultSeq();
    if (!o || typeof o !== "object") return d;
    if (Array.isArray(o.steps)) {
        for (var i = 0; i < GL_SEQ_MAX; i++) {
            var v = Math.round(Number(o.steps[i]));
            d.steps[i] = isFinite(v) ? glClamp(v, -1, GL_NSLOT - 1) : -1;
        }
    }
    if (o.length !== undefined) d.length = glClamp(Math.round(Number(o.length)) || 8, 1, GL_SEQ_MAX);
    if (o.rate !== undefined) d.rate = glClamp(Math.round(Number(o.rate)), 0, GL_SEQ_RATES.length - 1) || 0;
    if (o.glide !== undefined) d.glide = glClamp(Number(o.glide) || 0, 0, 1);
    if (o.curve !== undefined) d.curve = Number(o.curve) > 0.5 ? 1 : 0;
    return d;
}
/** The slot of step idx: a hold (-1) takes the previous step's slot, searching backwards cyclically inside `len`; -1 when
 *  no step of the sequence has a slot. Twin of gl_seq_slot. */
function seqSlotAt(steps, idx, len) {
    var res = -1;
    for (var k = 0; k < GL_SEQ_MAX; k++) {
        var j = idx - k;
        j = j - len * Math.floor(j / len);
        var v = steps[j];
        if (res < -0.5 && v > -0.5) res = v;
    }
    return res;
}
/** Sequencer weights at a host beat. Twin of gl_seq. Returns { weights[8], idx, cur, prev, prog, frac, abs }. */
function seqWeights(seq, beat) {
    var len = glClamp(Math.round(seq.length), 1, GL_SEQ_MAX);
    var dv = GL_SEQ_RATES[glClamp(Math.round(seq.rate), 0, GL_SEQ_RATES.length - 1)];
    var gl = glClamp(seq.glide, 0, 1);
    var pos = beat / dv;
    var ab = Math.floor(pos);
    var fr = pos - ab;
    var idx = ab - len * Math.floor(ab / len);
    var cur = seqSlotAt(seq.steps, idx, len);
    var prv = seqSlotAt(seq.steps, idx - 1, len);
    var prog = gl > 0.0001 ? glClamp(fr / gl, 0, 1) : 1;
    var lin = seq.curve > 0.5;
    var wc = lin ? prog : Math.sin(prog * 1.5707963267948966);
    var wp = lin ? 1 - prog : Math.cos(prog * 1.5707963267948966);
    var w = [0, 0, 0, 0, 0, 0, 0, 0];
    if (prv > -0.5) w[prv] += wp;
    if (cur > -0.5) w[cur] += wc;
    return { weights: w, idx: idx, cur: cur, prev: prv, prog: prog, frac: fr, abs: ab };
}
function seqHeader(state) {
    var q = normalizeSeq(state.seq);
    return [engineMode(state), q.length, q.rate, q.glide, q.curve, 0, 0, 0];
}
/** Slot indices (0..7) that hold a glitch. */
function filledSlots(state) {
    var out = [];
    for (var i = 0; i < GL_NSLOT; i++) if (state.slots[i]) out.push(i);
    return out;
}
/**
 * Roll a sequence from the filled slots only. Deterministic for a seed. Returns { steps[16], length }.
 *   filledSlots: array of slot indices (0..7). length: optional 1..16 (default: 8 or 16, by chaos).
 * Shape: a motif of 2..4 steps (built from one or two filled slots, with holds) is repeated over the length; the share of
 * steps that deviate from the motif (jumps to another filled slot, extra holds) grows with chaos. Step 0 never holds, and
 * with two or more filled slots at least two different slots appear. No filled slot -> every step is a hold (empty).
 */
function randomizeSequence(seed, chaos, filledSlotList, length) {
    chaos = glClamp(Number(chaos) || 0, 0, 1);
    var rnd = glRng((seed >>> 0) ^ 0x5eed);
    var F = [];
    var src = filledSlotList || [];
    for (var i = 0; i < src.length; i++) {
        var v = Math.floor(Number(src[i]));
        if (v >= 0 && v < GL_NSLOT && F.indexOf(v) < 0) F.push(v);
    }
    var len = length === undefined ? (rnd() < 0.55 - 0.3 * chaos ? 8 : 16) : glClamp(Math.round(Number(length)) || 8, 1, GL_SEQ_MAX);
    var steps = [];
    for (var s = 0; s < GL_SEQ_MAX; s++) steps.push(-1);
    if (!F.length) return { steps: steps, length: len };
    var mlen = len >= 4 ? (rnd() < 0.5 ? 4 : (rnd() < 0.5 ? 2 : 3)) : len;
    var main = F[Math.floor(rnd() * F.length) % F.length];
    var alt = F.length > 1 ? F.filter(function (x) { return x !== main; })[Math.floor(rnd() * (F.length - 1)) % (F.length - 1)] : main;
    var holdP = 0.38 - 0.18 * chaos;
    var motif = [];
    for (var m = 0; m < mlen; m++) {
        if (m === 0) motif.push(main);
        else if (rnd() < holdP) motif.push(-1);
        else motif.push(rnd() < 0.55 ? alt : main);
    }
    var devP = 0.06 + 0.5 * chaos;
    for (var t = 0; t < len; t++) {
        var st = motif[t % mlen];
        if (t > 0 && rnd() < devP) {
            st = rnd() < 0.35 + 0.3 * chaos ? -1 : F[Math.floor(rnd() * F.length) % F.length];
        }
        steps[t] = st;
    }
    steps[0] = steps[0] < 0 ? main : steps[0];
    if (F.length > 1 && len >= 2) {
        var distinct = {};
        for (var u = 0; u < len; u++) { var cur = seqSlotAt(steps, u, len); if (cur >= 0) distinct[cur] = true; }
        if (Object.keys(distinct).length < 2) steps[Math.min(len - 1, 1 + Math.floor(rnd() * (len - 1)))] = alt;
    }
    return { steps: steps, length: len };
}
function setSeqStep(state, i, slot) {
    i = Math.floor(i);
    if (i < 0 || i >= GL_SEQ_MAX) return state;
    state.seq = normalizeSeq(state.seq);
    state.seq.steps[i] = glClamp(Math.round(Number(slot)), -1, GL_NSLOT - 1);
    return state;
}
function setSeqLength(state, n) { state.seq = normalizeSeq(state.seq); state.seq.length = glClamp(Math.round(Number(n)) || 1, 1, GL_SEQ_MAX); return state; }
function setSeqRate(state, r) { state.seq = normalizeSeq(state.seq); state.seq.rate = glClamp(Math.round(Number(r)), 0, GL_SEQ_RATES.length - 1) || 0; return state; }
function setSeqGlide(state, g) { state.seq = normalizeSeq(state.seq); state.seq.glide = glClamp(Number(g) || 0, 0, 1); return state; }
function setSeqCurve(state, c) { state.seq = normalizeSeq(state.seq); state.seq.curve = Number(c) > 0.5 ? 1 : 0; return state; }
/** Every step becomes a hold (an empty sequence is silent: weights 0). */
function seqClear(state) { state.seq = normalizeSeq(state.seq); for (var i = 0; i < GL_SEQ_MAX; i++) state.seq.steps[i] = -1; return state; }
/** The value after (dir > 0) or before (dir < 0) `cur` when cycling a step: hold, then the filled slots ascending, then hold again. */
function seqCycleValue(state, cur, dir) {
    var cyc = [-1].concat(filledSlots(state));
    var i;
    if (dir < 0) {
        for (i = cyc.length - 1; i >= 0; i--) if (cyc[i] < cur) return cyc[i];
        return cyc[cyc.length - 1];
    }
    for (i = 0; i < cyc.length; i++) if (cyc[i] > cur) return cyc[i];
    return cyc[0];
}
/** Cycle step i through hold / filled slots. Returns the new value. */
function seqCycleStep(state, i, dir) {
    state.seq = normalizeSeq(state.seq);
    var v = seqCycleValue(state, state.seq.steps[i], dir);
    setSeqStep(state, i, v);
    return v;
}
/** The 8 slot weights that are AUDIBLE: Working = slot 0 of the engine; Morph = the XY corners; Seq = the engine's own
 *  normalized weights from the telemetry (`scope`, optional), else the sequencer evaluated at `beat` (default 0). */
function soundingWeights(state, scope, beat) {
    if (state.audition === "working") return [1, 0, 0, 0, 0, 0, 0, 0];
    if (state.audition === "morph") return cornerSlotWeights(state.corners, state.xy[0], state.xy[1]);
    if (scope && scope[GL_SCOPE.SEQ_ON] > 0.5) {
        var w = [];
        for (var k = 0; k < GL_NSLOT; k++) w.push(Math.max(0, Number(scope[GL_SCOPE.WEIGHTS + k]) || 0));
        return w;
    }
    return seqWeights(state.seq, Number(beat) || 0).weights;
}
/** Roll the sequence into the state from the filled slots (keeps rate / glide). */
function rerollSequence(state) {
    var q = normalizeSeq(state.seq);
    var r = randomizeSequence(state.seed++, state.chaos, filledSlots(state), q.length);
    q.steps = r.steps;
    state.seq = q;
    return state;
}

// ---------------------------------------------------------------------------------------------------------------
// UI model (stage 2): layout, tiles, module editor rows, edit / lock / reroll operations. All pure (no mgraphics).
// ---------------------------------------------------------------------------------------------------------------
// Live parameters of the device (all real live.* objects kept OFF the face; the v8ui draws the controls and drives them).
// kind: "dial" float, "toggle" 2-state enum (a live.text in Toggle mode), "enum" n-state enum (a live.menu, the value is the
// index), "int" integer dial. trigger: the value's rising edge fires an action.
var GL_PARAMS = {
    morphx: { kind: "dial", long: "Morph X", short: "Morph X", lo: 0, hi: 100, init: 50, unit: 5 },
    morphy: { kind: "dial", long: "Morph Y", short: "Morph Y", lo: 0, hi: 100, init: 50, unit: 5 },
    chaos: { kind: "dial", long: "Chaos", short: "Chaos", lo: 0, hi: 100, init: 50, unit: 5 },
    mix: { kind: "dial", long: "Mix", short: "Mix", lo: 0, hi: 100, init: 100, unit: 5, gen: "wet", scale: 0.01 },
    out: { kind: "dial", long: "Output", short: "Out", lo: -36, hi: 12, init: 0, unit: 4, gen: "outdb", scale: 1 },
    randomize: { kind: "toggle", long: "Randomize", short: "Randomize", enums: ["Off", "On"], init: 0, trigger: true },
    mutate: { kind: "toggle", long: "Mutate", short: "Mutate", enums: ["Off", "On"], init: 0, trigger: true },
    mode: { kind: "enum", long: "Mode", short: "Mode", enums: GL_MODE_NAMES, init: 0 },
    seqrate: { kind: "enum", long: "Seq Rate", short: "Seq Rate", enums: GL_SEQ_RATE_NAMES, init: 4 },
    glide: { kind: "dial", long: "Glide", short: "Glide", lo: 0, hi: 100, init: 0, unit: 5 },
    seqlen: { kind: "int", long: "Seq Length", short: "Seq Length", lo: 1, hi: 16, init: 8, unit: 0 },
};
var GL_PARAM_KEYS = ["morphx", "morphy", "chaos", "mix", "out", "randomize", "mutate", "mode", "seqrate", "glide", "seqlen"];

var GL_SHORT = { drvA: "DRIVE A", filt: "FILTER", form: "FORMANT", comb: "COMB", phas: "PHASER", crush: "CRUSH", rect: "RECTIFY", fm: "FM",
    corr: "CORRUPT", ring: "RING", stut: "STUTTER", time: "TAPE", gpit: "G-PITCH", gstr: "G-STRETCH", rvs: "REVERSE", shuf: "SHUFFLE", chop: "CHOP",
    drvB: "DRIVE B", dly: "DELAY", slap: "SLAPBACK", rev: "REVERB", wid: "WIDTH", spec: "SPECTRAL", freeze: "FREEZE", smear: "SMEAR",
    ccrush: "C-CRUSH", scramble: "SCRAMBLE", scatter: "SCATTER", mirror: "MIRROR", binshift: "BIN SHIFT", specgate: "SPEC GATE" };
// short names for the compact tiles (more than 4 modules in the glitch view)
var GL_TINY = { drvA: "DRV A", drvB: "DRV B", form: "FORMNT", phas: "PHASER", crush: "CRUSH", rect: "RECT", corr: "CORR", stut: "STUT", gpit: "G-PIT", gstr: "G-STR",
    rvs: "REV SL", shuf: "SHUF", slap: "SLAP", rev: "REVERB", wid: "WIDTH", ccrush: "C-CRSH", scramble: "SCRAM", scatter: "SCATR", binshift: "BINSH", specgate: "S-GATE" };

var GL_FACE = { MARGIN: 6, GAP: 4, TOP: 4, BOTTOM: 165, HEADER_H: 16, BODY_Y: 23, BODY_H: 114, ACTION_Y: 140, ACTION_H: 25,
    PAD_W: 112, VIEW_W: 196, EDITOR_W: 190, SLOTS_W: 84, SEQ_W: 212, SIDE_W: 46, DEVICE_H: 169, ROW_H: 12, ROW_GAP: 1, MAX_ROWS: 9, TAB_H: 12, MAX_TILES: 31,
    // glitch view paging: up to 4 big tiles, up to 8 compact (4 x 2), up to 12 small (4 x 3) per page, then pages of 12
    PAGE_CAP: 12, STRIP_H: 12, SEQ_PITCH: 12.5 };
// Options categories, in display order (the master list of the Options view)
var GL_OPT_CATS = ["Filter", "Distort", "Pitch", "Time", "Spectral", "Space", "Utility", "Movement"];

function defaultUi() { return { editor: 0, slots: 1, seq: 0, options: 0, sel: "", optCat: 0, edTab: 0 }; }
function normalizeUi(u) {
    var d = defaultUi();
    if (!u || typeof u !== "object") return d;
    d.editor = u.editor ? 1 : 0;
    d.slots = u.slots === undefined ? 1 : (u.slots ? 1 : 0);
    d.seq = u.seq ? 1 : 0;
    d.options = u.options ? 1 : 0;
    d.sel = typeof u.sel === "string" && glitchTileInfo(u.sel) ? u.sel : "";
    d.optCat = glClamp(Math.floor(Number(u.optCat)) || 0, 0, GL_OPT_CATS.length - 1);
    d.edTab = u.edTab ? 1 : 0;
    return d;
}
function glRect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

/** Every rect of the face for a UI state, in device pixels (the v8ui covers the whole device, 0,0..width,169).
 *  Sections, left to right: core | EDIT | SLOTS | SEQ | side. Widths: 374 base, +194 EDIT, +88 SLOTS, +216 SEQ. */
function glitchFaceLayout(ui) {
    ui = normalizeUi(ui);
    var F = GL_FACE;
    var x = F.MARGIN;
    var L = { ui: ui };
    L.core = glRect(x, F.TOP, F.PAD_W + F.GAP + F.VIEW_W, F.BOTTOM - F.TOP);
    L.toggles = { editor: glRect(x, F.TOP, 40, F.HEADER_H), slots: glRect(x + 44, F.TOP, 40, F.HEADER_H), seq: glRect(x + 88, F.TOP, 40, F.HEADER_H) };
    L.hint = glRect(x + 132, F.TOP, L.core.w - 132, F.HEADER_H);
    L.pad = glRect(x, F.BODY_Y, F.PAD_W, F.BODY_H);
    L.view = glRect(x + F.PAD_W + F.GAP, F.BODY_Y, F.VIEW_W, F.BODY_H);
    L.action = {
        dice: glRect(x, F.ACTION_Y, 70, F.ACTION_H),
        mutate: glRect(x + 74, F.ACTION_Y, 52, F.ACTION_H),
        chaos: glRect(x + 130, F.ACTION_Y, 62, F.ACTION_H),
        opt: glRect(x + 196, F.ACTION_Y, 24, F.ACTION_H),
        ab: glRect(x + 224, F.ACTION_Y, 88, F.ACTION_H),
    };
    L.options = ui.options ? glitchOptionsLayout(L.core.x) : null;
    x += L.core.w;
    L.editor = null;
    if (ui.editor) { L.editor = glRect(x + F.GAP, F.TOP, F.EDITOR_W, F.BOTTOM - F.TOP); x += F.GAP + F.EDITOR_W; }
    L.slots = null;
    if (ui.slots) {
        var sx = x + F.GAP;
        var pads = [];
        for (var i = 0; i < GL_NSLOT; i++) pads.push(glRect(sx + 4 + (i % 2) * 40, F.BODY_Y + Math.floor(i / 2) * 29, 36, 26));
        L.slots = { rect: glRect(sx, F.TOP, F.SLOTS_W, F.BOTTOM - F.TOP), pads: pads, save: glRect(sx + 4, F.ACTION_Y, 36, F.ACTION_H), clear: glRect(sx + 44, F.ACTION_Y, 36, F.ACTION_H) };
        x += F.GAP + F.SLOTS_W;
    }
    L.seq = null;
    if (ui.seq) { L.seq = glitchSeqLayout(x + F.GAP); x += F.GAP + F.SEQ_W; }
    var sdx = x + F.GAP;
    L.side = { rect: glRect(sdx, F.TOP, F.SIDE_W, F.BOTTOM - F.TOP), mix: glRect(sdx, 8, F.SIDE_W, 72), out: glRect(sdx, 84, F.SIDE_W, 72) };
    L.width = sdx + F.SIDE_W + F.MARGIN;
    L.height = F.DEVICE_H;
    L.corners = glitchCornerRects(L.pad);
    return L;
}
function glitchCornerRects(pad) {
    var bw = 22, bh = 13, m = 3;
    return [glRect(pad.x + m, pad.y + m, bw, bh), glRect(pad.x + pad.w - m - bw, pad.y + m, bw, bh),
        glRect(pad.x + m, pad.y + pad.h - m - bh, bw, bh), glRect(pad.x + pad.w - m - bw, pad.y + pad.h - m - bh, bw, bh)];
}
/** The SEQUENCER section at x0: header (ON chip), length lane, 16 steps, a glide lane (display only), a palette of the 8
 *  slots + hold, Rate / Glide / Length / Curve controls and the Randomize / Clear buttons. */
function glitchSeqLayout(x0) {
    var F = GL_FACE;
    var rect = glRect(x0, F.TOP, F.SEQ_W, F.BOTTOM - F.TOP);
    var ix = x0 + 6, iw = F.SEQ_W - 12;
    var steps = [];
    for (var i = 0; i < GL_SEQ_MAX; i++) steps.push(glRect(ix + i * F.SEQ_PITCH, 36, 12, 30));
    var pal = [];
    for (var s = 0; s < GL_NSLOT; s++) pal.push(glRect(ix + s * 22, 102, 20, 14));
    pal.push(glRect(ix + 8 * 22, 102, iw - 8 * 22, 14)); // index 8 = hold
    return {
        rect: rect, x0: ix, pitch: F.SEQ_PITCH, on: glRect(x0 + F.SEQ_W - 6 - 34, 6, 34, 14),
        lane: glRect(ix, 23, iw, 12), steps: steps, glide: glRect(ix, 69, iw, 30), palette: pal,
        rate: glRect(ix, 119, 98, 12), glideBar: glRect(ix + 102, 119, 98, 12), len: glRect(ix, 133, 98, 12), curve: glRect(ix + 102, 133, 98, 12),
        dice: glRect(ix, 147, 140, 16), clear: glRect(ix + 144, 147, iw - 144, 16),
    };
}
/** Options view: one panel over the core area (pad + glitch view + action bar). Master / detail: the 7 categories in a list on
 *  the left (a toggle for the whole category + a select button each), the selected category's types as two columns of rows
 *  on the right (a category holds at most 8 types), the "all" chip in the header and the note line at the bottom. */
function glitchOptionsLayout(x0) {
    var F = GL_FACE;
    var panel = glRect(x0, F.BODY_Y, F.PAD_W + F.GAP + F.VIEW_W, F.BOTTOM - F.BODY_Y);
    var close = glRect(panel.x + panel.w - 44, panel.y + 4, 40, 14);
    var all = glRect(panel.x + panel.w - 44 - 4 - 56, panel.y + 4, 56, 14);
    var cats = [];
    for (var c = 0; c < GL_OPT_CATS.length; c++) {
        var cy = panel.y + 20 + c * 15;
        cats.push({ toggle: glRect(panel.x + 6, cy, 16, 14), select: glRect(panel.x + 24, cy, 66, 14) });
    }
    var tx = panel.x + 98, tw2 = (panel.x + panel.w - 6 - tx - 4) / 2;
    var slots = [];
    for (var k = 0; k < 8; k++) slots.push(glRect(tx + (k % 2) * (tw2 + 4), panel.y + 22 + Math.floor(k / 2) * 24, tw2, 22));
    // items[i] = the rect of type i in the CURRENT category's two-column grid, or null when i is not in it
    return { panel: panel, close: close, all: all, cats: cats, slots: slots, note: glRect(tx, panel.y + panel.h - 14, panel.x + panel.w - 6 - tx, 13) };
}
/** Item indices (into GL_ALLOW_ITEMS) per category, in GL_OPT_CATS order. */
function glitchOptionCategories() {
    var out = [];
    for (var c = 0; c < GL_OPT_CATS.length; c++) {
        var list = [];
        for (var i = 0; i < GL_ALLOW_ITEMS.length; i++) if (GL_ALLOW_ITEMS[i].category === GL_OPT_CATS[c]) list.push(i);
        out.push({ name: GL_OPT_CATS[c], types: list });
    }
    return out;
}
/** 0 = none allowed, 1 = all, 2 = some. */
function glitchCategoryState(state, cat) {
    var cs = glitchOptionCategories()[cat].types, n = 0;
    for (var i = 0; i < cs.length; i++) if (state.allow[GL_ALLOW_ITEMS[cs[i]].id]) n++;
    return n === 0 ? 0 : (n === cs.length ? 1 : 2);
}
function setAllowCategory(state, cat, on) {
    var cs = glitchOptionCategories()[cat].types;
    for (var i = 0; i < cs.length; i++) state.allow[GL_ALLOW_ITEMS[cs[i]].id] = !!on;
    return state;
}
/** The tile grid of the glitch view for n tiles. Up to 4 tiles: big (2 x 2 or a row), up to 8: compact 4 x 2, then 4 x 3, and
 *  more than 12 tiles page (12 per page). The bottom strip (GL_FACE.STRIP_H) carries the chain ribbon and the pager.
 *  Returns { rects (this page's tiles, in order), first (absolute index of rects[0]), pages, page, cols, rows, cap, compact,
 *  grid, strip, ribbon, prev, next, pageText }. */
function glitchViewLayout(n, view, page) {
    var F = GL_FACE;
    var strip = glRect(view.x, view.y + view.h - F.STRIP_H, view.w, F.STRIP_H);
    var grid = glRect(view.x, view.y, view.w, view.h - F.STRIP_H - 2);
    var cols, rows, cap;
    if (n <= 4) { cols = n <= 3 ? Math.max(n, 1) : 2; rows = Math.max(1, Math.ceil(n / cols)); cap = 4; }
    else if (n <= 8) { cols = 4; rows = 2; cap = 8; }
    else { cols = 4; rows = 3; cap = F.PAGE_CAP; }
    var pages = Math.max(1, Math.ceil(n / cap));
    page = glClamp(Math.floor(Number(page)) || 0, 0, pages - 1);
    var first = page * cap;
    var cnt = Math.max(0, Math.min(cap, n - first));
    var gap = 3;
    var tw2 = (grid.w - (cols - 1) * gap) / cols;
    var th = Math.min(n <= 4 ? 76 : 99, (grid.h - (rows - 1) * gap) / rows);
    var y0 = grid.y + (grid.h - (rows * th + (rows - 1) * gap)) / 2;
    var rects = [];
    for (var i = 0; i < cnt; i++) rects.push(glRect(grid.x + (i % cols) * (tw2 + gap), y0 + Math.floor(i / cols) * (th + gap), tw2, th));
    var paged = pages > 1;
    var rw = paged ? view.w - 62 : view.w;
    return { rects: rects, first: first, pages: pages, page: page, cols: cols, rows: rows, cap: cap, compact: n > 4, grid: grid, strip: strip,
        ribbon: glRect(view.x, strip.y, rw, strip.h),
        prev: paged ? glRect(view.x + view.w - 32, strip.y, 16, strip.h) : null, next: paged ? glRect(view.x + view.w - 16, strip.y, 16, strip.h) : null,
        pageText: paged ? glRect(view.x + view.w - 62, strip.y, 30, strip.h) : null };
}
/** Back-compat helper: the rects of page 0. */
function glitchTileRects(n, view) { return glitchViewLayout(n, view, 0).rects; }
/** Editor: header buttons, the PARAMS / MOTION tab chips under them and one row rect per parameter. */
function glitchEditorLayout(ed, nRows) {
    var F = GL_FACE;
    var rows = [];
    var y0 = F.BODY_Y + F.TAB_H + 2;
    for (var i = 0; i < nRows; i++) rows.push(glRect(ed.x + 6, y0 + i * (F.ROW_H + F.ROW_GAP), ed.w - 12, F.ROW_H));
    return { close: glRect(ed.x + ed.w - 22, F.TOP + 2, 16, 14), remove: glRect(ed.x + ed.w - 42, F.TOP + 2, 16, 14), lock: glRect(ed.x + ed.w - 62, F.TOP + 2, 16, 14), rows: rows,
        tabParams: glRect(ed.x + 6, F.BODY_Y, 56, F.TAB_H), tabMotion: glRect(ed.x + 66, F.BODY_Y, 56, F.TAB_H) };
}
/** The Motion panel of the editor (the MOTION tab replaces the param rows). type: 0 off, 1 LFO, 2 Steps, 3 Env. Only the controls the
 *  type uses are non-null: type[4] selector cells; target (cycles the candidates); sync chip + rate bar; LFO: shape[7] cells;
 *  Steps: nsteps chip + glide bar; Env: atk, rel; depth and phase bars (Env has no phase); area = the waveform / step painter /
 *  level display under them. Every rect is 178 wide at most and ends above the editor's bottom hint line (y <= 156). */
function glitchMotionLayout(ed, type) {
    var x = ed.x + 6, w = ed.w - 12;
    var cw = w / 4;
    var o = { type: [], target: null, sync: null, rate: null, shape: null, nsteps: null, glide: null, atk: null, rel: null, depth: null, phase: null, area: null };
    for (var i = 0; i < 4; i++) o.type.push(glRect(x + i * cw, 37, i < 3 ? cw - 2 : cw, 14));
    if (!(type >= 1 && type <= 3)) return o;
    o.target = glRect(x, 54, w, 12);
    o.sync = glRect(x, 69, 34, 12);
    o.rate = glRect(x + 37, 69, w - 37, 12);
    var y4 = 84, y5 = 99, y6 = 114;
    if (type === 1) {
        o.shape = [];
        var sw = w / GL_MV_SHAPE_NAMES.length;
        for (var k = 0; k < GL_MV_SHAPE_NAMES.length; k++) o.shape.push(glRect(x + k * sw, y4, k < GL_MV_SHAPE_NAMES.length - 1 ? sw - 1 : sw, 12));
        o.depth = glRect(x, y5, w, 12);
        o.phase = glRect(x, y6, w, 12);
    } else if (type === 2) {
        o.nsteps = glRect(x, y4, 34, 12);
        o.glide = glRect(x + 37, y4, w - 37, 12);
        o.depth = glRect(x, y5, w, 12);
        o.phase = glRect(x, y6, w, 12);
    } else {
        o.atk = glRect(x, y4, w, 12);
        o.rel = glRect(x, y5, w, 12);
        o.depth = glRect(x, y6, w, 12);
    }
    o.area = glRect(x, 129, w, 27);
    return o;
}

/** Every interactive rect: [{id, r, layer, panel}]. layer 1 sits on top of layer 0 inside the same panel (hit order).
 *  nTiles = ALL tiles of the glitch view (the pager shows `page`), nRows = rows of the editor. */
function glitchHitMap(ui, nTiles, nRows, page, mvType) {
    var L = glitchFaceLayout(ui);
    var out = [];
    function add(id, r, panel, layer) { out.push({ id: id, r: r, panel: panel, layer: layer || 0 }); }
    add("tg_editor", L.toggles.editor, L.core);
    add("tg_slots", L.toggles.slots, L.core);
    add("tg_seq", L.toggles.seq, L.core);
    if (L.options) {
        var O = L.options;
        add("opt_close", O.close, O.panel);
        add("opt_all", O.all, O.panel);
        var cats = glitchOptionCategories();
        for (var c = 0; c < O.cats.length; c++) { add("optcat_tg" + c, O.cats[c].toggle, O.panel); add("optcat_sel" + c, O.cats[c].select, O.panel); }
        var cur = cats[L.ui.optCat].types;
        for (var t = 0; t < cur.length; t++) add("opt_" + cur[t], O.slots[t], O.panel);
    } else {
        add("pad", L.pad, L.core);
        for (var c2 = 0; c2 < 4; c2++) add("corner" + c2, L.corners[c2], L.pad, 1);
        var V = glitchViewLayout(Math.min(nTiles, GL_FACE.MAX_TILES), L.view, page);
        for (var i = 0; i < V.rects.length; i++) add("tile" + (V.first + i), V.rects[i], L.view);
        if (V.prev) { add("pg_prev", V.prev, L.view); add("pg_next", V.next, L.view); }
        for (var k in L.action) add("act_" + k, L.action[k], L.core);
    }
    add("side_mix", L.side.mix, L.side.rect);
    add("side_out", L.side.out, L.side.rect);
    if (L.editor) {
        var E = glitchEditorLayout(L.editor, nRows);
        add("ed_close", E.close, L.editor);
        add("ed_remove", E.remove, L.editor);
        add("ed_lock", E.lock, L.editor);
        add("ed_tab0", E.tabParams, L.editor);
        add("ed_tab1", E.tabMotion, L.editor);
        if (L.ui.edTab) {
            var Mo = glitchMotionLayout(L.editor, mvType === undefined ? 1 : mvType);
            for (var mt = 0; mt < 4; mt++) add("mv_type" + mt, Mo.type[mt], L.editor);
            var singles = ["target", "sync", "rate", "nsteps", "glide", "atk", "rel", "depth", "phase", "area"];
            for (var sg = 0; sg < singles.length; sg++) if (Mo[singles[sg]]) add("mv_" + singles[sg], Mo[singles[sg]], L.editor);
            if (Mo.shape) for (var sh = 0; sh < Mo.shape.length; sh++) add("mv_shape" + sh, Mo.shape[sh], L.editor);
        } else for (var r = 0; r < E.rows.length; r++) add("ed_row" + r, E.rows[r], L.editor);
    }
    if (L.slots) {
        for (var s = 0; s < GL_NSLOT; s++) add("slot" + s, L.slots.pads[s], L.slots.rect);
        add("slot_save", L.slots.save, L.slots.rect);
        add("slot_clear", L.slots.clear, L.slots.rect);
    }
    if (L.seq) {
        var Q = L.seq;
        add("seq_on", Q.on, Q.rect);
        add("seq_lane", Q.lane, Q.rect);
        for (var st = 0; st < GL_SEQ_MAX; st++) add("seq_step" + st, Q.steps[st], Q.rect);
        for (var pl = 0; pl <= GL_NSLOT; pl++) add("seq_pal" + pl, Q.palette[pl], Q.rect);
        add("seq_rate", Q.rate, Q.rect);
        add("seq_glide", Q.glideBar, Q.rect);
        add("seq_len", Q.len, Q.rect);
        add("seq_curve", Q.curve, Q.rect);
        add("seq_dice", Q.dice, Q.rect);
        add("seq_clear", Q.clear, Q.rect);
    }
    return out;
}
function glInside(r, p) { return r.x >= p.x - 1e-6 && r.y >= p.y - 1e-6 && r.x + r.w <= p.x + p.w + 1e-6 && r.y + r.h <= p.y + p.h + 1e-6; }
function glOverlap(a, b) { return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6; }
function glHit(r, x, y) { return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

// ----- tiles / modules -----
function glitchTileInfo(key) {
    var inst = glInstance(key);
    if (inst) return { key: key, inst: key, type: inst.type, sub: null, name: GL_SHORT[key] || inst.name, category: inst.category };
    var t = glType(key);
    if (t && t.amountKey) return { key: key, inst: "spec", type: key, sub: t.amountKey, name: GL_SHORT[key] || t.name, category: t.category };
    return null;
}
/** The tiles of a (blended or plain) vector, in chain order; the spectral instance expands into its active sub-ops. */
function glitchTiles(vec) {
    var L = glitchLayout();
    var tiles = [];
    for (var ii = 0; ii < GL_INSTANCES.length; ii++) {
        var inst = GL_INSTANCES[ii];
        if (inst.id === "spec") {
            if (!(vec[L.base.spec] > GL_ACTIVE_EPS)) continue;
            for (var ti = 0; ti < GL_TYPES.length; ti++) {
                var t = GL_TYPES[ti];
                if (t.instances[0] !== "spec") continue;
                var amt = vec[L.index["spec." + t.amountKey]];
                if (amt > GL_ACTIVE_EPS) tiles.push({ key: t.id, inst: "spec", sub: t.amountKey, name: GL_SHORT[t.id], category: t.category, wet: amt, chain: ii, mv: glitchTileMove(vec, { key: t.id, inst: "spec" }) });
            }
        } else if (vec[L.base[inst.id]] > GL_ACTIVE_EPS) {
            tiles.push({ key: inst.id, inst: inst.id, sub: null, name: GL_SHORT[inst.id], category: inst.category, wet: vec[L.base[inst.id]], chain: ii, mv: glitchTileMove(vec, { key: inst.id, inst: inst.id }) });
        }
    }
    return tiles;
}
/** Rows of the module editor for a tile: [{id ("wet" or a param key), name, spec, shared}]. */
function glitchEditorRows(key) {
    var info = glitchTileInfo(key);
    if (!info) return [];
    var inst = glInstance(info.inst);
    var rows = [];
    if (!info.sub) {
        for (var i = 0; i < inst.params.length; i++) rows.push({ id: inst.params[i].key, name: inst.params[i].key === "wet" ? "Amount" : inst.params[i].name, spec: inst.params[i], shared: false });
        return rows;
    }
    for (var j = 0; j < inst.params.length; j++) {
        var ps = inst.params[j];
        if (ps.key === info.sub) rows.push({ id: ps.key, name: "Amount", spec: ps, shared: false });
    }
    for (var j2 = 0; j2 < inst.params.length; j2++) {
        var p2 = inst.params[j2];
        if (p2.group === info.sub && p2.key !== info.sub) rows.push({ id: p2.key, name: p2.name, spec: p2, shared: false });
    }
    rows.push({ id: "wet", name: "Spectral Mix", spec: inst.params[0], shared: true });
    return rows;
}
function glitchGetValue(g, key, id) {
    var info = glitchTileInfo(key);
    if (!info) return 0;
    var inst = glInstance(info.inst);
    var mod = g && g.modules ? g.modules[info.inst] : null;
    var spec = null;
    for (var i = 0; i < inst.params.length; i++) if (inst.params[i].key === id) spec = inst.params[i];
    if (!spec) return 0;
    if (!mod) return id === "wet" ? 0 : spec.def;
    if (id === "wet") return mod.wet;
    return mod.params[id] === undefined ? spec.def : mod.params[id];
}
function glitchSetValue(g, key, id, v) {
    var info = glitchTileInfo(key);
    if (!info) return false;
    var inst = glInstance(info.inst);
    var spec = null;
    for (var i = 0; i < inst.params.length; i++) if (inst.params[i].key === id) spec = inst.params[i];
    if (!spec) return false;
    var mod = g.modules[inst.id] || (g.modules[inst.id] = { wet: 0, params: defaultParams(inst), move: null });
    v = glClamp(Number(v), spec.min, spec.max);
    if (!isFinite(v)) return false;
    if (spec.kind === "disc") v = Math.round(v);
    if (id === "wet") mod.wet = v; else mod.params[id] = v;
    return true;
}
/** Remove a module from a glitch (a spectral sub-op only zeroes its amount; the spectral module goes when none is left). */
function glitchRemoveTile(g, key) {
    var info = glitchTileInfo(key);
    if (!info) return false;
    if (!info.sub) delete g.modules[info.inst];
    else {
        var mod = g.modules.spec;
        if (mod) {
            mod.params[info.sub] = 0;
            if (mod.move && glMoveInTile(glInstance("spec"), mod.move.target, info.sub)) mod.move = null;
            var anyOn = false;
            for (var i = 0; i < GL_TYPES.length; i++) if (GL_TYPES[i].amountKey && mod.params[GL_TYPES[i].amountKey] > GL_ACTIVE_EPS) anyOn = true;
            if (!anyOn) delete g.modules.spec;
        }
    }
    if (g.locks) { delete g.locks[key]; if (!Object.keys(g.locks).length) delete g.locks; }
    return true;
}
function glitchIsLocked(g, key) { return !!(g && g.locks && g.locks[key]); }
function glitchToggleLock(g, key) {
    if (!glitchTileInfo(key)) return false;
    if (!g.locks) g.locks = {};
    if (g.locks[key]) delete g.locks[key]; else g.locks[key] = true;
    if (!Object.keys(g.locks).length) delete g.locks;
    return !!(g.locks && g.locks[key]);
}
/** Copy one tile (module, or a spectral sub-op's group) from glitch `from` into glitch `to`. */
function glitchCopyTile(from, to, key) {
    var info = glitchTileInfo(key);
    if (!info || !from.modules[info.inst]) return false;
    var src = from.modules[info.inst];
    if (!info.sub) { to.modules[info.inst] = glCopy(src); return true; }
    var inst = glInstance("spec");
    var dst = to.modules.spec || (to.modules.spec = { wet: src.wet, params: defaultParams(inst), move: null });
    if (dst.wet < GL_ACTIVE_EPS) dst.wet = src.wet;
    for (var i = 0; i < inst.params.length; i++) {
        var ps = inst.params[i];
        if (ps.key === info.sub || ps.group === info.sub) dst.params[ps.key] = src.params[ps.key] === undefined ? ps.def : src.params[ps.key];
    }
    // the spectral instance's single movement travels with the sub-op it moves
    if (src.move && glMoveInTile(inst, src.move.target, info.sub)) dst.move = glCopy(src.move);
    else if (dst.move && glMoveInTile(inst, dst.move.target, info.sub)) dst.move = null;
    return true;
}
function glitchApplyLocks(old, neu) {
    if (old.locks) {
        for (var key in old.locks) if (old.locks[key]) glitchCopyTile(old, neu, key);
        neu.locks = glCopy(old.locks);
    }
    return neu;
}
/** Roll a new working glitch (locked modules are kept). */
function rerollWorking(state) {
    var seed = state.seed++;
    state.working = glitchApplyLocks(state.working, randomizeGlitch(seed, state.chaos, state.allow));
    state.working.name = "";
    return state;
}
function mutateAmount(state) { return 0.15 + 0.35 * state.chaos; }
/** Nudge the working glitch (locked modules are kept). */
function mutateWorking(state) {
    var seed = state.seed++;
    state.working = glitchApplyLocks(state.working, mutateGlitch(state.working, seed, mutateAmount(state), state.allow));
    return state;
}
function setAllow(state, typeId, on) { if (state.allow[typeId] !== undefined) state.allow[typeId] = !!on; return state; }
function setAllowAll(state, on) { for (var t in state.allow) state.allow[t] = !!on; return state; }
function assignCorner(state, c, slot) { if (c >= 0 && c < 4 && slot >= 0 && slot < GL_NSLOT) state.corners[c] = slot; return state; }
/** Which of the 12 instances a glitch uses (for the slot pad glyph). */
function glitchSignature(g) {
    var out = [];
    for (var i = 0; i < GL_INSTANCES.length; i++) out.push(!!(g && g.modules && g.modules[GL_INSTANCES[i].id] && g.modules[GL_INSTANCES[i].id].wet > GL_ACTIVE_EPS));
    return out;
}
/** The vector that is audible: the blend of the engine slots by the engine weights. */
function currentVector(state) { return blendVectors(engineVectors(state), engineWeights(state)); }

// Undo: one snapshot per gesture (the v8ui calls undoPush once at the start of a gesture)
function glitchUndoSnapshot(state) {
    return JSON.stringify({ working: state.working, slots: state.slots, corners: state.corners, allow: state.allow, chaos: state.chaos, seed: state.seed, seq: state.seq });
}
function glitchUndoRestore(state, snap) {
    var o = JSON.parse(snap);
    var n = normalizeState({ working: o.working, slots: o.slots, corners: o.corners, allow: o.allow, chaos: o.chaos, seed: o.seed, xy: state.xy, audition: state.audition, ui: state.ui, seq: o.seq === undefined ? state.seq : o.seq });
    state.working = n.working; state.slots = n.slots; state.corners = n.corners; state.allow = n.allow; state.chaos = n.chaos; state.seed = n.seed; state.seq = n.seq;
    return state;
}

// ----- parameter value <-> position / text -----
function glParamToNorm(spec, v) {
    if (spec.kind === "log") return glClamp((Math.log(Math.max(v, spec.min)) - Math.log(spec.min)) / (Math.log(spec.max) - Math.log(spec.min)), 0, 1);
    return glClamp((v - spec.min) / (spec.max - spec.min), 0, 1);
}
function glNormToParam(spec, n) {
    n = glClamp(n, 0, 1);
    var v;
    if (spec.kind === "log") v = Math.exp(Math.log(spec.min) + n * (Math.log(spec.max) - Math.log(spec.min)));
    else v = spec.min + n * (spec.max - spec.min);
    if (spec.kind === "disc") v = Math.round(v);
    return glClamp(v, spec.min, spec.max);
}
function glitchFormatValue(spec, v) {
    if (spec.patterns) { var n = 0; for (var b = 0; b < 16; b++) if ((Math.floor(v) >> b) & 1) n++; return n + "/16"; }
    if (spec.kind === "disc") return spec.choices ? String(spec.choices[glClamp(Math.round(v) - spec.min, 0, spec.choices.length - 1)]) : String(Math.round(v));
    if (spec.kind === "wet" || (spec.unit === "" && spec.max <= 1.0001 && spec.min >= 0)) return Math.round(v * 100) + "%";
    if (spec.unit === "Hz") return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + "k" : Math.round(v) + "";
    if (spec.unit === "dB") return (v >= 0 ? "+" : "") + v.toFixed(1) + " dB";
    if (spec.unit === "x") return v.toFixed(1) + "x";
    if (spec.max - spec.min <= 3) return v.toFixed(2);
    return v.toFixed(1);
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        GL_MV_TYPE_NAMES: GL_MV_TYPE_NAMES, GL_MV_SHAPE_NAMES: GL_MV_SHAPE_NAMES, GL_MV_STEPS: GL_MV_STEPS, GL_MV_DIV_BEATS: GL_MV_DIV_BEATS, GL_MV_DIV_NAMES: GL_MV_DIV_NAMES,
        GL_MV_DIV_DEFAULT: GL_MV_DIV_DEFAULT, GL_MV_COL: GL_MV_COL, GL_MV_PARAM_KEYS: GL_MV_PARAM_KEYS, GL_MAIN_PARAM: GL_MAIN_PARAM, GL_MAIN_SUB: GL_MAIN_SUB,
        GL_MOVE_TYPES: GL_MOVE_TYPES, GL_ALLOW_ITEMS: GL_ALLOW_ITEMS, glMvSpecs: glMvSpecs,
        defaultMove: defaultMove, normalizeMove: normalizeMove, glMoveFromVector: glMoveFromVector, glMoveVecValue: glMoveVecValue, glMoveNearestDiv: glMoveNearestDiv,
        glitchMoveCandidates: glitchMoveCandidates, glitchMainParam: glitchMainParam, glitchGetMove: glitchGetMove, glitchSetMoveType: glitchSetMoveType,
        glitchSetMove: glitchSetMove, glitchSetMoveStep: glitchSetMoveStep, glitchMoveRateText: glitchMoveRateText, glitchTileMove: glitchTileMove,
        glMoveTypesAllowed: glMoveTypesAllowed, rollMovement: rollMovement, mutateMovement: mutateMovement, glMoveLfo: glMoveLfo, glMoveStepValue: glMoveStepValue,
        glMoveState: glMoveState, glMoveTick: glMoveTick, glMoveApply: glMoveApply, glMoveBlock: glMoveBlock, glitchMotionLayout: glitchMotionLayout, glMoveKeysOf: glMoveKeysOf,
        GL_STATE_VERSION: GL_STATE_VERSION, GL_NSLOT: GL_NSLOT, GL_FFT_N: GL_FFT_N, GL_LATENCY: GL_LATENCY, GL_ACTIVE_EPS: GL_ACTIVE_EPS,
        GL_SLOTS_BUF_SAMPS: GL_SLOTS_BUF_SAMPS, GL_SCOPE_SAMPS: GL_SCOPE_SAMPS, GL_SCOPE: GL_SCOPE, GL_DIV_BEATS: GL_DIV_BEATS,
        GL_DIV_NAMES: GL_DIV_NAMES, GL_CHOP_PATTERNS: GL_CHOP_PATTERNS, GL_INSTANCES: GL_INSTANCES, GL_TYPES: GL_TYPES,
        GL_WAVE_LEN: GL_WAVE_LEN, GL_BANDS: GL_BANDS, GL_CEP_BINS: GL_CEP_BINS, GL_HOP_CTL: GL_HOP_CTL,
        glitchLayout: glitchLayout, glitchMeta: glitchMeta, glitchEngineConstants: glitchEngineConstants, glInstance: glInstance, glType: glType, defaultGlitch: defaultGlitch,
        randomizeGlitch: randomizeGlitch, mutateGlitch: mutateGlitch, glitchToVector: glitchToVector, vectorToGlitch: vectorToGlitch,
        blendVectors: blendVectors, xyWeights: xyWeights, cornerSlotWeights: cornerSlotWeights, randRange: randRange,
        defaultState: defaultState, normalizeState: normalizeState, normalizeGlitch: normalizeGlitch, stateToBlob: stateToBlob,
        stateFromBlob: stateFromBlob, engineVectors: engineVectors, engineWeights: engineWeights, packEngineBuffer: packEngineBuffer,
        saveToSlot: saveToSlot, recallSlot: recallSlot, clearSlot: clearSlot, allowedTypes: allowedTypes, defaultAllow: defaultAllow,
        defaultParams: defaultParams, glRng: glRng,
        GL_NINST: GL_NINST, GL_SEQ_MAX: GL_SEQ_MAX, GL_SEQ_HDR: GL_SEQ_HDR, GL_SEQ_RATES: GL_SEQ_RATES, GL_SEQ_RATE_NAMES: GL_SEQ_RATE_NAMES,
        GL_LFO_BEATS: GL_LFO_BEATS, GL_LFO_NAMES: GL_LFO_NAMES, GL_SLICE_COUNTS: GL_SLICE_COUNTS, GL_SHUF_SPANS: GL_SHUF_SPANS, GL_VOWELS: GL_VOWELS,
        GL_MODE_NAMES: GL_MODE_NAMES,
        defaultSeq: defaultSeq, normalizeSeq: normalizeSeq, seqSlotAt: seqSlotAt, seqWeights: seqWeights, seqHeader: seqHeader, filledSlots: filledSlots,
        randomizeSequence: randomizeSequence, setSeqStep: setSeqStep, setSeqLength: setSeqLength, setSeqRate: setSeqRate, setSeqGlide: setSeqGlide,
        rerollSequence: rerollSequence, engineMode: engineMode,
        setSeqCurve: setSeqCurve, seqClear: seqClear, seqCycleValue: seqCycleValue, seqCycleStep: seqCycleStep, soundingWeights: soundingWeights,
        GL_OPT_CATS: GL_OPT_CATS, glitchSeqLayout: glitchSeqLayout, glitchViewLayout: glitchViewLayout, glitchOptionCategories: glitchOptionCategories,
        glitchCategoryState: glitchCategoryState, setAllowCategory: setAllowCategory,
        GL_PARAMS: GL_PARAMS, GL_PARAM_KEYS: GL_PARAM_KEYS, GL_SHORT: GL_SHORT, GL_TINY: GL_TINY, GL_FACE: GL_FACE, defaultUi: defaultUi, normalizeUi: normalizeUi,
        glitchFaceLayout: glitchFaceLayout, glitchCornerRects: glitchCornerRects, glitchOptionsLayout: glitchOptionsLayout, glitchTileRects: glitchTileRects,
        glitchEditorLayout: glitchEditorLayout, glitchHitMap: glitchHitMap, glInside: glInside, glOverlap: glOverlap, glHit: glHit,
        glitchTileInfo: glitchTileInfo, glitchTiles: glitchTiles, glitchEditorRows: glitchEditorRows, glitchGetValue: glitchGetValue, glitchSetValue: glitchSetValue,
        glitchRemoveTile: glitchRemoveTile, glitchIsLocked: glitchIsLocked, glitchToggleLock: glitchToggleLock, glitchCopyTile: glitchCopyTile,
        rerollWorking: rerollWorking, mutateWorking: mutateWorking, mutateAmount: mutateAmount, setAllow: setAllow, setAllowAll: setAllowAll,
        assignCorner: assignCorner, glitchSignature: glitchSignature, currentVector: currentVector, glitchUndoSnapshot: glitchUndoSnapshot,
        glitchUndoRestore: glitchUndoRestore, glParamToNorm: glParamToNorm, glNormToParam: glNormToParam, glitchFormatValue: glitchFormatValue,
    };
}
