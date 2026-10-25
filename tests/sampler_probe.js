// Audio probe for scripts/run_sampler_audio_tests.py.
// Fills `#0-bsamp` with a rich synthetic harmonic stereo test waveform, pokes polyphonic/unison
// voice notes into `#0-bsvoices`, records the stereo output of `src/sampler_core.genexpr` into
// `buffer~ rec`, and inspects `#0-bsscope` telemetry.

inlets = 4;
outlets = 3;

var mode = jsarguments.length > 1 ? jsarguments[1] : "repitch_chord";
// Optional 2nd argument: split point in ms. headRms covers [0, cut), afterRms / afterPeak [cut, end).
var cutMs = jsarguments.length > 2 ? Number(jsarguments[2]) : 0;
// Further arguments are key=value options:
//   notes=57,64   MIDI notes triggered together (default: one centred note 60 for single-note cases)
//   slice=0.1:0.5 slice bounds (normalised) written into slots 4/5 of every voice
//   newslice=a:b  bounds a `rebound` message pokes into voice 0
//   src=tone|tone48|sus48|rich48|clicks48   test sample (tone = the legacy 44.1 kHz decaying tone)
//   f0=220        fundamental for the h1..h8 harmonic readout
//   ana=100       start of the spectral analysis window in ms
//   pan=1         use the legacy triad pan seeds
//   src=steps48   Analyzed Root Key test sample: 220 / 330 / 246.94 Hz sine (+ 2nd, 3rd harmonic) in thirds of the
//                 sample, phase continuous; src=glide48: a glide from MIDI 57 to 64 over the whole sample
//   pitch=steps|glide|zero  what the probe writes into the pitch buffer (#0-bspitch, 4096 points of fractional MIDI
//                 over the whole sample); default follows src (steps48 -> steps, glide48 -> glide); zero = unfilled
//   segs=a-b,c-d  analysis windows in ms (from the start of the recording): segHz<k> (dominant frequency, 60..8000
//                 Hz, 32768-point Hann FFT with a log-parabolic peak) and segRms<k> are reported for each
//   cen=261.63 / harm=261.63  also report segCen<k> / segHarm<k> per window (see segReport)
//   wave=sine|saw|pulse|rich  waveform of the steps48 / glide48 / flat48 sources: pure sine, additive saw (1/n up to 24
//                 harmonics), additive 25 % pulse, or (default) sine + 2nd + 3rd harmonic. src=flat48: constant
//                 220 Hz (pitch curve = MIDI 57 exactly)
//   raw=a-b       write the output of the window a..b ms (from the start of the recording) as "l r" text lines to
//                 <resultpath>.raw.txt (the runner reads it with keep_dir; null tests against a reference render)
//   clk=a-b       window (ms) of the click / ripple metrics (see clickReport)
//   start=live    trigger from the setbuffers message instead of the harness event (CPU cases)
//   src=marks44   the same 1 s marks sample at 44.1 kHz (44100 frames): needs `samp_rate 44100` in a 48 kHz harness
//   src=marks48   Cycles timing test sample: 1 s (48000 frames) of a constant 220 Hz sine (pitch curve = MIDI 57) at a
//                 low level with three loud Hann bursts (70 ms wide) centred at 0.20 / 0.45 / 0.80 s of the sample
//   mk=1          report the burst envelope of the output: mkN (bursts found), mkT<k> (burst centre, ms from the start of
//                 the recording) and mkEnd (last time the output is above the sample's low level, ms)
//   Harness `snap t<ms>` events (case["snaps"]) record the loudest voice's playhead (slots 0..15): snp<ms>Pos / snp<ms>Amp
var opt = {};
for (var ai = 3; ai < jsarguments.length; ai++) {
    var tok = String(jsarguments[ai]);
    var eq = tok.indexOf("=");
    if (eq > 0) opt[tok.substring(0, eq)] = tok.substring(eq + 1);
}
function parseSlice(str) {
    if (!str) return null;
    var pr = String(str).split(":");
    return { start: Number(pr[0]), end: Number(pr[1]) };
}

// Per-case voice setup: MIDI notes, slice bounds (normalized), and the bounds a mid-run
// `rebound` message pokes into the held voice (slots 4/5 only, trigger counter untouched).
var SLICE_CFG = {
    slice_trig:       { start: 0.25, end: 0.50 },
    slice_end:        { start: 0.10, end: 0.20 },
    slice_sample_end: { start: 0.10, end: 0.20 },
    slice_loop:       { start: 0.10, end: 0.20 },
    slice_pingpong:   { start: 0.10, end: 0.20 },
    slice_reverse_end: { start: 0.10, end: 0.20 },
    slice_reverse_sample: { start: 0.40, end: 0.50 },
    live_loop:        { start: 0.60, end: 0.70, newStart: 0.10, newEnd: 0.20 },
    live_pingpong:    { start: 0.10, end: 0.50, newStart: 0.10, newEnd: 0.20 },
    live_continue:    { start: 0.00, end: 0.10, newStart: 0.20, newEnd: 0.30 }
};
var SINGLE_NOTE = /^(forward_oneshot|reverse_oneshot|freeze_hold|unison8_wide|mono_sample|pos_)/;
var peaks = { genL: -1, ctl: -1, genR: -1 };
var armed = false;
var sampName = "";
var voicesName = "";
var scopeName = "";
var pitchName = "";
var modJsMap = -1;
var modJsCode = -1;
var modJsWave = -1;
var modJsTy = -1;
var trigSeq = 0;
var resultPath = "/tmp/sampler_audio.txt";

function resultpath(p) { resultPath = String(p); }

// Analyzed Root Key test material (src=steps48 / glide48). 12000 frames at 48 kHz.
var STEP_HZ = [220.0, 330.0, 246.94];
function midiOfHz(f) { return 69.0 + 12.0 * Math.log(f / 440.0) / Math.LN2; }
function hzOfMidi(m) { return 440.0 * Math.pow(2.0, (m - 69.0) / 12.0); }
// MIDI pitch of the test sample at frame f (the exact analyzed curve the face would write)
function testMidiAtFrame(f, frames, kind) {
    if (kind === "glide") return 57.0 + 7.0 * f / frames;
    if (kind === "flat") return midiOfHz(220.0);
    return midiOfHz(STEP_HZ[Math.min(2, Math.floor(f / (frames / 3)))]);
}
function seedPitch() {
    if (!pitchName) return;
    var kind = opt.pitch || (opt.src === "glide48" ? "glide" : (opt.src === "steps48" ? "steps" : ((opt.src === "flat48" || opt.src === "marks48" || opt.src === "marks44") ? "flat" : "none")));
    var vals = new Array(4096);
    for (var i = 0; i < 4096; i++) {
        // point i is position i / 4095 of the whole sample
        vals[i] = (kind === "zero" || kind === "none") ? 0.0 : testMidiAtFrame(i / 4095.0 * 12000.0, 12000.0, kind);
    }
    new Buffer(pitchName).poke(1, 0, vals);
}

function pokeChunk(buf, start, samples) {
    var i = 0;
    while (i < samples.length) {
        var n = Math.min(128, samples.length - i);
        buf.poke(1, start + i, samples.slice(i, i + n));
        i += n;
    }
}

function peek1(buf, index) {
    var v = buf.peek(1, index, 1);
    if (typeof v === "number") return v;
    if (v && v.length) return Number(v[0]);
    return -1;
}

// mod=off leaves the route count at 0. mod=mseg fills slot 4's waveform with 1.
// mod=env makes slot 4 an envelope held at 1. Both route source 4 onto filt_res.
function seedMod(modName, msegName, slotName) {
    var kind = String(opt.mod || "off");
    var wave = new Array(1024);
    var slot = new Array(100);
    var i;
    for (i = 0; i < 1024; i++) wave[i] = 1;
    for (i = 0; i < 100; i++) slot[i] = 0;
    if (kind === "env") {
        slot[3] = 1;
        slot[15] = 1;
        slot[19] = 5000;
        slot[23] = 1;
        slot[27] = 200;
        slot[51] = 1;
    } else {
        slot[3] = 2;
        slot[7] = 1;
        slot[79] = 1;
        slot[87] = 1;
    }
    var route = (kind === "off") ? [0] : [1, 301, 4, 1, 0, 0.95, 0];
    pokeChunk(new Buffer(msegName), 3 * 1024, wave);
    pokeChunk(new Buffer(slotName), 0, slot);
    pokeChunk(new Buffer(modName), 0, route);
    modJsMap = peek1(new Buffer(modName), 0);
    modJsCode = peek1(new Buffer(modName), 1);
    modJsWave = peek1(new Buffer(msegName), 3 * 1024 + 512);
    modJsTy = peek1(new Buffer(slotName), 3);
}

