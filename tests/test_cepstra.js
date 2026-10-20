#!/usr/bin/env node
/**
 * Verification suite for devices/Cepstra.amxd (520 x 169 px — cepstral formant shifter; ignoreclick face v8ui + transparent live.* controls + interactive display v8ui).
 *
 * Verifies:
 *  1. Config helpers (src/cepstra_config.js): cutoff mapping, Auto/MIDI period scaling, shift ratio, gate map,
 *     Mid/Side lock, telemetry bin layout
 *  2. JS reference of the cepstral split: E + H reconstructs logmag exactly, liftered envelope is band-limited in
 *     quefrency, shift 0 / levels 100% / gate 0 is a magnitude identity (and a full STFT overlap-add null), a +12 st shift
 *     moves the envelope peak up an octave, Gate removes valleys first
 *  3. GenExpr ordering and lexer rules (functions -> Buffer -> Data -> Param -> History -> expressions, no e<digit>)
 *  4. .amxd header, 424 x 169 presentation layout, parameter ranges/defaults, z-order, `#0-` names, wiring
 *  5. v8ui evaluation: pixel coordinates, spectrum/envelope/ghost drawing, cutoff drag, Lock without feedback,
 *     idle sleep
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const AMXD_PATH = path.join(ROOT, "devices", "Cepstra.amxd");
const GEN_PATH = path.join(ROOT, "src", "cepstra_core.genexpr");
const cfg = require(path.join(ROOT, "src", "cepstra_config.js"));

let checks = 0;
function ok(cond, msg) {
    checks++;
    assert.ok(cond, msg);
}
function eq(a, b, msg) {
    checks++;
    assert.strictEqual(a, b, msg);
}
function near(a, b, tol, msg) {
    checks++;
    assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, expected ${b} +/- ${tol})`);
}

// ---------------------------------------------------------------------------------------------
// 1. Config helpers
// ---------------------------------------------------------------------------------------------
near(cfg.manualLagSamples(0, 44100, 2048), 0.3e-3 * 44100, 0.01, "Res 0% = 0.3 ms of quefrency");
near(cfg.manualLagSamples(1, 44100, 4096), 15e-3 * 44100, 0.01, "Res 100% = 15 ms of quefrency");
ok(cfg.manualLagSamples(1, 44100, 1024) < 512, "Manual cutoff must stay below N/2 (1k, 15 ms)");
ok(cfg.manualLagSamples(1, 96000, 1024) < 512, "Manual cutoff must stay below N/2 at 96 kHz");
near(cfg.manualLagSamples(0.5, 44100, 4096), 0.3e-3 * Math.sqrt(50) * 44100, 0.01, "Res mapping must be logarithmic");
near(cfg.periodScale(0), 0.3, 1e-9, "Auto/MIDI k at Res 0 = 0.3");
near(cfg.periodScale(1), 1.0, 1e-9, "Auto/MIDI k at Res 100 = 1.0");
near(cfg.periodScale(cfg.DEFAULT_RES_PCT / 100), 0.7, 0.01, "Default Res lands near k = 0.7");
near(cfg.lifterLagSamples(1, 0.57, 44100, 2048, 367.5), 0.699 * 367.5, 0.5, "Auto L = k * period");
near(cfg.lifterLagSamples(2, 1.0, 44100, 4096, cfg.midiPeriodSamples(57, 44100)), 44100 / 220, 0.01, "MIDI L = period at k = 1 (A3)");
eq(cfg.lifterLagSamples(1, 0.5, 44100, 2048, 0), cfg.manualLagSamples(0.5, 44100, 2048), "Auto without a period falls back to the manual map");
near(cfg.midiToHz(69), 440, 1e-9, "A4 = 440 Hz");
near(cfg.shiftRatio(12), 2, 1e-12, "+12 st = 2x");
near(cfg.shiftRatio(-12), 0.5, 1e-12, "-12 st = 0.5x");
near(cfg.shiftRatio(80), cfg.shiftRatio(36), 1e-12, "Shift clamps to +/-36 st");
eq(cfg.fftSizeForQuality(0), 1024, "Quality 0 = 1024");
eq(cfg.fftSizeForQuality(1), 2048, "Quality 1 = 2048 (default)");
eq(cfg.fftSizeForQuality(2), 4096, "Quality 2 = 4096");
eq(cfg.latencySamples(2048), 2304, "Latency = N + N/8");
near(cfg.resFromLag(0, cfg.manualLagSamples(0.37, 44100, 2048), 44100, 2048, 0), 0.37, 1e-9, "resFromLag inverts the manual map");
near(cfg.resFromLag(1, cfg.lifterLagSamples(1, 0.8, 44100, 2048, 300), 44100, 2048, 300), 0.8, 1e-9, "resFromLag inverts the Auto map");
near(cfg.binFreq(0, 44100), 40, 1e-9, "First telemetry bin = 40 Hz");
near(cfg.binFreq(127, 44100), 10000, 1e-6, "Last telemetry bin = 10 kHz");
near(cfg.freqToBinPos(cfg.binFreq(64, 44100), 44100), 64, 1e-9, "freqToBinPos inverts binFreq");
eq(cfg.NUM_BINS, 128, "128 log-spaced telemetry bins");
near(cfg.gateThresholdNepers(1) * 8.685889638, 30, 1e-6, "Gate 100% = +30 dB above the envelope");
eq(cfg.gateFineStructure(-3, 0), -3, "Gate 0 is a bypass");
ok(cfg.gateFineStructure(-3, 0.3) < -5, "Gate cuts valleys (below the threshold)");
near(cfg.gateFineStructure(8, 0.3), 8, 1e-9, "Gate keeps partials above the threshold");
let lk = cfg.applyLock(true, "mid", 5, 0, 0);
eq(lk.mid, 5, "Lock: mid follows the dial");
eq(lk.side, 5, "Lock: side moves by the same delta");
lk = cfg.applyLock(true, "side", -7, 5, 5);
eq(lk.mid, -7, "Lock: moving side by -12 moves mid by -12");
lk = cfg.applyLock(false, "mid", 9, 5, -2);
eq(lk.side, -2, "Unlocked: side untouched");
lk = cfg.applyLock(true, "mid", 36, 30, 30);
eq(lk.side, 36, "Lock clamps the follower to +36");

// Cepstrum axis (LINEAR quefrency, 0..20 ms), display scaling and glyph-knob mapping helpers
eq(cfg.NUM_QUEF, 192, "192 quefrency telemetry columns");
near(cfg.quefMsAt(0), 0, 1e-12, "Quefrency axis starts at n = 0");
near(cfg.quefMsAt(192), 20, 1e-12, "Quefrency axis ends at 20 ms");
near(cfg.quefMsAt(96), 10, 1e-12, "Axis is linear: column 96 starts at 10 ms");
near(cfg.axis01ToMs(cfg.msToAxis01(3.3)), 3.3, 1e-12, "msToAxis01 inverts axis01ToMs");
near(cfg.msToAxis01(10), 0.5, 1e-12, "10 ms sits mid-axis (linear 0..20 ms)");
near(cfg.msToAxis01(5) - cfg.msToAxis01(0), cfg.msToAxis01(15) - cfg.msToAxis01(10), 1e-12, "Equal ms steps are equal screen steps");
for (const r of [0, 0.25, 0.57, 1]) {
    near(cfg.axis01ToRes(0, cfg.resToAxis01(0, r, 44100, 2048, 0), 44100, 2048, 0), r, 1e-9, `screen x <-> Res round trip (manual, ${r})`);
    near(cfg.axis01ToRes(1, cfg.resToAxis01(1, r, 44100, 2048, 367.5), 44100, 2048, 367.5), r, 1e-9, `screen x <-> Res round trip (auto, ${r})`);
}
near(cfg.resToAxis01(0, 0, 44100, 2048, 0), 0.3 / 20, 1e-9, "Res 0 -> L = 0.3 ms -> x = 1.5% of the axis (log value mapping kept)");
near(cfg.resToAxis01(0, 1, 44100, 2048, 0), 15 / 20, 1e-9, "Res 100 -> L = 15 ms -> x = 75% of the axis");
ok(cfg.resToAxis01(0, 0.5, 44100, 2048, 0) < 0.5 * 0.5, "Res mapping stays logarithmic in value (Res 50% = 2.1 ms)");
{
    const sym = [3, -3, 0.2, -0.2];
    near(cfg.cepstrumDisplayHeight(sym[0], 1), -cfg.cepstrumDisplayHeight(sym[1], 1), 1e-12, "Display is symmetric around the zero line");
    near(cfg.cepstrumDisplayHeight(1, 1), 0.85, 1e-9, "|c| = reference lands at 85% of the half-height");
    eq(cfg.cepstrumDisplayHeight(0, 1), 0, "c = 0 sits on the centre line");
    eq(cfg.cepstrumDisplayHeight(500, 1), 1, "Huge values (c[0]) clip at the top");
    eq(cfg.cepstrumDisplayHeight(-500, 1), -1, "Huge negative values clip at the bottom");
    ok(cfg.cepstrumDisplayHeight(0.05, 1) > 0.15, "Small harmonic-region stems stay visible (soft compression)");
    ok(cfg.cepstrumDisplayHeight(0.3, 1) > cfg.cepstrumDisplayHeight(0.05, 1) && cfg.cepstrumDisplayHeight(1.0, 1) > cfg.cepstrumDisplayHeight(0.3, 1), "Compression is monotonic");
}
{
    const v = [50, 40, 0.1, -0.5, 0.2, 9999, -0.3, 0.05];
    near(cfg.percentileAbs(v, 2, 0.95), 0.5, 1e-12, "Percentile skips c[0..1] and the sentinel");
    eq(cfg.percentileAbs([9999, 9999], 0, 0.95), 0, "All-sentinel percentile = 0");
    let ref = 1;
    const up = cfg.adaptRef(ref, 5), down = cfg.adaptRef(ref, 0.2);
    ok(up - ref > 4 * 0.5 && ref - down < 0.1, "Auto-gain reference: fast attack, slow release");
    const rows = [0, 5, 10, 15, 20].map((j) => cfg.columnRange(j, 43));
    eq(rows[0][0], 0, "First display column starts at telemetry column 0");
    eq(cfg.columnRange(42, 43)[1], 192, "Last display column ends at the last telemetry column");
    for (let j = 0; j < 42; j++) eq(cfg.columnRange(j, 43)[1], cfg.columnRange(j + 1, 43)[0], "Display columns tile the telemetry");
    const pooled = cfg.poolSigned([0.1, -0.7, 0.3, 9999], 0, 4);
    eq(pooled.v, -0.7, "Pooling keeps the value with the largest |c| and its sign (pitch peaks survive)");
    ok(pooled.valid && !cfg.poolSigned([9999, 9999], 0, 2).valid, "Sentinel columns are invalid (beyond N/2)");
}
eq(cfg.KNOBS.map((k) => k.key).join(","), "res,mid,mix,side,gate", "Knob order on the face: Res, Mid, Mix, Side, Gate");
const midSpec = cfg.specFor("mid");
near(cfg.knobDragValue(midSpec, 0, -60, false), 36, 1e-9, "Dragging up 60 px moves Mid by half the range (+36)");
near(cfg.knobDragValue(midSpec, 0, 30, false), -18, 1e-9, "Dragging down 30 px lowers Mid by 18 st");
near(cfg.knobDragValue(midSpec, 0, -30, true), 36 * 2 / 120 * 30 / 8, 1e-9, "Shift-drag is 8x finer");
eq(cfg.knobDragValue(midSpec, 30, -500, false), 36, "Drag clamps to the max");
eq(cfg.knobDragValue(cfg.specFor("res"), 5, 500, false), 0, "Drag clamps to the min");
eq(cfg.quantizeTo(midSpec, 7.04), 7, "Mid quantizes to 0.1 st");
near(cfg.sliderValueAt(cfg.specFor("fmt"), 62 + 80, 62, 160), 100, 1e-9, "Dot slider midpoint = 100%");
eq(cfg.sliderValueAt(cfg.specFor("harm"), 500, 62, 160), 200, "Dot slider clamps to 200%");
eq(cfg.formatValue(midSpec, 7), "+7.0 st", "Value readout: Mid +7.0 st");
eq(cfg.formatValue(midSpec, -12.5), "-12.5 st", "Value readout: negative semitones");
eq(cfg.formatValue(cfg.specFor("res"), 57), "57.0%", "Value readout: percent");
eq(cfg.formatValue(cfg.specFor("fmt"), 130), "130%", "Value readout: 0..200% level");
eq(cfg.KNOBS.map((k) => k.def).join(","), "57,0,100,0,0", "Knob defaults (double-click reset values)");
ok(cfg.resGridCount(1) > cfg.resGridCount(0), "Res glyph grid gets denser with Res");
ok(cfg.mixRingCount(0) === 0 && cfg.mixRingCount(1) === 5 && cfg.mixRingCount(0.5) === 3, "Mix glyph ring count follows Mix");
{
    const open = cfg.gateBarHeights(0), gated = cfg.gateBarHeights(0.8);
    ok(open.every((h, i) => h === cfg.GATE_BAR_BASE[i]), "Gate 0: comb ungated");
    ok(gated.filter((h) => h < 0.1).length >= 4 && Math.max(...gated) < Math.max(...open), "Gate glyph gates short bars and shortens the rest");
}
near(cfg.shiftOffsetNorm(18), 0.5, 1e-9, "Shift glyph offset is st / 36");

// ---------------------------------------------------------------------------------------------
// 2. Reference cepstral split
// ---------------------------------------------------------------------------------------------
const SR = 44100;
const N = 2048;
function vowelFrame(n, f0, offset) {
    const x = new Float64Array(n);
    const period = SR / f0;
    for (let p = offset; p < n; p += period) x[Math.round(p)] = 1;
    const reson = (sig, f, bw) => {
        const r = Math.exp(-Math.PI * bw / SR);
        const th = 2 * Math.PI * f / SR;
        const a1 = -2 * r * Math.cos(th), a2 = r * r;
        const out = new Float64Array(sig.length);
        let y1 = 0, y2 = 0;
        for (let i = 0; i < sig.length; i++) {
            const v = (1 - r) * sig[i] - a1 * y1 - a2 * y2;
            out[i] = v; y2 = y1; y1 = v;
        }
        return out;
    };
    const a = reson(x, 700, 90), b = reson(x, 1220, 110), c = reson(x, 2600, 160);
    return Float64Array.from(a.map((v, i) => v + 0.7 * b[i] + 0.4 * c[i]));
}
const long = vowelFrame(4 * N, 120, 3);
const win = cfg.hannWindow(N);
const frame = Float64Array.from({ length: N }, (_, i) => long[N + i] * win[i]);
const LAG = Math.round(cfg.manualLagSamples(0.57, SR, N));
const split = cfg.cepstralSplit(frame, LAG);

let maxRecon = 0;
for (let k = 0; k < N; k++) maxRecon = Math.max(maxRecon, Math.abs(split.E[k] + split.H[k] - split.logmag[k]));
ok(maxRecon < 1e-9, `E + H must reconstruct logmag exactly (max err ${maxRecon})`);

// Band-limited envelope: its cepstrum has no energy above the lifter cutoff
{
    const re = Float64Array.from(split.E);
    const im = new Float64Array(N);
    cfg.fftInPlace(re, im, true);
    let beyond = 0, inside = 0;
    for (let n = 0; n < N; n++) {
        const q = n <= N / 2 ? n : N - n;
        if (q > LAG + 1) beyond = Math.max(beyond, Math.abs(re[n]));
        else inside = Math.max(inside, Math.abs(re[n]));
    }
    ok(beyond < 1e-9 && inside > 0.05, `Formant envelope must be band-limited to the lifter cutoff (beyond ${beyond}, inside ${inside})`);
}
// Envelope is real and symmetric
for (let k = 1; k < N / 2; k++) {
    ok(Math.abs(split.E[k] - split.E[N - k]) < 1e-9, "Envelope must be symmetric");
}
// Harmonic fine structure ripples at f0; envelope does not
{
    let hVar = 0, eVar = 0;
    const k0 = 20, k1 = 200;
    let hMean = 0, eMean = 0;
    for (let k = k0; k < k1; k++) { hMean += split.H[k]; eMean += split.E[k]; }
    hMean /= (k1 - k0); eMean /= (k1 - k0);
    for (let k = k0; k < k1; k++) { hVar += (split.H[k] - hMean) ** 2; }
    for (let k = k0; k < k1; k++) {
        const d = split.E[k] - split.E[k - 1];
        eVar += d * d;
    }
    ok(Math.sqrt(hVar / (k1 - k0)) > 1.0, "Harmonic layer must carry the partial ripple");
    ok(Math.sqrt(eVar / (k1 - k0)) < 0.5, "Envelope must be smooth bin to bin");
}

// Neutral = magnitude identity
let maxIdent = 0;
for (let k = 0; k <= N / 2; k++) {
    const lm = cfg.shiftedLogMag(split, k, 1, 1, 1, 0);
    maxIdent = Math.max(maxIdent, Math.abs(Math.exp(lm) - Math.exp(split.logmag[k])) / Math.exp(split.logmag[k]));
}
ok(maxIdent < 1e-9, `shift 0, levels 100%, gate 0 must be a magnitude identity (rel err ${maxIdent})`);

// Full STFT overlap-add null with the neutral reference
{
    const total = 8 * N;
    const sig = vowelFrame(total, 120, 5);
    const hop = N / 4;
    const out = new Float64Array(total);
    let sumW2 = 0;
    for (let i = 0; i < N; i += hop) sumW2 += win[i] * win[i];
    near(sumW2, 1.5, 1e-9, "Hann^2 at 75% overlap sums to 1.5");
    for (let start = 0; start + N <= total; start += hop) {
        const fr = Float64Array.from({ length: N }, (_, i) => sig[start + i] * win[i]);
        const sp = cfg.cepstralSplit(fr, LAG);
        const yr = new Float64Array(N), yi = new Float64Array(N);
        for (let k = 0; k <= N / 2; k++) {
            const mag = Math.exp(cfg.shiftedLogMag(sp, k, 1, 1, 1, 0));
            const am = Math.hypot(sp.xr[k], sp.xi[k]);
            const pr = am > 1e-12 ? sp.xr[k] / am : 1;
            const pi = am > 1e-12 ? sp.xi[k] / am : 0;
            yr[k] = mag * pr; yi[k] = mag * pi;
            if (k > 0 && k < N / 2) { yr[N - k] = mag * pr; yi[N - k] = -mag * pi; }
        }
        cfg.fftInPlace(yr, yi, true);
        for (let i = 0; i < N; i++) out[start + i] += yr[i] * win[i] / 1.5;
    }
    let err = 0, ref = 0;
    for (let i = N; i < total - N; i++) { err += (out[i] - sig[i]) ** 2; ref += sig[i] ** 2; }
    const db = 10 * Math.log10(err / ref);
    ok(db < -100, `Neutral reference STFT must null against the input (${db.toFixed(1)} dB)`);
}

// +12 st moves the envelope peak up an octave while H (harmonics) is untouched
{
    let peakK = 0, peakV = -1e9;
    for (let k = 8; k < N / 8; k++) if (split.E[k] > peakV) { peakV = split.E[k]; peakK = k; }
    let sPeakK = 0, sPeakV = -1e9;
    for (let k = 8; k < N / 4; k++) {
        const v = cfg.interpEnv(split.E, k / 2, N / 2);
        if (v > sPeakV) { sPeakV = v; sPeakK = k; }
    }
    near(sPeakK, peakK * 2, 2, "Shifted envelope peak must move to 2x the frequency");
    const shifted = cfg.shiftedLogMag(split, 100, 2, 1, 1, 0);
    const expected = cfg.interpEnv(split.E, 50, N / 2) + split.H[100];
    near(shifted, expected, 1e-9, "Shifted log-magnitude = E'(k/ratio) + original fine structure H(k)");
}
// Gate removes valleys first
{
    let valleyCut = 0, peakCut = 0;
    let hMax = -1e9, hMin = 1e9, kMax = 0, kMin = 0;
    for (let k = 10; k < 300; k++) {
        if (split.H[k] > hMax) { hMax = split.H[k]; kMax = k; }
        if (split.H[k] < hMin) { hMin = split.H[k]; kMin = k; }
    }
    valleyCut = split.H[kMin] - cfg.shiftedLogMag(split, kMin, 1, 0, 1, 0.3);
    peakCut = split.H[kMax] - cfg.shiftedLogMag(split, kMax, 1, 0, 1, 0.3);
    ok(valleyCut > 3 && peakCut < valleyCut, `Gate must attenuate valleys (${valleyCut}) more than partials (${peakCut})`);
}

// ---------------------------------------------------------------------------------------------
// 3. GenExpr ordering / lexer rules
// ---------------------------------------------------------------------------------------------
const gen = fs.readFileSync(GEN_PATH, "utf8");
ok(!/\be\d/.test(gen), "Never use e0..e9 identifiers in GenExpr (parsed as Euler's constant)");
ok(!gen.includes("delay("), "GenExpr must not use legacy delay()");
const firstFn = gen.indexOf("\nfft_pass(");
const lastFn = gen.indexOf("\njob_ola(");
const bufAt = gen.indexOf("\nBuffer ");
const dataAt = gen.indexOf("\nData ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1);");
ok(firstFn >= 0 && lastFn > firstFn && lastFn < bufAt, "Helper functions must precede Buffer");
ok(bufAt < dataAt && dataAt < paramAt && paramAt < histAt && histAt < exprAt, "Order: Buffer -> Data -> Param -> History -> expressions");
ok(!/\n(Buffer|Data|Param|History) /.test(gen.slice(0, bufAt)), "No declarations before the last helper function");
ok(gen.includes("job_tele(wre, scope, stat,") && gen.includes("qmax = 0.02 * srVal;") && gen.includes("9999") && gen.includes("abs(cv) > abs(best)"), "Telemetry writes the signed Mid cepstrum on 192 linear columns (n = 0..20 ms, largest |c| per column, sentinel beyond N/2)");
for (const fn of ["fft_pass", "init_tables", "job_capture", "job_logmag", "job_lift", "job_spec", "job_tele", "job_ola", "gate_h", "interp_env"]) {
    ok(gen.includes(`\n${fn}(`), `GenExpr must define ${fn}`);
}
ok(gen.includes('Buffer scope("cepscope");'), 'Telemetry must be Buffer scope("cepscope")');
ok(!/Param mix\(/.test(gen), "Param must not be named mix (GenExpr mix() builtin); the Mix knob drives `wet`");
for (const [name, def] of [["res", "0.57"], ["midshift", "0.0"], ["sideshift", "0.0"], ["gate", "0.0"], ["fmtlevel", "1.0"], ["harmlevel", "1.0"], ["resmode", "0"], ["quality", "1"], ["wet", "1.0"], ["midinote", "-1"]]) {
    ok(gen.includes(`Param ${name}(${def});`), `GenExpr Param ${name}(${def}) missing`);
}
const dataSizes = [...gen.matchAll(/^Data (\w+)\((\d+)\);/gm)].map((m) => [m[1], Number(m[2])]);
ok(dataSizes.length >= 18, "Data arrays for the frames must be declared");
for (const [nm, sz] of dataSizes) {
    if (["xre", "xim", "lre", "lim", "wre", "wim", "ere", "eim", "ore", "oim", "brv"].includes(nm)) eq(sz, 4096, `Data ${nm} must be sized for 4096`);
}
ok(gen.includes("quietCount < nCur"), "Silence sleep gate: skip FFT frames after one silent frame");
ok(gen.includes("0.00001") && gen.includes("fixdenorm") && gen.includes("fixnan"), "Denormal flush, NaN guard and -100 dB gate present");
ok(gen.includes("/ (n * 1.5)"), "Overlap-add must normalize Hann^2 at 75% overlap by 1.5");
ok(gen.includes("1024 * pow(2, qIdx)"), "Quality selects N = 1024 / 2048 / 4096");
ok(gen.includes("0.000000001"), "logmag uses the 1e-9 floor");
ok(/clip\(fmt \* epm \+ harm \* hm, -21, 12\)/.test(gen), "Output log-magnitude must be clamped against blow-ups");
ok(!/crumpets|crql/i.test(gen), "No forbidden name in the GenExpr");

// ---------------------------------------------------------------------------------------------
// 4. .amxd binary header, layout, parameters, wiring
// ---------------------------------------------------------------------------------------------
const raw = fs.readFileSync(AMXD_PATH);
eq(raw.slice(0, 4).toString("ascii"), "ampf", "Expected ampf header");
eq(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected aaaa audio-effect type");
eq(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
eq(raw.readUInt32LE(28), raw.length - 32, "Payload length mismatch");
ok(!/crumpets|crql/i.test(raw.toString("latin1")), "The device must not contain the forbidden names anywhere");

const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
eq(patcher.openinpresentation, 1, "Must open in presentation mode");
eq(patcher.openrect[2], 520.0, "Expected width 520");
eq(patcher.openrect[3], 169.0, "Expected height 169");
eq(patcher.devicewidth, 520.0, "devicewidth must be 520");

const boxes = patcher.boxes.map((b) => b.box);
const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
eq(byId["obj-plugin"].text, "plugin~", "Missing plugin~");
eq(byId["obj-plugout"].text, "plugout~", "Missing plugout~");
eq(byId["obj-midiin"].text, "midiin", "Missing midiin");
eq(byId["obj-midiparse"].text, "midiparse", "Missing midiparse");
eq(byId["obj-gen"].maxclass, "gen.codebox~", "Missing gen.codebox~");
eq(byId["obj-gen"].code, gen, "Embedded GenExpr mismatch");
eq(byId["obj-msg-gen-buf"].text, "scope #0-cepscope", "Gen buffer bind message mismatch");
eq(byId["obj-msg-ui-buf"].text, "setbuffer #0-cepscope", "v8ui buffer message mismatch");
eq(byId["obj-scope-buf"].text, "buffer~ #0-cepscope @samps 272", "Scope buffer must be 272 samples");
for (const b of boxes) {
    if (b.text && b.text.startsWith("buffer~")) ok(b.text.includes("#0-"), `buffer~ must use #0- prefix: ${b.text}`);
    if (b.text && /^(send|receive|s|r) /.test(b.text)) ok(b.text.includes("#0-"), `send/receive must use #0-: ${b.text}`);
}

// Parameters: real, automatable live.* objects (names, ranges and defaults unchanged so existing sets load)
function vof(id) { return byId[id].saved_attribute_attributes.valueof; }
const expectRange = [
    ["obj-ctrl-res", 0, 100, 57, "Res", "live.dial"],
    ["obj-ctrl-midshift", -36, 36, 0, "Mid Shift", "live.dial"],
    ["obj-ctrl-sideshift", -36, 36, 0, "Side Shift", "live.dial"],
    ["obj-ctrl-mix", 0, 100, 100, "Mix", "live.dial"],
    ["obj-ctrl-gate", 0, 100, 0, "Gate", "live.dial"],
    ["obj-ctrl-fmtlevel", 0, 200, 100, "Formant", "live.slider"],
    ["obj-ctrl-harmlevel", 0, 200, 100, "Harmonic", "live.slider"],
];
// colour attributes each transparent maxclass must have, all alpha 0
const REQUIRED_COLORS = {
    "live.dial": ["activedialcolor", "activeneedlecolor", "dialcolor", "needlecolor", "textcolor", "tricolor", "tribordercolor", "panelcolor", "bordercolor", "bgcolor", "focusbordercolor"],
    "live.slider": ["activeslidercolor", "slidercolor", "bgcolor", "activebgcolor", "bordercolor", "textcolor", "tricolor", "tribordercolor", "focusbordercolor", "activetricolor"],
    "live.tab": ["activebgcolor", "activebgoncolor", "bgcolor", "bgoncolor", "bordercolor", "textcolor", "textoncolor", "activetextcolor", "activetextoncolor", "focusbordercolor"],
    "live.text": ["activebgcolor", "activebgoncolor", "bgcolor", "bgoncolor", "bordercolor", "textcolor", "textoncolor", "activetextcolor", "activetextoncolor", "focusbordercolor"],
};
function assertTransparent(id) {
    const b = byId[id];
    const req = REQUIRED_COLORS[b.maxclass];
    ok(!!req, `${id}: unknown transparent maxclass ${b.maxclass}`);
    for (const k of req) {
        ok(Array.isArray(b[k]) && b[k].length === 4 && b[k][3] === 0, `${id}.${k} must be set with alpha 0`);
    }
    for (const [k, v] of Object.entries(b)) {
        if (k.includes("color") && Array.isArray(v) && v.length === 4) ok(v[3] === 0, `${id}.${k} must have alpha 0`);
    }
    if (b.maxclass === "live.dial" || b.maxclass === "live.slider") {
        eq(b.showname, 0, `${id} showname 0`);
        eq(b.shownumber, 0, `${id} shownumber 0`);
    }
    if (b.maxclass === "live.text") {
        eq((b.text || "").trim(), "", `${id} draws no text`);
        eq((b.texton || "").trim(), "", `${id} draws no on-text`);
    }
}
for (const [id, lo, hi, init, longName, mc] of expectRange) {
    const v = vof(id);
    eq(byId[id].maxclass, mc, `${id} maxclass`);
    eq(v.parameter_longname, longName, `${id} long name unchanged`);
    eq(v.parameter_mmin, lo, `${id} min`);
    eq(v.parameter_mmax, hi, `${id} max`);
    eq(v.parameter_initial[0], init, `${id} default`);
    eq(v.parameter_initial_enable, 1, `${id} must store its default (double-click reset)`);
    eq(byId[id].parameter_enable, 1, `${id} must be automatable`);
    eq(v.parameter_type, 0, `${id} must be a float parameter (no Int > 255 problem)`);
    ok(v.parameter_shortname, `${id} needs a short name`);
    eq(byId[id].presentation, 1, `${id} must be in presentation (so Live offers automation / mapping on right-click)`);
    assertTransparent(id);
}
// face knob ranges/defaults agree with the live parameters
for (const [spec, id] of [["res", "obj-ctrl-res"], ["mid", "obj-ctrl-midshift"], ["side", "obj-ctrl-sideshift"], ["mix", "obj-ctrl-mix"], ["gate", "obj-ctrl-gate"], ["fmt", "obj-ctrl-fmtlevel"], ["harm", "obj-ctrl-harmlevel"]]) {
    const sp = cfg.specFor(spec);
    eq(sp.min, vof(id).parameter_mmin, `${spec} face min = live min`);
    eq(sp.max, vof(id).parameter_mmax, `${spec} face max = live max`);
    eq(sp.def, vof(id).parameter_initial[0], `${spec} face default = live default`);
}
{
    const q = vof("obj-quality");
    eq(byId["obj-quality"].maxclass, "live.tab", "Quality is a live.tab");
    assert.deepStrictEqual(q.parameter_enum, ["1k", "2k", "4k"]);
    eq(q.parameter_longname, "Quality", "Quality name unchanged");
    eq(q.parameter_initial[0], 1, "Quality defaults to 2k");
    const lock = vof("obj-lock");
    eq(byId["obj-lock"].mode, 1, "Lock is a toggle");
    assert.deepStrictEqual(lock.parameter_enum, ["Free", "Lock"]);
    eq(lock.parameter_longname, "Lock Mid-Side", "Lock name unchanged");
    eq(lock.parameter_initial[0], 0, "Lock defaults to off");
    const am = vof("obj-auto"), mi = vof("obj-midi");
    assert.deepStrictEqual(am.parameter_enum, ["Off", "Auto"]);
    assert.deepStrictEqual(mi.parameter_enum, ["Off", "MIDI"]);
    const rm = vof("obj-resmode");
    assert.deepStrictEqual(rm.parameter_enum, ["Man", "Auto", "MIDI"]);
    eq(rm.parameter_longname, "Cutoff Mode", "resmode parameter name unchanged (old sets still load)");
    eq(rm.parameter_initial[0], 0, "Mode defaults to Manual");
    eq(byId["obj-resmode"].parameter_enable, 1, "resmode stays automatable");
    ok(!byId["obj-resmode"].presentation, "resmode stays off the face (AUTO/MIDI toggles replace it visually)");
    checks += 9;
}
for (const id of ["obj-quality", "obj-lock", "obj-auto", "obj-midi"]) {
    eq(byId[id].parameter_enable, 1, `${id} must be automatable`);
    eq(byId[id].presentation, 1, `${id} must be in presentation`);
    assertTransparent(id);
}
assertTransparent("obj-resmode");

// Layout: face v8ui (ignoreclick) + interactive display v8ui; live.* may overlap a v8ui ONLY if that v8ui has
// ignoreclick 1 and the live.* sits in front of it in z-order.
function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}
const face = byId["obj-viz"];
const disp = byId["obj-viz-disp"];
eq(face.maxclass, "v8ui", "face is a v8ui");
eq(disp.maxclass, "v8ui", "display is a v8ui");
eq(face.ignoreclick, 1, "The face v8ui must have ignoreclick 1 (live.* widgets sit over it)");
ok(!disp.ignoreclick, "The display v8ui stays interactive");
assert.deepStrictEqual(face.presentation_rect, [0, 0, 290, 169]);
assert.deepStrictEqual(disp.presentation_rect, [290, 0, 230, 169]);
checks += 2;
eq(face.presentation_rect[3], 169, "face is 169 px high");
eq(disp.presentation_rect[3], 169, "display is 169 px high");
eq(face.presentation_rect[2] + disp.presentation_rect[2], 520, "the two v8ui halves tile the 520 px device");
const v8uis = boxes.filter((b) => b.maxclass === "v8ui" && b.presentation === 1);
const presented = boxes.filter((b) => b.presentation === 1 && !b.hidden && b.maxclass && b.maxclass.startsWith("live.") && b.maxclass !== "live.comment");
eq(presented.length, 11, "11 presentation live.* controls (5 dials, 2 sliders, Quality, Lock, AUTO, MIDI)");
for (const w of presented) {
    for (const v of v8uis) {
        if (!rectsOverlap(v.presentation_rect, w.presentation_rect)) continue;
        eq(v.ignoreclick, 1, `${w.id} overlaps ${v.id}, which must have ignoreclick 1`);
        ok(boxes.indexOf(w) > boxes.indexOf(v), `${w.id} must sit in front of ${v.id} in z-order (later in boxes)`);
    }
    ok(!rectsOverlap(disp.presentation_rect, w.presentation_rect), `no live.* may overlap the interactive display (${w.id})`);
    ok(rectsOverlap(face.presentation_rect, w.presentation_rect), `${w.id} sits over the face it controls`);
}
for (let i = 0; i < presented.length; i++) {
    for (let j = i + 1; j < presented.length; j++) {
        ok(!rectsOverlap(presented[i].presentation_rect, presented[j].presentation_rect), `${presented[i].id} overlaps ${presented[j].id}`);
    }
}
for (const b of boxes) {
    if (b.presentation === 1 && !b.hidden && b.presentation_rect) {
        const r = b.presentation_rect;
        ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 520 && r[1] + r[3] <= 169, `${b.id} outside 520x169`);
    }
}
const panelIdx = boxes.map((b, i) => (b.maxclass === "panel" ? i : -1)).filter((i) => i >= 0);
const lastWidget = Math.max(...boxes.map((b, i) => (b.maxclass !== "panel" ? i : -1)));
ok(panelIdx.length >= 1, "Expected a background panel");
for (const pi of panelIdx) {
    eq(boxes[pi].background, 1, "Panels must set background: 1");
    ok(pi > lastWidget, "Panels must appear after all widgets");
}

// Wiring
const lines = patcher.lines.map((l) => l.patchline);
function connected(src, dst) { return lines.some((l) => l.source[0] === src && l.destination[0] === dst); }
function connectedPort(src, outlet, dst) { return lines.some((l) => l.source[0] === src && l.source[1] === outlet && l.destination[0] === dst); }
ok(connected("obj-plugin", "obj-gen") && connected("obj-gen", "obj-plugout"), "plugin~ -> gen -> plugout~");
eq(byId["obj-route-viz"].text, "route res mid side resmode auto midi", "router for face / display messages");
ok(connected("obj-viz", "obj-route-viz") && connected("obj-viz-disp", "obj-route-viz"), "both v8ui halves -> route");
const routeKeys = byId["obj-route-viz"].text.split(" ").slice(1);
// every live control reports to the face (set_x) so the glyphs redraw
const toFace = {
    "obj-ctrl-res": "prepend set_res", "obj-ctrl-midshift": "prepend set_mid", "obj-ctrl-sideshift": "prepend set_side",
    "obj-ctrl-mix": "prepend set_mix", "obj-ctrl-gate": "prepend set_gate", "obj-ctrl-fmtlevel": "prepend set_fmt",
    "obj-ctrl-harmlevel": "prepend set_harm", "obj-quality": "prepend set_quality", "obj-lock": "prepend set_lock",
    "obj-auto": "prepend set_auto", "obj-midi": "prepend set_midi", "obj-resmode": "prepend set_mode",
};
for (const [ctrl, msg] of Object.entries(toFace)) {
    const p = boxes.find((b) => b.text === msg && connected(ctrl, b.id));
    ok(!!p, `${ctrl} -> ${msg}`);
    ok(connected(p.id, "obj-viz"), `${msg} -> face`);
}
// gen paths
const toGen = {
    "obj-ctrl-res": ["obj-scale-res", "prepend res"], "obj-ctrl-midshift": [null, "prepend midshift"], "obj-ctrl-sideshift": [null, "prepend sideshift"],
    "obj-ctrl-mix": ["obj-scale-mix", "prepend wet"], "obj-ctrl-gate": ["obj-scale-gate", "prepend gate"],
    "obj-ctrl-fmtlevel": ["obj-scale-fmtlevel", "prepend fmtlevel"], "obj-ctrl-harmlevel": ["obj-scale-harmlevel", "prepend harmlevel"],
    "obj-quality": [null, "prepend quality"], "obj-resmode": [null, "prepend resmode"],
};
for (const [ctrl, [scale, msg]] of Object.entries(toGen)) {
    const prep = boxes.find((b) => b.text === msg);
    ok(!!prep && connected(prep.id, "obj-gen"), `${msg} -> gen`);
    if (scale) ok(connected(ctrl, scale) && connected(scale, prep.id), `${ctrl} -> ${scale} -> ${msg}`);
    else ok(connected(ctrl, prep.id), `${ctrl} -> ${msg}`);
}
eq(byId["obj-prep-mix"].text, "prepend wet", "Mix drives gen `wet`");
// silent-set return paths (v8ui-originated changes): res (display), mid / side (Lock follower), AUTO / MIDI / resmode
const setBack = { res: "obj-ctrl-res", mid: "obj-ctrl-midshift", side: "obj-ctrl-sideshift", resmode: "obj-resmode", auto: "obj-auto", midi: "obj-midi" };
for (const [key, target] of Object.entries(setBack)) {
    const port = routeKeys.indexOf(key);
    ok(port >= 0, `route has ${key}`);
    ok(boxes.some((b) => b.text === "prepend set" && connectedPort("obj-route-viz", port, b.id) && connected(b.id, target)), `${key}: route -> prepend set -> ${target} (silent, no echo)`);
}
ok(connectedPort("obj-route-viz", routeKeys.indexOf("res"), "obj-scale-res"), "res drag -> gen");
ok(connectedPort("obj-route-viz", routeKeys.indexOf("mid"), "obj-prep-midshift") && connectedPort("obj-route-viz", routeKeys.indexOf("side"), "obj-prep-sideshift"), "Lock follower -> gen");
ok(connectedPort("obj-route-viz", routeKeys.indexOf("resmode"), "obj-prep-resmode"), "AUTO/MIDI -> resmode -> gen");
ok(connected("obj-ui-resmode", "obj-viz-disp") && connected("obj-ui-quality", "obj-viz-disp") && connected("obj-ui-res", "obj-viz-disp"), "display receives mode / quality / res");
// no `prepend set` output ever reaches a v8ui or gen (no feedback loops)
for (const b of boxes) {
    if (b.text === "prepend set") {
        for (const l of lines) if (l.source[0] === b.id) ok(/^obj-(ctrl|resmode|quality|lock|auto|midi)/.test(l.destination[0]), "prepend set may only drive live objects (no feedback)");
    }
}
ok(connected("obj-midiin", "obj-midiparse") && connected("obj-midiparse", "obj-midi-unpack") && connected("obj-midi-gate", "obj-prep-midinote") && connected("obj-prep-midinote", "obj-gen") && connected("obj-prep-midi-ui", "obj-viz-disp"), "midiin -> midiparse -> last held note -> gen midinote (+ display)");
ok(connected("obj-msg-ui-buf", "obj-viz-disp"), "scope buffer name goes to the display");

// ---------------------------------------------------------------------------------------------
// 5. v8ui evaluation (face + display)
// ---------------------------------------------------------------------------------------------
function makeSandbox(rect, scopeMock) {
    const sb = { emitted: [], rgba: [], rects: [], strokes: 0, fills: 0, tasks: [], texts: [] };
    sb.mgraphics = {
        size: [rect[2], rect[3]],
        init() {}, redraw() {},
        set_source_rgba(r, g, b, a) { sb.rgba.push([r, g, b, a]); },
        set_line_width() {}, rectangle(x, y, w, h) { sb.rects.push({ x, y, w, h, c: sb.rgba[sb.rgba.length - 1] }); }, rectangle_rounded() {}, arc() {}, move_to() {}, line_to() {}, curve_to() {}, close_path() {},
        fill() { sb.fills++; }, stroke() { sb.strokes++; },
        select_font_face() {}, set_font_size() {}, show_text(t) { sb.texts.push(t); },
    };
    sb.Buffer = function (name) { this.name = name; this.peek = () => scopeMock.slice(); this.poke = () => {}; };
    sb.Task = function (fn) {
        const t = this;
        t.fn = fn; t.repeat = () => {}; t.schedule = () => { sb.tasks.push(t); }; t.cancel = () => { const i = sb.tasks.indexOf(t); if (i >= 0) sb.tasks.splice(i, 1); };
    };
    sb.outlet = (_i, msg) => sb.emitted.push(msg);
    return sb;
}
const scopeMock = new Array(272).fill(0);
for (let b = 0; b < 192; b++) {
    const ms = (b + 0.5) * 20 / 192;
    scopeMock[b] = (b === 0 ? 11 : 2.4 * Math.exp(-ms / 1.7) * Math.cos(ms * 7) + 0.55 * Math.exp(-(((ms - 8.33) / 0.2) ** 2)) + 0.004 * Math.sin(b * 3));
}
scopeMock[256] = 123; scopeMock[257] = 120; scopeMock[258] = 0.4; scopeMock[259] = 5; scopeMock[260] = 2048; scopeMock[261] = 1;

ok(!/crumpets|crql/i.test(face.textfile.text + disp.textfile.text), "No forbidden name in the v8ui scripts");

// ----- Face (draws only; no mouse handlers) -----
const fsb = makeSandbox(face.presentation_rect, scopeMock);
const fnFace = new Function(
    "mgraphics", "Buffer", "Task", "outlet", "notifyclients",
    face.textfile.text + "\nreturn { set_res, set_mid, set_side, set_mix, set_gate, set_fmt, set_harm, set_lock, set_mode, set_auto, set_midi, set_quality, paint, preview, layoutRegions, vals: () => vals, mode: () => curMode, lock: () => curLock, readout: () => readoutKey, hasMouse: typeof onclick !== 'undefined' || typeof ondrag !== 'undefined' || typeof ondblclick !== 'undefined' || typeof onidle !== 'undefined' };"
);
const ui = fnFace(fsb.mgraphics, fsb.Buffer, fsb.Task, fsb.outlet, () => {});
eq(fsb.mgraphics.relative_coords, 0, "face: relative_coords 0");
eq(fsb.mgraphics.autofill, 0, "face: autofill 0");
eq(ui.hasMouse, false, "The face has no mouse code (all dragging comes from the transparent live.* widgets)");
const R = ui.layoutRegions();
// every transparent widget sits over its drawn glyph / bar / selector
for (let i = 0; i < 5; i++) {
    const id = ["obj-ctrl-res", "obj-ctrl-midshift", "obj-ctrl-mix", "obj-ctrl-sideshift", "obj-ctrl-gate"][i];
    const rc = byId[id].presentation_rect;
    ok(Math.abs(rc[0] + rc[2] / 2 - R.knobs[i].cx) < 0.5 && Math.abs(rc[1] + rc[3] / 2 - R.knobs[i].cy) < 0.5, `${id} is centred on its glyph`);
}
assert.deepStrictEqual(byId["obj-ctrl-fmtlevel"].presentation_rect, [R.sliders[0].x, R.sliders[0].y, R.sliders[0].w, R.sliders[0].h]);
assert.deepStrictEqual(byId["obj-ctrl-harmlevel"].presentation_rect, [R.sliders[1].x, R.sliders[1].y, R.sliders[1].w, R.sliders[1].h]);
assert.deepStrictEqual(byId["obj-quality"].presentation_rect, [R.quality.x, R.quality.y, R.quality.w, R.quality.h]);
assert.deepStrictEqual(byId["obj-auto"].presentation_rect, [R.pillAuto.x, R.pillAuto.y, R.pillAuto.w, R.pillAuto.h]);
assert.deepStrictEqual(byId["obj-midi"].presentation_rect, [R.pillMidi.x, R.pillMidi.y, R.pillMidi.w, R.pillMidi.h]);
{
    const lr = byId["obj-lock"].presentation_rect;
    ok(Math.abs(lr[0] + lr[2] / 2 - R.lock.cx) < 0.5 && Math.abs(lr[1] + lr[3] / 2 - R.lock.cy) < 0.5, "Lock widget is centred on the padlock");
    checks += 5;
}

const hasCol = (sb, r, g, b, a) => sb.rgba.some((c) => Math.abs(c[0] - r) < 1e-6 && Math.abs(c[1] - g) < 1e-6 && Math.abs(c[2] - b) < 1e-6 && (a === undefined || Math.abs(c[3] - a) < 1e-6));
ui.preview();
fsb.rgba.length = 0;
ui.paint();
ok(hasCol(fsb, 1.0, 0.56, 0.10, 1.0), "face: orange tab / baseline drawn");
ok(hasCol(fsb, 0.22, 0.92, 0.46, 1.0), "face: green padlock drawn");

// Readout appears for ~1 s whenever a value changes (drag, automation, macro) and expires
fsb.tasks.length = 0;
ui.set_mid(0); ui.set_side(0); ui.set_lock(0);
ui.set_mid(7);
eq(ui.readout(), "mid", "A Mid change shows the Mid readout");
fsb.texts.length = 0;
ui.paint();
ok(fsb.texts.includes("Mid +7.0 st"), "Readout text is `Mid +7.0 st`");
ok(fsb.tasks.length === 1, "A 1 s timer clears the readout");
fsb.tasks[0].fn();
eq(ui.readout(), "", "Readout clears after the timer");
ui.set_gate(40);
eq(ui.readout(), "gate", "Gate change shows its readout");
fsb.tasks.length = 0;
ui.set_gate(40);
eq(fsb.tasks.length, 0, "An unchanged value does not retrigger the readout");

// AUTO / MIDI pills: exclusive, both off = Manual, mapped onto resmode, driven only by silent sets
ui.set_mode(0);
fsb.emitted.length = 0;
ui.set_auto(1);
assert.deepStrictEqual(fsb.emitted, [["resmode", 1], ["midi", 0]]); checks++;
eq(ui.mode(), 1, "AUTO on");
fsb.emitted.length = 0;
ui.set_midi(1);
assert.deepStrictEqual(fsb.emitted, [["resmode", 2], ["auto", 0]]); checks++;
eq(ui.mode(), 2, "MIDI replaces AUTO (mutually exclusive)");
fsb.emitted.length = 0;
ui.set_midi(0);
assert.deepStrictEqual(fsb.emitted, [["resmode", 0]]); checks++;
eq(ui.mode(), 0, "Both off = Manual");
fsb.emitted.length = 0;
ui.set_auto(0);
eq(fsb.emitted.length, 0, "AUTO off while Manual emits nothing");
ui.set_mode(1); // automation of the resmode parameter: toggles follow with silent sets
assert.deepStrictEqual(fsb.emitted, [["auto", 1], ["midi", 0]]); checks++;
fsb.emitted.length = 0;
ui.set_mode(1);
eq(fsb.emitted.length, 0, "Receiving the same mode back never re-emits (no feedback)");
ui.set_mode(0);

// Lock: works for the dial itself, automation and macros, without feedback
ui.set_lock(1);
eq(ui.lock(), 1, "Lock on");
ui.set_lock(0); ui.set_mid(0); ui.set_side(0); ui.set_lock(1);
fsb.emitted.length = 0;
ui.set_mid(5);
assert.deepStrictEqual(fsb.emitted, [["side", 5]]); checks++;
eq(ui.vals().side, 5, "Locked: Mid +5 moves Side by +5");
fsb.emitted.length = 0;
ui.set_mid(5);
eq(fsb.emitted.length, 0, "Locked: repeating the same value emits nothing (no feedback)");
ui.set_side(8);
assert.deepStrictEqual(fsb.emitted, [["mid", 8]]); checks++;
eq(ui.vals().mid, 8, "Locked: Side +3 moves Mid +3 (5 -> 8)");
ui.set_side(-30); // follower clamps at the range limit
ok(ui.vals().mid >= -36 && ui.vals().mid <= 36, "Lock follower stays in range");
ui.set_lock(0);
fsb.emitted.length = 0;
ui.set_mid(-4);
eq(fsb.emitted.length, 0, "Unlocked: Mid does not drag Side");
ui.set_quality(0);
ui.set_quality(1);

// ----- Display (interactive: cutoff-bar drag) -----
const dsb = makeSandbox(disp.presentation_rect, scopeMock);
const fnDisp = new Function(
    "mgraphics", "Buffer", "Task", "outlet", "notifyclients",
    disp.textfile.text + "\nreturn { loadbang, setbuffer, set_res, set_mode, set_quality, midi_note, pullScope, paint, preview, onclick, ondrag, ondblclick, layoutRegions, barAxis01, res: () => curRes };"
);
const dui = fnDisp(dsb.mgraphics, dsb.Buffer, dsb.Task, dsb.outlet, () => {});
eq(dsb.mgraphics.relative_coords, 0, "display: relative_coords 0");
eq(dsb.mgraphics.autofill, 0, "display: autofill 0");
const D = dui.layoutRegions();
dui.preview();
dsb.rgba.length = 0; dsb.fills = 0;
dui.paint();
ok(hasCol(dsb, 1.0, 0.56, 0.10, 1.0), "display: orange formant dots");
ok(hasCol(dsb, 0.30, 0.58, 1.0, 1.0), "display: blue harmonic dots");
ok(hasCol(dsb, 0.22, 0.92, 0.46, 1.0), "display: green pitch marker");
ok(dsb.fills > 200, "display: dot matrix draws many dots");

// Signed linear-quefrency dot display: stems from the centre line, orange left of the bar, blue right of it
{
    dui.setbuffer("1001-cepscope");
    scopeMock[258] = 0.4;
    for (let i = 0; i < 30; i++) dui.pullScope();
    dsb.rects.length = 0;
    dui.paint();
    const isOr = (c) => c && Math.abs(c[0] - 1.0) < 1e-6 && Math.abs(c[1] - 0.56) < 1e-6;
    const isBl = (c) => c && Math.abs(c[0] - 0.30) < 1e-6 && Math.abs(c[2] - 1.0) < 1e-6;
    const ends = dsb.rects.filter((r) => (isOr(r.c) || isBl(r.c)) && Math.abs(r.w - 3.4) < 1e-9 && r.c[3] === 1);
    const centreY = D.disp.plotY + 2.5 + 12 * 5 - 1.1 + 1.1;
    ok(ends.some((r) => r.y + r.h / 2 < centreY - 10), "Signal: positive stems end above the centre line");
    ok(ends.some((r) => r.y + r.h / 2 > centreY + 10), "Signal: negative stems end below the centre line (bipolar)");
    ok(ends.length > 15, "Signal: most columns carry a stem (" + ends.length + ")");
    const barX = D.disp.x + dui.barAxis01() * D.disp.w;
    ok(ends.filter((r) => r.x + r.w / 2 < barX).every((r) => isOr(r.c)), "Columns left of the cutoff are orange");
    ok(ends.filter((r) => r.x + r.w / 2 >= barX).every((r) => isBl(r.c)), "Columns right of the cutoff are blue");
    ok(ends.filter((r) => r.x + r.w / 2 < barX).some((r) => Math.abs(r.y + r.h / 2 - centreY) > 40), "Formant region reaches far from the centre (dense bipolar scatter)");
    const first = ends.filter((r) => r.x < D.disp.x + 6);
    ok(first.length > 0 && first.some((r) => r.y + r.h / 2 < D.disp.plotY + 8), "c[0] clips at the top edge");
    // with signal there are no axis tick labels
    dsb.texts.length = 0;
    dui.paint();
    ok(!dsb.texts.some((t) => /^(0\.5|1|2|5|10|ms)$/.test(t)), "No quefrency tick labels");
    // silence: a flat dotted line at the vertical centre, orange left / blue right of the cutoff
    scopeMock[258] = 0;
    for (let i = 0; i < 80; i++) dui.pullScope();
    dsb.rects.length = 0;
    dui.paint();
    const dots = dsb.rects.filter((r) => isOr(r.c) || isBl(r.c)).filter((r) => r.w < 3 && r.w > 2 && r.c[3] < 0.6);
    ok(dots.length >= 40, "Silence: a dotted zero line across all columns");
    ok(dots.every((r) => Math.abs(r.y + r.h / 2 - dots[0].y - dots[0].h / 2) < 1e-9), "Silence: every dot sits on the centre row (flat line)");
    ok(!dsb.rects.some((r) => Math.abs(r.w - 3.4) < 1e-9 && (isOr(r.c) || isBl(r.c))), "Silence: no stems");
    eq(dui.pullScope(), false, "Silence settles so redraws stop");
    scopeMock[258] = 0.4;
}
dui.set_mode(0);
dsb.emitted.length = 0;
const x5ms = D.disp.x + cfg.msToAxis01(5) * D.disp.w;
dui.onclick(x5ms, D.disp.plotY + 40);
ok(dsb.emitted.length >= 1 && dsb.emitted[0][0] === "res", "Clicking the display emits res");
near(dsb.emitted[0][1], Math.round(cfg.axis01ToRes(0, cfg.msToAxis01(5), 44100, 2048, 0) * 1000) / 10, 0.1, "Bar position maps to Res through the quefrency axis");
const resAfter = dsb.emitted[dsb.emitted.length - 1][1];
dsb.emitted.length = 0;
dui.ondrag(D.disp.x + cfg.msToAxis01(1) * D.disp.w, D.disp.plotY + 40);
ok(dsb.emitted.length === 1 && dsb.emitted[0][1] < resAfter, "Dragging the bar left lowers Res");
dui.set_res(60);
eq(dui.res(), 60, "Automation of Res updates the bar without emitting");
dui.setbuffer("1001-cepscope");
scopeMock[258] = 0;
dui.pullScope();
dui.set_res(0);
const barLeft = dui.barAxis01();
dui.set_res(100);
ok(dui.barAxis01() > barLeft, "Bar follows Res (moves right as Res rises) when silent");
dsb.emitted.length = 0;
dui.set_res(dui.res());
eq(dsb.emitted.length, 0, "Receiving Res from the parameter never re-emits (no feedback)");
scopeMock[258] = 0.4;
dui.pullScope();
dui.set_mode(1);
near(dui.barAxis01(), cfg.msToAxis01(123 / 44100 * 1000), 1e-9, "Auto: bar follows the tracked L");
dsb.emitted.length = 0;
dui.onclick(D.disp.x + cfg.msToAxis01(6) * D.disp.w, D.disp.plotY + 40);
{
    const period = 44100 / 120;
    const want = Math.round(cfg.axis01ToRes(1, cfg.msToAxis01(6), 44100, 2048, period) * 1000) / 10;
    near(dsb.emitted[0][1], want, 0.1, "Auto: dragging sets Res through the k = L / period scale");
}
dsb.rgba.length = 0;
dui.paint();
ok(hasCol(dsb, 0.85, 0.95, 1.0, 0.95), "Auto/MIDI bar is drawn in the tracked (dashed) style");
dui.set_mode(0);
dsb.rgba.length = 0;
dui.paint();
ok(!hasCol(dsb, 0.85, 0.95, 1.0, 0.95), "Manual bar is drawn solid (no tracked style)");
dsb.emitted.length = 0;
dui.ondblclick(D.disp.x + 20, 60);
assert.deepStrictEqual(dsb.emitted[0], ["res", cfg.DEFAULT_RES_PCT]); checks++;

dui.loadbang();
ok(dui.pullScope() === true, "pullScope() returns true while audio is present");
dui.paint();
scopeMock[258] = 0;
for (let i = 0; i < 120; i++) dui.pullScope();
eq(dui.pullScope(), false, "pullScope() returns false when silent so the display skips redraws");
scopeMock[258] = 0.4;
eq(dui.pullScope(), true, "pullScope() wakes up immediately when audio returns");
dui.set_mode(2);
dui.midi_note(47);
dui.paint();
dui.set_mode(1);
dui.set_quality(2);
dui.paint();

console.log(`test_cepstra: ok (${checks} checks, 520x169, face ignoreclick + transparent live.* controls)`);
