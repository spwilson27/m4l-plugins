// Deviate: shared constants, the draw algorithm, the hidden-parameter table, the blob codec and preview telemetry.
// Concatenated first into the engine and every face script (and required by Node tests: `nodeModule` pattern, AGENTS 1c).
// This file is the CONTRACT between the gen core, the engine, the faces and the tests. Everything in it is frozen once
// the DSP and face lanes start; add to it only through the orchestrator (append-only: scope slots, parameters, hidden rows).
//
// Mirrors that must stay equal (tests/test_deviate_dsp.js checks each):
//   DV_PARAMS        <-> P in scripts/build_deviate.py (`--dump-params`)
//   dvHash / dvStep  <-> dv_draw in src/deviate_core.genexpr (audio case seed_repro, parity 1e-9)
//   dvHiddenGen()    <-> dvHiddenFromMetas() (the generated GenExpr function is transpiled and compared, 1e-12)
//   DV_SCOPE / DV_CTL / DV_ECHO <-> the pokes / peeks of the core

// ---- metas, faces, sizes ----------------------------------------------------------------------------------------
var DV_METAS = ["Snap", "Pitch", "Body", "Motion", "Space", "Echo", "Grit", "Ring"];
var DV_META_KEYS = ["snap", "pitch", "body", "motion", "space", "echo", "grit", "ring"];
var DV_FACES = ["Roulette", "Constellation", "Lanes", "Tube", "Matrix", "Stub"];
var DV_CHAINS = ["T", "B", "L"]; // transient, body, long (the ringing tail)
var DV_PITCH_META = 1; // bipolar: neutral at 50
var DV_RING_META = 7;

var DV_LAT_ENV = 256; // samples: latency in Envelope split mode (patcher `latency` attribute at load)
var DV_LAT_SPEC = 1279; // samples: latency in Spectral split mode (1023 STFT + 256)
var DV_PRE = 96; // samples the draw is applied before the hit reaches the output
var DV_LOCK_AUDIO_MS = 30; // detector lockout
var DV_RING_MAX_S = 2.0; // nothing audible after this long, whatever the draw
var DV_RING_HOLD_S = 0.15;
var DV_RING_FADE_S = 0.02;
var DV_RING_TR_MIN = 0.05;
var DV_RING_TR_MAX = 1.83; // 0.15 + 1.83 + 0.02 = 2.0 s
var DV_SPEC_N = 2048; // ring length per channel of buffer ---deviatespec (5 channels: in, T, B, R, out)
var DV_SPEC_CH = { IN: 0, T: 1, B: 2, R: 3, OUT: 4 };
var DV_CTL_SAMPS = 64;
var DV_WAVE_BLOCKS = 256; // waveform ring blocks (of DV_WAVE_BLOCK_SAMPS samples)
var DV_WAVE_BLOCK_SAMPS = 512;
var DV_WAVE_STRIDE = 5; // in min, in max, out min, out max, onset flag

// ---- telemetry contract (buffer ---deviatescope, 1536 floats, written every 64 samples, skipped when idle except ALIVE) ----
var DV_SCOPE = Object.freeze({
    FRAMES: 0, SR: 1, HITS: 2, DRAW_SERIAL: 3, ONSET_AGE: 4, // ONSET_AGE: ms since the last hit reached the output, -1 when idle
    SPLIT_MODE: 5, LATENCY: 6, ASLEEP: 7, REROLL: 8, TR_S: 9, RING_ENV: 10, IR_TAG: 11,
    FAST: 12, SLOW: 13, THR: 14, MTRIG: 15,
    METAS: 16, // 16..23 drifted (effective) metas, 0..100
    DRAWS: 24, // 24..31 raw draws (the undrifted target), 0..100
    PK_IN: 32, PK_T: 33, PK_B: 34, PK_L: 35, PK_OUT: 36, PK_DRY: 37, // peaks since the last write: input, transient, body, long (tail), output, dry
    PAGE_APPLIED: 38, // counter: pages applied (the draw reached the chains)
    HIT_GATE: 39, // 1 = the last hit drew, 0 = Chance rejected it (the old draw is kept)
    HIT_SRC: 40, // 0 audio, 1 MIDI
    WAVE_HEAD: 41, // next waveform block to be written (0..DV_WAVE_BLOCKS-1)
    SPEC_HEAD: 42, // next slot of the ---deviatespec rings
    ALIVE: 48, // moves every 64 samples, also in silence (drives the DSP resend)
    HIDDEN: 64, // 64..127: the hidden values (DV_HIDDEN rows, applied page)
    ECHO: 128, // 128..159: what the gen runs with (DV_ECHO)
    WAVE: 256, // 256..1535: DV_WAVE_BLOCKS blocks of DV_WAVE_STRIDE
});
var DV_SCOPE_SAMPS = 1536;
// ECHO block: offsets from DV_SCOPE.ECHO
var DV_ECHO = Object.freeze({
    V: 0, // 0..7 values
    R: 8, // 8..15 ranges
    LOCKS: 16, // bit mask, bit i = meta i locked
    SENS: 17, THR: 18, CHANCE: 19, MIX: 20, SEED: 21, DRIFT: 22, SPLIT: 23, REROLL: 24, // the Param values the gen holds
    CTL_GEN: 25, // generation of ---deviatectl last applied
});
// ---deviatectl (JS -> gen): restored draw state. Written by the engine, GEN last.
var DV_CTL = Object.freeze({ GEN: 0, FLAGS: 1, REROLL: 2, HIT: 3, T: 4, E: 12 }); // T0..7 at 4..11, E0..7 at 12..19 (0..100)
// ---deviateir (JS -> gen): header, directory, then the IR spectra bank (src/deviate_ir.js)
var DV_IR = Object.freeze({ HDR: 128, SAMPS: 2500000, MAX_IRS: 10, VER: 0, COUNT: 1, SR: 2, READY: 3, DIR: 16 }); // DIR + 4i: offset, length, nHead, nTail
// Two-stage uniform partitioned convolver (a fork of Reverb+'s, AGENTS 27): head 128 / FFT 256 / 32 slots, tail 2048 / FFT 4096 / 48 slots
var DV_CONV = Object.freeze({ P1: 128, N1: 256, NB1: 129, HEAD_PARTS: 32, H: 4096, P2: 2048, N2: 4096, NB2: 2049, TAIL_MAX: 48, LAT: 256 });