function setbuffers(sName, vName, scName, pName, modName, msegName, slotName) {
    sampName = String(sName || "");
    voicesName = String(vName || "");
    scopeName = String(scName || "");
    pitchName = String(pName || "");
    seedSample();
    seedPitch();
    if (modName) seedMod(String(modName), String(msegName), String(slotName));
    if (opt.start === "live") { trigSeq += 1; seedVoices(); }
}

function modReport() {
    var txt = "";
    if (scopeName) {
        var c = [];
        try { c = new Buffer(scopeName).peek(1, 228, 6) || []; } catch (e) { c = []; }
        if (typeof c === "number") c = [c];
        var keys = ["mxRoutes", "mxSig", "mxRes", "mxMap", "mxTy", "mxWave"];
        for (var i = 0; i < keys.length; i++) txt += keys[i] + " " + (c[i] === undefined ? -1 : c[i]) + "\n";
    }
    if (opt.mod) txt += "jsMap " + modJsMap + "\njsCode " + modJsCode + "\njsWave " + modJsWave + "\njsTy " + modJsTy + "\n";
    return txt;
}

// Sent by the harness `events` list at the start of the measured window.
function trigger() {
    trigSeq += 1;
    seedVoices();
}

// Harness `events` entry: release voice 0 (gate off, trigger counter untouched).
function release() {
    if (!voicesName) return;
    new Buffer(voicesName).poke(1, 0, [0.0]);
}

// Harness `events` entry: move the held slice live (slots 4/5 of voice 0 only).
function rebound() {
    var cfg = SLICE_CFG[mode];
    var ns = parseSlice(opt.newslice);
    if (ns) cfg = { newStart: ns.start, newEnd: ns.end };
    if (!voicesName || !cfg || cfg.newStart === undefined) return;
    new Buffer(voicesName).poke(1, 4, [cfg.newStart, cfg.newEnd]);
}

function seedSample() {
    if (!sampName || !voicesName) return;
    var sb = new Buffer(sampName);
    // Short dual-mono tone with a steep decay. Reverse can walk from the quiet
    // tail back into the attack inside one rendered window, and stereo width
    // comes from unison rather than from a baked-in L/R difference.
    var wantFrames = (opt.src === "marks48") ? 48000 : ((opt.src === "marks44") ? 44100 : ((opt.src === "real48") ? Math.round(48000 * Number(opt.len || 8)) : 12000));
    sb.send("sizeinsamps", wantFrames);
    var frames = sb.framecount() || wantFrames;
    if (frames > wantFrames) frames = wantFrames;
    var ch1 = new Array(frames);
    var ch2 = new Array(frames);
    var src = opt.src || "tone";
    var sr0 = (src === "tone" || src === "marks44") ? 44100.0 : 48000.0;
    var rdPhs = 0.0;
    realSrc = (src === "real48") ? genReal(frames, sr0) : null;
    for (var i = 0; i < frames; i++) {
        var t = i / sr0;
        var env = Math.min(1.0, i / 32.0) * Math.exp(-i / 3500.0);
        if (src === "sus48" || src === "rich48" || src === "slices4" || src === "steps48" || src === "glide48" || src === "flat48" || src === "marks48" || src === "marks44") env = Math.min(1.0, i / 32.0);
        var w = 0;
        if (realSrc) {
            w = realSrc[i];
        } else if (src === "marks48" || src === "marks44") {
            // constant 220 Hz sine, low level, three Hann bursts (centres 0.20 / 0.45 / 0.80 s, 70 ms wide)
            rdPhs += 2.0 * Math.PI * 220.0 / sr0;
            var mkAmp = 0.12;
            var mkCs = [0.20, 0.45, 0.80];
            for (var mc = 0; mc < 3; mc++) {
                var mkD = (t - mkCs[mc]) / 0.035;
                if (Math.abs(mkD) < 1.0) mkAmp += 0.55 * (0.5 + 0.5 * Math.cos(Math.PI * mkD));
            }
            w = mkAmp * Math.sin(rdPhs);
        } else if (src === "steps48" || src === "glide48" || src === "flat48") {
            // Pitch moves over the sample; the phase is accumulated so the steps have no click.
            var rdHz = hzOfMidi(testMidiAtFrame(i, frames, src === "glide48" ? "glide" : (src === "flat48" ? "flat" : "steps")));
            rdPhs += 2.0 * Math.PI * rdHz / sr0;
            var wv = opt.wave || "rich";
            if (wv === "sine") {
                w = 0.55 * Math.sin(rdPhs);
            } else if (wv === "saw") {
                for (var sn = 1; sn <= 24; sn++) w += 0.3 / sn * Math.sin(sn * rdPhs);
            } else if (wv === "pulse") {
                // 25 % pulse: a_n = sin(n pi / 4) / n, so H2 / H1 = 0.7071, H3 / H1 = 0.3333
                for (var pn = 1; pn <= 24; pn++) w += 0.55 * Math.sin(pn * Math.PI / 4.0) / pn * Math.cos(pn * rdPhs) / 0.7071;
            } else {
                w = 0.55 * Math.sin(rdPhs) + 0.25 * Math.sin(2.0 * rdPhs) + 0.15 * Math.sin(3.0 * rdPhs);
            }
        } else if (src === "slices4") {
            // Four distinct tones, one per quarter (3000 frames at 48 kHz = 62.5 ms each), whole numbers of cycles
            // so a looped slice has no seam: 240 / 320 / 480 / 640 Hz.
            var qIdx = Math.min(3, Math.floor(i / (frames / 4)));
            var qHz = [240.0, 320.0, 480.0, 640.0][qIdx];
            w = 0.6 * Math.sin(2.0 * Math.PI * qHz * i / sr0);
        } else if (src === "rich48") {
            // 220 Hz harmonics up to 10 kHz with a smooth 1/n spectral envelope.
            for (var hn = 1; hn <= 45; hn++) w += 0.6 / hn * Math.sin(2.0 * Math.PI * 220.0 * hn * t) / 2.0;
            w *= env;
        } else if (src === "clicks48") {
            var k = i % 3000;
            w = 0.9 * Math.sin(2.0 * Math.PI * 1500.0 * t) * Math.exp(-k / 120.0);
        } else {
            w = (
                0.55 * Math.sin(2.0 * Math.PI * 220.0 * t) +
                0.25 * Math.sin(2.0 * Math.PI * 440.0 * t) +
                0.15 * Math.sin(2.0 * Math.PI * 660.0 * t)
            ) * env;
        }
        ch1[i] = w;
        ch2[i] = w;
    }
    sb.poke(1, 0, ch1);
    if (mode !== "mono_sample") sb.poke(2, 0, ch2);

}

