"use strict";
// Clip+: the shared curve, the transpiled gen functions, loudness, the built device and the face bounds.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const gx = require("./genexpr_functions.js");
const { makeRecorder, loadFace, checkRecording } = require("./paint_bounds_lib.js");
const C = require("../src/clipplus_curve.js");

const ROOT = path.join(__dirname, "..");
const CORE = fs.readFileSync(path.join(ROOT, "src/clipplus_core.genexpr"), "utf8");
const LIB = fs.readFileSync(path.join(ROOT, "src/cepstrum_lib.genexpr"), "utf8");
const G = gx.load(LIB, CORE);

function maxDiff(fn) {
    let m = 0;
    for (let i = 0; i < 400; i++) m = Math.max(m, Math.abs(fn(i)));
    return m;
}

// ---- gain reduction: only the dB the driven peak sits above the ceiling ----
{
    const SR = 48000;
    function db(lin) { return 20 * Math.log10(Math.max(lin, 1e-12)); }
    function lin(d) { return Math.pow(10, d / 20); }
    function peakOf(xs) {
        let p = 0;
        for (let i = 0; i < xs.length; i++) p = Math.max(p, Math.abs(xs[i]));
        return p;
    }
    function sine(n, freq, amp, phase) {
        const out = new Array(n);
        const w = 2 * Math.PI * freq / SR;
        for (let i = 0; i < n; i++) out[i] = amp * Math.sin(w * i + (phase || 0));
        return out;
    }
    function noise(n, amp, seed) {
        let s = seed >>> 0;
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            out[i] = ((s / 4294967296) * 2 - 1) * amp;
        }
        return out;
    }
    function impulse(n, at, amp) {
        const out = new Array(n).fill(0);
        out[at] = amp;
        return out;
    }
    function square(n, freq, amp) {
        const out = new Array(n);
        const period = SR / freq;
        for (let i = 0; i < n; i++) out[i] = ((i % period) < period * 0.5 ? amp : -amp);
        return out;
    }
    function twoTone(n, f1, a1, f2, a2) {
        const a = sine(n, f1, a1, 0);
        const b = sine(n, f2, a2, 0.4);
        for (let i = 0; i < n; i++) a[i] += b[i];
        return a;
    }
    // Driven peak of one buffer, then the meter. Channel mode picks which peak counts.
    function grOf(buffers, driveDb, ceilDb, chmode) {
        const g = C.cpDriveGain(driveDb);
        const peaks = buffers.map((b) => peakOf(b) * g);
        while (peaks.length < 2) peaks.push(0);
        return C.cpBlockGrDb(peaks[0], peaks[1], chmode || 0, C.cpDbToLin(ceilDb));
    }
    function shaperGr(x, driveDb, shape, ceilDb) {
        const c = C.cpDbToLin(ceilDb);
        const driven = Math.abs(x) * C.cpDriveGain(driveDb);
        const y = Math.abs(C.cpCurve(x, driveDb, shape, 0, c));
        return db(driven) - db(y);
    }

    const N = 4800;
    // The reported case: program around -28 dB, drive raised 0.8 dB, ceiling 0.
    // The soft curve does sag, and that sag is not gain reduction.
    const program = sine(N, 220, lin(-28.1));
    program[100] = lin(-28.1);
    assert.ok(grOf([program], 0.8, 0, 0) === 0, "−28 dB program at +0.8 dB drive is under the ceiling");
    assert.ok(shaperGr(lin(-28.1), 0.8, 0, 0) > 0.05, "the soft curve does sag on that program");
    assert.ok(shaperGr(lin(-28.1), 0.8, 0, 0) < 0.4, "but only by a fraction of a dB");

    // A full-scale tone plus 0.8 dB of drive is 0.8 dB over, not the ~5 dB the soft curve pulls it down.
    const full = sine(N, 440, 1);
    full[100] = 1;
    const over = grOf([full], 0.8, 0, 0);
    assert.ok(Math.abs(over - 0.8) < 0.02, "full-scale + 0.8 dB drive reports 0.8 dB GR, got " + over);
    assert.ok(shaperGr(1, 0.8, 0, 0) > 4.5, "soft curve pulls a full-scale sample down by several dB");

    const cases = [
        ["silence", new Array(N).fill(0), 0, 0, 0],
        ["silence driven", new Array(N).fill(0), 18, 0, 0],
        ["dc under", new Array(N).fill(0.2), 0, 0, 0],
        ["dc over", new Array(N).fill(0.2), 18, 0, db(0.2 * C.cpDriveGain(18))],
        ["quiet sine", sine(N, 80, lin(-40)), 0.8, 0, 0],
        ["mid sine, drive 0", sine(N, 220, lin(-6)), 0, 0, 0],
        ["mid sine, drive 0.8", sine(N, 220, lin(-6)), 0.8, 0, 0],
        ["mid sine, drive 6", sine(N, 220, lin(-6)), 6, 0, 6 + (-6)],
        ["hot sine, drive 0", sine(N, 1000, 1), 0, 0, 0],
        ["hot sine, drive 12", sine(N, 1000, 0.5), 12, 0, db(0.5 * C.cpDriveGain(12))],
        ["noise under", noise(N, 0.2, 3), 0.8, 0, 0],
        ["noise over", noise(N, 0.9, 9).map((v, i) => i === 10 ? 0.9 : v), 6, 0, db(0.9 * C.cpDriveGain(6))],
        ["impulse", impulse(N, 1000, 2.5), 0, 0, db(2.5)],
        ["impulse quiet", impulse(N, 20, 0.05), 12, 0, 0],
        ["square under", square(N, 110, 0.4), 0, 0, 0],
        ["square over", square(N, 110, 0.8), 6, -6, db(0.8 * C.cpDriveGain(6)) - (-6)],
        ["two-tone under", twoTone(N, 50, 0.15, 1370, 0.02), 0.8, 0, 0],
        ["two-tone over", (function () { const t = twoTone(N, 50, 0.25, 1370, 0.15); t[10] = 1.2; return t; })(), 6, 0, db(1.2 * C.cpDriveGain(6))],
        ["just under ceiling", sine(N, 330, 0.99), 0, 0, 0],
        ["just over, gated", sine(N, 330, lin(0.05)), 0, 0, 0],
        ["1 dB over", sine(N, 330, lin(1)), 0, 0, 1],
        ["ceiling -12, tone -6", sine(N, 200, lin(-6)), 0, -12, 6],
        ["ceiling -6, drive 0.8 still under", sine(N, 200, lin(-12)), 0.8, -6, 0],
    ];
    for (const row of cases) {
        const got = grOf([row[1]], row[2], row[3], 0);
        assert.ok(Math.abs(got - row[4]) < 0.05, row[0] + " GR " + got.toFixed(3) + " want " + row[4].toFixed(3));
    }

    // Stereo: only the channel fed to the clipper counts.
    const left = sine(N, 220, 1, 0);
    const right = sine(N, 880, 0.2, 1);
    assert.ok(Math.abs(grOf([left, right], 6, 0, 0) - 6) < 0.02, "Both follows the hotter channel");
    assert.ok(Math.abs(grOf([left, right], 6, 0, 1) - 6) < 0.02, "Left mode follows the left peak");
    assert.strictEqual(grOf([left, right], 6, 0, 2), 0, "Right mode ignores the left peak when the right is under the ceiling");
    assert.ok(Math.abs(grOf([sine(N, 100, 0.1), sine(N, 300, 1)], 0, -3, 2) - (db(1) - (-3))) < 0.05, "Right mode reports the right channel over a -3 dB ceiling");

    // A block that only clips on one sample still reports that sample.
    const click = impulse(N, 2500, lin(3));
    assert.ok(Math.abs(grOf([click], 0, 0, 0) - 3) < 0.02, "a single sample 3 dB over is 3 dB GR");
    console.log("[gr] signals");
}

