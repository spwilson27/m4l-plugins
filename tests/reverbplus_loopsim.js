"use strict";
// Reference model of Reverb+'s combined system for tests/test_reverbplus.js: a Hall-like FDN (the real line lengths,
// Hadamard mixing, per-line RT60 gains, the output normalisation of src/reverbplus_start.genexpr), fed from the input only, plus the
// recirculating chain loop of the Start gen (return -> delay -> 4 Schroeder allpasses -> gain g -> clip -> added to the chain input,
// chain input = tank wet x sqrt(1 - g^2) + loop). A chain gain multiplies the return. No bass shelf, damping or early reflections.
const path = require("path");
const C = require(path.join(__dirname, "..", "src", "reverbplus_config.js"));

function simTank(o) {
    const sr = 48000;
    const szS = C.rpSizeScale(o.size === undefined ? 0.6 : o.size);
    const lens = C.RP_TANK_LINES.hall.map((v) => Math.round(v * szS));
    const N = lens.length;
    const gm = lens.map((l) => C.rpLineGain(l, o.tankRt, sr));
    const nsC = Math.min(1, Math.max(0.12, Math.sqrt(Math.max(1 - gm.reduce((t, g) => t + g * g, 0) / N, 0))));
    const bufs = lens.map((l) => new Float64Array(l));
    const pos = new Int32Array(N);
    const n = Math.round(o.dur * sr);
    const wl = new Float64Array(n), wr = new Float64Array(n), tl = new Float64Array(n);
    const Tl = o.loopSamples || 0;
    const g = o.g || 0;
    const wetScale = Tl > 0 ? C.rpLoopWetScale(g) : 1;
    const a = C.rpLoopApGain(o.diffusion === undefined ? 0.8 : o.diffusion);
    const mkAp = (lens2) => lens2.map((D) => ({ D, buf: new Float64Array(D + 1), p: 0 }));
    const apL = mkAp(C.RP_LOOP.AP_LEN_L), apR = mkAp(C.RP_LOOP.AP_LEN_R);
    const runAp = (chain, x) => {
        for (const s of chain) {
            const w0 = s.buf[s.p];
            const w = x + a * w0;
            s.buf[s.p] = w;
            s.p = (s.p + 1) % s.D; // buffer length D: the sample written D samples ago is read back
            x = w0 - a * w;
        }
        return x;
    };
    const ringL = new Float64Array(Tl + 1), ringR = new Float64Array(Tl + 1);
    const cT = o.clipLevel === undefined ? 1 : o.clipLevel, cK = 0.8 * cT;
    const soft = (v) => { const ab = Math.abs(v); return ab <= cK ? v : Math.sign(v) * (cK + (cT - cK) * Math.tanh((ab - cK) / (cT - cK))); };
    const y = new Float64Array(N), f = new Float64Array(N);
    const hn = 1 / Math.sqrt(N), ci = Math.sqrt(2 / N);
    const sgn = (m) => ((m & 1) === 0 ? 1 : -1);
    for (let t = 0; t < n; t++) {
        const inL = t === 0 ? 1 : 0, inR = t === 0 ? 1 : 0;
        let oL = 0, oR = 0;
        for (let i = 0; i < N; i++) {
            y[i] = gm[i] * bufs[i][pos[i]];
            f[i] = y[i];
            oL += sgn(i * 7 + Math.floor(i / 2)) * y[i];
            oR += sgn(i * 5 + 1 + Math.floor(i / 3)) * y[i];
        }
        for (let h = 1; h < N; h *= 2) for (let j = 0; j < N; j += 2 * h) for (let k = j; k < j + h; k++) { const x1 = f[k], x2 = f[k + h]; f[k] = x1 + x2; f[k + h] = x1 - x2; }
        for (let i = 0; i < N; i++) {
            bufs[i][pos[i]] = f[i] * hn + ci * ((i & 1) === 0 ? inL : inR);
            pos[i] = (pos[i] + 1) % lens[i];
        }
        const twL = oL * 0.7071 * nsC, twR = oR * 0.7071 * nsC;
        tl[t] = twL;
        let dL = 0, dR = 0;
        if (Tl > 0) {
            const k = t % (Tl + 1);
            dL = soft(g * runAp(apL, ringL[k]));
            dR = soft(g * runAp(apR, ringR[k]));
            ringL[k] = 0;
            ringR[k] = 0;
        }
        wl[t] = twL * wetScale + dL;
        wr[t] = twR * wetScale + dR;
        if (Tl > 0) {
            const w = (t + Tl) % (Tl + 1);
            ringL[w] = o.chain * wl[t];
            ringR[w] = o.chain * wr[t];
        }
    }
    return { wl, wr, tl, sr, nsC };
}
function schroederRt(x, sr) {
    const s = new Float64Array(x.length);
    let acc = 0;
    for (let i = x.length - 1; i >= 0; i--) { acc += x[i] * x[i]; s[i] = acc; }
    let i1 = -1, i2 = -1;
    for (let i = 0; i < s.length; i++) {
        const d = 10 * Math.log10(Math.max(s[i] / s[0], 1e-30));
        if (i1 < 0 && d <= -5) i1 = i;
        if (i2 < 0 && d <= -25) { i2 = i; break; }
    }
    return i1 < 0 || i2 < 0 ? null : (i2 - i1) / sr * 3;
}


// Largest and mean |H|^2 of an impulse response (over 0..sr/2, DC excluded).
function transferStats(x) {
    let N = 1024;
    while (N < x.length) N *= 2;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < x.length; i++) re[i] = x[i];
    C.rpFft(re, im, N, false);
    let mx = 0, ms = 0;
    for (let k = 1; k < N / 2; k++) {
        const m2 = re[k] * re[k] + im[k] * im[k];
        ms += m2;
        if (m2 > mx) mx = m2;
    }
    return { peak2: mx, mean2: ms / (N / 2 - 1) };
}

module.exports = { simTank, schroederRt, transferStats };