// ---- Real-world Cycles material (src=real48) ---------------------------------------------------------------------
//   kind=pad     five detuned band-limited saws (-14 / -7 / 0 / +8 / +15 ct) + a low-passed noise bed
//   kind=vowel   jittered band-limited saw through 700 / 1220 / 2600 Hz resonators, voiced 350 ms / unvoiced (noise only)
//                150 ms, breath noise throughout
//   kind=saw     steady band-limited saw (18 harmonics) at f0
//   kind=vib     sine (+ 2nd, 3rd harmonic) with 5.5 Hz +-35 ct vibrato
//   off=0.35     the source's pitch in semitones above 220 Hz (the root the device is told about is 220 Hz)
//   gstart=4.8 glen=2.4   only this stretch of the (len seconds long) buffer holds sound: the scan starts at gstart
// Every component is band-limited to about 4.2 kHz (18 harmonics of the saw, noise low-passed at 1.5 kHz by six poles), so
// anything above 5 kHz in the output is an artefact of the engine (joins, interpolation, aliasing), not source content.
var realSrc = null;
var rndState = 12345;
function rnd01() { rndState = (rndState * 1664525 + 1013904223) % 4294967296; return rndState / 4294967296; }
function sawTable(nh) {
    var tb = new Array(4097);
    for (var i = 0; i < 4096; i++) {
        var s = 0;
        for (var n = 1; n <= nh; n++) s += Math.sin(2 * Math.PI * n * i / 4096) / n;
        tb[i] = s * 0.55;
    }
    tb[4096] = tb[0];
    return tb;
}
function tabRead(tb, ph) {
    var x = (ph - Math.floor(ph)) * 4096, i0 = Math.floor(x), fr = x - i0;
    return tb[i0] + (tb[i0 + 1] - tb[i0]) * fr;
}
function lpNoise(n, fc, sr, poles, amp) {
    var a = 1 - Math.exp(-2 * Math.PI * fc / sr), st = [], out = new Array(n), i, p;
    for (p = 0; p < poles; p++) st.push(0);
    var gain = 0;
    for (i = 0; i < n; i++) {
        var v = rnd01() * 2 - 1;
        for (p = 0; p < poles; p++) { st[p] += a * (v - st[p]); v = st[p]; }
        out[i] = v;
        gain += v * v;
    }
    var rms = Math.sqrt(gain / Math.max(n, 1)) + 1e-12;
    for (i = 0; i < n; i++) out[i] = out[i] / rms * amp;
    return out;
}
function genReal(frames, sr) {
    var kind = opt.kind || "pad", off = Number(opt.off === undefined ? 0.35 : opt.off);
    var g0 = Math.floor(sr * Number(opt.gstart || 4.8)), g1 = Math.min(frames, g0 + Math.floor(sr * Number(opt.glen || 2.4)));
    var f0 = 220.0 * Math.pow(2.0, off / 12.0);
    var out = new Array(frames), i;
    for (i = 0; i < frames; i++) out[i] = 0;
    rndState = 12345;
    var n = g1 - g0, tb = sawTable(18), noise = lpNoise(n, 1500, sr, 6, 1.0);
    var peak = 0;
    if (kind === "pad") {
        var cents = [-14, -7, 0, 8, 15], ph = [0.1, 0.37, 0.55, 0.71, 0.9];
        for (i = 0; i < n; i++) {
            var s = 0;
            for (var v = 0; v < 5; v++) {
                ph[v] += f0 * Math.pow(2.0, cents[v] / 1200.0) / sr;
                s += tabRead(tb, ph[v]);
            }
            var lfo = 1.0 + 0.2 * Math.sin(2 * Math.PI * 0.3 * i / sr);
            out[g0 + i] = (s * 0.2 + noise[i] * 0.06) * lfo;
        }
    } else if (kind === "vowel") {
        var fs = [700, 1220, 2600], qs = [9, 11, 14], gs = [1.0, 0.7, 0.35], bq = [];
        for (var r = 0; r < 3; r++) {
            var w0 = 2 * Math.PI * fs[r] / sr, al = Math.sin(w0) / (2 * qs[r]), a0 = 1 + al;
            bq.push({ b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, z1: 0, z2: 0, g: gs[r] });
        }
        var phv = 0, jit = 0, period = Math.floor(sr * 0.5), env = 0;
        for (i = 0; i < n; i++) {
            if (i % 480 === 0) jit = jit * 0.9 + (rnd01() - 0.5) * 0.012;
            phv += f0 * (1 + jit) / sr;
            var voiced = ((i % period) < Math.floor(sr * 0.35)) ? 1.0 : 0.0;
            env += (voiced - env) * 0.002;
            var x = tabRead(tb, phv) * env, y = 0;
            for (var q = 0; q < 3; q++) {
                var B = bq[q], o = B.b0 * x + B.z1;
                B.z1 = -B.a1 * o + B.z2;
                B.z2 = B.b2 * x - B.a2 * o;
                y += o * B.g;
            }
            out[g0 + i] = y * 4.0 + noise[i] * (0.03 + 0.08 * (1 - env));
        }
    } else if (kind === "saw") {
        // steady band-limited saw (18 harmonics, 1/n) at f0
        var sph = 0;
        for (i = 0; i < n; i++) {
            sph += f0 / sr;
            out[g0 + i] = tabRead(tb, sph);
        }
    } else if (kind === "vowelst") {
        // steady vowel: 18 harmonics shaped by formants at 700 / 1220 / 2600 Hz (Lorentzian-like, bandwidths 110 / 140 / 200 Hz)
        var vt = new Array(4097), vph = 0, vi, vn;
        for (vi = 0; vi < 4096; vi++) vt[vi] = 0;
        for (vn = 1; vn <= 18; vn++) {
            var vf = vn * f0, amp = 0;
            amp += 1.0 / Math.sqrt(1 + Math.pow((vf - 700) / 110, 2));
            amp += 0.6 / Math.sqrt(1 + Math.pow((vf - 1220) / 140, 2));
            amp += 0.3 / Math.sqrt(1 + Math.pow((vf - 2600) / 200, 2));
            amp /= (1 + 0.15 * vn);
            for (vi = 0; vi < 4096; vi++) vt[vi] += amp * Math.sin(2 * Math.PI * vn * vi / 4096);
        }
        vt[4096] = vt[0];
        for (i = 0; i < n; i++) {
            vph += f0 / sr;
            out[g0 + i] = tabRead(vt, vph);
        }
    } else {
        var phs = 0;
        for (i = 0; i < n; i++) {
            var vib = 35 * Math.sin(2 * Math.PI * 5.5 * i / sr);
            phs += f0 * Math.pow(2.0, vib / 1200.0) / sr;
            out[g0 + i] = 0.5 * Math.sin(2 * Math.PI * phs) + 0.12 * Math.sin(4 * Math.PI * phs + 0.4) + 0.06 * Math.sin(6 * Math.PI * phs + 1.1);
        }
    }
    for (i = g0; i < g1; i++) if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
    var sc = 0.5 / Math.max(peak, 1e-9);
    // 20 ms fade at both ends of the sounding stretch
    var fl = Math.floor(sr * 0.02);
    for (i = g0; i < g1; i++) {
        var fe = Math.min(1, (i - g0) / fl, (g1 - i) / fl);
        out[i] *= sc * fe;
    }
    return out;
}

