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

// Slices actually mapped to keys: the first one starts at the sample start point, markers at or
// before it (and at or after the end) drop out, so the slice under C1 always begins at `start`.
var SLICE_MIN_GAP = 0.002;
function activeSliceStarts(markers, start, end) {
    var s = Math.max(0.0, Math.min(1.0, Number(start) || 0.0));
    var e = Math.max(s + SLICE_MIN_GAP, Math.min(1.0, end === undefined ? 1.0 : Number(end)));
    var out = [s];
    var sorted = (markers || []).slice().sort(function (a, b) { return a - b; });
    for (var i = 0; i < sorted.length; i++) {
        var m = Number(sorted[i]);
        if (m > out[out.length - 1] + SLICE_MIN_GAP && m < e - SLICE_MIN_GAP) out.push(m);
    }
    return out;
}

// Index of the active slice containing pos, or -1 outside start..end
function sliceIndexAt(starts, end, pos) {
    if (!starts || starts.length === 0 || pos < starts[0] || pos > end) return -1;
    var idx = 0;
    for (var i = 0; i < starts.length; i++) if (pos >= starts[i]) idx = i;
    return idx;
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
    var sliceBase = 36; // MIDI note of slice 0 (the "from C1" control)

    // slices: sorted slice starts (C1 = slices[0]); slicesEnd: where the last slice stops
    function resolveSliceBounds(note, slices, slicesEnd) {
        if (!slices || slices.length === 0) {
            return { start: 0.0, end: 1.0, sliceIdx: 0 };
        }
        var idx = Math.max(0, note - sliceBase) % slices.length;
        var s0 = slices[idx];
        var s1 = (idx + 1 < slices.length) ? slices[idx + 1] : (slicesEnd === undefined ? 1.0 : slicesEnd);
        return { start: s0, end: Math.max(s0 + 0.005, s1), sliceIdx: idx };
    }

    return {
        voices: voices,
        heldStack: heldStack,
        setSliceBaseNote: function(n) {
            var v = Math.round(Number(n));
            sliceBase = isFinite(v) ? Math.max(0, Math.min(127, v)) : 36;
        },
        getSliceBaseNote: function() { return sliceBase; },
        setMaxVoices: function(n) {
            cap = Math.max(1, Math.min(16, Math.round(Number(n) || 16)));
        },
        getMaxVoices: function() {
            return cap;
        },
        noteOn: function(note, vel127, monoLegato, slices, slicesEnd) {
            var n = Math.max(0, Math.min(127, Math.round(Number(note) || 60)));
            var vNorm = Math.max(0.01, Math.min(1.0, (Number(vel127) || 100) / 127.0));
            stepCounter++;

            var sl = resolveSliceBounds(n, slices, slicesEnd);

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
        // Re-resolve the slice of every held note against new slice starts / end (start point or
        // end dragged during playback). Trigger counters are untouched, so the gen keeps playing.
        updateSliceBounds: function(slices, slicesEnd) {
            var touched = [];
            for (var h = 0; h < heldStack.length; h++) {
                var hb = resolveSliceBounds(heldStack[h].note, slices, slicesEnd);
                heldStack[h].sliceStart = hb.start;
                heldStack[h].sliceEnd = hb.end;
            }
            for (var i = 0; i < 16; i++) {
                if (voices[i].gate <= 0) continue;
                var b = resolveSliceBounds(voices[i].note, slices, slicesEnd);
                if (b.start !== voices[i].sliceStart || b.end !== voices[i].sliceEnd) {
                    voices[i].sliceStart = b.start;
                    voices[i].sliceEnd = b.end;
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

// ---------------------------------------------------------------------------
// Bitwig-style slicers. Every slicer returns sorted normalized marker positions
// in [0, 1) for the WHOLE sample. The start point itself is not returned (the
// keymap always makes the first slice begin at the start point).
// ---------------------------------------------------------------------------

var SLICE_BEAT_NAMES = ["1 bar", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];
// Length of each note value in beats (quarter notes) in 4/4; T = 2/3 of straight.
var SLICE_BEAT_LENGTHS = [4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12];
var SLICE_MAX_BEAT_MARKERS = 256;

function sliceClamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function sliceWindow(start, end, len) {
    var s = Number(start), e = Number(end);
    if (!isFinite(s)) s = 0;
    if (!isFinite(e)) e = 1;
    s = sliceClamp(s, 0, 1);
    e = sliceClamp(e, 0, 1);
    var a = Math.floor(s * len), b = Math.min(len, Math.ceil(e * len));
    return { s: s, e: e, a: a, b: b };
}

// n equal slices between start and end (n = 1..64).
function sliceDivisions(start, end, n) {
    var s = sliceClamp(Number(start) || 0, 0, 1);
    var e = sliceClamp(isFinite(Number(end)) ? Number(end) : 1, 0, 1);
    var cnt = Math.max(1, Math.min(64, Math.round(Number(n) || 1)));
    var out = [];
    if (e <= s) return out;
    for (var k = 0; k < cnt; k++) out.push(s + (e - s) * k / cnt);
    return out;
}

// One marker every note interval from the start point (4/4). Runs to the end of
// the sample (the keymap trims to start..end). Capped at 256 markers.
// bpm <= 0 or invalid falls back to 120.
function sliceBeats(start, end, frames, sampleRate, bpm, beatIndex) {
    var s = sliceClamp(Number(start) || 0, 0, 1);
    var idx = Math.max(0, Math.min(SLICE_BEAT_LENGTHS.length - 1, Math.round(Number(beatIndex) || 0)));
    var b = Number(bpm);
    if (!isFinite(b) || b <= 0) b = 120;
    var f = Number(frames), sr = Number(sampleRate);
    var out = [];
    if (!(f > 0) || !(sr > 0)) return out;
    var interval = (60 / b) * SLICE_BEAT_LENGTHS[idx] * sr / f; // normalized
    if (!(interval > 0)) return out;
    for (var k = 0; k < SLICE_MAX_BEAT_MARKERS; k++) {
        var pos = s + k * interval;
        if (pos >= 1 - 1e-12) break;
        out.push(pos);
    }
    return out;
}

// Tempo from a file name: "172 BPM", "172bpm", "bpm172", "_172_", "DS_PMB_160_vocal".
// Returns 0 when nothing in 60..220 is found.
function bpmFromName(fileName) {
    var name = String(fileName == null ? "" : fileName);
    name = name.replace(/^.*[\/\\]/, "");
    var m = /(?:^|[^0-9])(\d{2,3})(?:\.\d+)?\s*[-_ ]?bpm/i.exec(name);
    if (!m) m = /bpm\s*[-_ ]?(\d{2,3})(?![0-9])/i.exec(name);
    if (m) {
        var v = parseInt(m[1], 10);
        if (v >= 60 && v <= 220) return v;
    }
    var tokens = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").split(/[^A-Za-z0-9]+/);
    for (var i = 0; i < tokens.length; i++) {
        if (/^\d{2,3}$/.test(tokens[i])) {
            var n = parseInt(tokens[i], 10);
            if (n >= 60 && n <= 220) return n;
        }
    }
    return 0;
}

// Transient detection on raw mono sample data: log RMS envelope on a ~2 ms hop,
// flux against the quietest of the previous ~8 ms, level-adaptive threshold,
// >= 30 ms spacing, nothing within 10 ms after the start point.
function sliceOnsets(samples, sampleRate, sensitivity01, start, end) {
    var out = [];
    if (!samples || !(samples.length > 0)) return out;
    var sr = Number(sampleRate) > 0 ? Number(sampleRate) : 44100;
    var sensIn = Number(sensitivity01);
    var sens = isFinite(sensIn) ? sliceClamp(sensIn, 0, 1) : 0.5;
    var len = samples.length;
    var w = sliceWindow(start, end, len);
    var hop = Math.max(8, Math.round(sr * 0.002));
    var nh = Math.floor((w.b - w.a) / hop);
    if (nh < 6) return out;
    var env = new Float64Array(nh);
    var peak = 0;
    for (var i = 0; i < nh; i++) {
        var base = w.a + i * hop, acc = 0;
        for (var j = 0; j < hop; j++) {
            var x = samples[base + j];
            acc += x * x;
        }
        var r = Math.sqrt(acc / hop);
        env[i] = r;
        if (r > peak) peak = r;
    }
    if (peak < 1e-5) return out;
    var floor = peak * 1e-3;
    var lg = new Float64Array(nh);
    for (var k = 0; k < nh; k++) lg[k] = Math.log(Math.max(env[k], floor));

    var thr = 2.4 - 1.8 * sens;                       // nepers rise (~21 dB .. ~5 dB)
    var minLevel = peak * (0.12 - 0.115 * sens);      // ignore bumps far below the loudest part
    var spacing = Math.max(1, Math.round(0.030 * sr / hop));
    var guard = Math.ceil(0.010 * sr / hop);
    var look = 4;
    var lastAt = -spacing;
    var startPos = w.a / len;
    for (var h = 0; h < nh; h++) {
        if (h - lastAt < spacing) continue;
        var ref = h > 0 ? lg[h - 1] : Math.log(floor);
        for (var q = 2; q <= look && h - q >= 0; q++) if (lg[h - q] < ref) ref = lg[h - q];
        var flux = lg[h] - ref;
        if (flux > thr && env[h] > minLevel) {
            lastAt = h;
            if (h * hop < Math.round(0.010 * sr) || h < guard) continue;
            var pos = (w.a + h * hop) / len;
            if (pos > startPos && pos >= w.s && pos < w.e && pos < 1) out.push(pos);
        }
    }
    return out;
}

// YIN pitch (Hz, 0 = unvoiced) of decimated signal d at offset o, window W.
function sliceYin(d, o, W, tauMin, tauMax, diff, cm, fs) {
    var tau, j, delta, sum;
    diff[0] = 0;
    for (tau = 1; tau <= tauMax; tau++) {
        sum = 0;
        for (j = 0; j < W; j++) {
            delta = d[o + j] - d[o + j + tau];
            sum += delta * delta;
        }
        diff[tau] = sum;
    }
    var run = 0;
    cm[0] = 1;
    for (tau = 1; tau <= tauMax; tau++) {
        run += diff[tau];
        cm[tau] = run > 0 ? diff[tau] * tau / run : 1;
    }
    var best = -1;
    for (tau = tauMin; tau < tauMax; tau++) {
        if (cm[tau] < 0.2) {
            while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++;
            best = tau;
            break;
        }
    }
    if (best < 0) return 0;
    var t = best;
    if (best > 1 && best < tauMax) {
        var a = cm[best - 1], b = cm[best], c = cm[best + 1];
        var den = a + c - 2 * b;
        if (den > 1e-12) t = best + 0.5 * (a - c) / den;
    }
    return fs / t;
}

// A marker where the detected pitch changes. YIN on ~8 kHz decimated audio, 20 ms
// hop, 3-frame median on MIDI pitch. A deviation of >= thr semitones from the
// current note held for `hold` frames, or an unvoiced -> voiced transition after
// a gap of >= 2 frames, makes a marker. Sensitivity 0..1: thr 1.8..0.6 st,
// hold 3..1 frames.
function slicePitches(samples, sampleRate, sensitivity01, start, end) {
    var out = [];
    if (!samples || !(samples.length > 0)) return out;
    var sr = Number(sampleRate) > 0 ? Number(sampleRate) : 44100;
    var sensIn = Number(sensitivity01);
    var sens = isFinite(sensIn) ? sliceClamp(sensIn, 0, 1) : 0.5;
    var len = samples.length;
    var w = sliceWindow(start, end, len);
    var dec = Math.max(1, Math.round(sr / 8000));
    var fs = sr / dec;
    var W = 256, tauMin = Math.max(2, Math.floor(fs / 1000)), tauMax = Math.ceil(fs / 70);
    var nd = Math.floor((w.b - w.a) / dec);
    var hopD = Math.max(1, Math.round(0.020 * fs));
    var span = W + tauMax + 1;
    if (nd < span + hopD) return out;
    var d = new Float32Array(nd);
    var gpeak = 0;
    for (var i = 0; i < nd; i++) {
        var acc = 0, base = w.a + i * dec;
        for (var j = 0; j < dec; j++) acc += samples[base + j];
        acc /= dec;
        d[i] = acc;
        var ab = acc < 0 ? -acc : acc;
        if (ab > gpeak) gpeak = ab;
    }
    if (gpeak < 1e-4) return out;
    var nf = Math.floor((nd - span) / hopD) + 1;
    var diff = new Float64Array(tauMax + 2), cm = new Float64Array(tauMax + 2);
    var gate = gpeak * 0.02;
    var midi = new Float64Array(nf);
    for (var f = 0; f < nf; f++) {
        var o = f * hopD, e2 = 0;
        for (var k = 0; k < W; k += 2) e2 += d[o + k] * d[o + k];
        if (Math.sqrt(e2 / (W / 2)) < gate) { midi[f] = NaN; continue; }
        var hz = sliceYin(d, o, W, tauMin, tauMax, diff, cm, fs);
        midi[f] = hz > 0 ? 69 + 12 * Math.log(hz / 440) / Math.LN2 : NaN;
    }
    // 3-frame median over voiced neighbours; unvoiced stays unvoiced.
    var sm = new Float64Array(nf);
    for (var g = 0; g < nf; g++) {
        if (midi[g] !== midi[g]) { sm[g] = NaN; continue; }
        var v = [midi[g]];
        if (g > 0 && midi[g - 1] === midi[g - 1]) v.push(midi[g - 1]);
        if (g + 1 < nf && midi[g + 1] === midi[g + 1]) v.push(midi[g + 1]);
        v.sort(function (x, y) { return x - y; });
        sm[g] = v.length === 3 ? v[1] : (v.length === 2 ? (v[0] + v[1]) * 0.5 : v[0]);
    }
    var thr = 1.8 - 1.2 * sens;
    var hold = Math.max(1, Math.round(3 - 2 * sens));
    var centre = (W * 0.5) * dec; // frame centre offset in input samples
    var startPos = w.a / len;
    function emit(frame) {
        var pos = (w.a + frame * hopD * dec + centre) / len;
        if (pos > startPos && pos >= w.s && pos < w.e && pos < 1) out.push(pos);
    }
    var ref = NaN, segSum = 0, segN = 0;
    var gap = 0, seen = false;
    // leading silence counts as a gap, so the first note after it gets a marker
    var candStart = -1, candRef = NaN, candN = 0;
    for (var t = 0; t < nf; t++) {
        var p = sm[t];
        if (p !== p) { gap++; candStart = -1; candN = 0; continue; }
        if (!seen || gap >= 2) {
            if (gap >= 2) {
                // unvoiced -> voiced: confirm it stays voiced for `hold` frames
                var okc = true;
                for (var c = 1; c < hold; c++) if (t + c >= nf || sm[t + c] !== sm[t + c]) { okc = false; break; }
                if (okc) emit(t);
            }
            seen = true; gap = 0;
            ref = p; segSum = p; segN = 1; candStart = -1; candN = 0;
            continue;
        }
        gap = 0;
        if (Math.abs(p - ref) >= thr) {
            if (candStart >= 0 && Math.abs(p - candRef) < 1) candN++;
            else { candStart = t; candRef = p; candN = 1; }
            if (candN >= hold) {
                emit(candStart);
                ref = p; segSum = p; segN = 1; candStart = -1; candN = 0;
            }
        } else {
            candStart = -1; candN = 0;
            segSum += p; segN++;
            ref = segSum / segN;
            if (segN > 24) { segSum = ref * 12; segN = 12; }
        }
    }
    return out;
}

// Manual markers: both return NEW arrays.
function addSliceMarker(markers, pos) {
    var arr = Array.isArray(markers) ? markers.slice() : [];
    var p = Number(pos);
    if (!isFinite(p) || p < 0 || p >= 1) return arr;
    for (var i = 0; i < arr.length; i++) if (Math.abs(arr[i] - p) < 0.002) return arr;
    arr.push(p);
    arr.sort(function (a, b) { return a - b; });
    return arr;
}

function removeSliceMarker(markers, index) {
    var arr = Array.isArray(markers) ? markers.slice() : [];
    var i = Math.round(Number(index));
    if (isFinite(i) && i >= 0 && i < arr.length) arr.splice(i, 1);
    return arr;
}


// Through a local, so the type checker keeps this file a global script (as Max concatenates it)
// instead of a CommonJS module whose functions sampler_ui.js / sampler_face.js could not see.
var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        SAMPLER_MODES: SAMPLER_MODES,
        NOTE_NAMES: NOTE_NAMES,
        midiToNoteName: midiToNoteName,
        detectTransientSlices: detectTransientSlices,
        activeSliceStarts: activeSliceStarts,
        sliceIndexAt: sliceIndexAt,
        estimateRootMidiNote: estimateRootMidiNote,
        createVoiceAllocator: createVoiceAllocator,
        SLICE_BEAT_NAMES: SLICE_BEAT_NAMES,
        sliceDivisions: sliceDivisions,
        sliceBeats: sliceBeats,
        bpmFromName: bpmFromName,
        sliceOnsets: sliceOnsets,
        slicePitches: slicePitches,
        addSliceMarker: addSliceMarker,
        removeSliceMarker: removeSliceMarker
    };
}
