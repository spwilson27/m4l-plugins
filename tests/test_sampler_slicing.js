// Unit tests for the Better Sampler slicers in src/sampler_config.js.
const C = require("../src/sampler_config.js");
let fails = 0, passes = 0;
function ok(c, m) { if (c) passes++; else { fails++; console.log("FAIL: " + m); } }
function near(a, b, t) { return Math.abs(a - b) <= t; }
function ms() { const t = process.hrtime.bigint(); return Number(t) / 1e6; }
const SR = 48000;

function clicks(times, dur) {
    const x = new Float32Array(Math.round(dur * SR));
    let seed = 1;
    for (const t of times) {
        const i0 = Math.round(t * SR);
        for (let k = 0; k < 300 && i0 + k < x.length; k++) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            x[i0 + k] += (seed / 2147483648 - 1) * 0.8 * Math.exp(-k / 60);
        }
    }
    return x;
}
function tones(segs, sr) {
    const n = segs.reduce((a, s) => a + s[1], 0), x = new Float32Array(Math.round(n * sr));
    let i = 0, ph = 0;
    for (const [f, d] of segs) {
        const m = Math.round(d * sr);
        for (let k = 0; k < m; k++, i++) {
            ph += 2 * Math.PI * f / sr;
            x[i] = f > 0 ? 0.5 * Math.sin(ph) + 0.2 * Math.sin(2 * ph) : 0;
        }
    }
    return x;
}