// ---- curve, body, FIR match the gen functions ----
{
    let worst = 0;
    for (const drive of [0, 0.4, 6, 12, 18, 24]) {
        for (const shape of [0, 50, 100]) {
            for (const sym of [-100, 0, 100]) {
                for (const x of [-1.5, -0.25, 0, 0.1, 0.8]) {
                    worst = Math.max(worst, Math.abs(C.cpCurve(x, drive, shape, sym, 0.5) - G.cp_curve(x, drive, shape, sym, 0.5)));
                }
            }
        }
    }
    assert.ok(worst < 1e-9, "cp_curve matches the reference, worst " + worst);
    worst = 0;
    for (const t of [0.01, 0.2, 1]) {
        for (const a of [0, 0.01, 0.05, 0.25, 2]) worst = Math.max(worst, Math.abs(C.cpBody(a, t) - G.cp_body(a, t)));
    }
    assert.ok(worst < 1e-9, "cp_body matches");
    worst = 0;
    for (const peak of [0, 0.01, 0.5, 1, 1.096, 2, 8]) {
        for (const ceil of [0.25, 0.5, 1]) {
            worst = Math.max(worst, Math.abs(C.cpClipGrDb(peak, ceil) - G.cp_clip_gr(peak, ceil)));
            for (const mode of [0, 1, 2]) {
                worst = Math.max(worst, Math.abs(C.cpBlockGrDb(peak, peak * 0.4, mode, ceil) - G.cp_block_gr(peak, peak * 0.4, mode, ceil)));
            }
        }
    }
    assert.ok(worst < 1e-6, "cp_clip_gr matches the reference, worst " + worst);
    worst = 0;
    for (let i = 0; i < C.CLIP_FIR_N; i++) worst = Math.max(worst, Math.abs(C.cpFirCoef(i) - G.cp_fir_coef(i)));
    assert.ok(worst < 1e-9, "cp_fir_coef matches");
    // The shelf is a pre/post pair. With no clipping, post must undo pre (the comment's "exact reciprocal").
    {
        const sr = 48000;
        const cases = [
            [0, 400, 12, 0.707, 1000],
            [0, 1000, 6, 0.707, 1000],
            [0, 200, 24, 1, 50],
            [0, 80, 18, 2, 440],
            [1, 200, 12, 2, 1000],
        ];
        let shelfErr = 0;
        for (const [fmode, freq, gain, q, tone] of cases) {
            const st = new gx.DataSim(8, 2);
            for (let i = 0; i < 24000; i++) {
                const x = Math.sin(2 * Math.PI * i * tone / sr) * 0.4;
                const y = G.cp_pre_emp(x, st, 0, sr, freq, gain, q, fmode, 1);
                const comp = fmode > 0.5 ? st.peek(4, 0) : 0;
                const z = G.cp_post_emp(y, comp, st, 0, sr, freq, gain, q, fmode, 1);
                if (i > 12000) shelfErr = Math.max(shelfErr, Math.abs(z - x));
            }
        }
        assert.ok(shelfErr < 1e-6, "unclipped emphasis pre/post must cancel, worst " + shelfErr);
    }
    const kw = new gx.DataSim(10);
    G.cp_kw_init(kw, 48000);
    const shelf = C.cpBiquadCoefShelf(48000);
    const hp = C.cpBiquadCoefHp(48000);
    for (let i = 0; i < 5; i++) {
        assert.ok(Math.abs(shelf[i] - kw.peek(i)) < 1e-9, "K-weight shelf");
        assert.ok(Math.abs(hp[i] - kw.peek(i + 5)) < 1e-9, "K-weight highpass");
    }
    console.log("[curve] gen functions match the reference");
}

