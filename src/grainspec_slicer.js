// Better GrainSpec — Sample synthesis, onset slicing, pitch detection & MIDI mapping.
// Shared between Node.js unit tests and embedded v8ui script.

var GS_MAX_SLICES = 128;
var GS_SLICE_STRIDE = 4; // [startFrame, endFrame, transientFrames, pitchHz]
var GS_SLICE_FLOATS = GS_MAX_SLICES * GS_SLICE_STRIDE; // 512 floats
var GS_STATE_FLOATS = 16; // [playheadNorm, activeSlice, gPos0..3, gEnv0..3, outEnv, transEnv, captureHead, activeFlag, combHz, pitchRatio]

function gsClamp(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

function gsMulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
        var t = (a += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Synthesizes a punchy 2-second (88200 frames @ 44.1 kHz) stereo breakbeat / glitch loop
// with 16 distinct rhythmic events (kicks, snares, hats, FM metallic hits, bass notes)
// so Better GrainSpec plays immediately on load before any external sample is dropped.
function synthesizeDefaultLoop(sr) {
    var sampleRate = sr && sr > 0 ? sr : 44100;
    var durationSec = 2.0;
    var numFrames = Math.floor(sampleRate * durationSec);
    var left = new Array(numFrames);
    var right = new Array(numFrames);
    for (var i = 0; i < numFrames; i++) {
        left[i] = 0;
        right[i] = 0;
    }

    var rand = gsMulberry32(1337);
    var stepSec = durationSec / 16.0; // 16 sixteenth-note steps across 2 seconds (120 BPM 1 bar)
    var stepFrames = Math.floor(stepSec * sampleRate);

    // Pattern of 16 hits:
    // 0: Kick (65 Hz)
    // 1: Hat closed (320 Hz metallic)
    // 2: FM Glitch blip (220 Hz)
    // 3: Bass pluck (110 Hz)
    // 4: Snare (185 Hz + crisp noise)
    // 5: Hat open (420 Hz)
    // 6: Kick syncopated (60 Hz)
    // 7: FM Perc (330 Hz)
    // 8: Kick (65 Hz)
    // 9: Bass pluck (146.8 Hz - D3)
    // 10: Snare ghost + hat (195 Hz)
    // 11: FM Chord stab (261.6 Hz - C4)
    // 12: Snare main (180 Hz)
    // 13: Glitch ratchet (440 Hz)
    // 14: Bass sub (82.4 Hz - E2)
    // 15: Metallic fill (523.25 Hz - C5)
    var pattern = [
        { type: "kick", f0: 65, pan: 0.0 },
        { type: "hat", f0: 320, pan: -0.25 },
        { type: "fm", f0: 220, pan: 0.35 },
        { type: "bass", f0: 110, pan: -0.1 },
        { type: "snare", f0: 185, pan: 0.0 },
        { type: "hat", f0: 420, pan: 0.25 },
        { type: "kick", f0: 60, pan: 0.0 },
        { type: "fm", f0: 330, pan: -0.4 },
        { type: "kick", f0: 65, pan: 0.0 },
        { type: "bass", f0: 146.83, pan: 0.15 },
        { type: "snare", f0: 195, pan: -0.2 },
        { type: "fm", f0: 261.63, pan: 0.3 },
        { type: "snare", f0: 180, pan: 0.0 },
        { type: "fm", f0: 440, pan: -0.35 },
        { type: "bass", f0: 82.41, pan: 0.1 },
        { type: "fm", f0: 523.25, pan: 0.4 }
    ];

    for (var s = 0; s < 16; s++) {
        var ev = pattern[s];
        var start = s * stepFrames;
        var len = Math.min(stepFrames - 8, numFrames - start);
        var ph = 0;
        var modPh = 0;
        for (var k = 0; k < len; k++) {
            var t = k / sampleRate;
            var sig = 0;
            // Sharp click transient in first 4 ms on every hit
            var clickEnv = Math.exp(-t * 650);
            var noise = (rand() * 2 - 1);

            if (ev.type === "kick") {
                var pitchEnv = ev.f0 + 180 * Math.exp(-t * 95);
                ph += (2 * Math.PI * pitchEnv) / sampleRate;
                var bodyEnv = Math.exp(-t * 14);
                sig = Math.sin(ph) * bodyEnv * 0.85 + noise * clickEnv * 0.45;
            } else if (ev.type === "snare") {
                var snFreq = ev.f0 + 90 * Math.exp(-t * 120);
                ph += (2 * Math.PI * snFreq) / sampleRate;
                var toneEnv = Math.exp(-t * 28);
                var noiseEnv = Math.exp(-t * 22);
                sig = Math.sin(ph) * toneEnv * 0.55 + noise * noiseEnv * 0.65;
            } else if (ev.type === "hat") {
                ph += (2 * Math.PI * ev.f0) / sampleRate;
                modPh += (2 * Math.PI * ev.f0 * 2.41) / sampleRate;
                var hatEnv = Math.exp(-t * 42);
                var metal = Math.sin(ph + 2.2 * Math.sin(modPh));
                sig = (metal * 0.4 + noise * 0.6) * hatEnv * 0.7;
            } else if (ev.type === "bass") {
                ph += (2 * Math.PI * ev.f0) / sampleRate;
                var bassEnv = Math.exp(-t * 11);
                var saw = Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.22 * Math.sin(3 * ph);
                sig = Math.tanh(saw * 1.3) * bassEnv * 0.72 + noise * clickEnv * 0.25;
            } else {
                // FM metallic / pitched glitch hit
                ph += (2 * Math.PI * ev.f0) / sampleRate;
                modPh += (2 * Math.PI * ev.f0 * 1.5) / sampleRate;
                var fmEnv = Math.exp(-t * 16);
                var idx = 2.5 * Math.exp(-t * 32);
                sig = Math.sin(ph + idx * Math.sin(modPh)) * fmEnv * 0.75 + noise * clickEnv * 0.35;
            }

            // Short fade-out at the very end of the step to prevent step boundary discontinuity
            var tailFade = k > len - 64 ? (len - k) / 64 : 1.0;
            sig = gsClamp(sig * tailFade, -0.98, 0.98);
            var gL = Math.cos((ev.pan + 1) * 0.25 * Math.PI);
            var gR = Math.sin((ev.pan + 1) * 0.25 * Math.PI);
            left[start + k] = sig * gL;
            right[start + k] = sig * gR;
        }
    }

    return {
        sampleRate: sampleRate,
        numFrames: numFrames,
        left: left,
        right: right
    };
}

// Estimates the fundamental frequency (Hz) of a slice using normalized autocorrelation
// over the tonal body of the slice, clamped to [40, 2000] Hz.
function estimateSlicePitchHz(samples, sr, startFrame, endFrame) {
    var sampleRate = sr && sr > 0 ? sr : 44100;
    var n = samples ? samples.length : 0;
    if (n < 64) return 110;
    var s0 = Math.max(0, Math.min(n - 1, Math.floor(startFrame || 0)));
    var s1 = Math.max(s0 + 1, Math.min(n, Math.floor(endFrame || n)));
    var span = s1 - s0;
    if (span < 64) return 110;

    // Skip the first ~4 ms of noisy click if the slice is long enough
    var skip = Math.min(Math.floor(sampleRate * 0.004), Math.floor(span * 0.15));
    var winStart = s0 + skip;
    var winLen = Math.min(2048, s1 - winStart);
    if (winLen < 64) {
        winStart = s0;
        winLen = Math.min(2048, span);
    }

    var minLag = Math.max(8, Math.floor(sampleRate / 1200)); // max 1200 Hz
    var maxLag = Math.min(Math.floor(winLen * 0.55), Math.floor(sampleRate / 45)); // min 45 Hz
    if (maxLag <= minLag) return 110;

    var energy0 = 0;
    for (var i = 0; i < winLen; i++) {
        var v = samples[winStart + i];
        energy0 += v * v;
    }
    if (energy0 < 1e-8) return 110;

    var bestLag = -1;
    var bestCorr = -1;
    var prevCorr = 0;
    var rising = false;

    for (var lag = minLag; lag <= maxLag; lag++) {
        var sum = 0;
        var eA = 0;
        var eB = 0;
        var limit = winLen - lag;
        for (var j = 0; j < limit; j += 2) {
            var a = samples[winStart + j];
            var b = samples[winStart + j + lag];
            sum += a * b;
            eA += a * a;
            eB += b * b;
        }
        var denom = Math.sqrt(eA * eB);
        var corr = denom > 1e-9 ? sum / denom : 0;

        if (corr > prevCorr && corr > 0.35) {
            rising = true;
        } else if (rising && corr < prevCorr) {
            // First strong local peak in autocorrelation = fundamental period
            var peakLag = lag - 1;
            var peakCorr = prevCorr;
            if (peakCorr > 0.55) {
                bestLag = peakLag;
                bestCorr = peakCorr;
                break;
            }
            if (peakCorr > bestCorr) {
                bestCorr = peakCorr;
                bestLag = peakLag;
            }
            rising = false;
        }
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
        prevCorr = corr;
    }

    if (bestLag <= 0 || bestCorr < 0.15) return 110;
    var hz = sampleRate / bestLag;
    return gsClamp(hz, 40, 2000);
}

// Estimates the sharp transient duration (in frames) at the beginning of a slice
// by measuring where the fast envelope falls below the body RMS level.
function estimateTransientFrames(samples, sr, startFrame, endFrame) {
    var sampleRate = sr && sr > 0 ? sr : 44100;
    var minTrans = Math.floor(sampleRate * 0.006); // 6 ms
    var maxTrans = Math.floor(sampleRate * 0.065); // 65 ms
    var defTrans = Math.floor(sampleRate * 0.022); // 22 ms
    if (!samples || samples.length === 0) return defTrans;

    var s0 = Math.max(0, Math.floor(startFrame || 0));
    var s1 = Math.min(samples.length, Math.floor(endFrame || samples.length));
    var span = s1 - s0;
    if (span <= minTrans * 2) return Math.max(32, Math.floor(span * 0.35));

    var hop = Math.max(16, Math.floor(sampleRate * 0.002)); // 2 ms hops
    var limit = Math.min(span, maxTrans);
    var peakEnv = 0;
    var peakIdx = 0;
    var envs = [];

    for (var offset = 0; offset < limit; offset += hop) {
        var sum = 0;
        var count = Math.min(hop, limit - offset);
        for (var k = 0; k < count; k++) {
            var v = Math.abs(samples[s0 + offset + k]);
            if (v > sum) sum = v;
        }
        envs.push(sum);
        if (sum > peakEnv) {
            peakEnv = sum;
            peakIdx = envs.length - 1;
        }
    }

    if (peakEnv < 1e-5) return defTrans;
    var threshold = peakEnv * 0.32;
    for (var idx = peakIdx + 1; idx < envs.length; idx++) {
        if (envs[idx] <= threshold) {
            return gsClamp(idx * hop, minTrans, Math.min(maxTrans, Math.floor(span * 0.6)));
        }
    }
    return gsClamp(defTrans, minTrans, Math.floor(span * 0.5));
}

// Detects slice onsets using high-frequency energy flux and adaptive thresholding.
// sensitivity is in [0, 1] (or [0, 100] which is auto-normalized if > 1).
// Higher sensitivity monotonically yields >= as many slices as lower sensitivity.
function detectOnsets(samples, sr, sensitivity, maxSlices) {
    var sampleRate = sr && sr > 0 ? sr : 44100;
    var n = samples ? samples.length : 0;
    var cap = gsClamp(Math.floor(maxSlices || GS_MAX_SLICES), 1, GS_MAX_SLICES);
    var sens01 = sensitivity > 1.0001 ? gsClamp(sensitivity / 100, 0, 1) : gsClamp(sensitivity, 0, 1);

    if (n < 256) {
        return [{
            startFrame: 0,
            endFrame: Math.max(1, n),
            transientFrames: Math.max(1, Math.floor(n * 0.25)),
            pitchHz: 110
        }];
    }

    var hop = Math.max(64, Math.floor(sampleRate * 0.004)); // ~4 ms hop
    var numHops = Math.floor(n / hop);
    var flux = new Array(numHops);
    var prevEnergy = 0;
    var maxFlux = 0;

    for (var h = 0; h < numHops; h++) {
        var base = h * hop;
        var e = 0;
        var prevSample = base > 0 ? samples[base - 1] : 0;
        for (var i = 0; i < hop; i++) {
            var s = samples[base + i];
            var diff = s - prevSample; // high-pass pre-emphasis for sharp transients
            e += s * s * 0.35 + diff * diff * 0.65;
            prevSample = s;
        }
        e = Math.sqrt(e / hop);
        var d = e > prevEnergy ? (e - prevEnergy) : 0;
        flux[h] = d;
        if (d > maxFlux) maxFlux = d;
        prevEnergy = e * 0.85 + prevEnergy * 0.15;
    }

    // Min spacing between slices shrinks modestly with sensitivity (from ~90 ms down to ~28 ms)
    var minHopDist = Math.max(4, Math.round((0.090 - 0.062 * sens01) * sampleRate / hop));
    // Threshold drops smoothly as sensitivity increases from 0 -> 1
    var relThresh = maxFlux * (0.62 * Math.pow(1 - sens01, 1.65) + 0.015);

    var onsetFrames = [0];
    var lastHop = 0;

    // Require at least 22 ms between adjacent markers so micro-fluctuations inside a single hit don't double-slice
    var minFrameDist = Math.max(Math.round(sampleRate * 0.022), Math.round(minHopDist * hop * 0.75));
    if (maxFlux > 1e-6 && sens01 > 0.01) {
        for (var j = 1; j < numHops - 1; j++) {
            if (j - lastHop < minHopDist) continue;
            var val = flux[j];
            if (val < relThresh) continue;
            if (val >= flux[j - 1] && val >= flux[j + 1]) {
                // Local minimum refinement: step back a few samples to catch the exact attack start
                var exactFrame = j * hop;
                var lookback = Math.min(exactFrame, hop);
                var minAmp = Math.abs(samples[exactFrame]);
                var bestOffset = 0;
                for (var b = 1; b < lookback; b++) {
                    var a = Math.abs(samples[exactFrame - b]);
                    if (a <= minAmp * 0.5) {
                        minAmp = a;
                        bestOffset = b;
                    }
                }
                var cand = Math.max(0, exactFrame - bestOffset);
                if (cand - onsetFrames[onsetFrames.length - 1] >= minFrameDist) {
                    onsetFrames.push(cand);
                    lastHop = j;
                    if (onsetFrames.length >= cap) break;
                }
            }
        }
    }

    var slices = [];
    for (var idx = 0; idx < onsetFrames.length; idx++) {
        var sFrame = onsetFrames[idx];
        var eFrame = idx + 1 < onsetFrames.length ? onsetFrames[idx + 1] : n;
        if (eFrame <= sFrame) eFrame = Math.min(n, sFrame + 64);
        var tFrames = estimateTransientFrames(samples, sampleRate, sFrame, eFrame);
        var hz = estimateSlicePitchHz(samples, sampleRate, sFrame, eFrame);
        slices.push({
            startFrame: sFrame,
            endFrame: eFrame,
            transientFrames: tFrames,
            pitchHz: Math.round(hz * 100) / 100
        });
    }

    return slices;
}

// Encodes slice table into a flat 512-float array for buffer~ #0-gsslices
function slicesToFloats(slices, totalFrames) {
    var out = new Array(GS_SLICE_FLOATS);
    for (var i = 0; i < GS_SLICE_FLOATS; i++) out[i] = 0;
    var list = slices && slices.length ? slices : [{
        startFrame: 0,
        endFrame: Math.max(1, totalFrames || 44100),
        transientFrames: 1024,
        pitchHz: 110
    }];
    var count = Math.min(GS_MAX_SLICES, list.length);
    for (var s = 0; s < count; s++) {
        var item = list[s];
        var base = s * GS_SLICE_STRIDE;
        out[base + 0] = Math.max(0, Math.floor(item.startFrame || 0));
        out[base + 1] = Math.max(out[base + 0] + 1, Math.floor(item.endFrame || (totalFrames || 44100)));
        out[base + 2] = Math.max(16, Math.floor(item.transientFrames || 1024));
        out[base + 3] = gsClamp(item.pitchHz || 110, 40, 2000);
    }
    return out;
}

// Resolves a MIDI note-on into slice index, playback pitch ratio, and comb filter target Hz.
// keyMode 0 ("128 Slice Map"): All 128 MIDI notes map across detected slices.
//   If sliceCount <= 128, notes starting at C1 (36) or 0 wrap across 0..sliceCount-1,
//   preserving base pitch (pitchRatio = 1) and setting combHz to the slice's detected fundamental.
// keyMode 1 ("Chromatic Pitch"): Plays `selectedSlice` chromatically with root C3 (note 60),
//   scaling both playback pitchRatio and combHz by 2^((note - 60)/12).
function resolveMidiTrigger(note, velocity, keyMode, selectedSlice, slices, pitchSemitones) {
    var nSlices = slices && slices.length ? slices.length : 1;
    var midiNote = gsClamp(Math.round(note || 0), 0, 127);
    var vel = gsClamp(Math.round(velocity == null ? 100 : velocity), 0, 127);
    var tuneSemi = Number(pitchSemitones) || 0;
    var tuneRatio = Math.pow(2, tuneSemi / 12);

    var sliceIdx = 0;
    var pitchRatio = tuneRatio;
    var baseHz = 110;

    if (Number(keyMode) === 1) {
        sliceIdx = gsClamp(Math.floor(selectedSlice || 0), 0, nSlices - 1);
        var sliceObj = slices && slices[sliceIdx] ? slices[sliceIdx] : null;
        baseHz = sliceObj && sliceObj.pitchHz ? sliceObj.pitchHz : 110;
        var noteRatio = Math.pow(2, (midiNote - 60) / 12);
        pitchRatio = noteRatio * tuneRatio;
        return {
            active: vel > 0,
            sliceIndex: sliceIdx,
            velocity01: vel / 127,
            pitchRatio: pitchRatio,
            combHz: gsClamp(baseHz * pitchRatio, 30, 4000)
        };
    }

    // keyMode 0: 128 Slice Map
    sliceIdx = midiNote % nSlices;
    var sObj = slices && slices[sliceIdx] ? slices[sliceIdx] : null;
    baseHz = sObj && sObj.pitchHz ? sObj.pitchHz : 110;
    return {
        active: vel > 0,
        sliceIndex: sliceIdx,
        velocity01: vel / 127,
        pitchRatio: tuneRatio,
        combHz: gsClamp(baseHz * tuneRatio, 30, 4000)
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        GS_MAX_SLICES: GS_MAX_SLICES,
        GS_SLICE_STRIDE: GS_SLICE_STRIDE,
        GS_SLICE_FLOATS: GS_SLICE_FLOATS,
        GS_STATE_FLOATS: GS_STATE_FLOATS,
        gsClamp: gsClamp,
        gsMulberry32: gsMulberry32,
        synthesizeDefaultLoop: synthesizeDefaultLoop,
        estimateSlicePitchHz: estimateSlicePitchHz,
        estimateTransientFrames: estimateTransientFrames,
        detectOnsets: detectOnsets,
        slicesToFloats: slicesToFloats,
        resolveMidiTrigger: resolveMidiTrigger
    };
}
