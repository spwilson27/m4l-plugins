"use strict";
// BUG-1 (see BUGS.md): fractional Max Harm diverges between the JS reference
// mirror and the device. The genexpr ctl hook rounds hmaxp
// (mxH = hmaxp < 0.5 ? 404 : clip(round(hmaxp), 1, 404), harmsplit_core.genexpr)
// and the face paint rounds too (hsMaxHarm in harmsplit_ui.js), but hsFrame in
// harmsplit_config.js compares the integer h-prime against the UNROUNDED value
// (hp2 <= hmx), so for hmaxp with fraction >= .5 the device tracks one more
// harmonic than the mirror. Max Harm is a float control (0..404, integer unit
// style), so fractional values arrive via automation / typed entry.
// This test drives the gen chain WITH the ctl conversion applied (the real
// device path); tests/test_harmsplit.js passes hmaxp raw into hs_masks, which
// is why the existing suite cannot see this. Expected: FAIL today on the
// fractional >= .5 cases with maxMaskDiff = 1.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "harmsplit_config.js"));
const ref = require(path.join(ROOT, "src", "cepstrum_ref.js"));
const { DataSim, load } = require(path.join(ROOT, "tests", "genexpr_functions.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const prep = (src) => src.replace(/(?<![.\w])poke\((\w+),\s*/g, "$1.poke(").replace(/\blog10\(/g, "Math.log10(").replace(/\batan2\(/g, "Math.atan2(");
const gx = load(prep(read("src/cepstrum_lib.genexpr")), prep(read("src/spectral_split_lib.genexpr")), prep(read("src/harmsplit_core.genexpr").split("\nBuffer scope(")[0]));
const ctlMaxH = (v) => (v < 0.5 ? 404 : Math.min(Math.max(Math.round(v), 1), 404));
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) / 4294967296); }; }
function maxMaskDiff(hmaxp) {
    const n = 2048, sr = 48000, f0 = 220;
    const rnd = rng(11);
    const x = new Float64Array(sr);
    for (let i = 0; i < sr; i++) { let v = 0; for (let h = 1; h * f0 < sr * 0.45; h++) v += (1 / h) * Math.sin((2 * Math.PI * f0 * h * i) / sr); x[i] = 0.25 * v + 0.01 * (rnd() * 2 - 1); }
    const win = ref.hann(n), half = n / 2;
    const p = { hpat: 2, hmaxp: hmaxp, sens: 0.5, tilt: 0, thr: -120, flo: 80, fhi: 1500 };
    const st = cfg.hsNewState(n);
    const hsd = new DataSim(2049, 10), hp = new DataSim(406, 5), hst = new DataSim(32), sal = new DataSim(710, 5), hcf = new DataSim(2049, 2), ms = new DataSim(2049, 2);
    let age = 0, maxd = 0;
    const hops = Math.floor((sr - n) / (n / 4));
    for (let fr = 0; fr < hops; fr++) {
        const t0 = fr * (n / 4);
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let i = 0; i < n; i++) { re[i] = x[t0 + i] * win[i]; im[i] = x[t0 + i] * win[i]; }
        ref.fft(re, im, false);
        const mag = new Float64Array(half + 1);
        for (let k = 0; k <= half; k++) { const k2 = (n - k) % n; const ar = re[k], ai = im[k], br = re[k2], bi = -im[k2]; mag[k] = Math.hypot((ar + ai + (br - bi)) / 4, (ai - ar + (bi + br)) / 4) * 4 / n; ms.poke(mag[k], k, 0); }
        cfg.hsFrame(st, mag, p, sr);
        if (age < 0.5) gx.hs_reset(hst, hp);
        gx.hs_prep(ms, hsd, hst, hcf, n, sr, p.flo, p.fhi, p.tilt);
        gx.hs_sal(hsd, sal, hst, n, sr, p.flo, p.fhi);
        gx.hs_decide(hst, p.thr, cfg.HS_ACCEPT, 3 * n / sr);
        gx.hs_harm(hsd, hp, hst, n, sr);
        gx.hs_post(hst);
        gx.hs_masks(hsd, hp, hst, n, sr, p.sens, p.hpat, ctlMaxH(p.hmaxp), p.flo, p.fhi);
        age = Math.min(age + 1, 3);
        for (let k = 0; k <= half; k++) maxd = Math.max(maxd, Math.abs(st.mN[k] - hsd.peek(k, 0)), Math.abs(st.mA[k] - hsd.peek(k, 1)), Math.abs(st.mB[k] - hsd.peek(k, 2)));
    }
    return maxd;
}
for (const v of [9, 9.4, 9.5, 9.6, 10, 2.5, 3.5]) {
    const d = maxMaskDiff(v);
    assert.ok(d < 1e-9, "hmaxp=" + v + ": JS mirror vs device (ctl-rounded) masks diverge, maxMaskDiff=" + d);
}
console.log("All Harmonic Split Max Harm rounding tests passed");
