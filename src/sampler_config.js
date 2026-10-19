// Better Sampler — Shared Configuration, Polyphonic Voice Allocator, Transient Slicer & Pitch Detector.
//
// Used by src/sampler_ui.js and required by tests/test_sampler.js.

var SAMPLER_MODES = [
    { id: 0, key: "repitch",  label: "REPITCH",  shortLabel: "REP", color: [0.24, 0.84, 0.96], desc: "Classic varispeed pitch & forward/ping-pong crossfade loop" },
    { id: 1, key: "cycles",   label: "CYCLES",   shortLabel: "CYC", color: [0.76, 0.46, 0.98], desc: "Phase-locked wavetable cycle scanner with Formant shifting" },
    { id: 2, key: "textures", label: "TEXTURES", shortLabel: "TEX", color: [0.30, 0.90, 0.58], desc: "Dual overlapping Hann-windowed granular cloud engine" },
    { id: 3, key: "slice",    label: "SLICE",    shortLabel: "SLC", color: [0.98, 0.62, 0.24], desc: "Transient & grid slicer mapped chromatically from C1 (MIDI 36)" }
];

var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToNoteName(midi) {
    var m = Math.max(0, Math.min(127, Math.round(Number(midi) || 60)));
    var pc = ((m % 12) + 12) % 12;
    var oct = Math.floor(m / 12) - 2;
    return NOTE_NAMES[pc] + oct;
}

// Compute dynamic multi-panel layout for any of the 3 UI variants ("standard", "compact", "expanded")
// when collapsible panels (Filter/Amp, Mod/Unison) are toggled on or off.
function computeSamplerDynamicLayout(variant, showFiltAmp, showModUni) {
    var v = variant || "standard";
    var faOn = showFiltAmp ? 1 : 0;
    var muOn = showModUni ? 1 : 0;

    var baseLeftW = 304.0;
    var playStripW = 116.0;
    var filtAmpW = 148.0;
    var modUniW = 128.0;

    if (v === "compact") {
        baseLeftW = 248.0;
        playStripW = 104.0;
        filtAmpW = 132.0;
        modUniW = 114.0;
    } else if (v === "expanded") {
        baseLeftW = 336.0;
        playStripW = 124.0;
        filtAmpW = 160.0;
        modUniW = 144.0;
    }

    var curX = 6.0 + baseLeftW + 4.0 + playStripW + 4.0;
    var filtAmpX = curX;
    if (faOn) {
        curX += filtAmpW + 4.0;
    }
    var modUniX = curX;
    if (muOn) {
        curX += modUniW + 4.0;
    }
    var deviceWidth = curX + 2.0;

    return {
        variant: v,
        showFiltAmp: faOn,
        showModUni: muOn,
        baseLeftW: baseLeftW,
        playStripW: playStripW,
        filtAmpX: filtAmpX,
        filtAmpW: filtAmpW,
        modUniX: modUniX,
        modUniW: modUniW,
        deviceWidth: deviceWidth
    };
}

// Transient & Grid Slicer on a downsampled waveform peak envelope (0..1 array).
// Returns sorted normalized slice start positions in [0..1), always starting with 0.0.
function detectTransientSlices(peaks, sensitivity, maxSlices) {
    var cap = Math.max(2, Math.min(32, maxSlices || 16));
    if (!peaks || peaks.length < 8) {
        return [0.0, 0.25, 0.5, 0.75];
    }
    var sensIn = Number(sensitivity);
    var sens = isFinite(sensIn) ? Math.max(0.0, Math.min(1.0, sensIn)) : 0.65;
    var n = peaks.length;

    // Compute positive first-difference flux
    var diffs = new Array(n);
    var maxDiff = 1e-5;
    for (var i = 0; i < n; i++) {
        var prev = (i > 0) ? Math.abs(peaks[i - 1]) : 0.0;
        var cur = Math.abs(peaks[i]);
        var d = Math.max(0.0, cur - prev);
        diffs[i] = d;
        if (d > maxDiff) maxDiff = d;
    }

    var thresh = maxDiff * (0.58 - sens * 0.48);
    var minGapBins = Math.max(2, Math.floor(n / (cap * 1.4)));
    var candidates = [];

    for (var j = minGapBins; j < n - minGapBins; j++) {
        var v = diffs[j];
        if (v >= thresh && v >= diffs[j - 1] && v >= diffs[j + 1]) {
            candidates.push({ bin: j, norm: j / n, score: v });
        }
    }

    // Keep strongest peaks respecting minGapBins
    candidates.sort(function(a, b) { return b.score - a.score; });
    var chosen = [0.0];
    for (var k = 0; k < candidates.length && chosen.length < cap; k++) {
        var cNorm = candidates[k].norm;
        var tooClose = false;
        for (var m = 0; m < chosen.length; m++) {
            if (Math.abs(chosen[m] - cNorm) < (minGapBins / n)) {
                tooClose = true;
                break;
            }
        }
        if (!tooClose) {
            chosen.push(Math.round(cNorm * 10000) / 10000);
        }
    }

    // Fallback to musical grid divisions if signal is steady pad with no sharp transients
    if (chosen.length < 2) {
        var gridCount = Math.max(4, Math.min(16, Math.round(4 + sens * 12)));
        for (var g = 1; g < gridCount; g++) {
            chosen.push(Math.round((g / gridCount) * 10000) / 10000);
        }
    }

    chosen.sort(function(a, b) { return a - b; });
    return chosen;
}