// ---- Drive 0 ignores shape; soft knee vs hard; symmetry is even ----
{
    let worst = 0;
    for (const shape of [0, 100]) {
        for (const sym of [-100, 100]) {
            for (let i = 0; i <= 40; i++) {
                const x = -1.2 + 2.4 * i / 40;
                worst = Math.max(worst, Math.abs(C.cpCurve(x, 0, shape, sym, 1) - Math.max(-1, Math.min(1, x))));
            }
        }
    }
    assert.strictEqual(worst, 0, "Drive 0 is the ceiling clamp for every shape");
    const x = Math.pow(10, -12 / 20);
    const soft = C.cpCurve(x, 12, 0, 0, 1);
    const hard = C.cpCurve(x, 12, 100, 0, 1);
    assert.ok(soft < 0.7 && hard > 0.9, `soft ${soft} hard ${hard}`);
    const sr = 48000;
    const n = sr;
    function h2(sym) {
        const p = Object.assign(C.cpDefaultParams(), { driveDb: 12, shapePct: 40, symPct: sym, detailPct: 0, hlim: 0, autog: 0 });
        const s = new Float64Array(n);
        for (let i = 0; i < n; i++) s[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / sr);
        const y = C.cpRender(s, s, p, sr);
        return C.cpGoertzel(y.outL.subarray(n - Math.floor(0.5 * sr)), 440, sr);
    }
    const even0 = h2(0);
    const even1 = h2(100);
    assert.ok(even0 < 1e-4, "symmetry 0 has no second harmonic " + even0);
    assert.ok(even1 > 0.04, "symmetry 100 creates a second harmonic " + even1);
    console.log("[curve] drive 0, knee and symmetry");
}

// ---- Detail 0 is the waveshaper; Detail 100 keeps the quiet sine ----
{
    const sr = 48000;
    const n = Math.floor(0.45 * sr);
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        s[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / sr) + 0.02 * Math.sin(2 * Math.PI * 1370 * i / sr);
    }
    const base = { driveDb: 18, shapePct: 100, hlim: 0, autog: 0, oson: 0, tpeak: 0, ceilDb: 0 };
    function quiet(detail) {
        const p = Object.assign(C.cpDefaultParams(), base, { detailPct: detail });
        const y = C.cpRender(s, s, p, sr);
        return C.cpGoertzel(y.outL.subarray(n - Math.floor(0.15 * sr)), 1370, sr);
    }
    const kept = quiet(100);
    const lost = quiet(0);
    const expect = 0.02 * C.cpDriveGain(18);
    assert.ok(Math.abs(kept - expect) / expect < 0.02, `detail 100 keeps the quiet sine ${kept} vs ${expect}`);
    assert.ok(lost < kept * 0.3, `detail 0 loses it ${lost} vs ${kept}`);
    const id = new Float64Array(n);
    for (let i = 0; i < n; i++) id[i] = 0.25 * Math.sin(2 * Math.PI * 440 * i / sr);
    const y = C.cpRender(id, id, Object.assign(C.cpDefaultParams(), { detailPct: 0, hlim: 0, autog: 0, driveDb: 0 }), sr);
    let err = 0;
    for (let i = C.CLIP_LATENCY; i < n; i++) err = Math.max(err, Math.abs(y.outL[i] - id[i - C.CLIP_LATENCY]));
    assert.ok(err < 1e-6, "drive 0 detail 0 is a delayed copy " + err);
    // Verify Auto trims by Input gain (-inDb) and leaves Drive as an independent increase
    {
        const yAutoIn = C.cpRender(id, id, Object.assign(C.cpDefaultParams(), { inDb: 6, driveDb: 0, detailPct: 0, hlim: 0, autog: 1, ceilDb: 0 }), sr);
        let errAuto = 0;
        for (let i = C.CLIP_LATENCY; i < n; i++) errAuto = Math.max(errAuto, Math.abs(yAutoIn.outL[i] - id[i - C.CLIP_LATENCY]));
        assert.ok(errAuto < 1e-6, "Auto trims by -inDb so +6 dB Input below ceiling returns to unity: " + errAuto);
        const yAutoDrv = C.cpRender(id, id, Object.assign(C.cpDefaultParams(), { inDb: 0, driveDb: 6, detailPct: 0, hlim: 0, autog: 1, ceilDb: 0 }), sr);
        let pkDrv = 0;
        for (let i = C.CLIP_LATENCY; i < n; i++) pkDrv = Math.max(pkDrv, Math.abs(yAutoDrv.outL[i]));
        assert.ok(pkDrv > 0.35, "With Auto on and Input 0 dB, Drive is an independent increase: " + pkDrv);
    }
    const imp = new Float64Array(n);
    imp[0] = 1;
    const iy = C.cpRender(imp, imp, Object.assign(C.cpDefaultParams(), { detailPct: 0, hlim: 0, autog: 0 }), sr);
    let at = -1;
    let pk = 0;
    for (let i = 0; i < n; i++) if (Math.abs(iy.outL[i]) > pk) { pk = Math.abs(iy.outL[i]); at = i; }
    assert.strictEqual(at, C.CLIP_LATENCY, "latency " + at);
    assert.ok(Math.abs(pk - 1) < 1e-6, "impulse gain " + pk);
    console.log("[curve] detail and latency", C.CLIP_LATENCY);
}