// crunch=a-b (ms): artefact metrics of the mid signal over the window, with the source stretch played at natural speed
// (gstart + a .. gstart + b seconds, what a Speed 100 % scan reads) as the reference.
//   crHfDb / crRefHfDb   power above 5 kHz (hfc=<Hz>) relative to the total (dB): the sources hold nothing there
//   crHfFlat / crRefHfFlat  spectral flatness (geometric / arithmetic mean) of the 5..20 kHz power spectrum
//   crBin                max / median over 16 phase bins of the output period of the second-difference energy
//   crJmp999 / crRefJmp999  99.9th percentile of |x[n] - x[n-1]| over the rms of the step; crJmpMax the maximum
//   cf0=<Hz> the output fundamental (period for the phase bins), cj=<sample> the trigger sample (default 1)
function psdHf(x, sr, hfcIn) {
    var hfc = hfcIn || Number(opt.hfc || 5000);
    var N = 4096, hop = 2048, acc = new Array(N / 2), k, tot = 0, hf = 0, nseg = 0;
    for (k = 0; k < N / 2; k++) acc[k] = 0;
    var re = new Array(N), im = new Array(N);
    for (var s0 = 0; s0 + N <= x.length; s0 += hop) {
        for (k = 0; k < N; k++) { re[k] = x[s0 + k] * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / (N - 1))); im[k] = 0; }
        fftInPlace(re, im);
        for (k = 1; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
        nseg++;
    }
    var lo = Math.ceil(hfc / (sr / N)), hi = Math.min(N / 2 - 1, Math.floor(20000 / (sr / N)));
    var lsum = 0, asum = 0, cnt = 0;
    for (k = 1; k < N / 2; k++) {
        tot += acc[k];
        if (k >= lo && k <= hi) { hf += acc[k]; lsum += Math.log(acc[k] + 1e-30); asum += acc[k]; cnt++; }
    }
    var flat = cnt > 0 && asum > 0 ? Math.exp(lsum / cnt) / (asum / cnt) : 0;
    return { hfDb: 10 * Math.log(Math.max(hf, 1e-30) / Math.max(tot, 1e-30)) / Math.LN10, flat: flat, segs: nseg };
}
function stepStats(x) {
    var d = [], sq = 0, mx = 0, i;
    for (i = 1; i < x.length; i++) { var v = Math.abs(x[i] - x[i - 1]); d.push(v); sq += v * v; if (v > mx) mx = v; }
    var rms = Math.sqrt(sq / Math.max(d.length, 1)) + 1e-12;
    d.sort(function (a, b) { return a - b; });
    var p999 = d.length ? d[Math.min(d.length - 1, Math.floor(d.length * 0.999))] : 0;
    return { p999: p999 / rms, max: mx / rms };
}
function crunchReport(left, right, sr) {
    if (!opt.crunch) return "";
    var pr = String(opt.crunch).split("-");
    var i0 = Math.floor(sr * Number(pr[0]) / 1000), i1 = Math.min(left.length, Math.floor(sr * Number(pr[1]) / 1000));
    var m = [], i;
    for (i = i0; i < i1; i++) m.push(0.5 * (left[i] + right[i]));
    var ref = [], g0 = Math.floor(sr * Number(opt.gstart || 4.8)) + i0, g1 = g0 + (i1 - i0);
    var sc = (opt.sstart0 !== undefined) ? Number(opt.sstart0) : 0;
    for (i = g0; i < g1 && realSrc && i < realSrc.length; i++) ref.push(realSrc[i]);
    var o = psdHf(m, sr), rf = ref.length > 4096 ? psdHf(ref, sr, Number(opt.hfcr || opt.hfc || 5000)) : { hfDb: -999, flat: 0 };
    var so = stepStats(m), sr2 = ref.length > 8 ? stepStats(ref) : { p999: 0, max: 0 };
    // second-difference energy per phase bin of the output period
    var P = sr / Number(opt.cf0 || 220), t0 = Number(opt.cj === undefined ? 1 : opt.cj), nb = 16, be = [], bc = [];
    for (i = 0; i < nb; i++) { be.push(0); bc.push(0); }
    for (i = 2; i < m.length; i++) {
        var d2 = m[i] - 2 * m[i - 1] + m[i - 2];
        var ph = (((i0 + i - t0) % P) + P) % P / P, b = Math.min(nb - 1, Math.floor(ph * nb));
        be[b] += d2 * d2; bc[b]++;
    }
    var bm = [];
    for (i = 0; i < nb; i++) bm.push(be[i] / Math.max(bc[i], 1));
    var sorted = bm.slice().sort(function (a, b2) { return a - b2; });
    var med = sorted[Math.floor(nb / 2)] + 1e-30, top = sorted[nb - 1];
    return "crHfDb " + o.hfDb + "\ncrRefHfDb " + rf.hfDb + "\ncrHfFlat " + o.flat + "\ncrRefHfFlat " + rf.flat + "\n" +
           "crBin " + (top / med) + "\ncrJmp999 " + so.p999 + "\ncrRefJmp999 " + sr2.p999 + "\ncrJmpMax " + so.max + "\ncrRefJmpMax " + sr2.max + "\n";
}

function seedVoices() {
    if (!voicesName) return;
    var vb = new Buffer(voicesName);
    var vFlat = new Array(128);
    for (var k = 0; k < 128; k++) vFlat[k] = 0.0;

    if (mode === "idle_silent") {
        // All 16 voices gate = 0
        vb.poke(1, 0, vFlat);
        return;
    }

    // Trigger a 3-note polyphonic triad, a slice note, or one centered voice.
    // Centered single notes let Reverse / Freeze / 8-voice unison show up in the
    // recording instead of the triad's hardcoded pan seeds.
    var cfg = SLICE_CFG[mode];
    var sl = parseSlice(opt.slice);
    if (sl) cfg = sl;
    var single = SINGLE_NOTE.test(mode) || !!cfg || !!opt.notes;
    var notes = cfg ? [38] : (single ? [60] : [60, 64, 67]);
    if (opt.notes) notes = String(opt.notes).split(",").map(Number);
    for (var v = 0; v < notes.length; v++) {
        var base = v * 8;
        vFlat[base + 0] = 1.0;        // gate
        vFlat[base + 1] = notes[v];   // MIDI note
        vFlat[base + 2] = opt.vels ? Number(String(opt.vels).split(",")[v]) : 0.90;       // velocity (vels=0.2,1 per note)
        vFlat[base + 3] = trigSeq;    // trigCount
        vFlat[base + 4] = cfg ? cfg.start : 0.0; // sliceStart
        vFlat[base + 5] = cfg ? cfg.end : 1.0; // sliceEnd
        vFlat[base + 6] = single ? 0.0 : ((v === 0) ? -0.4 : ((v === 1) ? 0.4 : 0.0)); // panSeed
        vFlat[base + 7] = 0.17 * (v + 1); // rndSeed
    }
    vb.poke(1, 0, vFlat);
}

// ---- Note sequence (real note path): the face's allocator writes the same vdata layout -------------
// `noteon <key> <vel>` / `noteoff <key>` run src/sampler_config.js' createVoiceAllocator (concatenated in front of this
// file by scripts/run_sampler_audio_tests.py) and poke the voice exactly as writeVoiceToBuffer() in src/sampler_ui.js.
var alloc = null;
var snaps = {};
function getAlloc() {
    if (alloc) return alloc;
    alloc = createVoiceAllocator(16);
    if (opt.base !== undefined) alloc.setSliceBaseNote(Number(opt.base));
    if (opt.cap !== undefined) alloc.setMaxVoices(Number(opt.cap));
    return alloc;
}
function sliceStarts() {
    var markers = String(opt.markers || "0,0.25,0.5,0.75").split(",").map(Number);
    var st = Number(opt.sstart === undefined ? 0 : opt.sstart);
    var en = Number(opt.send === undefined ? 1 : opt.send);
    return { starts: activeSliceStarts(markers, st, en), end: en };
}
function writeVoice(v) {
    new Buffer(voicesName).poke(1, v.index * 8, [v.gate, v.note, v.vel, v.trigCount, v.sliceStart, v.sliceEnd, v.panSeed, v.rndSeed]);
}
function noteon(n, vel) {
    var a = getAlloc();
    var sl = sliceStarts();
    writeVoice(a.noteOn(Number(n), Number(vel), 0, opt.single ? [0.0] : sl.starts, sl.end));
}
function noteoff(n) {
    var rel = getAlloc().noteOff(Number(n), 0);
    for (var i = 0; i < rel.length; i++) writeVoice(rel[i]);
}
// Telemetry at this instant: playhead (slots 0..15) of the loudest voice (amps 16..31)
function snap(label) {
    var chunk = new Buffer(scopeName).peek(1, 0, 49);
    var best = -1, bestA = 0.0005;
    for (var i = 0; i < 16; i++) if (chunk[16 + i] > bestA) { bestA = chunk[16 + i]; best = i; }
    snaps[String(label)] = { voice: best, pos: best >= 0 ? chunk[best] : -1, amp: bestA, lfo: chunk[35], frame: chunk[39] };
    if (opt.tv) { try { snaps[String(label)].tv = new Buffer(scopeName).peek(1, 128, 80); } catch (terr) { } }
    if (opt.gt) { try { gtSnaps.push(new Buffer(scopeName).peek(1, 64, 64)); } catch (gerr) { } }
}


