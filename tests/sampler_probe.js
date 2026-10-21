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
//   start=live    trigger from the setbuffers message instead of the harness event (CPU cases)
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
var trigSeq = 0;
var resultPath = "/tmp/sampler_audio.txt";

function resultpath(p) { resultPath = String(p); }

function setbuffers(sName, vName, scName) {
    sampName = String(sName || "");
    voicesName = String(vName || "");
    scopeName = String(scName || "");
    seedSample();
    if (opt.start === "live") { trigSeq += 1; seedVoices(); }
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
    sb.send("sizeinsamps", 12000);
    var frames = sb.framecount() || 12000;
    if (frames > 12000) frames = 12000;
    var ch1 = new Array(frames);
    var ch2 = new Array(frames);
    var src = opt.src || "tone";
    var sr0 = (src === "tone") ? 44100.0 : 48000.0;
    for (var i = 0; i < frames; i++) {
        var t = i / sr0;
        var env = Math.min(1.0, i / 32.0) * Math.exp(-i / 3500.0);
        if (src === "sus48" || src === "rich48" || src === "slices4") env = Math.min(1.0, i / 32.0);
        var w = 0;
        if (src === "slices4") {
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
        vFlat[base + 2] = 0.90;       // velocity
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
    snaps[String(label)] = { voice: best, pos: best >= 0 ? chunk[best] : -1, amp: bestA };
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
        dumpMetrics(metrics) +
        seqReport(left, right, sr)
    );
    report.close();
    if (opt.dump) {
        var df = new File(resultPath + ".wav.txt", "write", "TEXT");
        var a1 = Math.floor(sr * Number(opt.ana || 100) / 1000);
        for (var di = 0; di < 1200; di++) df.writestring((left[a1 + di] === undefined ? 0 : left[a1 + di]) + "\n");
        df.close();
    }
    outlet(0, "bang");
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
    var chunk = buf.peek(1, 0, 49);
    if (!chunk || !chunk.length) {
        return { spawns: -1, activeVoices: 0, peakL: 0, cutHz: 0, sampFrames: 0, scopeLen: 0, jsFrames: jsFrames };
    }
    return {
        pos0: (chunk[0] === undefined) ? -1 : chunk[0],
        peakL: chunk[32] || 0,
        activeVoices: chunk[34] || 0,
        cutHz: chunk[37] || 0,
        spawns: (chunk.length > 48 && chunk[48] !== undefined) ? chunk[48] : -1,
        sampFrames: (chunk.length > 38 && chunk[38] !== undefined) ? chunk[38] : -3,
        scopeLen: chunk.length,
        jsFrames: jsFrames,
        gp: chunk.slice(40, 48),
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
    var sq = 0;
    var diffSq = 0;
    var len = left.length;

    for (var k = 0; k < len; k++) {
        var lv = left[k];
        var rv = right[k];
        if (lv !== lv || lv === Infinity || lv === -Infinity) nan++;
        else if (Math.abs(lv) > peak) peak = Math.abs(lv);
        if (rv !== rv || rv === Infinity || rv === -Infinity) nan++;
        else if (Math.abs(rv) > peak) peak = Math.abs(rv);
        sq += 0.5 * (lv * lv + rv * rv);
        diffSq += (lv - rv) * (lv - rv);
    }

    var rms = len > 0 ? Math.sqrt(sq / len) : 0;
    var stereoDiff = len > 0 ? Math.sqrt(diffSq / len) : 0;
    return { nan: nan, peak: peak, rms: rms, stereoDiff: stereoDiff };
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