// ---- parameters (mirror of P in scripts/build_deviate.py; ORDER IS FOREVER) ------------------------------------------
// [key, long name, short name, min, max, initial, type (0 float, 2 enum), unitstyle, exponent, gen message, divisor]
var DV_PARAMS = [
    ["v_snap", "Snap", "Snap", 0, 100, 30, 0, 5, 1, "dvv0", 1],
    ["v_pitch", "Pitch", "Pitch", 0, 100, 50, 0, 5, 1, "dvv1", 1],
    ["v_body", "Body", "Body", 0, 100, 30, 0, 5, 1, "dvv2", 1],
    ["v_motion", "Motion", "Motion", 0, 100, 20, 0, 5, 1, "dvv3", 1],
    ["v_space", "Space", "Space", 0, 100, 30, 0, 5, 1, "dvv4", 1],
    ["v_echo", "Echo", "Echo", 0, 100, 20, 0, 5, 1, "dvv5", 1],
    ["v_grit", "Grit", "Grit", 0, 100, 20, 0, 5, 1, "dvv6", 1],
    ["v_ring", "Ring", "Ring", 0, 100, 10, 0, 5, 1, "dvv7", 1],
    ["r_snap", "Snap Range", "R Snap", 0, 100, 50, 0, 5, 1, "dvr0", 1],
    ["r_pitch", "Pitch Range", "R Pitch", 0, 100, 50, 0, 5, 1, "dvr1", 1],
    ["r_body", "Body Range", "R Body", 0, 100, 50, 0, 5, 1, "dvr2", 1],
    ["r_motion", "Motion Range", "R Motion", 0, 100, 50, 0, 5, 1, "dvr3", 1],
    ["r_space", "Space Range", "R Space", 0, 100, 50, 0, 5, 1, "dvr4", 1],
    ["r_echo", "Echo Range", "R Echo", 0, 100, 50, 0, 5, 1, "dvr5", 1],
    ["r_grit", "Grit Range", "R Grit", 0, 100, 50, 0, 5, 1, "dvr6", 1],
    ["r_ring", "Ring Range", "R Ring", 0, 100, 50, 0, 5, 1, "dvr7", 1],
    ["sens", "Sensitivity", "Sens", 0, 100, 50, 0, 5, 1, "dvsens", 100],
    ["thresh", "Threshold", "Thresh", -60, 0, -36, 0, 4, 1, "dvthr", 1],
    ["chance", "Chance", "Chance", 0, 100, 100, 0, 5, 1, "dvchance", 1],
    ["mix", "Dry/Wet", "Mix", 0, 100, 100, 0, 5, 1, "dvwet", 100],
    ["seed", "Seed", "Seed", 0, 1000, 0, 0, 0, 1, "dvseed", 1],
    ["drift", "Drift", "Drift", 0, 100, 0, 0, 5, 1, "dvdrift", 1],
    ["reroll", "Reroll", "Reroll", 0, 1, 0, 2, 9, 1, "dvreroll", 1],
    ["split", "Split Mode", "Split", 0, 1, 0, 2, 9, 1, "dvsplit", 1],
    ["l_snap", "Snap Lock", "L Snap", 0, 1, 0, 2, 9, 1, "dvl0", 1],
    ["l_pitch", "Pitch Lock", "L Pitch", 0, 1, 0, 2, 9, 1, "dvl1", 1],
    ["l_body", "Body Lock", "L Body", 0, 1, 0, 2, 9, 1, "dvl2", 1],
    ["l_motion", "Motion Lock", "L Motion", 0, 1, 0, 2, 9, 1, "dvl3", 1],
    ["l_space", "Space Lock", "L Space", 0, 1, 0, 2, 9, 1, "dvl4", 1],
    ["l_echo", "Echo Lock", "L Echo", 0, 1, 0, 2, 9, 1, "dvl5", 1],
    ["l_grit", "Grit Lock", "L Grit", 0, 1, 0, 2, 9, 1, "dvl6", 1],
    ["l_ring", "Ring Lock", "L Ring", 0, 1, 0, 2, 9, 1, "dvl7", 1],
    ["midi_in", "MIDI From", "MIDI In", 0, 1, 0, 2, 9, 1, null, 1],
];
/** key -> index into DV_PARAMS */
var DV_PARAM_INDEX = {};
(function () {
    for (var i = 0; i < DV_PARAMS.length; i++) DV_PARAM_INDEX[DV_PARAMS[i][0]] = i;
})();
// Parameters whose gen message the ENGINE sends (it decides when): split (waits for the spec stage, sets the latency attribute)
var DV_ENGINE_GEN = { split: 1, reroll: 1 };