// Grain telemetry (#0-bsscope 64..127): slots 64..95 hold the read position of up to 32 grains (0..1, -1 unused), 96..127 their
// level. gt* is the state at the end of the run, gtAll* aggregates every `snap` (the harness snaps during playback).
var gtSnaps = [];
function grainStats(g) {
    var n = 0, mn = 2, mx = -2, lv = 0, distinct = {}, nd = 0, i, negOk = 1;
    if (!g || g.length < 64) return { n: -1, min: -1, max: -1, lvl: -1, distinct: -1, negOk: 0 };
    for (i = 0; i < 32; i++) {
        var p = g[i], l = g[32 + i];
        if (p >= 0) {
            n++; if (p < mn) mn = p; if (p > mx) mx = p; if (l > lv) lv = l;
            var key = Math.round(p * 1000);
            if (!distinct[key]) { distinct[key] = 1; nd++; }
            if (!(l > 0)) negOk = 0;
        } else if (p !== -1) negOk = 0;
        else if (l !== 0) negOk = 0;
    }
    return { n: n, min: n ? mn : -1, max: n ? mx : -1, lvl: lv, distinct: nd, negOk: negOk };
}
function grainReport(scopeStats) {
    var loud = 0, gi;
    if (scopeStats.grains) for (gi = 0; gi < 32; gi++) if (scopeStats.grains[gi] >= 0 && scopeStats.grains[32 + gi] > 0.25) loud++;
    var f = grainStats(scopeStats.grains), txt = "gtLoud " + loud + "\n" + "gtN " + f.n + "\ngtMin " + f.min + "\ngtMax " + f.max + "\ngtLvlMax " + f.lvl + "\ngtDistinct " + f.distinct + "\ngtUnusedOk " + f.negOk + "\n";
    if (gtSnaps.length) {
        var all = {}, nd = 0, mn = 2, mx = -2, maxN = 0, minN = 99, lvMax = 0, bad = 0, i, s;
        for (s = 0; s < gtSnaps.length; s++) {
            var st = grainStats(gtSnaps[s]);
            if (st.n > maxN) maxN = st.n;
            if (st.n < minN) minN = st.n;
            if (st.n > 0) { if (st.min < mn) mn = st.min; if (st.max > mx) mx = st.max; }
            if (st.lvl > lvMax) lvMax = st.lvl;
            if (!st.negOk) bad++;
            if (opt.gtlist) txt += "gtS" + s + " " + st.n + "\ngtS" + s + "Min " + st.min + "\ngtS" + s + "Max " + st.max + "\n";
            for (i = 0; i < 32; i++) if (gtSnaps[s][i] >= 0) {
                var k = Math.round(gtSnaps[s][i] * 1000);
                if (!all[k]) { all[k] = 1; nd++; }
            }
        }
        txt += "gtAllSnaps " + gtSnaps.length + "\ngtAllMaxN " + maxN + "\ngtAllMinN " + minN + "\ngtAllMin " + (mn > 1 ? -1 : mn) + "\ngtAllMax " + (mx < -1 ? -1 : mx) + "\ngtAllLvl " + lvMax + "\ngtAllDistinct " + nd + "\ngtAllBad " + bad + "\n";
    }
    return txt;
}

// dbgscope=1: slots 50..63 of the telemetry buffer (free for gen debugging variants), as dbgS50 .. dbgS63
function dbgScopeReport() {
    if (!opt.dbgscope || !scopeName) return "";
    var c = new Buffer(scopeName).peek(1, 50, 14), txt = "";
    for (var i = 0; i < 14; i++) txt += "dbgS" + (50 + i) + " " + c[i] + "\n";
    return txt;
}

function msg_float(v) {
    if (inlet === 0) peaks.genL = v;
    else if (inlet === 1) peaks.ctl = v;
    else if (inlet === 2) peaks.genR = v;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 44100;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var left = readChannel(rec, 1, n);
    var right = readChannel(rec, 2, n);
    // record~ leaves exact zeros in the tail when the audio thread renders
    // fewer samples than the scheduler's delay. Measure the written prefix.
    var rendered = left.length;
    while (rendered > 0 && left[rendered - 1] === 0 && right[rendered - 1] === 0) rendered--;
    if (rendered >= 64) {
        left = left.slice(0, rendered);
        right = right.slice(0, rendered);
    }
    var stats = scan(left, right, sr);
    var earlyRms = bandRms(left, right, Math.floor(left.length * 0.12), Math.floor(left.length * 0.38));
    var lateRms = bandRms(left, right, Math.floor(left.length * 0.65), Math.floor(left.length * 0.92));
    var scopeStats = readScope();
    var metrics = analyzeSpectrum(left, right, sr);
    var cutIdx = Math.max(0, Math.min(left.length, Math.floor(sr * cutMs / 1000)));
    var headRms = bandRms(left, right, 0, cutIdx);
    var afterRms = bandRms(left, right, cutIdx, left.length);
    var afterPeak = 0;
    for (var q = cutIdx; q < left.length; q++) {
        afterPeak = Math.max(afterPeak, Math.abs(left[q]), Math.abs(right[q]));
    }

    var report = new File(resultPath, "write", "TEXT");
    report.writestring(
        "genL " + peaks.genL + "\n" +
        "genR " + peaks.genR + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "rendered " + rendered + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "peakL " + stats.peakL + "\n" +
        "peakR " + stats.peakR + "\n" +
        "rms " + stats.rms + "\n" +
        "stereoDiff " + stats.stereoDiff + "\n" +
        "earlyRms " + earlyRms + "\n" +
        "lateRms " + lateRms + "\n" +
        "headRms " + headRms + "\n" +
        "afterRms " + afterRms + "\n" +
        "afterPeak " + afterPeak + "\n" +
        "scopePos0 " + scopeStats.pos0 + "\n" +
        "scopeActive " + scopeStats.activeVoices + "\n" +
        "scopePeakL " + scopeStats.peakL + "\n" +
        "scopeCutHz " + scopeStats.cutHz + "\n" +
        "scopeFrames " + scopeStats.sampFrames + "\n" +
        "scopeLen " + scopeStats.scopeLen + "\n" +
        "jsFrames " + scopeStats.jsFrames + "\n" +
        "spawns " + scopeStats.spawns + "\n" +
        "gpSliced " + (scopeStats.gp ? scopeStats.gp[0] : -1) + "\n" +
        "gpLoopMode " + (scopeStats.gp ? scopeStats.gp[1] : -1) + "\n" +
        "gpSlicePlay " + (scopeStats.gp ? scopeStats.gp[2] : -1) + "\n" +
        "gpMode " + (scopeStats.gp ? scopeStats.gp[3] : -1) + "\n" +
        "gpRoot " + (scopeStats.gp ? scopeStats.gp[6] : -1) + "\n" +
        "gpRootDyn " + scopeStats.rootDyn + "\n" +
        dumpMetrics(metrics) +
        segReport(left, right, sr) +
        clickReport(left, right, sr) +
        crunchReport(left, right, sr) +
        grainReport(scopeStats) +
        dbgScopeReport() +
        seqReport(left, right, sr) +
        snapReport() +
        markerReport(left, right, sr) +
        modReport()
    );
    report.close();
    if (opt.raw) {
        var rw = String(opt.raw).split("-");
        var r0 = Math.floor(sr * Number(rw[0]) / 1000), r1 = Math.min(left.length, Math.floor(sr * Number(rw[1]) / 1000));
        var rf = new File(resultPath + ".raw.txt", "write", "TEXT");
        var chunk = [];
        for (var ri = r0; ri < r1; ri++) {
            chunk.push(left[ri] + " " + right[ri]);
            if (chunk.length >= 512) { rf.writestring(chunk.join("\n") + "\n"); chunk = []; }
        }
        if (chunk.length) rf.writestring(chunk.join("\n") + "\n");
        rf.close();
    }
    if (opt.dump) {
        var df = new File(resultPath + ".wav.txt", "write", "TEXT");
        var a1 = Math.floor(sr * Number(opt.ana || 100) / 1000);
        for (var di = 0; di < 1200; di++) df.writestring((left[a1 + di] === undefined ? 0 : left[a1 + di]) + "\n");
        df.close();
    }
    outlet(0, "bang");
}