// divisions
{
    let d = C.sliceDivisions(0, 1, 4);
    ok(d.length === 4 && d[0] === 0 && d[1] === 0.25 && d[3] === 0.75, "divisions 4");
    d = C.sliceDivisions(0.2, 0.6, 2);
    ok(d.length === 2 && near(d[0], 0.2, 1e-12) && near(d[1], 0.4, 1e-12), "divisions window");
    ok(C.sliceDivisions(0, 1, 500).length === 64, "divisions cap 64");
    ok(C.sliceDivisions(0, 1, 0).length === 1, "divisions min 1");
    ok(C.sliceDivisions(0.5, 0.5, 4).length === 0, "divisions empty window");
}
// beats: 120 bpm, 10 s at 48k => beat = 0.5 s = 0.05 normalized
{
    const fr = 10 * SR;
    let b = C.sliceBeats(0, 1, fr, SR, 120, 2);
    ok(b.length === 20 && near(b[1], 0.05, 1e-12) && near(b[19], 0.95, 1e-9), "1/4 at 120bpm");
    b = C.sliceBeats(0.1, 1, fr, SR, 120, 0);
    ok(b.length === 5 && near(b[0], 0.1, 1e-12) && near(b[1], 0.3, 1e-12), "1 bar from start");
    b = C.sliceBeats(0, 1, fr, SR, 120, 3);
    ok(near(b[1], 0.05 * 2 / 3, 1e-12), "1/4T interval");
    b = C.sliceBeats(0, 1, fr, SR, 120, 5);
    ok(near(b[1], 0.025 * 2 / 3, 1e-12), "1/8T interval");
    ok(near(C.sliceBeats(0, 1, fr, SR, 120, 9)[1], 0.00625 * 2 / 3, 1e-12), "1/32T interval");
    b = C.sliceBeats(0, 1, 60 * SR, SR, 200, 8);
    ok(b.length === 256, "beats cap 256, got " + b.length);
    ok(C.sliceBeats(0, 1, 0, SR, 120, 2).length === 0, "beats zero frames");
    ok(C.sliceBeats(0, 1, fr, SR, 0, 2).length === 20, "beats bpm fallback");
    ok(C.SLICE_BEAT_NAMES.length === 10 && C.SLICE_BEAT_NAMES[3] === "1/4T", "beat names");
}
// bpmFromName
{
    const t = [["loop 172 BPM.wav", 172], ["loop172bpm.wav", 172], ["x_172_y.wav", 172], ["DS_PMB_160_vocal_phrase.wav", 160],
        ["bpm 90 pad.wav", 90], ["/a/b/Kick 808.wav", 0], ["take_5.wav", 0], ["x_250_.wav", 0], ["loop_95bpm_C.wav", 95], ["noname.wav", 0], ["a_1234_b.wav", 0]];
    for (const [n, v] of t) ok(C.bpmFromName(n) === v, "bpmFromName " + n + " => " + C.bpmFromName(n) + " want " + v);
    ok(C.bpmFromName(null) === 0 && C.bpmFromName("") === 0, "bpmFromName empty");
}
// onsets
{
    const times = [0.5, 1.1, 1.9, 2.0, 3.4, 4.05, 6.2, 7.7];
    const x = clicks(times, 9);
    const m = C.sliceOnsets(x, SR, 0.5, 0, 1);
    const sec = m.map(p => p * 9);
    ok(m.length === times.length, "onset count " + m.length + " " + sec.map(v => v.toFixed(3)));
    for (const t of times) ok(sec.some(s => near(s, t, 0.005)), "onset near " + t);
    for (let i = 1; i < sec.length; i++) ok(sec[i] - sec[i - 1] >= 0.03, "onset spacing");
    ok(m.every((p, i) => i === 0 || p > m[i - 1]) && m.every(p => p >= 0 && p < 1), "onsets sorted in range");
    const arr = C.sliceOnsets(Array.from(x), SR, 0.5, 0, 1);
    ok(arr.length === m.length, "Array input");
    const lo = C.sliceOnsets(x, SR, 0.0, 0, 1), hi = C.sliceOnsets(x, SR, 1.0, 0, 1);
    ok(hi.length >= lo.length, "sensitivity monotone");
    // window: only 2.5..5 s
    const w = C.sliceOnsets(x, SR, 0.5, 2.5 / 9, 5 / 9);
    ok(w.length === 2 && w.every(p => p >= 2.5 / 9 && p < 5 / 9), "onset window " + w.length);
    // click right at start is not marked (within 10 ms)
    const x0 = clicks([0.002, 0.5], 1);
    const m0 = C.sliceOnsets(x0, SR, 0.5, 0, 1);
    ok(m0.length === 1 && near(m0[0], 0.5, 0.005), "no marker within 10ms of start");
    // quiet clicks with a loud one: high sens finds more
    const q = clicks([1.0], 3); const q2 = clicks([2.0], 3);
    for (let i = 0; i < q.length; i++) q[i] = q[i] + 0.05 * q2[i];
    ok(C.sliceOnsets(q, SR, 1.0, 0, 1).length >= C.sliceOnsets(q, SR, 0.0, 0, 1).length, "quiet click sens");
}
// pitches
{
    const segs = [[220, 0.6], [330, 0.6], [247, 0.6]];
    const x = tones(segs, SR), dur = 1.8;
    const m = C.slicePitches(x, SR, 0.5, 0, 1).map(p => p * dur);
    ok(m.length === 2, "pitch markers " + m.map(v => v.toFixed(3)));
    ok(m.length >= 1 && near(m[0], 0.6, 0.05), "pitch step 1 near 0.6: " + m[0]);
    ok(m.length >= 2 && near(m[1], 1.2, 0.05), "pitch step 2 near 1.2: " + m[1]);
    // steady tone: no markers
    ok(C.slicePitches(tones([[220, 2]], SR), SR, 1.0, 0, 1).length === 0, "steady tone no markers");
    // vibrato-free semitone step caught at high sensitivity
    const st = tones([[220, 0.6], [233.08, 0.6]], SR);
    ok(C.slicePitches(st, SR, 1.0, 0, 1).length === 1, "semitone step at high sensitivity");
    // unvoiced -> voiced
    const uv = tones([[0, 0.5], [220, 0.5], [0, 0.3], [220, 0.5]], SR);
    const mu = C.slicePitches(uv, SR, 0.5, 0, 1).map(p => p * 1.8);
    ok(mu.length === 2 && near(mu[0], 0.5, 0.05) && near(mu[1], 1.3, 0.05), "unvoiced->voiced " + mu.map(v => v.toFixed(3)));
    // window: only the second half
    const w = C.slicePitches(x, SR, 0.5, 0.5 / 1.8 + 0.05, 1);
    ok(w.length === 1 && near(w[0] * dur, 1.2, 0.05), "pitch window");
    // 44.1k
    const x44 = tones(segs, 44100);
    const m44 = C.slicePitches(x44, 44100, 0.5, 0, 1);
    ok(m44.length === 2 && near(m44[0] * 1.8, 0.6, 0.05), "pitch 44.1k");
}
// manual
{
    const a = [0.2, 0.6];
    const b = C.addSliceMarker(a, 0.4);
    ok(JSON.stringify(b) === "[0.2,0.4,0.6]" && a.length === 2, "add sorted, new array");
    ok(C.addSliceMarker(b, 0.4015).length === 3, "reject within 0.002");
    ok(C.addSliceMarker(b, 0.403).length === 4, "accept beyond 0.002");
    ok(C.addSliceMarker(b, 1).length === 3 && C.addSliceMarker(b, -0.1).length === 3 && C.addSliceMarker(b, NaN).length === 3, "reject out of range");
    ok(C.addSliceMarker(null, 0.5).length === 1, "add to null");
    const r = C.removeSliceMarker(b, 1);
    ok(JSON.stringify(r) === "[0.2,0.6]" && b.length === 3, "remove, new array");
    ok(C.removeSliceMarker(b, 9).length === 3 && C.removeSliceMarker(b, -1).length === 3, "remove invalid index");
}
// edge cases
{
    const sil = new Float32Array(5 * SR);
    ok(C.sliceOnsets(sil, SR, 1, 0, 1).length === 0, "silence onsets");
    ok(C.slicePitches(sil, SR, 1, 0, 1).length === 0, "silence pitches");
    ok(C.sliceOnsets(new Float32Array(10), SR, 1, 0, 1).length === 0, "tiny onsets");
    ok(C.slicePitches(new Float32Array(100), SR, 1, 0, 1).length === 0, "tiny pitches");
    ok(C.sliceOnsets([], SR, 1, 0, 1).length === 0 && C.slicePitches(null, SR, 1, 0, 1).length === 0, "empty/null");
    ok(C.sliceOnsets(clicks([0.5], 1), SR, 0.5, 0.6, 0.6).length === 0, "empty window");
    ok(C.sliceOnsets(clicks([0.5], 1), SR, NaN, 0, 1).length === 1, "NaN sensitivity");
}
// performance: 60 s at 48 kHz
{
    const times = []; for (let t = 0.4; t < 59.5; t += 0.37) times.push(t);
    const x = clicks(times, 60);
    let t0 = ms(); const mo = C.sliceOnsets(x, SR, 0.5, 0, 1); const to = ms() - t0;
    const segs = []; const fr = [220, 262, 330, 247, 392, 294]; for (let i = 0; i < 100; i++) segs.push([fr[i % fr.length], 0.6]);
    const tn = tones(segs, SR);
    t0 = ms(); const mp = C.slicePitches(tn, SR, 0.5, 0, 1); const tp = ms() - t0;
    console.log("perf: onsets " + to.toFixed(1) + " ms (" + mo.length + " markers), pitches " + tp.toFixed(1) + " ms (" + mp.length + " markers)");
    ok(to < 150, "onset budget");
    ok(tp < 150, "pitch budget");
    ok(near(mo.length, times.length, 2), "perf onset count " + mo.length + "/" + times.length);
    ok(near(mp.length, 99, 3), "perf pitch count " + mp.length);
}
// slice base note
{
    const sl = [0, 0.25, 0.5, 0.75];
    const a = C.createVoiceAllocator(8);
    ok(a.noteOn(37, 100, 0, sl).sliceStart === 0.25, "default base 36");
    a.setSliceBaseNote(48);
    ok(a.noteOn(48, 100, 0, sl).sliceStart === 0, "base 48: note 48 -> slice 0");
    ok(a.noteOn(50, 100, 0, sl).sliceStart === 0.5, "base 48: note 50 -> slice 2");
    ok(a.noteOn(40, 100, 0, sl).sliceStart === 0, "notes below base clamp to slice 0");
    ok(a.noteOn(53, 100, 0, sl).sliceStart === 0.25, "past last slice wraps (53-48=5 -> 1)");
    const b = C.createVoiceAllocator(8);
    b.setSliceBaseNote(48);
    const v = b.noteOn(50, 100, 0, sl);
    b.updateSliceBounds([0, 0.1, 0.2, 0.3], 0.4);
    ok(v.sliceStart === 0.2 && Math.abs(v.sliceEnd - 0.3) < 1e-12, "updateSliceBounds uses the base");
    b.setSliceBaseNote(49);
    b.updateSliceBounds([0, 0.1, 0.2, 0.3], 0.4);
    ok(v.sliceStart === 0.1, "updateSliceBounds follows a new base");
}
console.log(passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
