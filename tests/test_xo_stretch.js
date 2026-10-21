#!/usr/bin/env node
/**
 * Tests for src/xo_stretch.js (granular / complex / texture stretch engines).
 *
 * Writes A/B WAVs (drum loop, chord, speech-like; 50 % and 200 % speed; every mode) to $XO_STRETCH_AB_DIR, default
 * <os tmpdir>/xo_stretch_ab (tests/out is tracked by git, so it is not used).
 * Set XO_STRETCH_QUICK=1 to skip the WAV renders.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const X = require(path.join(ROOT, "src", "xo_stretch.js"));

const SR = 44100;
const AB_DIR = process.env.XO_STRETCH_AB_DIR || path.join(os.tmpdir(), "xo_stretch_ab");
let failures = 0;
const metrics = {};

function check(name, fn) {
  try {
    fn();
    console.log("ok   - " + name);
  } catch (e) {
    failures++;
    console.log("FAIL - " + name + "\n       " + (e && e.message ? e.message : e));
  }
}

/* ---------------------------------------------------------- signals */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function sine(freq, seconds, amp = 0.5) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  return x;
}

function chord(seconds) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const f = [220, 277.18, 329.63];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const ff of f) v += Math.sin(2 * Math.PI * ff * i / SR);
    x[i] = v * 0.16;
  }
  return x;
}

function noise(seconds, amp = 0.3, seed = 7) {
  const r = rng(seed);
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * (r() * 2 - 1);
  return x;
}

/** 1-sample clicks every `period` seconds starting at `first`. */
function impulseTrain(seconds, period, first = 0.5) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const times = [];
  for (let t = first; t < seconds - 0.3; t += period) {
    x[Math.round(t * SR)] = 0.9;
    times.push(Math.round(t * SR));
  }
  return { x, times };
}

/** Drum-like clicks: damped noise bursts / kick sweeps on silence. */
function clickTrack(seconds, period, first = 0.5) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const times = [];
  const r = rng(11);
  let k = 0;
  for (let t = first; t < seconds - 0.4; t += period, k++) {
    const s0 = Math.round(t * SR);
    times.push(s0);
    const len = Math.round(0.18 * SR);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const env = Math.exp(-i / (0.035 * SR));
      if (k % 2 === 0) {
        const f = 50 + 150 * Math.exp(-i / (0.02 * SR));
        x[s0 + i] += 0.85 * env * Math.sin(2 * Math.PI * f * i / SR);
      } else {
        x[s0 + i] += 0.8 * env * (r() * 2 - 1) * (i < 8 ? 1 : 0.8);
      }
    }
  }
  return { x, times };
}

function drumLoop(bars = 2, bpm = 110) {
  const beat = 60 / bpm;
  const seconds = bars * 4 * beat;
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(5);
  const add = (t, kind) => {
    const s0 = Math.round(t * SR);
    const len = Math.round((kind === "hat" ? 0.06 : kind === "kick" ? 0.35 : 0.22) * SR);
    let hp = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      let v = 0;
      if (kind === "kick") {
        const f = 45 + 110 * Math.exp(-i / (0.025 * SR));
        v = 0.9 * Math.exp(-i / (0.12 * SR)) * Math.sin(2 * Math.PI * f * i / SR);
        if (i < 30) v += 0.4 * (r() * 2 - 1);
      } else if (kind === "snare") {
        v = Math.exp(-i / (0.06 * SR)) * (0.6 * (r() * 2 - 1) + 0.4 * Math.sin(2 * Math.PI * 190 * i / SR));
      } else {
        const nz = r() * 2 - 1;
        v = 0.5 * Math.exp(-i / (0.012 * SR)) * (nz - hp);
        hp = nz;
      }
      const pan = kind === "hat" ? 0.7 : 0.5;
      L[s0 + i] += v * (1 - pan) * 1.4;
      R[s0 + i] += v * pan * 1.4;
    }
  };
  for (let b = 0; b < bars * 4; b++) {
    const t = b * beat;
    if (b % 4 === 0 || b % 4 === 2) add(t, "kick");
    if (b % 4 === 1 || b % 4 === 3) add(t, "snare");
    add(t, "hat");
    add(t + beat / 2, "hat");
    if (b % 4 === 3) add(t + beat * 0.75, "kick");
  }
  return [L, R];
}