// ---- ceiling hold and true peak ----
{
    const sr = 48000;
    const n = Math.floor(0.25 * sr);
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = Math.sin(2 * Math.PI * 220 * i / sr);
    const y = C.cpRender(s, s, Object.assign(C.cpDefaultParams(), {
        driveDb: 18, shapePct: 100, detailPct: 0, hlim: 1, autog: 0, ceilDb: -6, tpeak: 0,
    }), sr);
    const lim = C.cpDbToLin(-6);
    let pk = 0;
    for (let i = C.CLIP_LATENCY; i < n; i++) pk = Math.max(pk, Math.abs(y.outL[i]));
    assert.ok(pk <= lim * 1.001, `ceiling holds ${pk} vs ${lim}`);
    const sq = new Float64Array(n);
    for (let i = 0; i < n; i++) sq[i] = Math.sin(2 * Math.PI * (sr / 4.3) * i / sr) > 0 ? 0.99 : -0.99;
    function tp(samples) {
        const coef = C.cpFirTable();
        const up = new Float64Array(coef.length);
        let m = 0;
        for (let i = C.CLIP_LATENCY + 1500; i < samples.length; i++) m = Math.max(m, C.cpTpPeak(up, coef, samples[i]));
        return m;
    }
    const off = C.cpRender(sq, sq, Object.assign(C.cpDefaultParams(), { detailPct: 0, hlim: 0, autog: 0, tpeak: 0, driveDb: 0 }), sr);
    const on = C.cpRender(sq, sq, Object.assign(C.cpDefaultParams(), { detailPct: 0, hlim: 0, autog: 0, tpeak: 1, driveDb: 0 }), sr);
    const offPk = tp(off.outL);
    const onPk = tp(on.outL);
    assert.ok(offPk > 1.3, "intersample over without true peak " + offPk);
    assert.ok(onPk < 1.05 && onPk < offPk * 0.85, "true peak pulls it to the ceiling " + onPk);
    console.log("[curve] ceiling and true peak", offPk.toFixed(3), onPk.toFixed(3));
}

// ---- LUFS of a -20 dBFS 1 kHz sine ----
{
    const sr = 48000;
    const meter = new C.CpMeter(sr);
    const amp = Math.pow(10, -20 / 20);
    const coefS = C.cpBiquadCoefShelf(sr);
    const coefH = C.cpBiquadCoefHp(sr);
    function bq(st) {
        const coef = st.coef;
        const y = coef[0] * st.x + coef[1] * st.x1 + coef[2] * st.x2 - coef[3] * st.y1 - coef[4] * st.y2;
        st.x2 = st.x1; st.x1 = st.x; st.y2 = st.y1; st.y1 = y;
        return y;
    }
    const sL = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: coefS };
    const hL = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: coefH };
    const sR = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: coefS };
    const hR = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: coefH };
    let kL = 0, kR = 0, mL = 0, mR = 0, pk = 0;
    for (let i = 0; i < sr; i++) {
        const v = amp * Math.sin(2 * Math.PI * 1000 * i / sr);
        sL.x = v; hL.x = bq(sL); const yL = bq(hL);
        sR.x = v; hR.x = bq(sR); const yR = bq(hR);
        kL += yL * yL; kR += yR * yR; mL += v * v; mR += v * v; pk = Math.max(pk, Math.abs(v));
        if ((i + 1) % C.CLIP_BLOCK === 0) {
            meter.push((kL + kR) / C.CLIP_BLOCK, (kL + kR) / C.CLIP_BLOCK, (mL + mR) / C.CLIP_BLOCK, (mL + mR) / C.CLIP_BLOCK, pk, pk);
            kL = kR = mL = mR = 0; pk = 0;
        }
    }
    const mom = meter.momentary()[0];
    assert.ok(Math.abs(mom + 20.7) < 0.6, "momentary LUFS near -20.7, got " + mom);
    assert.ok(Math.abs(meter.rms()[0] + 20) < 0.05, "RMS is the unweighted level");
    assert.ok(Math.abs(meter.integrated()[0] - mom) < 0.2, "integrated agrees on a steady tone");
    meter.reset();
    assert.strictEqual(meter.momentary()[0], -120, "reset clears the meters");
    console.log("[curve] LUFS", mom.toFixed(2));
}