// ---- utilities ---------------------------------------------------------------------------------------------------
function dvClamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

/** mulberry32: deterministic random numbers for tests and previews (a face must never call Math.random). */
function dvRng(seed) {
    var a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function dvLatency(splitMode) {
    return splitMode ? DV_LAT_SPEC : DV_LAT_ENV;
}

// ---- the draw ----------------------------------------------------------------------------------------------------
// Counter-based, fully reproducible: the same Seed, Value/Range/Lock/Chance/Drift settings and hit number always give the
// same draw. The hash is exact integer arithmetic in doubles (a seed mixed linearly, then four squarings mod a prime below 2^26,
// so every product stays below 2^53): JS `%` and the gen's `x - m * floor(x / m)` agree bit for bit. (A sin-based hash was tried
// first: in real Max one of 48 draws differed completely from JS, so gen's sin is not bit-faithful at some arguments.)
// Mirrors dv_draw in the core.
var DV_HASH_M = 67108859;
function dvHash(idx, k, slot) {
    var x = (idx * 7919 + k * 104729 + slot * 3571 + 12345) % DV_HASH_M;
    for (var r = 0; r < 4; r++) x = (x * x + 40503) % DV_HASH_M;
    return x / DV_HASH_M;
}

/** Per-hit drift coefficient: E += kd * (T - E). Drift 0 jumps, Drift 100 reaches ~90 % after 4 hits. */
function dvDriftK(drift) {
    return 1 - 0.56 * dvClamp(drift, 0, 100) / 100;
}

/** @returns {{valid: number, hits: number, reroll: number, serial: number, gate: number, T: number[], E: number[]}} */
function dvNewState() {
    return { valid: 0, hits: 0, reroll: 0, serial: 0, gate: 1, T: [0, 0, 0, 0, 0, 0, 0, 0], E: [0, 0, 0, 0, 0, 0, 0, 0] };
}

/**
 * One draw event. `ev` = "hit" (an onset or a MIDI note) or "reroll" (the Reroll button: a forced draw, no hit).
 * `p` = {v[8], r[8], lock[8] (0|1), chance, seed, drift}, all in the parameters' own units (0..100). Mutates `st`.
 * A hit always advances the hit counter; it draws only when Chance lets it (the first hit always draws). Every hit and
 * every reroll then moves the drifted values E toward the target T. Locked metas keep their previous draw.
 * @returns {{gate: number, drew: number, idx: number}}
 */
function dvStep(st, p, ev) {
    var k = Math.floor(p.seed + 0.5);
    var idx, gate = 1, drew = 1, i;
    if (!st.valid) {
        for (i = 0; i < 8; i++) {
            st.T[i] = dvClamp(p.v[i], 0, 100);
            st.E[i] = st.T[i];
        }
    }
    if (ev === "reroll") {
        st.reroll++;
        idx = st.hits * 4096 + (st.reroll % 4096);
    } else {
        idx = st.hits * 4096 + (st.reroll % 4096);
        gate = !st.valid ? 1 : (dvHash(idx, k, 8) * 100 < p.chance ? 1 : 0);
        drew = gate;
        st.hits++;
        st.gate = gate;
    }
    if (drew) {
        for (i = 0; i < 8; i++) {
            if (st.valid && p.lock[i]) continue;
            st.T[i] = dvClamp(p.v[i] + (2 * dvHash(idx, k, i) - 1) * p.r[i], 0, 100);
        }
        st.valid = 1;
        st.serial++;
    }
    var kd = dvDriftK(p.drift);
    for (i = 0; i < 8; i++) st.E[i] += kd * (st.T[i] - st.E[i]);
    return { gate: gate, drew: drew, idx: idx };
}

/** Telemetry view of the draw state: before the first draw the metas show the clamped Values. */
function dvDrawn(st, p) {
    var e = [], t = [];
    for (var i = 0; i < 8; i++) {
        e.push(st.valid ? st.E[i] : dvClamp(p.v[i], 0, 100));
        t.push(st.valid ? st.T[i] : dvClamp(p.v[i], 0, 100));
    }
    return { E: e, T: t };
}

/** Default parameter values as a draw parameter set. */
function dvDefaultDrawParams() {
    var p = { v: [], r: [], lock: [0, 0, 0, 0, 0, 0, 0, 0], chance: 100, seed: 0, drift: 0 };
    for (var i = 0; i < 8; i++) {
        p.v.push(DV_PARAMS[i][5]);
        p.r.push(DV_PARAMS[8 + i][5]);
    }
    return p;
}

// ---- Ring law, windows -------------------------------------------------------------------------------------------
/** Tail time constant in seconds for Ring 0..100 (60 dB-ish decay at Tr). */
function dvRingTr(ring) {
    return DV_RING_TR_MIN * Math.pow(DV_RING_TR_MAX / DV_RING_TR_MIN, dvClamp(ring, 0, 100) / 100);
}

/** Output envelope of the effect residue `age` seconds after a hit: hold 150 ms, exponential to -66 dB at Tr, 20 ms fade to exact 0. */
function dvRingEnv(age, Tr) {
    if (age < 0) return 0;
    if (age <= DV_RING_HOLD_S) return 1;
    var end = DV_RING_HOLD_S + Tr;
    if (age <= end) return Math.pow(10, -3.3 * (age - DV_RING_HOLD_S) / Tr);
    var e0 = Math.pow(10, -3.3);
    var f = 1 - (age - end) / DV_RING_FADE_S;
    return f > 0 ? e0 * f : 0;
}

function dvSmooth(x) {
    var u = dvClamp(x, 0, 1);
    return u * u * (3 - 2 * u);
}

/** Time windows after a hit: gT (transient, 1 -> 0 over wT ms), gR (long, 0 -> 1 over wR ms), gB = 1 - gT - gR >= 0. */
function dvWindows(ageSec, wT, wR) {
    var gT = 1 - dvSmooth(ageSec * 1000 / Math.max(wT, 1));
    var gR = dvSmooth(ageSec * 1000 / Math.max(wR, 1));
    var gB = Math.max(0, 1 - gT - gR);
    return { gT: gT, gB: gB, gR: gR };
}

// ---- hidden parameters -------------------------------------------------------------------------------------------
// Each row maps one meta (0..100, drifted E; discrete rows use the undrifted draw T) to one hidden parameter of one effect.
// curve: lin | log | step (integer lo..hi, n = hi - lo + 1 equal bins) | abs50 (bipolar: min(1, 4 |2u - 1|), 0 at u = 0.5).
// kind: A = amount (value at meta 0 is neutral = the effect is off; Pitch: neutral at 50), C = character, D = discrete (step).
// jit: per-slot deterministic jitter of the meta (u scaled by 1 + jit (2 hash(slot) - 1)), 0 for rows that must stay exact.
// The DSP lane may append rows (slot = index; scope slot DV_SCOPE.HIDDEN + index, 64 available).
var DV_HIDDEN = [
    { id: "snap_amt", chain: "T", fx: "snap", meta: 0, curve: "lin", lo: 0, hi: 1, kind: "A", jit: 0.08 },
    { id: "click_lvl", chain: "T", fx: "click", meta: 0, curve: "lin", lo: 0, hi: 0.9, kind: "A", jit: 0.1 },
    { id: "click_hz", chain: "T", fx: "click", meta: 0, curve: "log", lo: 1800, hi: 7500, kind: "C", jit: 0.1 },
    { id: "tfilt_hz", chain: "T", fx: "filt", meta: 0, curve: "log", lo: 20, hi: 1800, kind: "A", jit: 0.1 },
    { id: "win_t_ms", chain: "T", fx: "win", meta: 0, curve: "lin", lo: 20, hi: 10, kind: "C", jit: 0.05 },
    { id: "pitch_st", chain: "B", fx: "pitch", meta: 1, curve: "lin", lo: -12, hi: 12, kind: "A", jit: 0 },
    { id: "pitch_wet", chain: "B", fx: "pitch", meta: 1, curve: "abs50", lo: 0, hi: 1, kind: "A", jit: 0 },
    { id: "grain_ms", chain: "B", fx: "pitch", meta: 1, curve: "lin", lo: 90, hi: 40, kind: "C", jit: 0.1 },
    { id: "res_wet", chain: "B", fx: "res", meta: 2, curve: "lin", lo: 0, hi: 0.85, kind: "A", jit: 0.08 },
    { id: "res_f0", chain: "B", fx: "res", meta: 2, curve: "log", lo: 70, hi: 420, kind: "C", jit: 0.12 },
    { id: "res_stretch", chain: "B", fx: "res", meta: 2, curve: "lin", lo: 1, hi: 2.4, kind: "C", jit: 0.1 },
    { id: "comb_wet", chain: "B", fx: "comb", meta: 2, curve: "lin", lo: 0, hi: 0.7, kind: "A", jit: 0.1 },
    { id: "comb_hz", chain: "B", fx: "comb", meta: 2, curve: "log", lo: 110, hi: 1400, kind: "C", jit: 0.1 },
    { id: "form_wet", chain: "B", fx: "form", meta: 2, curve: "lin", lo: 0, hi: 0.9, kind: "A", jit: 0.12 },
    { id: "form_vowel", chain: "B", fx: "form", meta: 2, curve: "step", lo: 0, hi: 4, kind: "D", jit: 0.15 },
    { id: "win_r_ms", chain: "B", fx: "win", meta: 2, curve: "lin", lo: 180, hi: 120, kind: "C", jit: 0.05 },
    { id: "phas_wet", chain: "B", fx: "phas", meta: 3, curve: "lin", lo: 0, hi: 0.8, kind: "A", jit: 0.1 },
    { id: "phas_hz", chain: "B", fx: "phas", meta: 3, curve: "log", lo: 0.15, hi: 7, kind: "C", jit: 0.12 },
    { id: "chor_wet", chain: "L", fx: "chor", meta: 3, curve: "lin", lo: 0, hi: 0.7, kind: "A", jit: 0.1 },
    { id: "chor_hz", chain: "L", fx: "chor", meta: 3, curve: "log", lo: 0.2, hi: 5, kind: "C", jit: 0.12 },
    { id: "chor_ms", chain: "L", fx: "chor", meta: 3, curve: "lin", lo: 4, hi: 18, kind: "C", jit: 0.1 },
    { id: "conv_wet", chain: "L", fx: "conv", meta: 4, curve: "lin", lo: 0, hi: 0.9, kind: "A", jit: 0.08 },
    { id: "conv_ir", chain: "L", fx: "conv", meta: 4, curve: "step", lo: 0, hi: 9, kind: "D", jit: 0 },
    { id: "rev_wet", chain: "L", fx: "rev", meta: 4, curve: "lin", lo: 0, hi: 0.8, kind: "A", jit: 0.1 },
    { id: "rev_size", chain: "L", fx: "rev", meta: 4, curve: "lin", lo: 0.2, hi: 1, kind: "C", jit: 0.08 },
    { id: "dly_wet", chain: "L", fx: "dly", meta: 5, curve: "lin", lo: 0, hi: 0.7, kind: "A", jit: 0.1 },
    { id: "dly_ms", chain: "L", fx: "dly", meta: 5, curve: "log", lo: 45, hi: 480, kind: "C", jit: 0.1 },
    { id: "dly_fb", chain: "L", fx: "dly", meta: 5, curve: "lin", lo: 0.1, hi: 0.72, kind: "C", jit: 0.08 },
    { id: "slap_wet", chain: "L", fx: "slap", meta: 5, curve: "lin", lo: 0, hi: 0.6, kind: "A", jit: 0.1 },
    { id: "drive_amt", chain: "T", fx: "drive", meta: 6, curve: "lin", lo: 0, hi: 0.9, kind: "A", jit: 0.08 },
    { id: "crush_wet", chain: "T", fx: "crush", meta: 6, curve: "lin", lo: 0, hi: 0.8, kind: "A", jit: 0.1 },
    { id: "crush_bits", chain: "T", fx: "crush", meta: 6, curve: "step", lo: 0, hi: 8, kind: "D", jit: 0 },
    { id: "ring_wet", chain: "B", fx: "ring", meta: 6, curve: "lin", lo: 0, hi: 0.7, kind: "A", jit: 0.12 },
    { id: "ring_hz", chain: "B", fx: "ring", meta: 6, curve: "log", lo: 70, hi: 1500, kind: "C", jit: 0.1 },
    { id: "sat_amt", chain: "B", fx: "sat", meta: 6, curve: "lin", lo: 0, hi: 0.9, kind: "A", jit: 0.08 },
    { id: "tr_s", chain: "L", fx: "ring", meta: 7, curve: "log", lo: 0.05, hi: 1.83, kind: "C", jit: 0 },
];
var DV_HIDDEN_COUNT = DV_HIDDEN.length;
/** hidden id -> row index */
var DV_HIDDEN_INDEX = {};
(function () {
    for (var i = 0; i < DV_HIDDEN.length; i++) DV_HIDDEN_INDEX[DV_HIDDEN[i].id] = i;
})();
/** The effect ids the DSP implements (one gen module each) and the chain that carries them. */
var DV_EFFECTS = (function () {
    var out = {};
    for (var i = 0; i < DV_HIDDEN.length; i++) {
        var r = DV_HIDDEN[i];
        if (r.fx === "win" || (r.fx === "ring" && r.id === "tr_s")) continue;
        out[r.fx] = r.chain;
    }
    return out;
})();

/** Per-slot jitter factor (deterministic: the same in JS and in the generated GenExpr). */
function dvJitter(slot) {
    var j = DV_HIDDEN[slot].jit;
    return j ? 1 + j * (2 * dvHash(slot, 7, 3) - 1) : 1;
}

function dvCurve(row, u) {
    switch (row.curve) {
        case "lin": return row.lo + (row.hi - row.lo) * u;
        case "log": return row.lo * Math.pow(row.hi / row.lo, u);
        case "abs50": return row.lo + (row.hi - row.lo) * Math.min(1, 4 * Math.abs(2 * u - 1));
        default: {
            var n = row.hi - row.lo + 1;
            return row.lo + Math.min(n - 1, Math.floor(u * n));
        }
    }
}

/**
 * The hidden values for the 8 drifted metas `E` and the 8 undrifted draws `T` (both 0..100). Discrete rows (kind D) read T.
 * @returns {Float64Array}
 */
function dvHiddenFromMetas(E, T) {
    var out = new Float64Array(DV_HIDDEN.length);
    for (var i = 0; i < DV_HIDDEN.length; i++) {
        var r = DV_HIDDEN[i];
        var m = (r.kind === "D" ? T : E)[r.meta];
        var u = dvClamp(m * 0.01 * dvJitter(i), 0, 1);
        out[i] = dvCurve(r, u);
    }
    return out;
}

/** The values the hidden rows have at meta 0 (Pitch: at 50) = the neutral, effect-off state. */
function dvHiddenNeutral() {
    var E = [0, 0, 0, 0, 0, 0, 0, 0];
    E[DV_PITCH_META] = 50;
    return dvHiddenFromMetas(E, E);
}

function dvNum(x) {
    var s = String(x);
    return /^-?\d+$/.test(s) ? s + ".0" : s;
}

/**
 * The GenExpr function `dv_hidden(mE, mT, hv)` generated from DV_HIDDEN: mE / mT are Data(8) (drifted metas, undrifted draws),
 * hv a Data(64) that receives the hidden values. One variable set, no `if`, literals only, a single `return 0` (a gen function without a return value fails to compile) (so tests/genexpr_functions.js can run it).
 */
function dvHiddenGen() {
    // One statement per row (Max 9 stops compiling a function with ~66 chained assignments: measured, see AGENTS 30): the 16 metas are
    // read into locals first, every row is a single poke of one expression.
    var L = ["dv_hidden(mE, mT, hv) {"];
    var i;
    for (i = 0; i < 8; i++) L.push("\tme" + i + " = peek(mE, " + i + ");");
    for (i = 0; i < 8; i++) L.push("\tmt" + i + " = peek(mT, " + i + ");");
    for (i = 0; i < DV_HIDDEN.length; i++) {
        var r = DV_HIDDEN[i];
        var m = (r.kind === "D" ? "mt" : "me") + r.meta;
        var u = "clip(" + m + " * 0.01 * " + dvNum(dvJitter(i)) + ", 0, 1)";
        var expr;
        if (r.curve === "lin") expr = dvNum(r.lo) + " + " + dvNum(r.hi - r.lo) + " * " + u;
        else if (r.curve === "log") expr = dvNum(r.lo) + " * pow(" + dvNum(r.hi / r.lo) + ", " + u + ")";
        else if (r.curve === "abs50") expr = dvNum(r.lo) + " + " + dvNum(r.hi - r.lo) + " * min(1, 4 * abs(2 * " + u + " - 1))";
        else {
            var n = r.hi - r.lo + 1;
            expr = dvNum(r.lo) + " + min(" + dvNum(n - 1) + ", floor(" + u + " * " + dvNum(n) + "))";
        }
        L.push("\t// " + i + " " + r.id + " (" + r.chain + " " + r.fx + ", meta " + r.meta + ", " + r.curve + ")");
        L.push("\tpoke(hv, " + expr + ", " + i + ");");
    }
    L.push("\treturn 0;");
    L.push("}");
    return L.join("\n");
}

// ---- state blob (DeviateStateData) -------------------------------------------------------------------------------
// [1, flags, reroll, 0 (reserved), T0..T7 x100, E0..E7 x100, then tagged sections: tag, faceId, n, n ints ...]
// flags bit 0 = a draw exists (valid). Unknown trailing sections are kept so presets interchange across faces.
var DV_BLOB_VERSION = 1;

/**
 * @param {{valid: number, reroll: number, T: number[], E: number[]}} st
 * @param {Array<{tag: string, face: string, vals: number[]}>} [sections]
 */
function dvBlobEncode(st, sections) {
    /** @type {Array<number | string>} */
    var a = [DV_BLOB_VERSION, st.valid ? 1 : 0, Math.max(0, Math.floor(st.reroll || 0)), 0];
    var i;
    for (i = 0; i < 8; i++) a.push(Math.round(dvClamp(st.T[i], 0, 100) * 100));
    for (i = 0; i < 8; i++) a.push(Math.round(dvClamp(st.E[i], 0, 100) * 100));
    (sections || []).forEach(function (s) {
        var vals = (s.vals || []).map(function (v) { return Math.round(Number(v) || 0); });
        a.push(String(s.tag), String(s.face), vals.length);
        for (var k = 0; k < vals.length; k++) a.push(vals[k]);
    });
    return a;
}

/** @returns {{valid: number, reroll: number, T: number[], E: number[], sections: Array<{tag: string, face: string, vals: number[]}>} | null} null = defaults */
function dvBlobDecode(arr) {
    if (!arr || typeof arr.length !== "number" || arr.length < 20) return null;
    var a = Array.prototype.slice.call(arr);
    if (Number(a[0]) !== DV_BLOB_VERSION) return null;
    for (var i = 1; i < 20; i++) if (!isFinite(Number(a[i]))) return null;
    var T = [], E = [];
    for (var k = 0; k < 8; k++) {
        T.push(dvClamp(Number(a[4 + k]) / 100, 0, 100));
        E.push(dvClamp(Number(a[12 + k]) / 100, 0, 100));
    }
    var out = { valid: (Number(a[1]) & 1) ? 1 : 0, reroll: Math.max(0, Math.floor(Number(a[2]))), T: T, E: E, sections: [] };
    var p = 20;
    while (p + 2 < a.length) {
        var n = Number(a[p + 2]);
        if (typeof a[p] !== "string" || !(n >= 0) || n !== Math.floor(n) || p + 3 + n > a.length) break;
        var vals = [];
        for (var j = 0; j < n; j++) vals.push(Number(a[p + 3 + j]) || 0);
        out.sections.push({ tag: a[p], face: String(a[p + 1]), vals: vals });
        p += 3 + n;
    }
    return out;
}

// ---- preview telemetry -------------------------------------------------------------------------------------------
/**
 * A deterministic, representative scope buffer for scripts/render_deviate_previews.py and the tests.
 * state: "idle" | "hit" | "ring" | "extreme" or {kind, spectral, gate, seed, ageMs}.
 * idle: DSP running, nothing playing; hit: 30 ms after a hit (all peaks high, new draw); ring: 600 ms into the tail;
 * extreme: every meta 0 / 100 alternating, peaks at 1, the Chance-rejected hit.
 * @returns {Float32Array}
 */
function dvPreviewTel(state) {
    var o = typeof state === "string" ? { kind: state } : (state || { kind: "idle" });
    var kind = o.kind || "idle";
    var rng = dvRng(o.seed === undefined ? 4242 : o.seed);
    var s = new Float32Array(DV_SCOPE_SAMPS);
    var S = DV_SCOPE, i;
    s[S.FRAMES] = 100; s[S.SR] = 48000; s[S.ALIVE] = 100; s[S.SPLIT_MODE] = o.spectral ? 1 : 0;
    s[S.LATENCY] = dvLatency(o.spectral ? 1 : 0);
    var p = dvDefaultDrawParams();
    p.seed = 7;
    var st = dvNewState();
    var metas, draws, ageMs, hit = kind !== "idle";
    if (hit) {
        dvStep(st, p, "hit"); dvStep(st, p, "hit"); dvStep(st, p, "reroll");
    }
    if (kind === "extreme") {
        metas = [100, 0, 100, 0, 100, 0, 100, 0];
        draws = [0, 100, 0, 100, 0, 100, 0, 100];
    } else {
        var d = dvDrawn(st, p);
        metas = d.E; draws = d.T;
    }
    ageMs = o.ageMs !== undefined ? o.ageMs : kind === "hit" ? 30 : kind === "ring" ? 600 : kind === "extreme" ? 12 : -1;
    s[S.HITS] = hit ? 3 : 0;
    s[S.DRAW_SERIAL] = hit ? st.serial : 0;
    s[S.REROLL] = hit ? st.reroll : 0;
    s[S.HIT_GATE] = kind === "extreme" || o.gate === 0 ? 0 : 1;
    s[S.HIT_SRC] = 0;
    s[S.ONSET_AGE] = ageMs;
    var Tr = dvRingTr(metas[DV_RING_META]);
    s[S.TR_S] = Tr;
    var age = Math.max(0, ageMs) / 1000;
    var env = hit ? dvRingEnv(age, Tr) : 0;
    s[S.RING_ENV] = env;
    s[S.IR_TAG] = hit ? 3 : 0;
    s[S.FAST] = hit ? 0.35 * env + 0.02 : 0.004;
    s[S.SLOW] = hit ? 0.12 : 0.004;
    s[S.THR] = Math.pow(10, -36 / 20);
    for (i = 0; i < 8; i++) { s[S.METAS + i] = metas[i]; s[S.DRAWS + i] = draws[i]; }
    var w = dvWindows(age, 15, 150);
    var pkT = kind === "extreme" ? 1 : hit ? 0.8 * w.gT + 0.02 : 0.01;
    var pkB = kind === "extreme" ? 1 : hit ? 0.7 * w.gB + 0.02 : 0.01;
    var pkL = kind === "extreme" ? 1 : hit ? 0.55 * env * Math.min(1, w.gR + 0.2) + 0.01 : 0.005;
    s[S.PK_IN] = hit ? 0.8 : 0.03; s[S.PK_T] = pkT; s[S.PK_B] = pkB; s[S.PK_L] = pkL;
    s[S.PK_OUT] = hit ? Math.min(1, 0.9 * (w.gT + w.gB) + pkL * 0.5) : 0.03; s[S.PK_DRY] = s[S.PK_IN];
    s[S.PAGE_APPLIED] = hit ? 3 : 0;
    s[S.WAVE_HEAD] = 40;
    s[S.SPEC_HEAD] = 0;
    var hv = dvHiddenFromMetas(metas, draws);
    for (i = 0; i < hv.length; i++) s[S.HIDDEN + i] = hv[i];
    for (i = 0; i < 8; i++) { s[S.ECHO + DV_ECHO.V + i] = Number(DV_PARAMS[i][5]); s[S.ECHO + DV_ECHO.R + i] = Number(DV_PARAMS[8 + i][5]); }
    s[S.ECHO + DV_ECHO.SENS] = 0.5; s[S.ECHO + DV_ECHO.THR] = -36; s[S.ECHO + DV_ECHO.CHANCE] = 100; s[S.ECHO + DV_ECHO.MIX] = 1;
    s[S.ECHO + DV_ECHO.SEED] = 7;
    // waveform ring: 40 blocks of history ending at WAVE_HEAD, one hit 12 blocks ago (hit) or none
    for (var b = 0; b < DV_WAVE_BLOCKS; b++) {
        var back = (40 - 1 - b + DV_WAVE_BLOCKS) % DV_WAVE_BLOCKS; // blocks before the head
        var o2 = S.WAVE + b * DV_WAVE_STRIDE;
        var since = back - 12; // blocks since the hit (negative = before it)
        var a = hit && since >= 0 && since < 200 ? Math.pow(0.97, since) * (0.6 + 0.3 * rng()) : 0.01 * rng();
        s[o2] = -a; s[o2 + 1] = a; s[o2 + 2] = -a * 0.9; s[o2 + 3] = a * 0.9; s[o2 + 4] = hit && since === 0 ? 1 : 0;
    }
    return s;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        DV_METAS, DV_META_KEYS, DV_FACES, DV_CHAINS, DV_PITCH_META, DV_RING_META, DV_LAT_ENV, DV_LAT_SPEC, DV_PRE, DV_LOCK_AUDIO_MS,
        DV_RING_MAX_S, DV_RING_HOLD_S, DV_RING_FADE_S, DV_RING_TR_MIN, DV_RING_TR_MAX, DV_SPEC_N, DV_SPEC_CH, DV_CTL_SAMPS,
        DV_WAVE_BLOCKS, DV_WAVE_BLOCK_SAMPS, DV_WAVE_STRIDE, DV_SCOPE, DV_SCOPE_SAMPS, DV_ECHO, DV_CTL, DV_IR, DV_CONV,
        DV_PARAMS, DV_PARAM_INDEX, DV_ENGINE_GEN, DV_HIDDEN, DV_HIDDEN_COUNT, DV_HIDDEN_INDEX, DV_EFFECTS, DV_BLOB_VERSION,
        dvClamp, dvRng, dvLatency, DV_HASH_M, dvHash, dvDriftK, dvNewState, dvStep, dvDrawn, dvDefaultDrawParams, dvRingTr, dvRingEnv, dvSmooth,
        dvWindows, dvJitter, dvCurve, dvHiddenFromMetas, dvHiddenNeutral, dvHiddenGen, dvBlobEncode, dvBlobDecode, dvPreviewTel,
    };
}