function speechLike(seconds = 3) {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(3);
  // glottal pulse train through 3 formant resonators
  const formants = [[700, 90], [1220, 110], [2600, 160]];
  const state = formants.map(() => [0, 0]);
  const syll = [[0.05, 0.4, 0.5], [0.55, 0.95, 0.9], [1.1, 1.6, 0.7], [1.8, 2.3, 1.1], [2.45, 2.9, 0.8]];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0, f0 = 110, voiced = 0;
    for (const s of syll) {
      if (t >= s[0] && t <= s[1]) {
        const u = (t - s[0]) / (s[1] - s[0]);
        env = Math.sin(Math.PI * u) ** 0.6;
        f0 = 100 + 30 * s[2] + 15 * Math.sin(2 * Math.PI * 5 * t) + 20 * u;
        voiced = 1;
      }
    }
    phase += f0 / SR;
    let src = 0;
    if (voiced) {
      if (phase >= 1) phase -= 1;
      src = (phase < 0.04 ? 1 : 0) - 0.04 + 0.02 * (r() * 2 - 1);
    }
    let y = 0;
    for (let k = 0; k < 3; k++) {
      const f = formants[k][0] * (1 + 0.15 * Math.sin(2 * Math.PI * 0.7 * t + k));
      const bw = formants[k][1];
      const rad = Math.exp(-Math.PI * bw / SR);
      const c1 = 2 * rad * Math.cos(2 * Math.PI * f / SR), c2 = -rad * rad;
      const st = state[k];
      const o = (1 - rad) * src * 6 + c1 * st[0] + c2 * st[1];
      st[1] = st[0]; st[0] = o;
      y += o * (k === 0 ? 1 : 0.6);
    }
    // fricative burst between syllables
    const fr = (t > 0.45 && t < 0.55) || (t > 1.65 && t < 1.78) ? 0.25 * (r() * 2 - 1) : 0;
    const v = (y * env + fr) * 0.6;
    L[i] = v * 0.9;
    R[i] = v * 1.0;
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let i = 0; i < n; i++) { L[i] *= 0.8 / pk; R[i] *= 0.8 / pk; }
  return [L, R];
}

/* ---------------------------------------------------------- analysis */

function rms(x, a = 0, b = x.length) {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

function db(v) {
  return 20 * Math.log10(Math.max(v, 1e-12));
}

function allFinite(chs) {
  return chs.every(c => { for (let i = 0; i < c.length; i++) if (!isFinite(c[i])) return false; return true; });
}

/** Spectrum of segment [a, b) with a 4-term Blackman-Harris window, zero padded to >= 2^17 (and >= the segment). */
function spectrum(x, a, b) {
  const len = b - a;
  let N = 1 << 17;
  while (N < len) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * u) + 0.14128 * Math.cos(4 * Math.PI * u) - 0.01168 * Math.cos(6 * Math.PI * u);
    re[i] = x[a + i] * w;
  }
  X.xsFft(re, im, N, false);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = re[k] * re[k] + im[k] * im[k];
  return { power: mag, binHz: SR / N };
}

function peakFreq(x, a, b) {
  const s = spectrum(x, a, b);
  let best = 0;
  for (let k = 1; k < s.power.length; k++) if (s.power[k] > s.power[best]) best = k;
  return best * s.binHz;
}