// ---- genexpr lint ----
{
    const fns = gx.functionsOf(CORE);
    for (const fn of fns) {
        const rets = fn.body.filter((l) => /^\s*return\b/.test(l));
        assert.strictEqual(rets.length, 1, `${fn.name}: exactly one return`);
        assert.ok(/^\treturn\b/.test(fn.body[fn.body.length - 1]), `${fn.name}: return is the last line`);
    }
    const code = CORE.replace(/\/\/.*$/gm, "");
    assert.ok(!/\be\d+\b/.test(code), "no e<digit> identifier");
    assert.ok(!/\bpoke\([^;]*\bcp_\w+\(/.test(code), "no user function call inside poke()");
    const lines = CORE.split("\n");
    const firstDecl = lines.findIndex((l) => /^(Buffer|Data|Param|History|Delay)\b/.test(l));
    const lastFn = lines.reduce((m, l, i) => (/^[A-Za-z_]\w*\([^)]*\) \{$/.test(l) ? i : m), -1);
    assert.ok(lastFn > 0 && lastFn < firstDecl, "functions precede declarations");
    assert.ok(/Buffer scope\("clipscope"\)/.test(CORE), "scope buffer, no set prefix");
    assert.ok(/read\(1047/.test(CORE) && /read\(999/.test(CORE) && /read\(24/.test(CORE), "delay taps");
    assert.ok(/hop = hop \+ cp_hop\(ch,/.test(code), "both STFT rings are filled from one call site");
    assert.ok(/preL = chmode > 1\.5 \? ch0By : deEmp0;/.test(code), "R/S bypasses the left, Both and L/M clip it");
    assert.ok(/preR = \(chmode > 0\.5 && chmode < 1\.5\) \? ch1By : deEmp1;/.test(code), "L/M bypasses the right, Both and R/S clip it");
    assert.strictEqual(C.CLIP_LATENCY, 1047);
    console.log("[genexpr] lint");
}

// ---- built device ----
{
    const amxd = path.join(ROOT, "devices/Clip+.amxd");
    assert.ok(fs.existsSync(amxd), "devices/Clip+.amxd is built");
    const buf = fs.readFileSync(amxd);
    assert.strictEqual(buf.slice(0, 4).toString(), "ampf");
    assert.strictEqual(buf.slice(8, 12).toString(), "aaaa");
    const n = buf.readUInt32LE(28);
    const text = buf.slice(32, 32 + n).toString("utf8");
    assert.ok(!/NEWFANGLED/i.test(text), "No branding text in Clip+.amxd");
    const patcher = JSON.parse(text).patcher;
    assert.deepStrictEqual(patcher.openrect, [0, 0, 406, 169]);
    assert.strictEqual(patcher.openinpresentation, 1);
    assert.strictEqual(patcher.latency, 1047);
    const boxes = patcher.boxes.map((b) => b.box);
    const tail = boxes.slice(-5);
    assert.deepStrictEqual(tail.map((b) => b.maxclass), ["panel", "panel", "panel", "panel", "panel"]);
    for (const p of tail) assert.strictEqual(p.background, 1);
    assert.ok(!boxes.some((b) => b.maxclass === "gen" || b.maxclass === "gen.codebox~"), "no static gen~");
    const hub = boxes.find((b) => b.varname === "cp_genin");
    assert.ok(hub && hub.text === "gate 1 1", "gate hub");
    assert.ok(boxes.some((b) => b.varname === "cp_plugin" && b.text === "plugin~"));
    assert.ok(boxes.some((b) => b.varname === "cp_plugout" && b.text === "plugout~"));
    assert.ok(boxes.some((b) => String(b.text || "").indexOf("buffer~ ---clipscope") === 0));
    // Verify top header labels INPUT, Spectral Clipper, OUTPUT are removed
    assert.ok(!boxes.some((b) => b.id === "obj-lbl-in" || b.id === "obj-lbl-out" || b.id === "obj-title-clip"), "INPUT / Spectral Clipper / OUTPUT top labels are removed");
    const live = boxes.filter((b) => String(b.maxclass || "").indexOf("live.") === 0 && b.presentation_rect && !b.hidden);
    const canvases = boxes.filter((b) => b.maxclass === "v8ui" && b.presentation_rect && !b.hidden);
    function overlaps(a, b) {
        const ar = a.presentation_rect;
        const br = b.presentation_rect;
        return ar[0] < br[0] + br[2] && ar[0] + ar[2] > br[0] && ar[1] < br[1] + br[3] && ar[1] + ar[3] > br[1];
    }
    for (const c of canvases) for (const w of live) assert.ok(!overlaps(c, w), `${c.id} overlaps ${w.id}`);
    const meters = boxes.find((b) => b.id === "obj-meters");
    assert.ok(meters && meters.hidden === 1, "meters start hidden");
    assert.deepStrictEqual(meters.presentation_rect.slice(2), [176, 157], "meters black box is enlarged to 176x157");
    assert.ok(!boxes.some((b) => b.id === "obj-title-meters" || b.id === "obj-reset"), "Meters label and Reset button are moved inside the black box");
    const show = boxes.find((b) => b.id === "obj-ctrl-meters");
    assert.strictEqual(show.saved_attribute_attributes.valueof.parameter_invisible, 1);
    assert.strictEqual(show.saved_attribute_attributes.valueof.parameter_initial[0], 0);
    const drive = boxes.find((b) => b.id === "obj-ctrl-drive");
    const dv = drive.saved_attribute_attributes.valueof;
    assert.strictEqual(dv.parameter_mmin, 0);
    assert.strictEqual(dv.parameter_mmax, 24);
    assert.strictEqual(dv.parameter_initial[0], 0);
    for (const id of ["dlt", "dc", "os", "hlim", "meters"]) {
        const tb = boxes.find((b) => b.id === "obj-ctrl-" + id);
        assert.strictEqual(tb.saved_attribute_attributes.bgoncolor.expression, "themecolor.live_control_selection");
        assert.strictEqual(tb.saved_attribute_attributes.bgcolor.expression, "themecolor.live_control_bg");
        assert.ok(tb.presentation_rect[0] >= 298, id + " is in the right-hand Options panel");
    }
    const autoBtn = boxes.find((b) => b.id === "obj-ctrl-auto");
    assert.strictEqual(autoBtn.maxclass, "live.text", "Auto is a live.text toggle button like Wave/Curve");
    assert.strictEqual(autoBtn.text, "Man");
    assert.strictEqual(autoBtn.texton, "Auto");
    assert.deepStrictEqual(autoBtn.saved_attribute_attributes.valueof.parameter_enum, ["Man", "Auto"]);
    const viewBtn = boxes.find((b) => b.id === "obj-ctrl-view");
    assert.strictEqual(viewBtn.maxclass, "live.text", "View is a live.text toggle button");
    assert.strictEqual(viewBtn.presentation, 0, "Curve button is drawn next to Sym slider inside obj-viz rather than in Options");
    assert.ok(!boxes.some((b) => b.id === "obj-ctrl-midw"), "Mid Size control is removed");
    const vizBox = boxes.find((b) => b.id === "obj-viz");
    assert.strictEqual(vizBox.presentation_rect[2], 180, "Central display width is fixed to 180 px");
    const msBtn = boxes.find((b) => b.id === "obj-ctrl-msmode");
    assert.strictEqual(msBtn.maxclass, "live.text", "Stereo Mode (L/R vs M/S) is a toggle button");
    assert.strictEqual(msBtn.text, "L/R");
    assert.strictEqual(msBtn.texton, "M/S");
    assert.deepStrictEqual(msBtn.saved_attribute_attributes.valueof.parameter_enum, ["L/R", "M/S"]);
    const chParam = boxes.find((b) => b.id === "obj-ctrl-chmode");
    assert.deepStrictEqual(chParam.saved_attribute_attributes.valueof.parameter_enum, ["Both", "L", "R"]);
    const chBtn = boxes.find((b) => b.id === "obj-btn-chmode");
    assert.strictEqual(chBtn.maxclass, "live.text", "Channel Mode button is a tristate cycle live.text button");
    assert.strictEqual(chBtn.text, "Both");
    assert.strictEqual(msBtn.presentation_rect[0], chBtn.presentation_rect[0], "Stereo Mode and Channel Mode sit on separate rows at the same x");
    assert.ok(chBtn.presentation_rect[1] >= msBtn.presentation_rect[1] + msBtn.presentation_rect[3], "Channel Mode row is below Stereo Mode row");
    const filtTab = boxes.find((b) => b.id === "obj-filt-tab");
    assert.ok(filtTab && filtTab.presentation === 1 && !filtTab.hidden, "Left Bass Filter fold tab is always visible on the left side");
    assert.deepStrictEqual(filtTab.presentation_rect, [4, 4, 18, 161]);
    const showFiltBtn = boxes.find((b) => b.id === "obj-ctrl-showfilt");
    assert.strictEqual(showFiltBtn.presentation, 0, "Old Filter toggle button in Options is removed from presentation");
    const filtPanel = boxes.find((b) => b.id === "obj-panel-filt");
    const filtViz = boxes.find((b) => b.id === "obj-filt-viz");
    assert.ok(filtPanel && !filtPanel.hidden && filtViz && filtViz.hidden === 1, "Left Bass Filter fold starts collapsed with tab panel visible");
    assert.strictEqual(filtPanel.presentation_rect[0], 4, "Filter fold sits on the left of the device");
    const filtType = boxes.find((b) => b.id === "obj-ctrl-filttype");
    assert.strictEqual(filtType.maxclass, "live.tab", "Filter Type uses a live.tab with SVG images");
    assert.strictEqual(filtType.usepicture, 1, "Filter Type uses pictures");
    assert.deepStrictEqual(filtType.pictures, ["lowshelf.svg", "lowcut.svg"], "Filter Type uses the fork (lowshelf.svg) and low-cut (lowcut.svg) images");
    const filtQ = boxes.find((b) => b.id === "obj-ctrl-filtq");
    assert.ok(filtQ, "Filter Q control exists");
    assert.strictEqual(filtQ.saved_attribute_attributes.valueof.parameter_mmin, 0.1);
    assert.strictEqual(filtQ.saved_attribute_attributes.valueof.parameter_mmax, 10.0);
    const inBox = boxes.find((b) => b.id === "obj-ctrl-in");
    const outBox = boxes.find((b) => b.id === "obj-ctrl-out");
    const inMeter = boxes.find((b) => b.id === "obj-in-meter");
    const outMeter = boxes.find((b) => b.id === "obj-out-meter");
    assert.ok(inBox.presentation_rect[1] + inBox.presentation_rect[3] <= inMeter.presentation_rect[1], "Input control is above the IN VU meter");
    assert.ok(outBox.presentation_rect[1] + outBox.presentation_rect[3] <= outMeter.presentation_rect[1], "Output control is above the OUT VU meter");
    assert.ok(!boxes.some((b) => b.id === "obj-ctrl-on"), "On button is removed");
    assert.ok(!boxes.some((b) => b.id === "obj-ctrl-tpeak"), "old True Peak button is removed");
    const osBtn = boxes.find((b) => b.id === "obj-ctrl-os");
    assert.strictEqual(osBtn.text, "4x", "OS button is labeled 4x");
    const peakBtn = boxes.find((b) => b.id === "obj-ctrl-hlim");
    assert.strictEqual(peakBtn.text, "Peak", "Limit button is renamed to Peak");
    const detail = boxes.find((b) => b.id === "obj-ctrl-detail").saved_attribute_attributes.valueof;
    assert.strictEqual(detail.parameter_initial[0], 100);
    const hlim = boxes.find((b) => b.id === "obj-ctrl-hlim").saved_attribute_attributes.valueof;
    assert.strictEqual(hlim.parameter_initial[0], 1);
    console.log("[device] Clip+.amxd");
}

// ---- paint stays inside all canvases ----
{
    function join(files) {
        return files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
    }
    const faceCode = join(["src/spectral_theme.js", "src/clipplus_curve.js", "src/clipplus_dsp.js", "src/clipplus_ui.js"]);
    const meterCode = join(["src/spectral_theme.js", "src/clipplus_curve.js", "src/clipplus_meters.js"]);
    function run(code, w, h, label, setup) {
        const rec = makeRecorder(w, h);
        const face = loadFace(code, rec);
        rec.begin(label);
        if (setup) setup(face);
        face.paint();
        rec.end();
        const bad = checkRecording(rec, { regions: [{ x: 0, y: 0, w: w, h: h }] });
        assert.deepStrictEqual(bad, [], bad.join("\n"));
        return { face, rec };
    }
    const viz = run('var FACE_ROLE = "viz";\n' + faceCode, 180, 157, "viz", (f) => f.preview());
    assert.ok(viz.face.csBipolarCurve(-0.5, 10, 50, 0, 1) < 0, "Gain curve is bipolar (negative for negative input)");
    assert.ok(viz.face.csBipolarCurve(0.5, 10, 50, 0, 1) > 0, "Gain curve is bipolar (positive for positive input)");
    // Verify at Shape 100% and Sym 0, curve is a hard clip at ceiling
    const ceilLin = C.cpDbToLin(-3);
    assert.ok(Math.abs(viz.face.csBipolarCurve(ceilLin, 0, 100, 0, ceilLin) - ceilLin) < 1e-9, "At Shape 100%, curve is a hard clip at ceiling");
    assert.ok(Math.abs(viz.face.csBipolarCurve(ceilLin * 0.5, 0, 100, 0, ceilLin) - ceilLin * 0.5) < 1e-9, "At Shape 100%, curve is linear below ceiling");
    // The drawn curve is the waveshaper. Drive 0 is a hard ceiling clamp, and Symmetry is full strength.
    assert.ok(Math.abs(viz.face.csBipolarCurve(0.99, 0, 0, 0, 1) - C.cpCurve(0.99, 0, 0, 0, 1)) < 1e-6,
        "Drive 0 Shape 0 draws the hard clamp, got " + viz.face.csBipolarCurve(0.99, 0, 0, 0, 1));
    assert.ok(Math.abs(viz.face.csBipolarCurve(0.3, 12, 100, -100, 1) - C.cpCurve(0.3, 12, 100, -100, 1)) < 1e-6,
        "Drive 12 Shape 100 Sym -100 matches the waveshaper, got " + viz.face.csBipolarCurve(0.3, 12, 100, -100, 1));

    run('var FACE_ROLE = "viz";\n' + faceCode, 180, 157, "viz-wave", (f) => { f.preview(); f.set_view(1); });
    run('var FACE_ROLE = "viz";\n' + faceCode, 180, 157, "viz-extremes", (face) => {
        face.set_drive(24);
        face.set_shape(100);
        face.set_sym(-100);
        face.set_ceiling(-12);
        face.set_outgain(12);
        face.set_ingain(24);
        face.cpView = 1;
        face.cpScope.clip = 1;
        face.cpScope.gr = 40;
        face.cpScope.inPk = 8;
        face.cpScope.outPk = 4;
        face.cpDsp.createdAt = 1;
        face.cpDots = [[-4, 4], [0, 0], [1e3, -1e3]];
        const cols = [];
        for (let i = 0; i < 64; i++) cols.push([-1e4, 1e4, -1e4, 1e4]);
        face.cpWave = cols;
    });
    run('var FACE_ROLE = "in_meter";\n' + faceCode, 46, 139, "in-meter", (f) => f.preview());
    const outM = run('var FACE_ROLE = "out_meter";\n' + faceCode, 82, 139, "out-meter", (f) => {
        f.preview();
        f.cpMaxGr = 5.4;
        f.cpScope.gr = 1.2;
    });
    const outTxts = outM.rec.shapes.filter((s) => s.kind === "text").map((s) => String(s.text));
    assert.ok(outTxts.some((t) => t.includes("-5.4")), "Sticky GR displays max applied GR (-5.4), got " + outTxts.join(", "));
    outM.face.onclick(10, 8);
    assert.strictEqual(outM.face.cpMaxGr, 0, "Clicking GR readout clears cpMaxGr");

    {
        const rec = makeRecorder(18, 161);
        rec.mgraphics.rotate = undefined;
        const face = loadFace('var FACE_ROLE = "filt_tab";\n' + faceCode, rec);
        rec.begin("filt-tab");
        face.preview();
        face.paint();
        rec.end();
        const bad = checkRecording(rec, { regions: [{ x: 0, y: 0, w: 18, h: 161 }] });
        assert.deepStrictEqual(bad, [], bad.join("\n"));
    }
    run('var FACE_ROLE = "filt_viz";\n' + faceCode, 112, 66, "filt-viz", (f) => f.preview());
    // Verify dragging up/down in the XY filter panel in Low-Cut mode (filttype = 1) increases/decreases Q
    {
        const rec = makeRecorder(112, 66);
        const face = loadFace('var FACE_ROLE = "filt_viz";\n' + faceCode, rec);
        face.set_filton(1);
        face.set_filttype(1);
        face.set_filtq(1.0);
        face.onclick(56, 33);
        face.ondrag(56, 15, 1); // drag upward -> increases Q
        assert.ok(face.cpFiltQ > 1.5, "Dragging upward in Low-Cut XY panel increases Q, got " + face.cpFiltQ);
        face.onclick(56, 15);
        face.ondrag(56, 50, 1); // drag downward -> decreases Q
        assert.ok(face.cpFiltQ < 1.0, "Dragging downward in Low-Cut XY panel decreases Q, got " + face.cpFiltQ);
    }
    // Shelf dot Y drives the Emphasis parameter, and the corner of the curve stays with the pointer
    {
        const rec = makeRecorder(112, 66);
        const face = loadFace('var FACE_ROLE = "filt_viz";\n' + faceCode, rec);
        const writes = [];
        face.patcher.getnamed = (name) => ({ message(v) { writes.push([name, v]); } });
        face.set_filton(1);
        face.set_filttype(0);
        face.set_filtfreq(250);
        face.set_filtq(0.71);
        face.set_filtgain(12);
        const before = face.csFiltGainAt(250);
        const y0 = face.csFiltDbToY(before);
        face.onclick(50, y0);
        face.ondrag(50, y0 + 3, 1);
        const mouseDb = face.csFiltYToDb(y0 + 3) - face.csFiltYToDb(y0);
        const after = face.csFiltGainAt(250);
        assert.ok(face.cpFiltGain > 12, "Dragging the shelf dot down deepens the cut, Emphasis " + face.cpFiltGain);
        assert.ok(Math.abs((after - before) - mouseDb) < 0.35, "Shelf corner follows the pointer by " + mouseDb.toFixed(2) + " dB, moved " + (after - before).toFixed(2));
        assert.ok(writes.some((w) => w[0] === "obj-ctrl-filtgain" && Math.abs(w[1] - face.cpFiltGain) < 1e-6), "Shelf drag writes Emphasis on obj-ctrl-filtgain");
        face.set_filtgain(0);
        assert.ok(Math.abs(face.csFiltGainAt(250)) < 1e-6, "Emphasis 0 flattens the shelf");
        // The drawn shelf is the pre-emphasis the clipper hears. A 100 Hz tone through the gen
        // must sit on that curve (the analog sketch used to miss it by several dB).
        face.set_filtfreq(400);
        face.set_filtq(0.707);
        face.set_filtgain(12);
        const drawn = face.csFiltGainAt(100);
        const st = new gx.DataSim(8, 2);
        let sxx = 0, syy = 0, n = 0;
        const sr = 48000;
        for (let i = 0; i < sr; i++) {
            const x = Math.sin(2 * Math.PI * i * 100 / sr);
            const y = G.cp_pre_emp(x, st, 0, sr, 400, 12, 0.707, 0, 1);
            if (i > sr / 2) { n++; sxx += x * x; syy += y * y; }
        }
        const heard = 20 * Math.log10(Math.sqrt(syy / sxx));
        assert.ok(Math.abs(drawn - heard) < 0.15, "shelf curve at 100 Hz must match the gen, drawn " + drawn.toFixed(2) + " heard " + heard.toFixed(2));
    }
    // Low Cut does not use Emphasis, so the value and its label go grey and the box ignores drags.
    {
        const rec = makeRecorder(180, 157);
        const face = loadFace('var FACE_ROLE = "viz";\n' + faceCode, rec);
        const attrs = [];
        face.patcher.getnamed = (name) => ({
            setattr() { attrs.push([name].concat(Array.from(arguments))); },
        });
        face.set_filttype(1);
        const gainOff = attrs.filter((a) => a[0] === "obj-ctrl-filtgain");
        const lblOff = attrs.filter((a) => a[0] === "obj-lbl-filtgain");
        assert.ok(gainOff.some((a) => a[1] === "active" && a[2] === 0), "Low Cut deactivates Emphasis");
        assert.ok(gainOff.some((a) => a[1] === "textcolor"), "Low Cut greys the Emphasis value");
        assert.ok(lblOff.some((a) => a[1] === "textcolor"), "Low Cut greys the Emphasis label");
        attrs.length = 0;
        face.set_filttype(0);
        const gainOn = attrs.filter((a) => a[0] === "obj-ctrl-filtgain");
        assert.ok(gainOn.some((a) => a[1] === "active" && a[2] === 1), "Shelf reactivates Emphasis");
    }
    // Channel button: Both -> L -> R, and Both -> M -> S once stereo mode is M/S.
    {
        const rec = makeRecorder(180, 157);
        const face = loadFace('var FACE_ROLE = "viz";\n' + faceCode, rec);
        const writes = [];
        const btn = { text: "", texton: "" };
        face.patcher.getnamed = (name) => {
            if (name === "Channel Mode") return { message(v) { writes.push(v); } };
            if (name === "obj-btn-chmode") return { setattr(k, v) { btn[k] = v; } };
            return null;
        };
        face.cycle_chmode();
        face.cycle_chmode();
        face.cycle_chmode();
        assert.deepStrictEqual(writes, [1, 2, 0], "the cycle writes Both, L, R as 0, 1, 2");
        assert.strictEqual(btn.text, "Both");
        assert.strictEqual(btn.texton, "Both");
        writes.length = 0;
        face.set_msmode(1);
        face.cycle_chmode();
        face.cycle_chmode();
        assert.strictEqual(btn.text, "S", "M/S mode cycles Both, M, S");
        assert.deepStrictEqual(writes, [1, 2]);
        face.set_msmode(0);
        assert.strictEqual(btn.text, "R", "leaving M/S restores the L/R label for the same index");
    }
    const inMs = run('var FACE_ROLE = "in_meter";\n' + faceCode, 46, 139, "in-meter-ms", (f) => {
        f.preview();
        f.set_msmode(1);
    });
    const inMsTxt = inMs.rec.shapes.filter((s) => s.kind === "text").map((s) => String(s.text));
    assert.ok(inMsTxt.some((t) => t.includes("M") && t.includes("S") && !t.includes("L")), "input meters relabel to M/S");
    const outMs = run('var FACE_ROLE = "out_meter";\n' + faceCode, 82, 139, "out-meter-ms", (f) => {
        f.preview();
        f.set_msmode(1);
    });
    const outMsTxt = outMs.rec.shapes.filter((s) => s.kind === "text").map((s) => String(s.text));
    assert.ok(outMsTxt.some((t) => t.includes("M") && t.includes("S")), "output meters relabel to M/S");
    run(meterCode, 176, 157, "meters");
    const mPrev = run(meterCode, 176, 157, "meters-preview", (face) => {
        face.preview();
    });
    const mTxts = mPrev.rec.shapes.filter((s) => s.kind === "text").map((s) => String(s.text));
    assert.ok(mTxts.includes("Meters") && mTxts.includes("Reset"), "Meters black box draws both Meters label and Reset button inside the top row");
    mPrev.face.onclick(68, 12);
    assert.strictEqual(mPrev.face.cpMeter.momentary()[0], -120, "Clicking Reset inside the top of the black box resets the meters");
    run(meterCode, 176, 157, "meters-full", (face) => {
        const m = face.cpMeter;
        for (let i = 0; i < 80; i++) m.push(0.01, 0.008, 0.012, 0.009, 0.4, 0.3);
    });
    console.log("[paint] bounds");
}

console.log("test_clipplus: ok");