// Autocorrelation / zero-crossing root MIDI note estimator on a mono sample window.
function estimateRootMidiNote(samples, sampleRate) {
    var sr = Math.max(8000, Number(sampleRate) || 44100);
    if (!samples || samples.length < 256) return 60;

    var len = Math.min(samples.length, 4096);
    var rms = 0.0;
    for (var i = 0; i < len; i++) {
        rms += samples[i] * samples[i];
    }
    rms = Math.sqrt(rms / len);
    if (rms < 0.002) return 60;

    var minLag = Math.max(8, Math.floor(sr / 1000.0));  // ~1000 Hz max
    var maxLag = Math.min(Math.floor(len * 0.5), Math.floor(sr / 45.0)); // ~45 Hz min
    var corrs = new Array(maxLag + 1);
    var bestLag = -1;
    var bestCorr = -1.0;

    for (var lag = minLag; lag <= maxLag; lag++) {
        var sum = 0.0;
        var normA = 0.0;
        var normB = 0.0;
        var count = len - lag;
        for (var idx = 0; idx < count; idx += 2) {
            var a = samples[idx];
            var b = samples[idx + lag];
            sum += a * b;
            normA += a * a;
            normB += b * b;
        }
        var denom = Math.sqrt(normA * normB);
        var corr = (denom > 1e-6) ? (sum / denom) : 0.0;
        corrs[lag] = corr;
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    if (bestLag <= 0 || bestCorr < 0.55) return 60;

    // Pick the first local peak that reaches >= 92% of the global maximum correlation
    // so fundamental period is chosen over subharmonic multiples (2T, 3T, ...).
    var peakThresh = bestCorr * 0.92;
    for (var pLag = minLag + 1; pLag < maxLag; pLag++) {
        if (corrs[pLag] >= peakThresh && corrs[pLag] >= corrs[pLag - 1] && corrs[pLag] >= corrs[pLag + 1]) {
            bestLag = pLag;
            break;
        }
    }

    var estHz = sr / bestLag;
    var midi = Math.round(69 + 12 * (Math.log(estHz / 440.0) / Math.LN2));
    return Math.max(24, Math.min(96, midi));
}

// 16-Voice Polyphonic + Mono/Legato Voice Allocator state machine
function createVoiceAllocator(maxVoices) {
    var cap = Math.max(1, Math.min(16, maxVoices || 16));
    var voices = [];
    for (var i = 0; i < 16; i++) {
        var panSeed = ((i % 2 === 0) ? 1 : -1) * (((i >> 1) + 1) / 8.0);
        voices.push({
            index: i,
            gate: 0,
            note: 60,
            vel: 0.0,
            trigCount: 0,
            sliceStart: 0.0,
            sliceEnd: 1.0,
            panSeed: Math.round(panSeed * 1000) / 1000,
            rndSeed: Math.round((((i * 0.61803398875) % 1.0)) * 1000) / 1000,
            age: 0
        });
    }
    var heldStack = [];
    var stepCounter = 1;

    function resolveSliceBounds(note, slices) {
        if (!slices || slices.length === 0) {
            return { start: 0.0, end: 1.0, sliceIdx: 0 };
        }
        var idx = Math.max(0, note - 36) % slices.length;
        var s0 = slices[idx];
        var s1 = (idx + 1 < slices.length) ? slices[idx + 1] : 1.0;
        return { start: s0, end: Math.max(s0 + 0.005, s1), sliceIdx: idx };
    }

    return {
        voices: voices,
        heldStack: heldStack,
        setMaxVoices: function(n) {
            cap = Math.max(1, Math.min(16, Math.round(Number(n) || 16)));
        },
        getMaxVoices: function() {
            return cap;
        },
        noteOn: function(note, vel127, monoLegato, slices) {
            var n = Math.max(0, Math.min(127, Math.round(Number(note) || 60)));
            var vNorm = Math.max(0.01, Math.min(1.0, (Number(vel127) || 100) / 127.0));
            stepCounter++;

            var sl = resolveSliceBounds(n, slices);

            // Track held note stack for mono/legato fallback
            for (var h = heldStack.length - 1; h >= 0; h--) {
                if (heldStack[h].note === n) heldStack.splice(h, 1);
            }
            heldStack.push({ note: n, vel: vNorm, sliceStart: sl.start, sliceEnd: sl.end });

            if (monoLegato || cap === 1) {
                var v0 = voices[0];
                var wasHeld = v0.gate > 0;
                v0.gate = 1;
                v0.note = n;
                v0.vel = vNorm;
                v0.sliceStart = sl.start;
                v0.sliceEnd = sl.end;
                v0.age = stepCounter;
                // In Legato mode (monoLegato == 1), only increment trigCount when no note was held
                if (!wasHeld || !monoLegato) {
                    v0.trigCount = (v0.trigCount + 1) % 100000;
                }
                return v0;
            }

            // 1. Check if same note is already playing -> retrigger that voice
            var target = null;
            for (var i = 0; i < cap; i++) {
                if (voices[i].gate > 0 && voices[i].note === n) {
                    target = voices[i];
                    break;
                }
            }

            // 2. Otherwise pick oldest released voice within [0..cap-1]
            if (!target) {
                var oldestFreeAge = Infinity;
                for (var j = 0; j < cap; j++) {
                    if (voices[j].gate === 0 && voices[j].age < oldestFreeAge) {
                        oldestFreeAge = voices[j].age;
                        target = voices[j];
                    }
                }
            }

            // 3. Voice steal oldest active voice if all cap voices are busy
            if (!target) {
                var oldestActiveAge = Infinity;
                for (var k = 0; k < cap; k++) {
                    if (voices[k].age < oldestActiveAge) {
                        oldestActiveAge = voices[k].age;
                        target = voices[k];
                    }
                }
            }

            target.gate = 1;
            target.note = n;
            target.vel = vNorm;
            target.sliceStart = sl.start;
            target.sliceEnd = sl.end;
            target.trigCount = (target.trigCount + 1) % 100000;
            target.age = stepCounter;
            return target;
        },
        noteOff: function(note, monoLegato) {
            var n = Math.max(0, Math.min(127, Math.round(Number(note) || 60)));
            stepCounter++;

            for (var h = heldStack.length - 1; h >= 0; h--) {
                if (heldStack[h].note === n) heldStack.splice(h, 1);
            }

            var touched = [];
            if (monoLegato || cap === 1) {
                var v0 = voices[0];
                if (heldStack.length > 0) {
                    var prev = heldStack[heldStack.length - 1];
                    v0.gate = 1;
                    v0.note = prev.note;
                    v0.sliceStart = prev.sliceStart;
                    v0.sliceEnd = prev.sliceEnd;
                    touched.push(v0);
                } else if (v0.gate > 0) {
                    v0.gate = 0;
                    v0.age = stepCounter;
                    touched.push(v0);
                }
                return touched;
            }

            for (var i = 0; i < cap; i++) {
                if (voices[i].gate > 0 && voices[i].note === n) {
                    voices[i].gate = 0;
                    voices[i].age = stepCounter;
                    touched.push(voices[i]);
                }
            }
            return touched;
        },
        allNotesOff: function() {
            heldStack.length = 0;
            for (var i = 0; i < 16; i++) {
                voices[i].gate = 0;
            }
            return voices;
        }
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        SAMPLER_MODES: SAMPLER_MODES,
        NOTE_NAMES: NOTE_NAMES,
        midiToNoteName: midiToNoteName,
        computeSamplerDynamicLayout: computeSamplerDynamicLayout,
        detectTransientSlices: detectTransientSlices,
        estimateRootMidiNote: estimateRootMidiNote,
        createVoiceAllocator: createVoiceAllocator
    };
}