/** Energy outside +-halfWidth of the given centre frequencies, relative to the total, in dB. */
function offPeakDb(x, a, b, centres, halfWidth) {
  const s = spectrum(x, a, b);
  let total = 0, off = 0;
  for (let k = 1; k < s.power.length; k++) {
    const f = k * s.binHz;
    total += s.power[k];
    if (!centres.some(c => Math.abs(f - c) <= halfWidth)) off += s.power[k];
  }
  return 10 * Math.log10(off / total + 1e-30);
}

/**
 * Attack quality at an onset: input onset sample `t0`, stretch factor `alpha` (out/in).
 * Returns { preEchoDb, riseMs }: energy 8..40 ms before the output peak vs the peak, and the 10 %..90 % rise time of
 * the 0.5 ms smoothed absolute envelope.
 */
function attackMetrics(y, t0, alpha) {
  const q = Math.round(t0 * alpha);
  const a = Math.max(0, q - Math.round(0.06 * SR)), b = Math.min(y.length, q + Math.round(0.08 * SR));
  const sm = Math.round(0.0005 * SR);
  const env = new Float64Array(y.length);
  let acc = 0;
  for (let i = a; i < b; i++) {
    acc += Math.abs(y[i]);
    if (i - sm >= a) acc -= Math.abs(y[i - sm]);
    env[i] = acc / sm;
  }
  let pk = a, pv = 0;
  for (let i = a; i < b; i++) if (env[i] > pv) { pv = env[i]; pk = i; }
  const pre = rms(y, Math.max(0, pk - Math.round(0.040 * SR)), Math.max(1, pk - Math.round(0.008 * SR)));
  let i10 = pk, i90 = pk;
  for (let i = pk; i > a; i--) if (env[i] < 0.9 * pv) { i90 = i; break; }
  for (let i = i90; i > a; i--) if (env[i] < 0.1 * pv) { i10 = i; break; }
  const peakRms = rms(y, pk, Math.min(y.length, pk + Math.round(0.01 * SR))) || 1e-9;
  return { preEchoDb: db(pre / peakRms), riseMs: (i90 - i10) / SR * 1000, offsetMs: (pk - q) / SR * 1000 };
}

function meanAttack(y, times, alpha) {
  let pre = 0, rise = 0, n = 0, off = 0;
  for (const t of times) {
    if (t * alpha + 0.1 * SR > y.length) continue;
    const m = attackMetrics(y, t, alpha);
    pre += m.preEchoDb; rise += m.riseMs; off += Math.abs(m.offsetMs); n++;
  }
  return { preEchoDb: pre / n, riseMs: rise / n, offsetMs: off / n };
}

/* ---------------------------------------------------------- WAV */

function writeWav(file, chans, sr) {
  const n = chans[0].length, C = chans.length;
  const buf = Buffer.alloc(44 + n * C * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * C * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(C, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * C * 2, 28); buf.writeUInt16LE(C * 2, 32);
  buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * C * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[c][i])) * 32767), o);
      o += 2;
    }
  }
  fs.writeFileSync(file, buf);
}

/* ---------------------------------------------------------- tests */