// Spectrum of mono samples seg[0..): Hann, 32768-point FFT. Returns the magnitudes, the bin width and the dominant
// frequency (60..8000 Hz, log-parabolic peak refinement).
function segSpectrum(seg, sr) {
    var N = 32768, re = new Array(N), im = new Array(N);
    var cnt = Math.min(seg.length, N);
    for (var q = 0; q < N; q++) {
        re[q] = q < cnt ? seg[q] * (0.5 - 0.5 * Math.cos(2 * Math.PI * q / Math.max(cnt - 1, 1))) : 0;
        im[q] = 0;
    }
    fftInPlace(re, im);
    var binHz = sr / N, best = 0, bk = 0, mg = new Array(N / 2);
    mg[0] = 0;
    for (var b = 1; b < N / 2; b++) {
        mg[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        var f = b * binHz;
        if (f < 60 || f > 8000) continue;
        if (mg[b] > best) { best = mg[b]; bk = b; }
    }
    var hz = 0;
    if (best >= 1e-7) {
        hz = bk * binHz;
        if (bk > 1 && bk < N / 2 - 1) {
            var ya = Math.log(mg[bk - 1] + 1e-12), yb = Math.log(mg[bk] + 1e-12), yc = Math.log(mg[bk + 1] + 1e-12);
            var den = ya - 2 * yb + yc;
            if (Math.abs(den) > 1e-9) hz = (bk + 0.5 * (ya - yc) / den) * binHz;
        }
    }
    return { mg: mg, binHz: binHz, hz: hz };
}

// segs=a-b,c-d (ms): per window of the mid signal
//   segHz     dominant frequency
//   segRms    rms
//   segCen    (cen=<Hz>) power-weighted mean frequency in 0.6..1.45 x cen: the carrier of a grain cloud whose grain-rate
//             sidebands can win the peak pick
//   segHarm   (harm=<Hz>) fraction of the 60..4000 Hz power within +-4 % of a multiple of <Hz>: 1 for a waveform that
//             repeats at <Hz>, low when the cycle read is the wrong length
//   segH2_/segH3_ (harm=) 2nd / 3rd harmonic amplitude relative to the 1st: the waveform shape
function segReport(left, right, sr) {
    if (!opt.segs) return "";
    var wins = String(opt.segs).split(",");
    var txt = "";
    var cenRef = Number(opt.cen || 0), harmRef = Number(opt.harm || 0);
    for (var k = 0; k < wins.length; k++) {
        var pr = wins[k].split("-");
        var i0 = Math.floor(sr * Number(pr[0]) / 1000), i1 = Math.min(left.length, Math.floor(sr * Number(pr[1]) / 1000));
        var seg = [], sq = 0;
        for (var i = i0; i < i1; i++) { var m = 0.5 * (left[i] + right[i]); seg.push(m); sq += m * m; }
        var sp = seg.length > 64 ? segSpectrum(seg, sr) : { mg: [], binHz: 1, hz: 0 };
        txt += "segHz" + k + " " + sp.hz + "\n" +
               "segRms" + k + " " + (seg.length ? Math.sqrt(sq / seg.length) : 0) + "\n";
        if (cenRef > 0 && sp.mg.length) {
            var num = 0, den2 = 0;
            for (var b = 1; b < sp.mg.length; b++) {
                var f = b * sp.binHz;
                if (f < 0.6 * cenRef || f > 1.45 * cenRef) continue;
                num += sp.mg[b] * sp.mg[b] * f; den2 += sp.mg[b] * sp.mg[b];
            }
            txt += "segCen" + k + " " + (den2 > 0 ? num / den2 : 0) + "\n";
        }
        if (harmRef > 0 && sp.mg.length) {
            var inH = 0, tot = 0;
            for (var b2 = 1; b2 < sp.mg.length; b2++) {
                var f2 = b2 * sp.binHz;
                if (f2 < 60 || f2 > 4000) continue;
                var pw = sp.mg[b2] * sp.mg[b2];
                tot += pw;
                var hk = Math.round(f2 / harmRef);
                if (hk >= 1 && Math.abs(f2 - hk * harmRef) <= 0.04 * hk * harmRef) inH += pw;
            }
            txt += "segHarm" + k + " " + (tot > 0 ? inH / tot : 0) + "\n";
            // amplitude of the 2nd and 3rd harmonic relative to the 1st (+-4 % peak search): the waveform shape
            var hmax = [0, 0, 0, 0];
            for (var hh = 1; hh <= 3; hh++) {
                var bLo = Math.floor(hh * harmRef * 0.96 / sp.binHz), bHi = Math.ceil(hh * harmRef * 1.04 / sp.binHz);
                for (var bb = bLo; bb <= bHi && bb < sp.mg.length; bb++) hmax[hh] = Math.max(hmax[hh], sp.mg[bb]);
            }
            txt += "segH2_" + k + " " + (hmax[1] > 0 ? hmax[2] / hmax[1] : 0) + "\n" +
                   "segH3_" + k + " " + (hmax[1] > 0 ? hmax[3] / hmax[1] : 0) + "\n";
        }
        // hs=<f0>: amplitude of the first 18 harmonics of <f0> (+-3 %), their power-weighted centroid and the frequency of
        // the strongest one with a parabolic refinement over the neighbouring harmonics: where the formants sit
        if (opt.hs && sp.mg.length) {
            var hs0 = Number(opt.hs), ha = [], hq = 0, hqn = 0, hbest = 0, hbn = 1, hn2;
            for (hn2 = 1; hn2 <= 18; hn2++) {
                var hb0 = Math.floor(hn2 * hs0 * 0.97 / sp.binHz), hb1 = Math.ceil(hn2 * hs0 * 1.03 / sp.binHz), hm = 0;
                for (var hb = hb0; hb <= hb1 && hb < sp.mg.length; hb++) hm = Math.max(hm, sp.mg[hb]);
                ha.push(hm);
                hq += hm * hm * hn2 * hs0; hqn += hm * hm;
                if (hm > hbest) { hbest = hm; hbn = hn2; }
                txt += "segA" + k + "_" + hn2 + " " + hm + "\n";
            }
            var hpk = hbn;
            if (hbn > 1 && hbn < 18) {
                var la = Math.log(ha[hbn - 2] + 1e-12), lb = Math.log(ha[hbn - 1] + 1e-12), lc = Math.log(ha[hbn] + 1e-12), hd = la - 2 * lb + lc;
                if (Math.abs(hd) > 1e-9) hpk = hbn + 0.5 * (la - lc) / hd;
            }
            txt += "segHCen" + k + " " + (hqn > 0 ? hq / hqn : 0) + "\n" + "segHPk" + k + " " + hpk * hs0 + "\n";
        }
    }
    return txt;
}

// clk=a-b (ms, opt.cen / opt.harm = the expected fundamental, default 261.63 Hz): continuity of the mid signal.
//   clkRatio   largest per-window max |x[n] - x[n-1]| over the median of those windows (windows of 1.5 periods, hop of half
//              a period): about 1 for a steady periodic waveform, large where a window join or a pitch step clicks
//   clkRipple  (max - min) / mean of the RMS over windows of 2 periods (hop 1/2 period): amplitude modulation
//   clkJump    largest sample-to-sample step relative to the signal peak
function clickReport(left, right, sr) {
    if (!opt.clk) return "";
    var pr = String(opt.clk).split("-");
    var i0 = Math.floor(sr * Number(pr[0]) / 1000), i1 = Math.min(left.length, Math.floor(sr * Number(pr[1]) / 1000));
    var f0 = Number(opt.harm || opt.cen || 261.63);
    var P = sr / f0;
    var m = [], pk = 0;
    for (var i = i0; i < i1; i++) { var v = 0.5 * (left[i] + right[i]); m.push(v); if (Math.abs(v) > pk) pk = Math.abs(v); }
    var W = Math.floor(P * 1.5), hop = Math.max(1, Math.floor(P / 2)), mx = [], rms = [], mxAt = [];
    var jump = 0;
    for (var a = 1; a < m.length; a++) jump = Math.max(jump, Math.abs(m[a] - m[a - 1]));
    for (var s0 = 1; s0 + W < m.length; s0 += hop) {
        var mj = 0;
        for (var q = 0; q < W; q++) mj = Math.max(mj, Math.abs(m[s0 + q] - m[s0 + q - 1]));
        mx.push(mj);
        mxAt.push(1000.0 * (i0 + s0) / sr);
    }
    var topAt = -1, topV = 0;
    for (var t1 = 0; t1 < mx.length; t1++) if (mx[t1] > topV) { topV = mx[t1]; topAt = mxAt[t1]; }
    var W2 = Math.floor(P * 2);
    for (var s1 = 0; s1 + W2 < m.length; s1 += hop) {
        var sq = 0;
        for (var z = 0; z < W2; z++) sq += m[s1 + z] * m[s1 + z];
        rms.push(Math.sqrt(sq / W2));
    }
    var sorted = mx.slice().sort(function (x, y) { return x - y; });
    var med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    var top = sorted.length ? sorted[sorted.length - 1] : 0;
    var rmin = 1e9, rmax = 0, rsum = 0, rminAt = 0, rmaxAt = 0;
    for (var r = 0; r < rms.length; r++) {
        if (rms[r] < rmin) { rmin = rms[r]; rminAt = 1000.0 * (i0 + r * hop) / sr; }
        if (rms[r] > rmax) { rmax = rms[r]; rmaxAt = 1000.0 * (i0 + r * hop) / sr; }
        rsum += rms[r];
    }
    var rmean = rms.length ? rsum / rms.length : 0;
    return "clkRatio " + (med > 1e-9 ? top / med : 0) + "\n" +
           "clkRipple " + (rmean > 1e-9 ? (rmax - rmin) / rmean : 0) + "\n" +
           "clkAtMs " + topAt + "\n" +
           "clkRipMinAt " + rminAt + "\n" + "clkRipMaxAt " + rmaxAt + "\n" +
           "clkJump " + (pk > 1e-9 ? jump / pk : 0) + "\n" +
           "clkPeak " + pk + "\n";
}

// Per-key readout of a note sequence (opt.seq = keys, opt.step / opt.hold / opt.skip in ms): dominant frequency,
// rms and the playhead snapshot of every key's window.
function seqReport(left, right, sr) {
    if (!opt.seq) return "";
    var keys = String(opt.seq).split(",").map(Number);
    var step = Number(opt.step || 150), hold = Number(opt.hold || 120), skip = Number(opt.skip || 30);
    var txt = "";
    for (var k = 0; k < keys.length; k++) {
        var i0 = Math.floor(sr * (k * step + skip) / 1000), i1 = Math.min(left.length, Math.floor(sr * (k * step + hold) / 1000));
        var seg = [];
        var sq = 0;
        for (var i = i0; i < i1; i++) { var m = 0.5 * (left[i] + right[i]); seg.push(m); sq += m * m; }
        var N = 16384, re = new Array(N), im = new Array(N);
        var cnt = Math.min(seg.length, N);
        for (var q = 0; q < N; q++) {
            re[q] = q < cnt ? seg[q] * (0.5 - 0.5 * Math.cos(2 * Math.PI * q / Math.max(cnt - 1, 1))) : 0;
            im[q] = 0;
        }
        fftInPlace(re, im);
        var best = 0, bestK = 0, binHz = sr / N;
        for (var b = 1; b < N / 2; b++) {
            var f = b * binHz;
            if (f < 60 || f > 8000) continue;
            var mg = re[b] * re[b] + im[b] * im[b];
            if (mg > best) { best = mg; bestK = b; }
        }
        var sn = snaps[String(k)] || { voice: -2, pos: -2, amp: 0 };
        txt += "seq" + k + "Hz " + (best > 1e-9 ? bestK * binHz : 0) + "\n" +
               "seq" + k + "Rms " + (seg.length ? Math.sqrt(sq / seg.length) : 0) + "\n" +
               "seq" + k + "Pos " + sn.pos + "\n" +
               "seq" + k + "Voice " + sn.voice + "\n";
    }
    return txt;
}

// Playhead snapshots taken by `snap t<ms>` events: snp<ms>Pos (normalised playhead of the loudest voice) and snp<ms>Amp.
function snapReport() {
    var txt = "";
    for (var key in snaps) {
        if (snaps[key].tv) {
            // Per-voice envelope / filter telemetry (scope 128..207): tv<ms>_<voice>a/al/m/ml/c = amp code, amp level, mod code, mod level,
            // cutoff Hz for voices 0..3; tv<ms>x = how many of voices 4..15 are not idle (any code / level / cutoff != 0).
            var tvc = snaps[key].tv, ms = key.substring(1), extra = 0;
            for (var tvv = 0; tvv < 16; tvv++) {
                if (tvv < 4) txt += "tv" + ms + "_" + tvv + "a " + tvc[tvv] + "\ntv" + ms + "_" + tvv + "al " + tvc[16 + tvv] + "\ntv" + ms + "_" + tvv + "m " + tvc[32 + tvv] + "\ntv" + ms + "_" + tvv + "ml " + tvc[48 + tvv] + "\ntv" + ms + "_" + tvv + "c " + tvc[64 + tvv] + "\n";
                else if (tvc[tvv] !== 0 || tvc[16 + tvv] !== 0 || tvc[32 + tvv] !== 0 || tvc[48 + tvv] !== 0 || tvc[64 + tvv] !== 0) extra++;
            }
            txt += "tv" + ms + "x " + extra + "\n";
        }
        if (key.charAt(0) !== "t") continue;
        txt += "snp" + key.substring(1) + "Pos " + snaps[key].pos + "\n" + "snp" + key.substring(1) + "Amp " + snaps[key].amp + "\n" + "snp" + key.substring(1) + "Lfo " + snaps[key].lfo + "\n" + "snp" + key.substring(1) + "Frame " + snaps[key].frame + "\n";
    }
    return txt;
}

// mk=1: the burst envelope of the mid signal (|x| smoothed over 12 ms). Bursts = clusters of envelope above 60 % of the
// maximum (gaps over 40 ms split them); mkT<k> = centroid in ms from the start of the recording; mkEnd = last time the
// envelope is above 9 % of the maximum (the low level of marks48 is 18 % of the burst level).
function markerReport(left, right, sr) {
    if (!opt.mk) return "";
    var n = left.length, win = Math.max(2, Math.floor(sr * 0.012));
    var cum = new Array(n + 1);
    cum[0] = 0;
    for (var i = 0; i < n; i++) cum[i + 1] = cum[i] + Math.abs(0.5 * (left[i] + right[i]));
    var env = new Array(n), mx = 0;
    for (var j = 0; j < n; j++) {
        var a = Math.max(0, j - (win >> 1)), b = Math.min(n, a + win);
        env[j] = (cum[b] - cum[a]) / Math.max(b - a, 1);
        if (env[j] > mx) mx = env[j];
    }
    var thr = 0.6 * mx, gap = Math.floor(sr * 0.040);
    var cl = [], cur = null, lastAbove = -1e9, endIdx = -1;
    for (var k = 0; k < n; k++) {
        if (env[k] > 0.09 * mx) endIdx = k;
        if (env[k] > thr) {
            if (!cur || k - lastAbove > gap) { cur = { w: 0, wt: 0 }; cl.push(cur); }
            cur.w += env[k] - thr;
            cur.wt += (env[k] - thr) * k;
            lastAbove = k;
        }
    }
    var txt = "mkN " + cl.length + "\nmkMax " + mx + "\nmkEnd " + (endIdx >= 0 ? 1000.0 * endIdx / sr : -1) + "\n";
    for (var c = 0; c < cl.length; c++) txt += "mkT" + c + " " + (1000.0 * cl[c].wt / cl[c].w / sr) + "\n";
    return txt;
}

function readScope() {
    var jsFrames = -1;
    if (sampName) {
        try {
            jsFrames = new Buffer(sampName).framecount() || 0;
        } catch (err) {
            jsFrames = -2;
        }
    }
    if (!scopeName) return { spawns: -1, activeVoices: -1, peakL: -1, cutHz: -1, sampFrames: -1, scopeLen: 0, jsFrames: jsFrames };
    var buf = new Buffer(scopeName);
    var chunk = buf.peek(1, 0, 50);
    if (!chunk || !chunk.length) {
        return { spawns: -1, activeVoices: 0, peakL: 0, cutHz: 0, sampFrames: 0, scopeLen: 0, jsFrames: jsFrames };
    }
    var gchunk = null;
    try { gchunk = buf.peek(1, 64, 64); } catch (gerr) { gchunk = null; }
    return {
        pos0: (chunk[0] === undefined) ? -1 : chunk[0],
        peakL: chunk[32] || 0,
        activeVoices: chunk[34] || 0,
        cutHz: chunk[37] || 0,
        spawns: (chunk.length > 48 && chunk[48] !== undefined) ? chunk[48] : -1,
        sampFrames: (chunk.length > 38 && chunk[38] !== undefined) ? chunk[38] : -3,
        scopeLen: chunk.length,
        jsFrames: jsFrames,
        rootDyn: (chunk.length > 49 && chunk[49] !== undefined) ? chunk[49] : -1,
        gp: chunk.slice(40, 48),
        grains: gchunk,
    };
}

function readChannel(buf, channel, n) {
    var out = [];
    for (var i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        if (!chunk) {
            for (var k = 0; k < count; k++) out.push(0);
            continue;
        }
        if (typeof chunk === "number") {
            out.push(chunk);
            continue;
        }
        for (var j = 0; j < count; j++) out.push(chunk[j]);
    }
    return out;
}

function bandRms(left, right, i0, i1) {
    var sq = 0;
    var count = 0;
    var a = Math.max(0, i0);
    var b = Math.min(left.length, i1);
    for (var k = a; k < b; k++) {
        var lv = left[k];
        var rv = right[k];
        sq += 0.5 * (lv * lv + rv * rv);
        count++;
    }
    return count > 0 ? Math.sqrt(sq / count) : 0;
}

function scan(left, right, sr) {
    var nan = 0;
    var peak = 0;
    var peakL = 0;
    var peakR = 0;
    var sq = 0;
    var diffSq = 0;
    var len = left.length;

    for (var k = 0; k < len; k++) {
        var lv = left[k];
        var rv = right[k];
        if (lv !== lv || lv === Infinity || lv === -Infinity) nan++;
        else if (Math.abs(lv) > peakL) peakL = Math.abs(lv);
        if (rv !== rv || rv === Infinity || rv === -Infinity) nan++;
        else if (Math.abs(rv) > peakR) peakR = Math.abs(rv);
        if (peakL > peak) peak = peakL;
        if (peakR > peak) peak = peakR;
        sq += 0.5 * (lv * lv + rv * rv);
        diffSq += (lv - rv) * (lv - rv);
    }

    var rms = len > 0 ? Math.sqrt(sq / len) : 0;
    var stereoDiff = len > 0 ? Math.sqrt(diffSq / len) : 0;
    return { nan: nan, peak: peak, peakL: peakL, peakR: peakR, rms: rms, stereoDiff: stereoDiff };
}


// ---------------------------------------------------------------------------
// Spectral / temporal metrics on the mid signal (all keys are single tokens).
// ---------------------------------------------------------------------------
function fftInPlace(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
        var bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            var tr = re[i]; re[i] = re[j]; re[j] = tr;
            var ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (var len = 2; len <= n; len <<= 1) {
        var ang = -2 * Math.PI / len;
        var wr = Math.cos(ang), wi = Math.sin(ang);
        for (var a = 0; a < n; a += len) {
            var cr = 1, ci = 0;
            for (var b = 0; b < len / 2; b++) {
                var ur = re[a + b], ui = im[a + b];
                var vr = re[a + b + len / 2] * cr - im[a + b + len / 2] * ci;
                var vi = re[a + b + len / 2] * ci + im[a + b + len / 2] * cr;
                re[a + b] = ur + vr; im[a + b] = ui + vi;
                re[a + b + len / 2] = ur - vr; im[a + b + len / 2] = ui - vi;
                var nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

function analyzeSpectrum(left, right, sr) {
    var out = {};
    var len = left.length;
    var mid = new Array(len);
    var peak = 0;
    var chk = 0;
    for (var i = 0; i < len; i++) {
        mid[i] = 0.5 * (left[i] + right[i]);
        if (Math.abs(mid[i]) > peak) peak = Math.abs(mid[i]);
        chk += left[i] * ((i % 97) + 1) + right[i] * ((i % 89) + 1) * 0.5;
    }
    out.chk = chk;
    // first audible sample (5% of the peak), in ms from the start of the recording
    var startIdx = -1;
    for (var q = 0; q < len; q++) { if (Math.abs(mid[q]) > 0.05 * peak) { startIdx = q; break; } }
    out.startMs = (startIdx >= 0) ? 1000.0 * startIdx / sr : -1;

    // Spectrum of the analysis window (Hann, zero padded to 16384).
    var N = 16384;
    var a0 = Math.floor((Number(opt.ana || 100) / 1000.0) * sr);
    var re = new Array(N), im = new Array(N);
    var cnt = Math.max(Math.min(len - a0, N), 0);
    for (var k = 0; k < N; k++) {
        var w = (k < cnt) ? (0.5 - 0.5 * Math.cos(2 * Math.PI * k / Math.max(cnt - 1, 1))) : 0;
        re[k] = (k < cnt) ? mid[a0 + k] * w : 0;
        im[k] = 0;
    }
    fftInPlace(re, im);
    var half = N / 2;
    var mag = new Array(half);
    var tot = 0, cen = 0, best = 0, bestK = 0;
    var edges = [20, 150, 300, 600, 1200, 2400, 4800, 9600, 24000];
    var band = [0, 0, 0, 0, 0, 0, 0, 0];
    var hf2 = 0;
    var binHz = sr / N;
    for (var m = 1; m < half; m++) {
        mag[m] = Math.sqrt(re[m] * re[m] + im[m] * im[m]) / Math.max(cnt, 1) * 4;
        var pw = mag[m] * mag[m];
        var f = m * binHz;
        if (f < 20) continue;
        tot += pw; cen += pw * f;
        if (f > 2000) hf2 += pw;
        for (var e = 0; e < 8; e++) { if (f >= edges[e] && f < edges[e + 1]) { band[e] += pw; break; } }
        if (f > 40 && f < 8000 && mag[m] > best) { best = mag[m]; bestK = m; }
    }
    mag[0] = 0;
    var pkHz = bestK * binHz;
    if (bestK > 1 && bestK < half - 1) {
        var ya = Math.log(mag[bestK - 1] + 1e-12), yb = Math.log(mag[bestK] + 1e-12), yc = Math.log(mag[bestK + 1] + 1e-12);
        var den = ya - 2 * yb + yc;
        if (Math.abs(den) > 1e-9) pkHz = (bestK + 0.5 * (ya - yc) / den) * binHz;
    }
    out.specPeakHz = pkHz;
    out.specPeakMag = best;
    out.centroid = tot > 0 ? cen / tot : 0;
    out.hfFrac = tot > 0 ? hf2 / tot : 0;
    out.specPower = tot;
    for (var bb = 0; bb < 8; bb++) out["band" + bb] = tot > 0 ? band[bb] / tot : 0;
    // Harmonics of f0
    var f0 = Number(opt.f0 || 220);
    for (var h = 1; h <= 8; h++) {
        var kc = Math.round(f0 * h / binHz);
        var span = Math.max(2, Math.round(kc * 0.025));
        var hm = 0;
        for (var kk = Math.max(kc - span, 1); kk <= Math.min(kc + span, half - 1); kk++) hm = Math.max(hm, mag[kk]);
        out["h" + h] = hm;
    }
    // Short-time RMS modulation depth and envelope onset count (analysis region only)
    var hop = Math.floor(sr * 0.005);
    var rmsList = [];
    for (var s0 = a0; s0 + hop <= len; s0 += hop) {
        var sq = 0;
        for (var z = 0; z < hop; z++) sq += mid[s0 + z] * mid[s0 + z];
        rmsList.push(Math.sqrt(sq / hop));
    }
    var mean = 0, vr = 0;
    for (var r1 = 0; r1 < rmsList.length; r1++) mean += rmsList[r1];
    mean = rmsList.length ? mean / rmsList.length : 0;
    for (var r2 = 0; r2 < rmsList.length; r2++) vr += (rmsList[r2] - mean) * (rmsList[r2] - mean);
    out.modDepth = (mean > 1e-9 && rmsList.length) ? Math.sqrt(vr / rmsList.length) / mean : 0;
    var env = 0, mx = 0, envArr = new Array(len);
    for (var n2 = a0; n2 < len; n2++) {
        var ab = Math.abs(mid[n2]);
        env = ab > env ? env + (ab - env) * 0.04 : env + (ab - env) * 0.004;
        envArr[n2] = env;
        if (env > mx) mx = env;
    }
    var armed = true, ons = 0;
    for (var n3 = a0; n3 < len; n3++) {
        if (armed && envArr[n3] > 0.5 * mx) { ons++; armed = false; }
        else if (!armed && envArr[n3] < 0.25 * mx) armed = true;
    }
    out.envOnsets = ons;
    return out;
}

function dumpMetrics(m) {
    var txt = "";
    for (var key in m) {
        var v = m[key];
        if (v !== v) v = -999;
        txt += key + " " + v + "\n";
    }
    return txt;
}
