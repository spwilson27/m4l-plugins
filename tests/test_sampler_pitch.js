// Unit tests for trackPitchCurve (Analyzed Root Key) in src/sampler_config.js.
const C = require("../src/sampler_config.js");
let fails = 0, passes = 0;
function ok(c, m) { if (c) passes++; else { fails++; console.log("FAIL: " + m); } }
const SR = 48000, P = 4096;
const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
const f2m = (f) => 69 + 12 * Math.log2(f / 440);
let seed = 7;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; }

// segs: [{dur, hz, hz2?, shape: sine|saw|pulse|noise|silence, amp}]
function synth(segs) {
    let total = 0; for (const s of segs) total += Math.round(s.dur * SR);
    const x = new Float32Array(total); let i = 0, ph = 0;
    for (const s of segs) {
        const n = Math.round(s.dur * SR), a = s.amp || 0.5;
        for (let k = 0; k < n; k++, i++) {
            const hz = !s.hz ? 0 : s.hz2 ? s.hz + (s.hz2 - s.hz) * k / n : s.hz;
            ph += hz / SR; ph -= Math.floor(ph);
            let v = 0;
            if (s.shape === "noise") v = rnd();
            else if (s.shape === "saw") v = 2 * ph - 1;
            else if (s.shape === "pulse") v = ph < 0.2 ? 1 : -0.25;
            else if (s.shape === "silence") v = 0;
            else v = Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph);
            x[i] = v * a;
        }
    }
    return x;
}
function seg(c, a, b) { // curve values over fraction range [a,b]
    const o = []; for (let i = Math.ceil(a * (P - 1)); i <= Math.floor(b * (P - 1)); i++) o.push(i); return o;
}
function within(r, a, b, target, tol, msg) {
    let worst = 0;
    for (const i of seg(r.curve, a, b)) worst = Math.max(worst, Math.abs(r.curve[i] - target));
    ok(worst <= tol, msg + " (worst dev " + worst.toFixed(3) + ")");
}