async function main() {
  const modes = ["granular", "complex", "texture"];
  check("no Signalsmith API left in xo_stretch.js", () => {
    assert.strictEqual(X.loadSignalsmith, undefined);
    assert.strictEqual(X.stretchAudioAsync, undefined);
    assert.ok(!/smith/i.test(fs.readFileSync(path.join(ROOT, "src", "xo_stretch.js"), "utf8")));
  });
  check("an unknown mode name renders as complex", () => {
    const r = X.stretchAudioEx([sine(200, 1)], SR, { mode: "signalsmith", speed: 0.8 });
    assert.strictEqual(r.engine, "complex");
    assert.ok(allFinite(r.channels));
  });

  // ---- generic checks per mode
  const sus = [chord(4), noise(4, 0.25)];
  const fullScale = (() => {
    const x = sine(330, 3, 1.0);
    const y = chord(3);
    for (let i = 0; i < y.length; i++) y[i] = Math.max(-1, Math.min(1, y[i] * 5));
    return [x, y];
  })();
  for (const mode of modes) {
    for (const speed of [0.5, 1.37, 2, 3]) {
      check(`${mode} @${speed}x: length, finite, peak, loudness`, () => {
        const opts = { mode, speed, grainMs: 60, amount: 0.3 };
        const outLen = Math.round(sus[0].length / speed);
        sus.forEach((src, i) => {
          // granular on pure tones interferes between grains (inherent to the device engine): only noise is held to the level rule
          const r = X.stretchAudio([src, src], SR, opts);
          assert.strictEqual(r.length, 2);
          assert.ok(Math.abs(r[0].length - outLen) <= 1, `length ${r[0].length} vs ${outLen}`);
          assert.ok(allFinite(r), "NaN/Inf");
          // compare steady-state RMS (middle of the output, away from edges)
          const a = Math.round(r[0].length * 0.25), b = Math.round(r[0].length * 0.75);
          const ia = Math.round(src.length * 0.25), ib = Math.round(src.length * 0.75);
          const diff = db(rms(r[0], a, b)) - db(rms(src, ia, ib));
          metrics[`level_${mode}_${speed}_${i ? "noise" : "chord"}`] = diff;
          const tol = 1.5;
          assert.ok(Math.abs(diff) <= tol, `loudness ${diff.toFixed(2)} dB (signal ${i})`);
        });
        fullScale.forEach(src => {
          const r = X.stretchAudio([src], SR, opts);
          assert.ok(peakOf(r[0]) <= 1.0001, `peak ${peakOf(r[0])}`);
        });
      });
    }
    check(`${mode}: pitch shift keeps length and is finite`, () => {
      const src = chord(3);
      const r = X.stretchAudio([src], SR, { mode, speed: 1.25, pitchSt: 5, amount: 0.2 });
      assert.ok(Math.abs(r[0].length - Math.round(src.length / 1.25)) <= 1);
      assert.ok(allFinite(r));
      if (mode !== "texture" && mode !== "granular") {
        const f = peakFreq(r[0], Math.round(r[0].length * 0.2), Math.round(r[0].length * 0.8));
        const expect = [220, 277.18, 329.63].map(v => v * Math.pow(2, 5 / 12));
        assert.ok(expect.some(e => Math.abs(f - e) < 3), `peak at ${f.toFixed(1)} Hz, expected one of ${expect.map(e => e.toFixed(1))}`);
      }
    });
    if (mode !== "texture") {
      check(`${mode}: speed 1 / pitch 0 is a bit-exact bypass`, () => {
        const src = speechLike(1)[0];
        const r = X.stretchAudio([src], SR, { mode, speed: 1, pitchSt: 0 });
        assert.strictEqual(r[0].length, src.length);
        for (let i = 0; i < src.length; i++) assert.strictEqual(r[0][i], src[i]);
      });
    }
  }

  // ---- complex: tonal purity
  check("complex: 440 Hz sine at 50 % and 200 % speed stays at 440 Hz, low sidebands", () => {
    const src = sine(440, 4, 0.5);
    for (const speed of [0.5, 2]) {
      const y = X.stretchAudio([src], SR, { mode: "complex", speed })[0];
      const a = Math.round(y.length * 0.2), b = Math.round(y.length * 0.8);
      const f = peakFreq(y, a, b);
      assert.ok(Math.abs(f - 440) <= 2, `peak ${f} @${speed}`);
      const off = offPeakDb(y, a, b, [440], 20);
      metrics[`sine440_${speed}_offpeak_db`] = off;
      assert.ok(off < -30, `sidebands ${off.toFixed(1)} dB @${speed}`);
    }
  });

  check("complex: chord stays clean (3 partials, off-peak energy)", () => {
    const src = chord(4);
    for (const speed of [0.5, 2]) {
      const y = X.stretchAudio([src, src], SR, { mode: "complex", speed })[0];
      const a = Math.round(y.length * 0.2), b = Math.round(y.length * 0.8);
      const off = offPeakDb(y, a, b, [220, 277.18, 329.63], 15);
      metrics[`chord_${speed}_offpeak_db`] = off;
      assert.ok(off < -25, `chord off-peak ${off.toFixed(1)} dB @${speed}`);
      const f = peakFreq(y, a, b);
      assert.ok([220, 277.18, 329.63].some(c => Math.abs(f - c) < 2), "peak " + f);
    }
  });

  // ---- complex: transients vs plain phase vocoder
  const tracks = {
    clicks: clickTrack(8, 0.5),
    impulses: impulseTrain(8, 0.5)
  };
  for (const name of Object.keys(tracks)) {
    for (const speed of [0.5, 2]) {
      check(`complex: ${name} @${speed}x keeps sharp attacks (vs plain phase vocoder)`, () => {
        const { x, times } = tracks[name];
        const alpha = 1 / speed;
        const good = X.stretchAudio([x], SR, { mode: "complex", speed })[0];
        const plain = X.stretchAudio([x], SR, { mode: "complex", speed, transients: false, phaseLock: false })[0];
        const gm = meanAttack(good, times, alpha), pm = meanAttack(plain, times, alpha);
        const ref = meanAttack(x, times, 1);
        metrics[`${name}_${speed}`] = { input: ref, complex: gm, plainPV: pm };
        assert.ok(gm.preEchoDb < pm.preEchoDb - 10 || gm.preEchoDb < -45, `pre-echo ${gm.preEchoDb.toFixed(1)} dB vs plain ${pm.preEchoDb.toFixed(1)} dB`);
        assert.ok(gm.preEchoDb < -30, `pre-echo ${gm.preEchoDb.toFixed(1)} dB too high`);
        assert.ok(gm.riseMs <= Math.max(1.5, ref.riseMs * 3), `rise ${gm.riseMs.toFixed(2)} ms (input ${ref.riseMs.toFixed(2)})`);
        assert.ok(gm.offsetMs < 12, `attack timing offset ${gm.offsetMs.toFixed(1)} ms`);
        assert.ok(peakOf(good) <= 1.0001);
      });
    }
  }

  check("complex: stereo image is preserved (hard-panned and centred components)", () => {
    const l = sine(300, 3, 0.4);
    const r = new Float32Array(l.length);
    for (let i = 0; i < r.length; i++) r[i] = 0.5 * l[i] + 0.3 * Math.sin(2 * Math.PI * 900 * i / SR);
    const out = X.stretchAudio([l, r], SR, { mode: "complex", speed: 0.7 });
    const a = Math.round(out[0].length * 0.3), b = Math.round(out[0].length * 0.7);
    // channel R contains L's 300 Hz at half level with the same phase: R(300) / L(300) stays 0.5 and in phase
    const sl = spectrum(out[0], a, b), sr_ = spectrum(out[1], a, b);
    const k = Math.round(300 / sl.binHz);
    let ratio = 0;
    for (let d = -3; d <= 3; d++) ratio += Math.sqrt(sr_.power[k + d]) / Math.sqrt(sl.power[k + d]) / 7;
    assert.ok(Math.abs(ratio - 0.5) < 0.05, "L/R ratio at 300 Hz " + ratio);
    // zero correlation lag check on the 300 Hz-dominated band: use sample correlation of L and (R - 0.3 sin) ~ scaled L
    let num = 0, d1 = 0, d2 = 0;
    for (let i = a; i < b; i++) { num += out[0][i] * out[1][i]; d1 += out[0][i] ** 2; d2 += out[1][i] ** 2; }
    let n0 = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < l.length; i++) { n0 += l[i] * r[i]; e1 += l[i] ** 2; e2 += r[i] ** 2; }
    const corrIn = n0 / Math.sqrt(e1 * e2), corrOut = num / Math.sqrt(d1 * d2);
    assert.ok(Math.abs(corrOut - corrIn) < 0.05, `correlation ${corrIn.toFixed(3)} -> ${corrOut.toFixed(3)}`);
  });

  check("complex: 5 s stereo speed 0.5 renders in well under 1 s", () => {
    const src = drumLoop(4, 140); // ~6.9 s
    const five = src.map(c => c.subarray(0, 5 * SR));
    X.stretchAudio(five, SR, { mode: "complex", speed: 0.5 }); // warm up
    const times = {};
    for (const speed of [0.5, 1.5, 4]) {
      const t0 = process.hrtime.bigint();
      X.stretchAudio(five, SR, { mode: "complex", speed });
      times[speed] = Number(process.hrtime.bigint() - t0) / 1e6;
    }
    const tp = process.hrtime.bigint();
    X.stretchAudio(five, SR, { mode: "complex", speed: 0.5, pitchSt: 3 });
    times["0.5+3st"] = Number(process.hrtime.bigint() - tp) / 1e6;
    metrics.complexMs = times;
    assert.ok(times[0.5] < 1000, "took " + times[0.5].toFixed(0) + " ms");
  });

  // ---- texture
  check("texture: smooth, no periodic clicks, level held", () => {
    const src = [noise(6, 0.25), noise(6, 0.25, 9)];
    for (const amount of [0, 0.5, 1]) {
      const y = X.stretchAudio(src, SR, { mode: "texture", speed: 0.5, amount })[0];
      // 5 ms RMS envelope, away from edges
      const blk = Math.round(0.005 * SR);
      const a = Math.round(y.length * 0.15), b = Math.round(y.length * 0.85);
      const env = [];
      for (let i = a; i + blk < b; i += blk) env.push(rms(y, i, i + blk));
      const mean = env.reduce((s, v) => s + v, 0) / env.length;
      const dev = Math.sqrt(env.reduce((s, v) => s + (v - mean) ** 2, 0) / env.length) / mean;
      // hop-rate modulation: correlate the envelope with the frame-rate sinusoid
      const N = amount === 0 ? 4096 : (amount === 0.5 ? 16384 : 32768);
      const hopBlocks = (N / 4) / blk;
      let cs = 0, sn = 0;
      env.forEach((v, i) => { cs += (v - mean) * Math.cos(2 * Math.PI * i / hopBlocks); sn += (v - mean) * Math.sin(2 * Math.PI * i / hopBlocks); });
      const mod = 2 * Math.hypot(cs, sn) / env.length / mean;
      metrics[`texture_${amount}`] = { envDevRel: dev, hopRateMod: mod };
      assert.ok(dev < 0.25, `envelope deviation ${dev.toFixed(3)} @amount ${amount}`);
      assert.ok(mod < 0.06, `hop-rate modulation ${mod.toFixed(3)} @amount ${amount}`);
    }
    const ch = [chord(4), chord(4)];
    for (const amount of [0, 1]) {
      const y = X.stretchAudio(ch, SR, { mode: "texture", speed: 0.5, amount })[0];
      let maxStep = 0;
      for (let i = 1; i < y.length; i++) maxStep = Math.max(maxStep, Math.abs(y[i] - y[i - 1]));
      assert.ok(maxStep < 0.06, `sample step ${maxStep} @amount ${amount}`);
      assert.ok(peakOf(y) < 1, "peak");
    }
  });

  check("texture: smears (transients vanish, spectrum kept)", () => {
    const { x } = clickTrack(6, 1.0);
    const y = X.stretchAudio([x], SR, { mode: "texture", speed: 1, amount: 0.5 })[0];
    const crestIn = peakOf(x) / rms(x), crestOut = peakOf(y) / rms(y);
    assert.ok(crestOut < crestIn * 0.7, `crest ${crestIn.toFixed(1)} -> ${crestOut.toFixed(1)}`);
  });

  check("texture: bigger amount = smoother", () => {
    const { x } = clickTrack(6, 0.5);
    const mod = amount => {
      const y = X.stretchAudio([x], SR, { mode: "texture", speed: 1, amount })[0];
      const blk = Math.round(0.02 * SR);
      const env = [];
      for (let i = Math.round(SR * 0.5); i + blk < y.length - SR * 0.5; i += blk) env.push(rms(y, i, i + blk));
      const mean = env.reduce((s, v) => s + v, 0) / env.length;
      return Math.sqrt(env.reduce((s, v) => s + (v - mean) ** 2, 0) / env.length) / mean;
    };
    const lo = mod(0), hi = mod(1);
    assert.ok(hi < lo, `modulation ${lo.toFixed(2)} -> ${hi.toFixed(2)}`);
  });

  // ---- granular vs the device engine
  check("granular: xo_node_engine.js renderEditedAudioSamples (Mode = Grain) delegates to this module", () => {
    // The old in-engine granular renderer was replaced by this module (xo_node_engine.js now calls stretchAudioEx);
    // with levelMatch on, Speed 50 % / 200 % and no Trim/Dec the device render must equal the module output.
    const prev = global.__MAX_API_MOCK__;
    global.__MAX_API_MOCK__ = { post() {}, outlet() {}, addHandler() {} };
    const engine = require(path.join(ROOT, "src", "xo_node_engine.js"));
    global.__MAX_API_MOCK__ = prev;
    const x = speechLike(2)[0];
    for (const [speedPct, grainMs] of [[50, 45], [200, 45], [75, 120], [150, 12]]) {
      const ref = engine.renderEditedAudioSamples({ sampleRate: SR, samples: x }, { stretchMode: 0, speedPct, grainMs, decayMs: 600000, gainDb: 0 });
      const mine = X.stretchAudio([x], SR, { mode: "granular", speed: speedPct / 100, grainMs })[0];
      const n = Math.min(ref.samples.length, mine.length);
      assert.ok(Math.abs(ref.samples.length - mine.length) <= 1, `length ${ref.samples.length} vs ${mine.length}`);
      let maxDiff = 0;
      for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(ref.samples[i] - Math.max(-1, Math.min(1, mine[i]))));
      assert.ok(maxDiff < 1e-6, `max diff ${maxDiff} @${speedPct}%/${grainMs}ms`);
    }
  });

  // ---- A/B renders
  if (!process.env.XO_STRETCH_QUICK) {
    fs.mkdirSync(AB_DIR, { recursive: true });
    const mats = { drum_loop: drumLoop(2, 110), chord: [chord(4), chord(4)], speech: speechLike(3) };
    // slightly different right channel for the chord so the image is not pure mono
    for (const [name, chs] of Object.entries(mats)) {
      writeWav(path.join(AB_DIR, `${name}_original.wav`), chs, SR);
      for (const mode of modes) {
        for (const speed of [0.5, 2]) {
          const r = X.stretchAudio(chs, SR, { mode, speed, grainMs: 45, amount: 0.4 });
          writeWav(path.join(AB_DIR, `${name}_${mode}_${Math.round(speed * 100)}pct.wav`), r, SR);
        }
      }
      for (const speed of [0.5, 2]) {
        const r = X.stretchAudio(chs, SR, { mode: "complex", speed, fftSize: 2048 });
        writeWav(path.join(AB_DIR, `${name}_complex2048_${Math.round(speed * 100)}pct.wav`), r, SR);
      }
      const plain = X.stretchAudio(chs, SR, { mode: "complex", speed: 0.5, transients: false, phaseLock: false });
      writeWav(path.join(AB_DIR, `${name}_plainPV_50pct.wav`), plain, SR);
    }
    console.log("A/B WAVs: " + AB_DIR);
  }

  console.log("\nMETRICS " + JSON.stringify(metrics, (k, v) => typeof v === "number" ? Math.round(v * 100) / 100 : v, 1));
  if (failures) {
    console.log(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nall xo_stretch tests passed");
}

main().catch(e => { console.error(e); process.exit(1); });
