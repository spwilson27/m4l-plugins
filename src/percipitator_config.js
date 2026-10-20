// Shared Percipitator DSP math, 4-frame Sine->Triangle->Saw->Square wavetable generator,
// phase warp modifiers, 12-note scale quantizer, sidechain MIDI chord/harmony tracker,
// spectral tilt, and partial sieve helpers.
// Prepended into src/percipitator_ui.js at build time and exported for Node tests.

const NUM_BANDS = 16;
const WT_FRAMES = 4; // Frame 0: Sine, Frame 1: Triangle, Frame 2: Saw, Frame 3: Square
const WT_FRAME_SIZE = 2048;
const WT_TOTAL_SAMPS = WT_FRAMES * WT_FRAME_SIZE; // 8192 samples
const SCOPE_SAMPS = 36; // 0..15 band amps, 16..31 band MIDI notes, 32..35 telemetry

// 16 log-spaced spectral analysis/resynthesis center frequencies (Hz) from ~92.5 Hz to ~7040 Hz
const BAND_FREQS = [
    92.5, 123.5, 164.8, 220.0, 293.7, 392.0, 523.3, 698.5,
    932.3, 1244.5, 1661.2, 2217.5, 2960.0, 3951.1, 5274.0, 7040.0
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WT_SHAPE_NAMES = ["Sine", "Triangle", "Saw", "Square"];
const WARP_MODES = ["Bend", "Asym", "Sync", "Fold"];
const SIEVE_MODES = ["All", "Odd", "Even", "Sprs", "Rise"];

// Default 12-note scale mask: C Major (2741)
const DEFAULT_SCALE_MASK = (1<<0)|(1<<2)|(1<<4)|(1<<5)|(1<<7)|(1<<9)|(1<<11);

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function dbToLin(db) {
    return Math.pow(10, db / 20);
}

function freqToMidi(hz) {
    return 69 + 12 * Math.log2(Math.max(hz, 20) / 440);
}

function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// Compute a 12-bit pitch-class mask and lowest held MIDI note from a Map/Object of held MIDI notes (note -> velocity).
function computeMidiChordState(heldNotesMap, fallbackMask) {
    let mask = 0;
    let lowestNote = 128;
    let count = 0;
    const keys = Object.keys(heldNotesMap || {});
    for (let i = 0; i < keys.length; i++) {
        const note = Number(keys[i]);
        const vel = heldNotesMap[keys[i]];
        if (vel > 0 && Number.isFinite(note) && note >= 0 && note < 128) {
            const pc = ((Math.round(note) % 12) + 12) % 12;
            mask |= (1 << pc);
            if (note < lowestNote) lowestNote = note;
            count++;
        }
    }
    if (count === 0) {
        return {
            active: false,
            count: 0,
            mask: (fallbackMask | 0) & 0xFFF,
            rootMidi: 60,
        };
    }
    return {
        active: true,
        count,
        mask,
        rootMidi: lowestNote,
    };
}

// Quantize a floating-point MIDI note onto the nearest enabled pitch class in scaleMask (12-bit int),
// searching +/- 11 semitones so even a single enabled note snaps every band across octaves.
function quantizeMidiToScale(rawMidi, scaleMask, snap01) {
    const mask = (scaleMask | 0) & 0xFFF;
    if (mask === 0) return rawMidi;
    const baseNote = Math.round(rawMidi);
    let bestNote = baseNote;
    let bestDist = 99;
    for (let offset = -11; offset <= 11; offset++) {
        const cand = baseNote + offset;
        const pc = ((cand % 12) + 12) % 12;
        if ((mask & (1 << pc)) !== 0) {
            const dist = Math.abs(cand - rawMidi);
            if (dist < bestDist) {
                bestDist = dist;
                bestNote = cand;
            }
        }
    }
    const s = clamp(snap01, 0, 1);
    return rawMidi + (bestNote - rawMidi) * s;
}

// Per-band Partial Sieve gain multiplier matching sieve_gain() in src/percipitator_core.genexpr:
//   0 (All):  all 16 bands active
//   1 (Odd):  odd-indexed bands attenuated, even-indexed bands full (hollow clarinet/formant)
//   2 (Even): even-indexed bands attenuated, odd-indexed bands full
//   3 (Sprs): every 3rd band active (crystalline sparse droplets)
//   4 (Rise): upper harmonic bands emphasized
function computeSieveGain(bandIndex, sieveMode) {
    const m = Math.round(clamp(sieveMode, 0, 4));
    const idx = bandIndex | 0;
    if (m === 0) return 1.0;
    if (m === 1) return (idx % 2 === 0) ? 1.0 : 0.08;
    if (m === 2) return (idx % 2 === 1) ? 1.0 : 0.08;
    if (m === 3) return (idx % 3 === 0) ? 1.15 : 0.04;
    return 0.25 + 0.95 * (idx / Math.max(1, NUM_BANDS - 1));
}

// Per-band Spectral Tilt gain multiplier (tiltBipolar in [-1..+1]):
//   -1.0 (-100%): strongly darkens upper partials (+36 dB low / -36 dB high)
//   +1.0 (+100%): strongly brightens upper partials (-36 dB low / +36 dB high)
function computeTiltGain(bandIndex, tiltBipolar) {
    const t = clamp(tiltBipolar, -1, 1);
    const pos = ((bandIndex / Math.max(1, NUM_BANDS - 1)) - 0.5) * 2.0; // -1..+1
    return Math.pow(2.0, t * pos * 6.0);
}

// Phase warp modifiers matching warp_phase() in src/percipitator_core.genexpr:
//   mode 0 (Bend): pinches or stretches phase toward center
//   mode 1 (Asym): skews duty cycle breakpoint
//   mode 2 (Sync): multiplies phase frequency (1x..5x hard sync)
//   mode 3 (Fold): wraps multiplied phase back and forth (triangle fold)
function warpPhase(phase01, mode, warp01) {
    const p = ((phase01 % 1) + 1) % 1;
    const w = clamp(warp01, 0, 1);
    const m = Math.round(clamp(mode, 0, 3));
    if (m === 0) {
        const exp = Math.pow(3.2, (w - 0.5) * 2.0);
        return Math.pow(p, exp);
    }
    if (m === 1) {
        const bp = 0.5 - w * 0.38;
        if (p < bp) return 0.5 * (p / Math.max(bp, 0.02));
        return 0.5 + 0.5 * ((p - bp) / Math.max(1 - bp, 0.02));
    }
    if (m === 2) {
        const mult = 1.0 + w * 4.0;
        return (p * mult) % 1.0;
    }
    const fmult = 1.0 + w * 3.0;
    const fp = (p * fmult) % 2.0;
    return fp <= 1.0 ? fp : (2.0 - fp);
}

// Generate the 4-frame x 2048-sample "Sine -> Triangle -> Saw -> Square" wavetable:
//   Frame 0: Pure Sine
//   Frame 1: Triangle
//   Frame 2: Band-smoothed Sawtooth
//   Frame 3: Band-smoothed Square
function generateStandardWavetable() {
    const out = new Array(WT_TOTAL_SAMPS);
    const twoPi = Math.PI * 2;
    for (let f = 0; f < WT_FRAMES; f++) {
        const base = f * WT_FRAME_SIZE;
        for (let i = 0; i < WT_FRAME_SIZE; i++) {
            const ph = i / WT_FRAME_SIZE;
            const w = ph * twoPi;
            let v = 0;
            if (f === 0) {
                // Pure Sine
                v = Math.sin(w);
            } else if (f === 1) {
                // Triangle wave (phase-aligned with sine: rises 0..0.25, falls 0.25..0.75, rises 0.75..1)
                if (ph < 0.25) v = ph * 4.0;
                else if (ph < 0.75) v = 2.0 - ph * 4.0;
                else v = ph * 4.0 - 4.0;
            } else if (f === 2) {
                // Sawtooth (16 harmonics with gentle Gibbs Lanczos sigma window)
                for (let h = 1; h <= 16; h++) {
                    const sigma = Math.sin((h * Math.PI) / 17) / ((h * Math.PI) / 17);
                    v += (Math.sin(h * w) / h) * sigma;
                }
            } else {
                // Square (odd harmonics up to 15 with gentle Gibbs window)
                for (let h = 1; h <= 15; h += 2) {
                    const sigma = Math.sin((h * Math.PI) / 16) / ((h * Math.PI) / 16);
                    v += (Math.sin(h * w) / h) * sigma;
                }
            }
            out[base + i] = v;
        }
        // Normalize each frame to peak 0.98 with zero DC offset
        let sum = 0;
        for (let i = 0; i < WT_FRAME_SIZE; i++) sum += out[base + i];
        const dc = sum / WT_FRAME_SIZE;
        let peak = 1e-6;
        for (let i = 0; i < WT_FRAME_SIZE; i++) {
            out[base + i] -= dc;
            if (Math.abs(out[base + i]) > peak) peak = Math.abs(out[base + i]);
        }
        const scale = 0.98 / peak;
        for (let i = 0; i < WT_FRAME_SIZE; i++) {
            out[base + i] *= scale;
        }
    }
    return out;
}

// Sample the 4-frame wavetable (Sine -> Triangle -> Saw -> Square) with phase warp for UI preview & tests
function evalWavetableSample(wtArray, phase01, wtPos01, warpMode, warp01) {
    const warpedPh = warpPhase(phase01, warpMode, warp01);
    const fPos = clamp(wtPos01, 0, 1) * (WT_FRAMES - 1);
    const f0 = Math.min(WT_FRAMES - 1, Math.floor(fPos));
    const f1 = Math.min(WT_FRAMES - 1, f0 + 1);
    const fMix = fPos - f0;
    const idx = clamp(warpedPh, 0, 0.9999) * WT_FRAME_SIZE;
    const i0 = Math.floor(idx) % WT_FRAME_SIZE;
    const i1 = (i0 + 1) % WT_FRAME_SIZE;
    const frac = idx - Math.floor(idx);
    const s0 = wtArray[f0 * WT_FRAME_SIZE + i0] * (1 - frac) + wtArray[f0 * WT_FRAME_SIZE + i1] * frac;
    const s1 = wtArray[f1 * WT_FRAME_SIZE + i0] * (1 - frac) + wtArray[f1 * WT_FRAME_SIZE + i1] * frac;
    return s0 + (s1 - s0) * fMix;
}

// Export through a local so this file stays a global script for the type checker (see AGENTS.md 1c).
var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        NUM_BANDS,
        WT_FRAMES,
        WT_FRAME_SIZE,
        WT_TOTAL_SAMPS,
        SCOPE_SAMPS,
        BAND_FREQS,
        NOTE_NAMES,
        WT_SHAPE_NAMES,
        WARP_MODES,
        SIEVE_MODES,
        DEFAULT_SCALE_MASK,
        clamp,
        dbToLin,
        freqToMidi,
        midiToFreq,
        computeMidiChordState,
        quantizeMidiToScale,
        computeSieveGain,
        computeTiltGain,
        warpPhase,
        generateStandardWavetable,
        evalWavetableSample,
    };
}