// constant tones
for (const hz of [220, 440, 110, 55, 1000]) {
    const r = C.trackPitchCurve(synth([{ dur: 1.5, hz }]), SR, P, 60);
    ok(r.curve.length === P && r.voiced.length === P, "sizes " + hz);
    within(r, 0, 1, f2m(hz), hz >= 1000 ? 0.15 : 0.1, "const " + hz + " Hz");
    ok(r.voicedRatio > 0.95, "voiced ratio " + hz + " = " + r.voicedRatio);
}
// 57.03 example
{
    const r = C.trackPitchCurve(synth([{ dur: 1, hz: 220 }]), SR, P, 0);
    ok(Math.abs(r.curve[P >> 1] - 57.0) < 0.1, "220 Hz is MIDI 57");
}
// steps 220 -> 330 -> 247, 1 s each
{
    const r = C.trackPitchCurve(synth([{ dur: 1, hz: 220 }, { dur: 1, hz: 330 }, { dur: 1, hz: 247 }]), SR, P, 60);
    within(r, 0.02, 0.31, f2m(220), 0.2, "step A");
    within(r, 0.36, 0.64, f2m(330), 0.2, "step B");
    within(r, 0.69, 0.98, f2m(247), 0.2, "step C");
    // transition near 1/3 and 2/3: below midpoint before, above after
    const mid1 = (f2m(220) + f2m(330)) / 2;
    const i1 = r.curve.findIndex((v) => v > mid1) / (P - 1);
    ok(Math.abs(i1 - 1 / 3) < 0.02, "transition 1 at " + i1.toFixed(3));
    const mid2 = (f2m(330) + f2m(247)) / 2;
    let i2 = -1; for (let i = P - 1; i >= 0; i--) if (r.curve[i] > mid2) { i2 = i; break; }
    ok(Math.abs(i2 / (P - 1) - 2 / 3) < 0.02, "transition 2 at " + (i2 / (P - 1)).toFixed(3));
}
// glide 200 -> 400 Hz (one octave), monotone and accurate
{
    const r = C.trackPitchCurve(synth([{ dur: 3, hz: 200, hz2: 400 }]), SR, P, 60);
    let worst = 0, mono = true;
    for (let i = 0; i < P; i++) {
        const t = i / (P - 1);
        const exp = f2m(200 + 200 * t); // linear-in-Hz glide
        if (i > 20 && i < P - 20) worst = Math.max(worst, Math.abs(r.curve[i] - exp));
        if (i > 0 && r.curve[i] < r.curve[i - 1] - 0.3) mono = false;
    }
    ok(worst < 0.35, "glide tracks (worst " + worst.toFixed(3) + ")");
    ok(mono, "glide is monotone");
}
// harmonic-rich saw and pulse: no octave errors
for (const shape of ["saw", "pulse"]) {
    for (const hz of [110, 196, 330]) {
        const r = C.trackPitchCurve(synth([{ dur: 1.5, hz, shape }]), SR, P, 60);
        within(r, 0.02, 0.98, f2m(hz), 0.25, shape + " " + hz + " Hz");
    }
}
// tone, noise, tone: noise holds first pitch and is unvoiced
{
    const r = C.trackPitchCurve(synth([{ dur: 1, hz: 220 }, { dur: 1, shape: "noise" }, { dur: 1, hz: 330 }]), SR, P, 60);
    within(r, 0.02, 0.31, f2m(220), 0.2, "tone before noise");
    within(r, 0.40, 0.61, f2m(220), 0.2, "noise holds previous pitch");
    within(r, 0.70, 0.98, f2m(330), 0.2, "tone after noise");
    let bad = 0; for (const i of seg(r.curve, 0.38, 0.62)) if (r.voiced[i]) bad++;
    ok(bad <= 1, "noise unvoiced (" + bad + " voiced points)");
    ok(r.voicedRatio > 0.5 && r.voicedRatio < 0.75, "ratio " + r.voicedRatio);
}
// leading silence takes first voiced pitch
{
    const r = C.trackPitchCurve(synth([{ dur: 1, shape: "silence" }, { dur: 1.5, hz: 261.63 }]), SR, P, 40);
    within(r, 0, 1, 60, 0.15, "leading silence");
    ok(r.voiced[10] === 0 && r.voiced[P - 10] === 1, "voiced flags around silence");
}
// all noise / silence: fallback
{
    const r = C.trackPitchCurve(synth([{ dur: 2, shape: "noise" }]), SR, P, 48);
    let w = 0; for (let i = 0; i < P; i++) w = Math.max(w, Math.abs(r.curve[i] - 48));
    ok(w < 1e-6, "noise -> fallback");
    ok(r.voicedRatio < 0.05, "noise voicedRatio " + r.voicedRatio);
    const s = C.trackPitchCurve(new Float32Array(SR), SR, P, 52);
    ok(s.curve[0] === 52 && s.curve[P - 1] === 52 && s.voicedRatio === 0, "silence -> fallback");
}
// degenerate input
{
    for (const len of [0, 1, 100, 500, 2000]) {
        const r = C.trackPitchCurve(synth([{ dur: len / SR, hz: 220 }]), SR, 64, 61);
        ok(r.curve.length === 64 && r.curve[0] === 61 && r.curve[63] === 61, "short buffer " + len + " -> fallback");
    }
    const e = C.trackPitchCurve(null, SR, 8, 55);
    ok(e.curve.length === 8 && e.curve[3] === 55, "null input");
    const one = C.trackPitchCurve(synth([{ dur: 1, hz: 220 }]), SR, 1, 60);
    ok(one.curve.length === 1 && Math.abs(one.curve[0] - 57) < 0.15, "points = 1 -> " + one.curve[0]);
    const two = C.trackPitchCurve(synth([{ dur: 1, hz: 220 }]), SR, 2, 60);
    ok(two.curve.length === 2 && Math.abs(two.curve[1] - 57) < 0.15, "points = 2");
    for (const sr of [44100, 24000, 22050]) {
        const x = new Float32Array(sr);
        for (let i = 0; i < sr; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / sr);
        const r = C.trackPitchCurve(x, sr, 100, 60);
        ok(Math.abs(r.curve[50] - 57) < 0.15 && r.voicedRatio > 0.9, sr + " Hz rate ok");
    }
}
// performance: 60 s at 48 kHz (voiced + noise mix = the worst case, every frame runs YIN)
{
    const x = synth([{ dur: 20, hz: 220, shape: "saw" }, { dur: 20, shape: "noise" }, { dur: 20, hz: 330, hz2: 440 }]);
    C.trackPitchCurve(x.subarray(0, SR * 2), SR, P, 60); // warm up
    let best = 1e9;
    for (let k = 0; k < 3; k++) {
        const t = process.hrtime.bigint();
        C.trackPitchCurve(x, SR, P, 60);
        best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
    }
    console.log("60 s @ 48 kHz: " + best.toFixed(1) + " ms (best of 3)");
    ok(best < 200, "perf budget < 200 ms (" + best.toFixed(1) + ")");
}
console.log("sampler pitch tests: " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
