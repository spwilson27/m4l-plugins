#!/usr/bin/env node
/**
 * Comprehensive verification suite for devices/Multiband Split.amxd (268 x 169 px — UI 2).
 *
 * Covers:
 *  1. Linkwitz-Riley (12 / 24 / 48 dB/oct) analytical & discrete-time flat-summing invariants
 *     across 1, 2, 3, and 4 bands (0.000 dB passband & crossover unity sum)
 *  2. Block-Size 8192 Hann-Windowed FFT Spectrogram harmonic resolution (sawtooth wave overtones
 *     f0, 2*f0, 3*f0, 4*f0, 5*f0 resolved with > 25 dB peak-to-trough contrast)
 *  3. Ableton LOM path parsing & Nested Rack ("chain within a chain") scoping
 *  4. Automatic band creation per detected instance (1 -> 2 -> 3 -> 4 bands, and cleanup on delete)
 *  5. Top-Right Volume Slider (-inf to +18 dB) & Bottom-Right Clickable Link Status Toggle
 *  6. GenExpr ordering & lexer safety, .amxd binary header, ---mbsplitscope @samps 8224 isolation,
 *     removal of 2B/3B/4B & Phase buttons, and zero widget overlap
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { minifyGen } = require("./minify_gen.js");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "mbsplit_core.genexpr");
const CONFIG_PATH = path.join(ROOT, "src", "mbsplit_config.js");
const UI_PATH = path.join(ROOT, "src", "mbsplit_ui.js");
const DSP_PATH = path.join(ROOT, "src", "mbsplit_dsp.js");
const AMXD_PATH = path.join(ROOT, "devices", "Multiband Split.amxd");

const cfg = require(CONFIG_PATH);

// =========================================================================
// 1. CROSSOVER MATH & FLAT-SUMMING INVARIANTS (12 / 24 / 48 dB/oct, 1..4 Bands)
// =========================================================================
{
    assert.ok(Math.abs(cfg.normToFreq(cfg.freqToNorm(1000.0)) - 1000.0) < 1e-6, "freqToNorm / normToFreq must round-trip");
    const s = cfg.sanitizeCrossovers(2000, 500, 1000, 0);
    assert.ok(s[0] < s[1] && s[1] < s[2], `sanitizeCrossovers must enforce F1 < F2 < F3 (got ${s})`);

    assert.strictEqual(cfg.formatGainDb(-70.0), "-inf dB", "-70 dB must format as -inf dB");
    assert.strictEqual(cfg.formatGainDb(0.0), "0.0 dB", "0 dB must format as 0.0 dB");
    assert.strictEqual(cfg.formatGainDb(18.0), "+18.0 dB", "+18 dB must format as +18.0 dB");

    // Analytical magnitude sum must be 1.000000 at all frequencies for 1, 2, 3, and 4 bands and all slopes
    for (const numBands of [1, 2, 3, 4]) {
        for (const slope of [0, 1, 2]) {
            for (const testFreq of [25, 120, 350, 800, 2200, 4500, 12000]) {
                const resp = cfg.computeBandMagnitudesAtFreq(testFreq, 120, 800, 4500, numBands, slope, (1 << numBands) - 1);
                assert.ok(
                    Math.abs(resp.totalSum - 1.0) < 1e-12,
                    `Analytical band sum must equal 1.0 at ${testFreq} Hz (bands=${numBands}, slope=${slope}, got=${resp.totalSum})`
                );
            }
        }
    }

    // Discrete-time TPT Linkwitz-Riley steady-state sine reconstruction test across 1, 2, 3, 4 bands and 12/24/48 dB slopes
    const sr = 48000;
    const windowSamps = 2048;
    const binHz = sr / windowSamps;
    for (const numBands of [1, 2, 3, 4]) {
        for (const slope of [0, 1, 2]) {
            for (const binK of [2, 5, 19, 34, 85, 192, 384]) {
                const testHz = binK * binHz;
                const dsp = cfg.createReferenceSplitterDsp(sr);
                let sumSqIn = 0;
                let sumSqTotal = 0;
                const totalSamps = 4096;
                const settleSamps = totalSamps - windowSamps;
                for (let n = 0; n < totalSamps; n++) {
                    const x = Math.sin((2.0 * Math.PI * testHz * n) / sr);
                    const bands = dsp.processSample(x, 120.0, 800.0, 4500.0, numBands, slope);
                    const ySum = bands[0] + bands[1] + bands[2] + bands[3];
                    if (n >= settleSamps) {
                        sumSqIn += x * x;
                        sumSqTotal += ySum * ySum;
                    }
                }
                const rmsRatio = Math.sqrt(sumSqTotal / sumSqIn);
                const errDb = Math.abs(cfg.linToDb(rmsRatio));
                assert.ok(
                    errDb < 0.001,
                    `Discrete TPT sum must be flat 0.0 dB at ${testHz} Hz (bands=${numBands}, slope=${slope}, errDb=${errDb.toFixed(6)} dB)`
                );
            }
        }
    }
}

// =========================================================================
// 1b. DYNAMIC PHASE (LR F1 + COMPLEMENTARY LINEAR-PHASE FIR F2 / F3)
// =========================================================================
{
    assert.strictEqual(cfg.firLatencyForSampleRate(44100), 128, "44.1 kHz FIR latency must be 128 samples");
    assert.strictEqual(cfg.firLatencyForSampleRate(48000), 128, "48 kHz FIR latency must be 128 samples");
    assert.strictEqual(cfg.firLatencyForSampleRate(96000), 256, "96 kHz FIR latency must be 256 samples");
    assert.strictEqual(cfg.firLatencyForSampleRate(192000), 512, "192 kHz FIR latency must be 512 samples");

    const sr = 48000;
    const D = cfg.firLatencyForSampleRate(sr);
    for (const fc of [800, 4500]) {
        const kh = cfg.designFirHalfKernel(fc, sr, D);
        assert.ok(Math.abs(cfg.evalFirHalfKernel(kh, 0, sr) - 1.0) < 1e-12, `FIR LP at ${fc} Hz must have unity DC gain`);
        const atFc = cfg.linToDb(Math.abs(cfg.evalFirHalfKernel(kh, fc, sr)));
        assert.ok(Math.abs(atFc + 6.02) < 0.3, `FIR LP must be -6 dB at fc=${fc} (got ${atFc.toFixed(2)})`);
        const stop = cfg.linToDb(Math.abs(cfg.evalFirHalfKernel(kh, fc + 1.2 * sr / D, sr)) + 1e-12);
        assert.ok(stop < -55, `FIR LP stopband at fc + 1.2 sr/D must be < -55 dB (fc=${fc}, got ${stop.toFixed(1)})`);
        for (let f = 0; f < 20000; f += 25) {
            const err = Math.abs(cfg.evalFirHalfKernel(kh, f, sr) - cfg.computeFirLowpassMag(f, fc, sr));
            assert.ok(err < 0.1, `Display FIR approximation must stay within 0.1 of the kernel (fc=${fc}, f=${f}, err=${err.toFixed(3)})`);
        }
        for (const nb of [3, 4]) {
            const r = cfg.computeBandMagnitudesAtFreq(fc * 1.3, 120, 800, 4500, nb, 1, (1 << nb) - 1, 1, sr);
            assert.ok(Math.abs(r.totalSum - 1.0) < 1e-9, `Dynamic analytical band sum must be 1.0 (nb=${nb})`);
        }
    }

    // Impulse: every band count and slope must sum to the F1 allpass (Min-phase 2-band sum) delayed by exactly D
    for (const numBands of [1, 2, 3, 4]) {
        for (const slope of [0, 1, 2]) {
            const dyn = cfg.createReferenceSplitterDsp(sr);
            const ref = cfg.createReferenceSplitterDsp(sr);
            assert.strictEqual(dyn.firLatency, D);
            const n = D + 1024;
            const dynSum = [], refSum = [];
            for (let i = 0; i < n; i++) {
                const x = i === 0 ? 1.0 : 0.0;
                const b = dyn.processSampleDynamic(x, 120.0, 800.0, 4500.0, numBands, slope);
                dynSum.push(b[0] + b[1] + b[2] + b[3]);
                const r = ref.processSample(x, 120.0, 800.0, 4500.0, numBands === 1 ? 1 : 2, slope);
                refSum.push(r[0] + r[1] + r[2] + r[3]);
            }
            let err = 0;
            for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(dynSum[i] - (i >= D ? refSum[i - D] : 0.0)));
            assert.ok(err < 1e-12, `Dynamic sum must equal the F1 allpass delayed by ${D} samples (bands=${numBands}, slope=${slope}, err=${err})`);
        }
    }

    // Band isolation: 2.4 kHz sits in band 3 of 120 / 800 / 4500; FIR neighbours must reject it
    {
        const dsp = cfg.createReferenceSplitterDsp(sr);
        const hz = 2400.0;
        const sq = [0, 0, 0, 0];
        let sqIn = 0;
        for (let i = 0; i < 6000; i++) {
            const x = Math.sin(2 * Math.PI * hz * i / sr);
            const b = dsp.processSampleDynamic(x, 120.0, 800.0, 4500.0, 4, 1);
            if (i >= 2000) {
                for (let k = 0; k < 4; k++) sq[k] += b[k] * b[k];
                sqIn += x * x;
            }
        }
        const db = sq.map((v) => cfg.linToDb(Math.sqrt(v / sqIn) + 1e-12));
        assert.ok(Math.abs(db[2]) < 0.05, `2.4 kHz must pass band 3 at 0 dB (got ${db[2].toFixed(3)})`);
        assert.ok(db[1] < -55 && db[3] < -55, `2.4 kHz must be < -55 dB in bands 2 / 4 (got ${db[1].toFixed(1)}, ${db[3].toFixed(1)})`);
    }

    const genSrc = fs.readFileSync(GEN_PATH, "utf8");
    assert.ok(genSrc.includes("Param dynphase(0.0);"), "GenExpr must expose Param dynphase");
    assert.ok(genSrc.includes("poke(scope, firD, 26, 0, 0);"), "GenExpr must publish FIR latency at scope[26]");
    assert.ok(genSrc.includes("firD = clamp(128.0 * round(sr / 48000.0), 128.0, 512.0);"), "GenExpr FIR latency must match firLatencyForSampleRate()");
    assert.ok(genSrc.includes("xw = 6.0 * sqrt(") && cfg.MBSPLIT_FIR_BETA === 6.0, "GenExpr and JS must share Kaiser beta 6");
    // Max's gen compiler rejects a for loop inside a GenExpr function (the whole codebox goes silent)
    const fnBodies = genSrc.slice(0, genSrc.indexOf("\nBuffer scope("));
    assert.ok(!/\bfor\s*\(/.test(fnBodies), "GenExpr helper functions must not contain for loops");
}

// =========================================================================
// 2. BLOCK-SIZE 8192 FFT SAWTOOTH HARMONIC RESOLUTION TEST
// =========================================================================
{
    assert.strictEqual(cfg.MBSPLIT_FFT_SIZE, 8192, "Spectrogram FFT block size must be 8192");
    const sr = 48000.0;
    const f0 = 110.0; // A2 sawtooth wave (harmonics at 110, 220, 330, 440, 550, 660 Hz...)
    const saw8192 = cfg.synthesizeSawWave8192(f0, sr);
    assert.strictEqual(saw8192.length, 8192);
    const dbBins = cfg.computeFft8192DbBins(saw8192);
    assert.strictEqual(dbBins.length, 4096);

    // Check first 6 harmonics vs inter-harmonic midpoints
    for (let h = 1; h <= 6; h++) {
        const harmHz = f0 * h;
        const troughHz = f0 * (h + 0.5);
        const peakDb = cfg.sampleFft8192DbForPixel(harmHz * 0.99, harmHz * 1.01, dbBins, sr);
        const troughDb = cfg.sampleFft8192DbForPixel(troughHz * 0.99, troughHz * 1.01, dbBins, sr);
        const contrastDb = peakDb - troughDb;
        assert.ok(
            contrastDb > 25.0,
            `8192-FFT harmonic #${h} (${harmHz} Hz) must stand > 25 dB above midpoint trough (${troughHz} Hz): peak=${peakDb.toFixed(1)} dB, trough=${troughDb.toFixed(1)} dB`
        );
    }
    // The pink tilt is a continuous slope. Adjacent bins around 60 Hz must not jump by several dB.
    function toneAtBin(k) {
        const freq = k * sr / cfg.MBSPLIT_FFT_SIZE;
        const x = new Array(cfg.MBSPLIT_FFT_SIZE);
        for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * freq * i / sr);
        return cfg.computeFft8192DbBins(x)[k];
    }
    const lowStep = toneAtBin(11) - toneAtBin(10);
    assert.ok(Math.abs(lowStep) < 1.0, "equal tones at 58.6 Hz and 64.5 Hz differ by " + lowStep.toFixed(2) + " dB");
    const oct = toneAtBin(64) - toneAtBin(32);
    assert.ok(Math.abs(oct - 2.2) < 0.6, "one octave of tilt is about 2.2 dB, got " + oct.toFixed(2));
    cfg.ensureSpecColumnBins(sr, cfg.MBSPLIT_SPEC_COLS);
    for (let c = 0; c < cfg.MBSPLIT_SPEC_COLS; c += 17) {
        const fLo = cfg.normToFreq(c / cfg.MBSPLIT_SPEC_COLS);
        const fHi = cfg.normToFreq((c + 1) / cfg.MBSPLIT_SPEC_COLS);
        const viaPixel = cfg.sampleFft8192DbForPixel(fLo, fHi, dbBins, sr);
        const viaCol = cfg.sampleFft8192DbForColumn(c, dbBins, sr);
        assert.ok(Math.abs(viaPixel - viaCol) < 1e-6, `column ${c} bin table must match the per-pixel sampler`);
    }
}

// =========================================================================
// 3. NESTED RACK ("CHAIN WITHIN A CHAIN") LOM SCOPING & AUTO BAND SELECTION
// =========================================================================
{
    const pathLowA = "live_set tracks 0 devices 0 chains 0 devices 0";
    const pathMidA = "live_set tracks 0 devices 0 chains 1 devices 0";
    const pathHighA = "live_set tracks 0 devices 0 chains 2 devices 0";
    const pathLowB = "live_set tracks 0 devices 0 chains 1 devices 1 chains 0 devices 0";
    const pathHighB = "live_set tracks 0 devices 0 chains 1 devices 1 chains 1 devices 0";

    const ctxLowA = cfg.parseRackContextFromPath(pathLowA);
    const ctxMidA = cfg.parseRackContextFromPath(pathMidA);
    const ctxHighA = cfg.parseRackContextFromPath(pathHighA);
    const ctxLowB = cfg.parseRackContextFromPath(pathLowB);
    const ctxHighB = cfg.parseRackContextFromPath(pathHighB);

    assert.strictEqual(ctxLowA.parentRackPath, "live_set tracks 0 devices 0");
    assert.strictEqual(ctxMidA.parentRackPath, "live_set tracks 0 devices 0");
    assert.strictEqual(ctxHighA.parentRackPath, "live_set tracks 0 devices 0");
    assert.strictEqual(ctxLowB.parentRackPath, "live_set tracks 0 devices 0 chains 1 devices 1");
    assert.strictEqual(ctxHighB.parentRackPath, "live_set tracks 0 devices 0 chains 1 devices 1");
    assert.notStrictEqual(ctxLowB.parentRackPath, ctxMidA.parentRackPath);

    assert.strictEqual(cfg.resolveEffectiveBandMask(0, 0, 1, 1), 1, "Single instance (1 band) must pass Band 1 (FULL)");
    assert.strictEqual(cfg.resolveEffectiveBandMask(0, ctxLowA.chainIndex, 3, 1), 1);
    assert.strictEqual(cfg.resolveEffectiveBandMask(0, ctxMidA.chainIndex, 3, 1), 2);
    assert.strictEqual(cfg.resolveEffectiveBandMask(0, ctxHighA.chainIndex, 3, 1), 4);
}

// =========================================================================
// 4. GENEXPR ORDERING & LEXER CHECKS
// =========================================================================
const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(!gen.match(/\be\d/), "Never use e0..e9 identifiers in GenExpr (parsed as Euler's constant)");
assert.ok(!gen.includes("delay("), "GenExpr must not use delay()");
const fnAt = gen.indexOf("slew_step(");
const bufAt = gen.indexOf("\nBuffer scope(");
const paramAt = gen.indexOf("\nParam f1(");
const histAt = gen.indexOf("\nHistory smF1(");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1.0);");
assert.ok(fnAt >= 0 && fnAt < bufAt, "Helper functions must precede Buffer in GenExpr");
assert.ok(bufAt < paramAt && paramAt < histAt && histAt < exprAt, "GenExpr must follow Buffer -> Param -> History -> expressions order");
assert.ok(gen.includes("poke(scope, monoIn, 32.0 + ringPos"), "GenExpr must write monoIn into 8192-sample circular ring buffer");
assert.ok(gen.includes("poke(scope, scopeBeat, 23, 0, 0);"), "GenExpr must publish the telemetry beat at scope[23]");
{
    // The counter itself is unconditional. The poke sits in the every-64-samples block, which must
    // not be nested inside silence sleep, or a silent track would never report DSP ready.
    const tickAt = gen.indexOf("scopeCnt = scopeCnt + 1.0;");
    let depth = 0;
    for (let i = 0; i < tickAt; i++) {
        if (gen[i] === "{") depth++;
        else if (gen[i] === "}") depth--;
    }
    assert.strictEqual(depth, 0, "scope beat must advance outside the silence-sleep block so a silent track still reports DSP ready");
}

// =========================================================================
// 5. AMXD BINARY HEADER, UI 2 LAYOUT, REMOVED BUTTONS & ZERO WIDGET OVERLAP
// =========================================================================
function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}

{
    const raw = fs.readFileSync(AMXD_PATH);
    assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", "Expected ampf header");
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected aaaa audio-effect type");
    assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
    const jsonLen = raw.readUInt32LE(28);
    assert.strictEqual(jsonLen, raw.length - 32, "Payload length mismatch");

    const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.strictEqual(patcher.openinpresentation, 1, "Must open in presentation mode");
    assert.strictEqual(patcher.openrect[2], 268.0, "Expected UI 2 width 268.0 px");
    assert.strictEqual(patcher.openrect[3], 169.0, "Expected height 169.0 px");

    const boxes = patcher.boxes.map((b) => b.box);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    const lines = patcher.lines.map((l) => l.patchline);

    assert.ok(!byId["obj-title"], "Duplicate MULTIBAND SPLIT title label must be removed");
    assert.ok(!byId["obj-ctrl-bands"], "2B/3B/4B buttons (obj-ctrl-bands) must be removed");
    assert.ok(!byId["obj-ctrl-phase"], "Phase button (obj-ctrl-phase) must be removed");
    assert.strictEqual(byId["obj-buf-scope"].text, "buffer~ ---mbsplitscope @samps 8224", "Scope buffer must allocate 8224 samples for 8192-block FFT");

    const gainVo = byId["obj-ctrl-gain"].saved_attribute_attributes.valueof;
    assert.strictEqual(gainVo.parameter_mmin, -70.0, "Gain min must be -70 dB (-inf)");
    assert.strictEqual(gainVo.parameter_mmax, 18.0, "Gain max must be +18 dB");

    function hasLine(srcId, dstId) {
        return lines.some((l) => l.source[0] === srcId && l.destination[0] === dstId);
    }

    // Dynamic Phase toggle: automatable live.text, bidirectionally synced via v8ui
    const phaseBtn = byId["obj-ctrl-phasemode"];
    assert.ok(phaseBtn && phaseBtn.maxclass === "live.text", "Missing Phase Mode live.text toggle");
    assert.strictEqual(phaseBtn.saved_attribute_attributes.valueof.parameter_longname, "Phase Mode");
    assert.deepStrictEqual(phaseBtn.saved_attribute_attributes.valueof.parameter_enum, ["Min", "Dynamic"]);
    assert.strictEqual(phaseBtn.text, "MIN");
    assert.strictEqual(phaseBtn.texton, "DYN");
    assert.ok(hasLine("obj-ctrl-phasemode", "obj-prep-phasemode") && hasLine("obj-prep-phasemode", "obj-viz"), "Missing Phase Mode -> set_phasemode -> viz");
    assert.ok(byId["obj-route-ui"].text.split(/\s+/).includes("ui_phasemode"), "route must handle ui_phasemode");
    assert.ok(lines.some((l) => l.source[0] === "obj-route-ui" && l.source[1] === 11 && l.destination[0] === "obj-gen-in" && l.destination[1] === 1), "route-ui unmatched outlet (11) must feed the gen hub's data inlet");
    for (const k of [1, 2, 3]) {
        assert.ok(byId["obj-route-ui"].text.split(/\s+/).includes(`ui_st_f${k}`), `route must handle ui_st_f${k}`);
        assert.ok(lines.some((l) => l.source[0] === "obj-route-ui" && l.source[1] === 7 + k && l.destination[0] === `obj-ctrl-f${k}`),
            `ui_st_f${k} must drive obj-ctrl-f${k} (active / textcolor)`);
        const vo = byId[`obj-ctrl-f${k}`];
        assert.ok(vo.saved_attribute_attributes.textcolor && vo.saved_attribute_attributes.textcolor.expression.startsWith("themecolor."), `obj-ctrl-f${k} must use a theme-bound text colour (Live dims it with active 0)`);
    }
    assert.ok(hasLine("obj-set-phasemode", "obj-ctrl-phasemode"), "ui_phasemode must `set` the toggle");
    assert.strictEqual(byId["obj-ctrl-slope"].presentation_rect[0] + byId["obj-ctrl-slope"].presentation_rect[2] <= phaseBtn.presentation_rect[0], true, "Slope tab must end before Phase toggle");
    assert.ok(phaseBtn.presentation_rect[0] + phaseBtn.presentation_rect[2] <= byId["obj-ctrl-f1"].presentation_rect[0], "Phase toggle must end before F1");

    assert.ok(byId["obj-plugin"] && byId["obj-plugin"].text === "plugin~", "Missing plugin~");
    assert.ok(byId["obj-plugout"] && byId["obj-plugout"].text === "plugout~", "Missing plugout~");
    // Deferred DSP (AGENTS.md 1d): no gen in the device, a gate hub takes every gen-bound message, the face creates the gen~ later
    assert.ok(!byId["obj-gen"] && !boxes.some((b) => /^gen/.test(b.maxclass || "")), "The device must ship without a gen / gen~ (it is created after load)");
    assert.ok(byId["obj-gen-in"] && byId["obj-gen-in"].text === "gate 1 1" && byId["obj-gen-in"].varname === "mb_genin", "Missing the open gate hub (varname mb_genin)");
    assert.strictEqual(byId["obj-plugin"].varname, "mb_plugin", "plugin~ needs the scripting name mb_plugin");
    assert.strictEqual(byId["obj-plugout"].varname, "mb_plugout", "plugout~ needs the scripting name mb_plugout");
    assert.ok(!lines.some((l) => l.source[0] === "obj-plugin" && l.destination[0] === "obj-plugout"), "No dry cord while the gen~ loads (a rack of K chains would be K times as loud)");
    assert.ok(!lines.some((l) => l.source[0] === "obj-plugin"), "plugin~ is wired to the gen~ by the face, not in the file");
    assert.ok(!lines.some((l) => l.destination[0] === "obj-plugout"), "plugout~ is wired to the gen~ by the face, not in the file");
    for (const l of lines) {
        if (l.destination[0] === "obj-gen-in") assert.strictEqual(l.destination[1], 1, "Every gen-bound cord must go into the hub's DATA inlet (a `t a` / left inlet hub makes no cord)");
    }
    assert.strictEqual(byId["obj-msg-gen-buf"].text, "scope ---mbsplitscope", "Gen buffer bind message must be 'scope ---mbsplitscope'");
    assert.ok(hasLine("obj-loadbang", "obj-msg-gen-buf") && hasLine("obj-msg-gen-buf", "obj-gen-in"), "Missing loadbang -> scope ---mbsplitscope -> gen hub");
    assert.ok(hasLine("obj-loadbang", "obj-msg-ui-buf") && hasLine("obj-msg-ui-buf", "obj-viz"), "Missing loadbang -> setbuffer ---mbsplitscope -> viz");
    assert.ok(byId["obj-msg-ui-dsp"] && byId["obj-msg-ui-dsp"].text === "init_dsp" && hasLine("obj-thisdevice", "obj-msg-ui-dsp") && hasLine("obj-msg-ui-dsp", "obj-viz"), "live.thisdevice must send init_dsp to the face");
    assert.ok(!hasLine("obj-loadbang", "obj-msg-ui-dsp"), "Never start the DSP from loadbang (the LOM is not ready); only from live.thisdevice");
    {
        // the embedded gen patch is the core, with the build's hash
        const vizText = byId["obj-viz"].textfile.text;
        const m = vizText.match(/var GEN_DSP_TEXT\s*=\s*("(?:\\.|[^"\\])*")\s*;\s*var GEN_DSP_HASH\s*=\s*"([0-9a-f]{12})"\s*;/);
        assert.ok(m, "The face script must embed GEN_DSP_TEXT / GEN_DSP_HASH");
        const gp = JSON.parse(JSON.parse(m[1]));
        assert.strictEqual(gp.patcher.classnamespace, "dsp.gen", "Embedded gen patch must be a dsp.gen patcher");
        const codebox = gp.patcher.boxes.map((b) => b.box).find((b) => b.maxclass === "codebox");
        assert.strictEqual(codebox.code, minifyGen(gen), "Embedded gen patch is the mangled core");
        assert.ok(gp.patcher.lines.length === 4, "gen patch: in 1 / in 2 -> codebox -> out 1 / out 2");
    }

    // Instance isolation: in a device's top-level patcher `#0` is NOT expanded in Live (every instance would share the buffer), so
    // buffer~ / send / receive names use the `---` prefix (Delay+, Reverb+, Spectral Split)
    for (const b of boxes) {
        if (b.maxclass === "newobj" && b.text) {
            const tok = b.text.split(/\s+/);
            if (["buffer~", "send", "receive", "s", "r", "send~", "receive~"].includes(tok[0])) {
                assert.ok(tok[1] && tok[1].startsWith("---"), `Object '${b.text}' must use the --- prefix for instance isolation`);
            }
        }
    }

    // Check decorative panels are at the end of boxes with background: 1
    const firstPanelIdx = boxes.findIndex((b) => b.maxclass === "panel");
    assert.ok(firstPanelIdx > 0, "Expected decorative panels");
    for (let i = firstPanelIdx; i < boxes.length; i++) {
        assert.strictEqual(boxes[i].maxclass, "panel", "All decorative panels must be placed at the end of boxes");
        assert.strictEqual(boxes[i].background, 1, `Panel ${boxes[i].id} must have background: 1`);
    }

    // Check zero overlap between live.* widgets and v8ui canvas in presentation mode
    const vizRect = byId["obj-viz"].presentation_rect;
    const interactiveWidgets = boxes.filter(
        (b) => b.presentation === 1 && b.id !== "obj-viz" && b.maxclass && b.maxclass.startsWith("live.") && b.maxclass !== "live.comment" && b.maxclass !== "live.thisdevice"
    );
    for (const w of interactiveWidgets) {
        assert.ok(
            !rectsOverlap(vizRect, w.presentation_rect),
            `Widget ${w.id} (${w.presentation_rect}) must not overlap v8ui (${vizRect})`
        );
        const r = w.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 268 && r[1] + r[3] <= 169, `Widget ${w.id} outside 268x169 bounds`);
    }
    for (let i = 0; i < interactiveWidgets.length; i++) {
        for (let j = i + 1; j < interactiveWidgets.length; j++) {
            assert.ok(
                !rectsOverlap(interactiveWidgets[i].presentation_rect, interactiveWidgets[j].presentation_rect),
                `Widgets ${interactiveWidgets[i].id} and ${interactiveWidgets[j].id} overlap`
            );
        }
    }
}

// =========================================================================
// 6. AUTO BAND CREATION PER DETECTED INSTANCE (1..4), VOLUME SLIDER & LINK TOGGLE
// =========================================================================
{
    const combinedCode = fs.readFileSync(CONFIG_PATH, "utf8") + "\n\n" + fs.readFileSync(path.join(__dirname, "..", "src", "spectral_theme.js"), "utf8") +
        "\n\nvar GEN_DSP_TEXT = \"{}\";\nvar GEN_DSP_HASH = \"test\";\n" + fs.readFileSync(DSP_PATH, "utf8") + "\n\n" + fs.readFileSync(UI_PATH, "utf8");
    const sharedBus = { groups: {}, peers: {} };
    const sawRing8192 = cfg.synthesizeSawWave8192(110.0, 48000.0);

    function createUiInstance(lomPath) {
        const emitted0 = [];
        const emitted1 = [];
        const drawCmds = [];
        const sandbox = {
            Math: Math,
            Date: Date,
            Number: Number,
            String: String,
            Boolean: Boolean,
            Array: Array,
            Object: Object,
            parseInt: parseInt,
            isNaN: isNaN,
            liveLomPath: lomPath || "",
            cursorHiddenCount: 0,
            cursorShownCount: 0,
            max: {
                hidecursor: function() { sandbox.cursorHiddenCount++; },
                showcursor: function() { sandbox.cursorShownCount++; }
            },
            global: { __mbsplit_shared_bus: sharedBus },
            Global: function() { return sharedBus; },
            LiveAPI: function(cb, target) {
                const t = (typeof cb === "string" && target === undefined) ? cb : target;
                if (t === "this_device") {
                    this.path = sandbox.liveLomPath;
                    this.id = sandbox.liveLomPath ? "42" : "0";
                } else {
                    this.path = t || "";
                    this.id = this.path ? "10" : "0";
                }
            },
            Buffer: function() {
                this.peek = function(_ch, offset, count) {
                    if (offset === 32 && count === 8192) {
                        return sawRing8192;
                    }
                    return [
                        0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.25, 0.2,
                        0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03,
                        0.45, 0.52, 0.31, 0.18, 0.65, 0.52, 2, 10, 0, 48000, sandbox.mockFirD, 0
                    ];
                };
            },
            Task: function(fn) {
                this.interval = 40;
                this.repeat = function() {};
            },
            mgraphics: {
                size: [256, 136],
                relative_coords: 1,
                autofill: 1,
                init: function() {},
                redraw: function() { sandbox.paint(); },
                set_source_rgba: function(r, g, b, a) { drawCmds.push({ op: "rgba", r, g, b, a }); },
                set_line_width: function(w) { drawCmds.push({ op: "lw", w }); },
                rectangle: function(x, y, w, h) { drawCmds.push({ op: "rect", x, y, w, h }); },
                rectangle_rounded: function(x, y, w, h, rx, ry) { drawCmds.push({ op: "rrect", x, y, w, h }); },
                move_to: function(x, y) { drawCmds.push({ op: "move", x, y }); },
                line_to: function(x, y) { drawCmds.push({ op: "line", x, y }); },
                close_path: function() { drawCmds.push({ op: "close" }); },
                arc: function(x, y, r, a1, a2) { drawCmds.push({ op: "arc", x, y, r }); },
                fill: function() { drawCmds.push({ op: "fill" }); },
                stroke: function() { drawCmds.push({ op: "stroke" }); },
                select_font_face: function(f) {},
                set_font_size: function(s) {},
                text_measure: function(t) { return [String(t).length * 5, 9]; },
                show_text: function(t) { drawCmds.push({ op: "text", text: t }); }
            },
            inlets: 1,
            outlets: 2,
            outlet: function(idx, msg) {
                if (idx === 0) emitted0.push(msg);
                else emitted1.push(msg);
            },
            notifyclients: function() { sandbox.notified = (sandbox.notified || 0) + 1; },
            patcher: {
                latency: 0,
                setattr: function(k, v) { if (k === "latency") sandbox.patcher.latency = v; }
            },
            mockFirD: 128
        };
        vm.createContext(sandbox);
        vm.runInContext(combinedCode, sandbox);
        assert.strictEqual(sandbox.mgraphics.relative_coords, 0, "v8ui must set mgraphics.relative_coords = 0");
        assert.strictEqual(sandbox.mgraphics.autofill, 0, "v8ui must set mgraphics.autofill = 0");
        sandbox.setbuffer("---mbsplitscope");
        sandbox.TOPO_INTERVAL_MS = 0;   // the unit tests call pullScope() back to back: poll the topology on every call
        sandbox.loadbang();
        sandbox.emitted0 = emitted0;
        sandbox.emitted1 = emitted1;
        sandbox.drawCmds = drawCmds;
        return sandbox;
    }

    // 1. Add Instance 1 on Chain 0 -> must auto-detect 1 band (1:FULL)
    const inst1 = createUiInstance("live_set tracks 0 devices 0 chains 0 devices 0");
    assert.strictEqual(inst1.curNumBands, 1, "1 detected instance must create 1 band (FULL)");
    assert.strictEqual(inst1.getEffectiveMask(), 1, "Chain 0 with 1 band must pass Band 1");

    // Slope 0 is 12 dB/oct (power 2). One octave above the crossover the low band is 1/5,
    // not the 24 dB/oct value 1/17. `Number(0) || 1` drew 12 dB as 24 dB.
    const lr12 = inst1.computeCrossoverMagResponse(2000, 1000, 0);
    const lr24 = inst1.computeCrossoverMagResponse(2000, 1000, 1);
    assert.ok(Math.abs(lr12.lp - 0.2) < 1e-9, "12 dB/oct one octave down is 1/5, got " + lr12.lp);
    assert.ok(lr12.lp > lr24.lp + 0.05, "12 dB/oct rolls off slower than 24 dB/oct");

    // 2. Add Instance 2 on Chain 1 -> both instances must auto-detect 2 bands (1:LOW, 2:HIGH)
    const inst2 = createUiInstance("live_set tracks 0 devices 0 chains 1 devices 0");
    assert.strictEqual(inst1.curNumBands, 2, "Adding 2nd instance must update Instance 1 to 2 bands");
    assert.strictEqual(inst2.curNumBands, 2, "Instance 2 must detect 2 bands");
    assert.strictEqual(inst1.getEffectiveMask(), 1, "Instance 1 (Chain 0) must solo Band 1 (LOW)");
    assert.strictEqual(inst2.getEffectiveMask(), 2, "Instance 2 (Chain 1) must solo Band 2 (HIGH)");

    // 3. Add Instance 3 on Chain 2 -> all 3 instances must auto-detect 3 bands (1:LOW, 2:MID, 3:HIGH)
    const inst3 = createUiInstance("live_set tracks 0 devices 0 chains 2 devices 0");
    assert.strictEqual(inst1.curNumBands, 3, "Adding 3rd instance must update Instance 1 to 3 bands");
    assert.strictEqual(inst2.curNumBands, 3, "Adding 3rd instance must update Instance 2 to 3 bands");
    assert.strictEqual(inst3.curNumBands, 3, "Instance 3 must detect 3 bands");
    assert.strictEqual(inst3.getEffectiveMask(), 4, "Instance 3 (Chain 2) must solo Band 3 (HIGH)");

    // 4. Add Instance 4 on Chain 3 -> all 4 instances must auto-detect 4 bands (LOW, LO-M, HI-M, HIGH)
    const inst4 = createUiInstance("live_set tracks 0 devices 0 chains 3 devices 0");
    assert.strictEqual(inst1.curNumBands, 4, "Adding 4th instance must update Instance 1 to 4 bands");
    assert.strictEqual(inst4.curNumBands, 4, "Instance 4 must detect 4 bands");
    assert.strictEqual(inst4.getEffectiveMask(), 8, "Instance 4 (Chain 3) must solo Band 4 (HIGH)");

    // 4b. Work sharing in a rack: gen prune, one FFT per link group, band meters merged over the group
    {
        const sentTail = (inst, name) => { const m = inst.emitted0.filter((e) => e[0] === name); return m.length ? m[m.length - 1][1] : undefined; };
        for (const inst of [inst1, inst2, inst3, inst4]) inst.pullScope();
        assert.strictEqual(sentTail(inst1, "prune"), 1, "A rack instance must prune its gen to its own band");
        assert.strictEqual(sentTail(inst4, "prune"), 1, "Every rack instance prunes (4 linked instances)");
        // leader = first alive instance in chain order: it runs the FFT, the others copy its columns
        for (let k = 0; k < 3; k++) for (const inst of [inst1, inst2, inst3, inst4]) inst.pullScope();
        assert.strictEqual(inst1.fftWantRing, true, "The first instance in chain order must run the FFT (ring on)");
        for (const inst of [inst2, inst3, inst4]) {
            assert.strictEqual(inst.fftWantRing, false, "Followers must not run the FFT while the leader publishes");
            assert.strictEqual(sentTail(inst, "ringon"), 0, "Followers switch the gen's ring off");
            assert.strictEqual(inst.fftComputed, 0, "A follower must not compute an FFT");
            assert.ok(inst.fftCopied >= 2, `A follower must copy the leader's spectrogram frames (got ${inst.fftCopied})`);
        }
        assert.ok(inst1.fftComputed >= 3, "The leader computes the FFT every tick");
        for (let c = 0; c < inst1.SPEC_COLS; c++) {
            assert.ok(Math.abs(inst2.specColDb[c] - inst1.specColDb[c]) < 1e-9 || inst2.fftCopied !== inst1.fftComputed,
                "A follower's smoothed columns equal the leader's when it saw every frame");
        }
        // band meters: each instance's gen measures only its own band; the face shows the max over the group
        inst1.bandPeaksOwn = [0.5, 0, 0, 0];
        inst2.bandPeaksOwn = [0, 0.4, 0, 0];
        inst3.bandPeaksOwn = [0, 0, 0.3, 0];
        inst4.bandPeaksOwn = [0, 0, 0, 0.2];
        inst3.mergeBandPeaks(inst3.getAliveGroupPeers(inst3.getActiveGroupKey()));
        assert.deepStrictEqual(Array.from(inst3.bandPeaks), [0.5, 0.4, 0.3, 0.2], "Band meters must merge the linked instances' own bands");
        // fallback: leader goes quiet (deleted chain, DSP not loaded): after FFT_SHARE_FRESH_MS the next instance runs the FFT itself
        const key = inst2.getActiveGroupKey();
        sharedBus.spec[key].t -= 5000;
        inst2.pullScope();
        assert.strictEqual(inst2.fftWantRing, true, "A follower must take over the FFT when the shared frame is stale");
        assert.strictEqual(sentTail(inst2, "ringon"), 1, "The takeover switches the gen's ring on");
        inst2.fftRingOnSince = Date.now();
        const computedBefore = inst2.fftComputed;
        inst2.pullScope();
        assert.strictEqual(inst2.fftComputed, computedBefore, "No FFT until the 8192-sample ring has refilled");
        inst2.fftRingOnSince = Date.now() - 1000;
        inst2.pullScope();
        assert.strictEqual(inst2.fftComputed, computedBefore + 1, "FFT resumes after the ring refilled");
        inst1.pullScope();   // the leader publishes again: the substitute hands the FFT back
        inst2.pullScope();
        assert.strictEqual(inst2.fftWantRing, false, "The substitute stops when the leader publishes again");
        assert.strictEqual(sentTail(inst2, "ringon"), 0);
        // a lone instance keeps every band (the face meters show all bands) and runs its own FFT
        const lone = createUiInstance("live_set tracks 1 devices 0");
        lone.pullScope();
        assert.strictEqual(sentTail(lone, "prune"), 0, "A lone instance must not prune (it shows all band meters)");
        assert.strictEqual(lone.fftWantRing, true);
        lone.notifydeleted();
        console.log(`[work sharing] leader FFTs ${inst1.fftComputed}, follower copies ${inst3.fftCopied}, follower FFTs ${inst3.fftComputed}`);
    }

    // 5. Removing Instance 4 via notifydeleted() must update remaining instances back to 3 bands
    inst4.notifydeleted();
    assert.strictEqual(inst1.curNumBands, 3, "Deleting 4th instance must return Instance 1 to 3 bands");
    assert.strictEqual(inst2.curNumBands, 3, "Deleting 4th instance must return Instance 2 to 3 bands");
    assert.strictEqual(inst3.curNumBands, 3, "Deleting 4th instance must return Instance 3 to 3 bands");

    // 5b. Simulate Ableton Live moving middle Instance 2 (Chain 1) to Undo trash (this_device path becomes "")
    inst2.liveLomPath = "";
    inst1.pullScope();
    assert.strictEqual(inst1.curNumBands, 2, "Deleting middle instance in Live must shrink Instance 1 to 2 bands");
    assert.strictEqual(inst3.curNumBands, 2, "Deleting middle instance in Live must shrink Instance 3 to 2 bands");
    assert.strictEqual(inst1.getEffectiveMask(), 1, "Instance 1 (Chain 0) remains Band 1 (LOW)");
    assert.strictEqual(inst3.getEffectiveMask(), 2, "Instance 3 (Chain 2, now 2nd alive chain) must compact to Band 2 (HIGH)");

    // Ensure repeated pullScope() ticks on the Undo-trashed instance NEVER re-register or trigger a broadcast loop
    const notifiedBeforeTicks = inst1.notified || 0;
    for (let tick = 0; tick < 20; tick++) {
        inst2.pullScope();
        inst1.pullScope();
        inst3.pullScope();
    }
    assert.strictEqual(inst1.curNumBands, 2, "Repeated ticks while Instance 2 is in Undo trash must keep 2 bands");
    assert.strictEqual(inst3.curNumBands, 2, "Repeated ticks while Instance 2 is in Undo trash must keep 2 bands on Instance 3");
    assert.strictEqual(inst1.notified || 0, notifiedBeforeTicks, "Undo-trashed instance must never trigger a notification/broadcast loop");

    // 5c. Simulate Cmd+Z Undo in Live restoring Instance 2
    inst2.liveLomPath = "live_set tracks 0 devices 0 chains 1 devices 0";
    inst2.pullScope();
    assert.strictEqual(inst1.curNumBands, 3, "Restoring Instance 2 via Undo must return Instance 1 to 3 bands");
    assert.strictEqual(inst2.curNumBands, 3, "Restored Instance 2 must have 3 bands");
    assert.strictEqual(inst3.curNumBands, 3, "Instance 3 must return to 3 bands");
    assert.strictEqual(inst3.getEffectiveMask(), 4, "Instance 3 returns to Band 3 (HIGH)");

    // 6. Nested Rack B inside Chain 1 (2 instances -> 2 bands, isolated from Outer Rack A's 3 bands)
    const nestedLowB = createUiInstance("live_set tracks 0 devices 0 chains 1 devices 1 chains 0 devices 0");
    assert.strictEqual(nestedLowB.curNumBands, 1, "Single instance in Nested Rack B starts at 1 band");
    const nestedHighB = createUiInstance("live_set tracks 0 devices 0 chains 1 devices 1 chains 1 devices 0");
    assert.strictEqual(nestedLowB.curNumBands, 2, "2nd instance in Nested Rack B updates Nested Rack B to 2 bands");
    assert.strictEqual(nestedHighB.curNumBands, 2, "Nested High B has 2 bands");
    assert.strictEqual(inst1.curNumBands, 3, "Outer Rack A remains at 3 bands");

    // 6b. Cmd+D Same-Chain Duplication: right-hand splitter in the same chain stays in its own empty 1-band chain
    const dupRight = createUiInstance("live_set tracks 0 devices 0 chains 0 devices 1");
    // Simulate Ableton Live Cmd+D copying inst1's serialized state (which had numBands=3) into dupRight
    dupRight.setvalueof(inst1.getvalueof());
    inst1.pullScope();
    dupRight.pullScope();
    assert.strictEqual(inst1.isLeftMostInOwnChain(), true, "Left-most splitter in Chain 0 (devices 0) must remain isLeftMostInOwnChain() === true");
    assert.strictEqual(dupRight.isLeftMostInOwnChain(), false, "Right-hand Cmd+D splitter in Chain 0 (devices 1) must have isLeftMostInOwnChain() === false");
    assert.strictEqual(inst1.curNumBands, 3, "Left-most splitter in Chain 0 must stay part of the 3-band rack chain");
    assert.strictEqual(inst2.curNumBands, 3, "Chain 1 splitter must stay part of the 3-band rack chain");
    assert.strictEqual(inst3.curNumBands, 3, "Chain 2 splitter must stay part of the 3-band rack chain");
    assert.strictEqual(dupRight.curNumBands, 1, "Right-hand Cmd+D splitter in Chain 0 must be in its own empty 1-band chain");
    assert.strictEqual(dupRight.getEffectiveMask(), 1, "Right-hand Cmd+D splitter must output 1:FULL (mask 1)");
    assert.ok(dupRight.getActiveGroupKey().indexOf("rack_group::isolated::") === 0, "Right-hand Cmd+D splitter must use an isolated group key");

    // Crossovers between the left-most rack chain and the right-hand isolated splitter must not bleed
    dupRight.set_f1(910.0);
    assert.ok(Math.abs(inst1.curF1 - 120.0) < 1e-3, "Changing F1 on right-hand isolated splitter must not affect Outer Rack");
    inst1.set_f1(260.0);
    assert.ok(Math.abs(inst2.curF1 - 260.0) < 1e-3, "Changing F1 on left-most Chain 0 splitter must sync Chain 1");
    assert.ok(Math.abs(dupRight.curF1 - 910.0) < 1e-3, "Changing F1 on Outer Rack must not overwrite right-hand isolated splitter");

    // 6c. Same-Chain Reordering (swapping devices 0 <-> devices 1 in Chain 0)
    dupRight.liveLomPath = "live_set tracks 0 devices 0 chains 0 devices 0";
    inst1.liveLomPath = "live_set tracks 0 devices 0 chains 0 devices 1";
    dupRight.pullScope();
    inst1.pullScope();
    assert.strictEqual(dupRight.isLeftMostInOwnChain(), true, "Reordering dupRight to devices 0 makes it left-most in Chain 0");
    assert.strictEqual(inst1.isLeftMostInOwnChain(), false, "Displaced inst1 at devices 1 is no longer left-most in Chain 0");
    assert.strictEqual(dupRight.curNumBands, 3, "Newly left-most dupRight joins the 3-band rack chain");
    assert.ok(Math.abs(dupRight.curF1 - 260.0) < 1e-3, "Newly left-most dupRight inherits Outer Rack's F1 crossover (260 Hz)");
    assert.strictEqual(inst1.curNumBands, 1, "Displaced right-hand inst1 drops to its own empty 1-band chain");

    // 6d. Deleting the left-most splitter in Chain 0 promotes the right-hand splitter into the rack chain
    dupRight.notifydeleted();
    inst1.liveLomPath = "live_set tracks 0 devices 0 chains 0 devices 0";
    inst1.pullScope();
    assert.strictEqual(inst1.isLeftMostInOwnChain(), true, "After deleting left-most dupRight, inst1 at devices 0 is left-most again");
    assert.strictEqual(inst1.curNumBands, 3, "Promoted inst1 rejoins the 3-band rack chain");
    assert.strictEqual(inst1.getEffectiveMask(), 1, "Promoted inst1 resumes Band 1 (LOW)");

    // 6e. Cross-Chain Dynamic Reordering (moving inst1 from Chain 0 to Chain 3, then back to Chain 0)
    inst1.liveLomPath = "live_set tracks 0 devices 0 chains 3 devices 0";
    inst1.pullScope();
    assert.strictEqual(inst2.getEffectiveMask(), 1, "After moving inst1 to Chain 3, inst2 (Chain 1) must become Rank 0 (LOW)");
    assert.strictEqual(inst3.getEffectiveMask(), 2, "inst3 (Chain 2) must become Rank 1 (MID)");
    assert.strictEqual(inst1.getEffectiveMask(), 4, "inst1 (Chain 3) must become Rank 2 (HIGH)");

    // Restore inst1 to Chain 0
    inst1.liveLomPath = "live_set tracks 0 devices 0 chains 0 devices 0";
    inst1.pullScope();
    assert.strictEqual(inst1.getEffectiveMask(), 1, "Restoring inst1 to Chain 0 returns it to Band 1 (LOW)");
    assert.strictEqual(inst2.getEffectiveMask(), 2, "inst2 returns to Band 2 (MID)");
    assert.strictEqual(inst3.getEffectiveMask(), 4, "inst3 returns to Band 3 (HIGH)");

    // 6f. Dynamic Nesting Move (moving inst3 from Outer Rack A into Nested Rack B Chain 2)
    nestedLowB.set_f1(550.0);
    inst3.liveLomPath = "live_set tracks 0 devices 0 chains 1 devices 1 chains 2 devices 0";
    inst3.pullScope();
    assert.strictEqual(inst1.curNumBands, 2, "Moving inst3 out of Outer Rack A into Nested Rack B must shrink Outer Rack A from 3 -> 2 bands");
    assert.strictEqual(nestedLowB.curNumBands, 3, "Moving inst3 into Nested Rack B must grow Nested Rack B from 2 -> 3 bands");
    assert.strictEqual(inst3.curNumBands, 3, "inst3 inside Nested Rack B must detect 3 bands");
    assert.ok(Math.abs(inst3.curF1 - 550.0) < 1e-3, "inst3 moved into Nested Rack B must inherit Nested Rack B's F1 crossover");

    // Move inst3 back to Outer Rack A Chain 2
    inst3.liveLomPath = "live_set tracks 0 devices 0 chains 2 devices 0";
    inst3.pullScope();
    assert.strictEqual(inst1.curNumBands, 3, "Moving inst3 back to Outer Rack A restores 3 bands");
    assert.strictEqual(nestedLowB.curNumBands, 2, "Nested Rack B returns to 2 bands");

    // 6g. Manual Link Group (A..D / Off) and Track-Level Cmd+D Duplication
    const trackLeft = createUiInstance("live_set tracks 1 devices 0");
    const trackRight = createUiInstance("live_set tracks 1 devices 1");
    trackLeft.pullScope();
    trackRight.pullScope();
    assert.strictEqual(trackLeft.isLeftMostInOwnChain(), true, "Left-most splitter on a track (devices 0) must be left-most");
    assert.strictEqual(trackRight.isLeftMostInOwnChain(), false, "Right-hand Cmd+D splitter on a track (devices 1) must not be left-most");
    assert.strictEqual(trackLeft.curNumBands, 1, "Track-level left-most splitter has 1 band");
    assert.strictEqual(trackRight.curNumBands, 1, "Track-level right-hand splitter has 1 band in its own isolated group");
    assert.ok(trackRight.getActiveGroupKey().indexOf("rack_group::isolated::") === 0, "Track-level right-hand splitter uses isolated group key in Auto mode");

    // Switching manual link group on right-hand splitter to Group A (1) and Off (5)
    trackRight.set_linkgroup(1);
    assert.strictEqual(trackRight.getActiveGroupKey(), "manual_group_A", "Manual Link Group A overrides isolated auto group");
    trackRight.set_linkgroup(5);
    assert.strictEqual(trackRight.getActiveGroupKey(), null, "Link Group Off returns null group key");
    trackRight.set_linkgroup(0);
    assert.ok(trackRight.getActiveGroupKey().indexOf("rack_group::isolated::") === 0, "Returning to Auto restores isolated group key for right-hand splitter");
    trackLeft.notifydeleted();
    trackRight.notifydeleted();

    // 7. Test Top-Right Volume Slider (-inf to +18 dB) — Ableton-style Mouse Stealing & Vertical (Up/Down) Drag
    const vr = inst1.getVolumeSliderRect();
    const clickX = vr[0] + 10;
    const clickY = vr[1] + 7;
    inst1.onclick(clickX, clickY, 1, 0, 0);
    assert.strictEqual(inst1.cursorHiddenCount, 1, "Clicking volume slider must steal/hide mouse cursor");
    assert.strictEqual(inst1.curGainDb, 0.0, "Initial click on volume slider must not jump from 0.0 dB");

    // Pure horizontal (left-right) drag must NOT change volume
    inst1.ondrag(clickX + 40, clickY, 1, 0, 0);
    inst1.ondrag(clickX - 40, clickY, 1, 0, 0);
    assert.strictEqual(inst1.curGainDb, 0.0, "Horizontal left-right movement must not change volume slider");

    // Drag DOWN (increasing y) -> decreases volume to -70 dB (-inf dB)
    inst1.ondrag(clickX, clickY + 200, 1, 0, 0);
    inst1.ondrag(clickX, clickY + 200, 0, 0, 0);
    assert.strictEqual(inst1.cursorShownCount, 1, "Releasing mouse on volume slider must restore cursor");
    assert.strictEqual(inst1.curGainDb, -70.0, "Dragging volume slider DOWN must reach -70 dB (-inf dB)");

    // Drag UP (decreasing y) -> increases volume to +18.0 dB
    inst1.onclick(clickX, clickY, 1, 0, 0);
    inst1.ondrag(clickX, clickY - 200, 1, 0, 0);
    inst1.ondrag(clickX, clickY - 200, 0, 0, 0);
    assert.ok(Math.abs(inst1.curGainDb - 18.0) < 1e-4, "Dragging volume slider UP must reach +18.0 dB");

    // Double-click volume slider -> resets to 0.0 dB
    inst1.ondblclick(vr[0] + 20, vr[1] + 7);
    assert.strictEqual(inst1.curGainDb, 0.0, "Double-clicking volume slider must reset to 0.0 dB");

    // 8. Test Bottom-Right Clickable Link Info String inside Spectrogram
    assert.strictEqual(inst1.showLinkStatus, true, "Link status badge starts visible");
    const lrShown = inst1.getLinkBadgeRect();
    inst1.onclick(lrShown[0] + 5, lrShown[1] + 5, 1, 0, 0);
    assert.strictEqual(inst1.showLinkStatus, false, "Clicking link badge in bottom-right of spectrogram must hide full link string");
    const lrHidden = inst1.getLinkBadgeRect();
    inst1.onclick(lrHidden[0] + 5, lrHidden[1] + 5, 1, 0, 0);
    assert.strictEqual(inst1.showLinkStatus, true, "Clicking collapsed link badge must restore full link string");

    // 9. Test 8192-sample pullScope() spectrogram update
    inst1.pullScope();
    const maxColDb = Math.max(...inst1.specColDb);
    const minColDb = Math.min(...inst1.specColDb);
    assert.ok(maxColDb - minColDb > 30.0, "pullScope() with 8192-sample sawtooth buffer must produce high-contrast harmonic peaks");

    // 10. Dynamic Phase toggle: links across the rack, reports latency to Live, persists in the v3 blob
    assert.strictEqual(inst1.curPhaseMode, 0, "Phase mode defaults to Min");
    assert.strictEqual(inst1.patcher.latency, 0, "Min phase must report zero latency");
    inst1.set_phasemode(1);
    assert.ok(inst1.emitted0.some((m) => m[0] === "dynphase" && m[1] === 1), "set_phasemode must send dynphase 1 to gen");
    assert.strictEqual(inst1.patcher.latency, 128, "Dynamic phase must report 128 samples of latency at 48 kHz");
    assert.strictEqual(inst2.curPhaseMode, 1, "Phase mode must link to the other rack instances");
    assert.strictEqual(inst2.patcher.latency, 128, "Linked instance must report the same latency");
    assert.ok(inst2.emitted0.some((m) => m[0] === "ui_phasemode" && m[1] === 1), "Linked instance must `set` its toggle");
    const v3 = inst1.getvalueof();
    assert.strictEqual(v3[0], 3, "State blob must be version 3");
    assert.strictEqual(v3[11], 1, "State blob must store the phase mode");
    inst1.setvalueof([2, 120.0, 800.0, 4500.0, 2, 1, 0, 1, 0, 0.0, 1]);
    assert.strictEqual(inst1.curPhaseMode, 1, "v2 blobs (no phase field) must not touch the phase mode");
    inst1.setvalueof(v3.slice(0, 11).concat([0]));
    assert.strictEqual(inst1.curPhaseMode, 0, "v3 blob must restore Min phase");
    assert.strictEqual(inst1.patcher.latency, 0, "Restoring Min phase must report zero latency");
    inst1.set_phasemode(1);
    inst1.mockFirD = 256;
    inst1.pullScope();
    assert.strictEqual(inst1.patcher.latency, 256, "Latency must follow the gen FIR length (96 kHz)");
    inst1.set_phasemode(0);
    assert.strictEqual(inst1.patcher.latency, 0);
    assert.strictEqual(inst2.patcher.latency, 0);

    // 11. Crossover sliders for missing splits are greyed out (active 0, theme-dimmed)
    function lastActive(inst, k) {
        const msgs = inst.emitted0.filter((m) => m[0] === `ui_st_f${k}` && m[1] === "active");
        return msgs.length ? msgs[msgs.length - 1][2] : undefined;
    }
    for (const nb of [1, 2, 3, 4]) {
        inst1.set_numbands(nb);
        for (const k of [1, 2, 3]) {
            assert.strictEqual(lastActive(inst1, k), nb > k ? 1 : 0, `${nb} band(s): F${k} must be ${nb > k ? "active" : "greyed out"}`);
            assert.ok(!inst1.emitted0.some((m) => m[0] === `ui_st_f${k}` && m[1] === "textcolor"), "greyed state must not hard-code a text colour");
        }
    }
    const before = inst1.emitted0.length;
    inst1.set_numbands(4);
    assert.ok(!inst1.emitted0.slice(before).some((m) => String(m[0]).startsWith("ui_st_f")), "Unchanged band count must not resend slider states");

    // Shift / right-edge toggle can turn the last passing band off (mask 0 = silence).
    // The v3 blob must reload that 0. `Number(mask) || 1` used to turn it into band 1.
    inst1.set_bandmode(0);
    assert.strictEqual(inst1.getEffectiveMask(), 1, "chain 0 in Auto passes band 1 before the toggle");
    const pill0 = inst1.getBandPillRect(0);
    inst1.onclick(pill0[0] + pill0[2] - 2, pill0[1] + 2, 1, 0, 0);
    assert.strictEqual(inst1.curBandMode, 5, "right-edge pill click enters the custom mask");
    assert.strictEqual(inst1.curCustomMask, 0, "toggling off the only passing band stores mask 0");
    assert.strictEqual(inst1.getEffectiveMask(), 0, "mask 0 passes no band");
    const muteBlob = inst1.getvalueof();
    assert.strictEqual(muteBlob[6], 5, "blob stores custom band mode");
    assert.strictEqual(muteBlob[7], 0, "blob stores custom mask 0");
    inst1.set_bandmode(1);
    assert.strictEqual(inst1.curCustomMask, 1, "solo band 1 replaces the empty mask");
    inst1.setvalueof(muteBlob);
    assert.strictEqual(inst1.curBandMode, 5, "reloaded blob keeps custom band mode");
    assert.strictEqual(inst1.curCustomMask, 0, "reloaded custom mask of 0 stays 0");
    assert.strictEqual(inst1.getEffectiveMask(), 0, "reloaded mask 0 still passes no band");
    inst1.set_numbands(0);
}

// =============================================================================
// 10. Automated Live Ableton MCP Regression Suite (when MCP Bridge is online)
// =============================================================================
const { execFileSync } = require("child_process");

function mcpCall(port, toolName, argsObj) {
    const cliPath = path.join(ROOT, "scripts", "ableton_mcp_server.js");
    const out = execFileSync(
        process.execPath,
        [cliPath, "--port", String(port), "--call", toolName, JSON.stringify(argsObj || {})],
        { encoding: "utf8", timeout: 15000 }
    );
    return JSON.parse(out);
}

function normalizeMcpState(state) {
    const lomDevices = (state && (state.liveSetMbsplitDevices || state.lomDevices) || []).map(d => {
        const params = d.params || Object.fromEntries((d.parameters || []).map(p => [p.name, p]));
        return Object.assign({}, d, { params });
    });
    const peers = ((state && state.peers) || []).map(p => Object.assign({}, p.state || {}, p));
    return {
        lomDevices,
        peers,
        peerByPath: Object.fromEntries(peers.filter(p => !p.isDeleted && p.lomPath).map(p => [p.lomPath, p])),
        devByPath: Object.fromEntries(lomDevices.map(d => [d.path, d]))
    };
}

function findActiveMcpPortWithSplitters() {
    const cliPath = path.join(ROOT, "scripts", "ableton_mcp_server.js");
    try {
        const raw = execFileSync(process.execPath, [cliPath, "--list-sessions"], {
            encoding: "utf8",
            timeout: 8000
        });
        const parsed = JSON.parse(raw);
        const sessions = (parsed && parsed.sessions) || [];
        for (const s of sessions) {
            if (!s || !s.port) continue;
            try {
                const state = normalizeMcpState(mcpCall(s.port, "ableton_inspect_mbsplit", {}));
                if (state.lomDevices.length >= 4) {
                    return s.port;
                }
            } catch (_) {}
        }
    } catch (_) {}
    return null;
}

function runLiveMcpRegressionSuite() {
    const port = findActiveMcpPortWithSplitters();
    if (!port) {
        console.log("[MCP] No active Ableton MCP session with >=4 Multiband Split devices detected; skipping live MCP suite.");
        return;
    }
    console.log(`[MCP] Running automated Live Ableton MCP regression suite on port ${port}...`);

    // Helper to arrange the 4 splitters into target LOM locations and pause briefly for v8ui tick
    function arrangeSplitters(layoutSpec) {
        const res = mcpCall(port, "ableton_eval_lom_js", {
            code: `
                var ls = new LiveAPI(null, "live_set");
                var outerRack = new LiveAPI(null, "live_set tracks 0 devices 0");
                var c0 = new LiveAPI(null, "live_set tracks 0 devices 0 chains 0");
                var c1 = new LiveAPI(null, "live_set tracks 0 devices 0 chains 1");
                var c2 = new LiveAPI(null, "live_set tracks 0 devices 0 chains 2");
                var subC0 = new LiveAPI(null, "live_set tracks 0 devices 0 chains 3 devices 0 chains 0");
                var subC1 = new LiveAPI(null, "live_set tracks 0 devices 0 chains 3 devices 0 chains 1");
                var targets = {
                    "c0": Number(c0.id),
                    "c1": Number(c1.id),
                    "c2": Number(c2.id),
                    "subC0": Number(subC0.id),
                    "subC1": Number(subC1.id)
                };
                var spec = ${JSON.stringify(layoutSpec)};
                for (var i = 0; i < spec.length; i++) {
                    ls.call("move_device", "id", spec[i].devId, "id", targets[spec[i].target], spec[i].index);
                }
                var bus = new Global("mbsplit_shared_bus");
                if (bus && bus.peers) {
                    var ids = Object.keys(bus.peers);
                    for (var j = 0; j < ids.length; j++) {
                        var p = bus.peers[ids[j]];
                        if (p && typeof p.refreshSelfLomState === "function") p.refreshSelfLomState(true);
                    }
                    for (var k = 0; k < ids.length; k++) {
                        var p2 = bus.peers[ids[k]];
                        if (p2 && typeof p2.onPeerBandsChanged === "function") p2.onPeerBandsChanged();
                    }
                }
                return { ok: true };
            `
        });
        assert.strictEqual(res.result && res.result.ok, true, "arrangeSplitters LOM move_device must succeed");
    }

    const initial = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
    assert.ok(initial.lomDevices.length >= 4, "Expected at least 4 Multiband Split devices in live session");
    const devIds = initial.lomDevices.slice(0, 4).map(d => d.id);
    const [d0, d1, d2, d3] = devIds;

    // -------------------------------------------------------------------------
    // MCP Case 1: Cmd+D Same-Chain Right-Hand Duplication Isolation
    // d0 at Chain 0 devices 0 (left-most), d1 at Chain 0 devices 1 (right-hand Cmd+D),
    // d2 at Chain 1 devices 0, d3 at Chain 2 devices 0.
    // -------------------------------------------------------------------------
    arrangeSplitters([
        { devId: d0, target: "c0", index: 0 },
        { devId: d1, target: "c0", index: 1 },
        { devId: d2, target: "c1", index: 0 },
        { devId: d3, target: "c2", index: 0 }
    ]);
    mcpCall(port, "ableton_set_device_parameter", {
        path: "live_set tracks 0 devices 0 chains 0 devices 1",
        paramName: "F1 Low",
        value: 5000
    });
    mcpCall(port, "ableton_set_device_parameter", {
        path: "live_set tracks 0 devices 0 chains 0 devices 0",
        paramName: "F1 Low",
        value: 6000
    });

    const state1 = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
    const peerByPath1 = state1.peerByPath;
    const leftMostC0 = peerByPath1["live_set tracks 0 devices 0 chains 0 devices 0"];
    const rightDupC0 = peerByPath1["live_set tracks 0 devices 0 chains 0 devices 1"];
    const leftMostC1 = peerByPath1["live_set tracks 0 devices 0 chains 1 devices 0"];
    const leftMostC2 = peerByPath1["live_set tracks 0 devices 0 chains 2 devices 0"];

    assert.ok(leftMostC0 && rightDupC0 && leftMostC1 && leftMostC2, "All 4 splitters must be registered at expected LOM paths");
    assert.strictEqual(leftMostC0.isLeftMostInChain, true, "MCP Case 1: chains 0 devices 0 must be left-most in Chain 0");
    assert.strictEqual(leftMostC0.curNumBands, 3, "MCP Case 1: chains 0 devices 0 must stay in 3-band Outer Rack chain");
    assert.strictEqual(leftMostC0.effectiveMask, 1, "MCP Case 1: chains 0 devices 0 must be Band 1 (LOW)");
    assert.strictEqual(leftMostC1.curNumBands, 3, "MCP Case 1: chains 1 devices 0 must be in 3-band Outer Rack chain");
    assert.strictEqual(leftMostC1.effectiveMask, 2, "MCP Case 1: chains 1 devices 0 must be Band 2 (MID)");
    assert.strictEqual(leftMostC2.curNumBands, 3, "MCP Case 1: chains 2 devices 0 must be in 3-band Outer Rack chain");
    assert.strictEqual(leftMostC2.effectiveMask, 4, "MCP Case 1: chains 2 devices 0 must be Band 3 (HIGH)");

    assert.strictEqual(rightDupC0.isLeftMostInChain, false, "MCP Case 1: right-hand splitter (chains 0 devices 1) must NOT be left-most");
    assert.strictEqual(rightDupC0.curNumBands, 1, "MCP Case 1: right-hand splitter (chains 0 devices 1) must be in its own empty 1-band chain");
    assert.strictEqual(rightDupC0.effectiveMask, 1, "MCP Case 1: right-hand splitter must pass 1:FULL (mask 1)");
    assert.ok(rightDupC0.groupKey.indexOf("rack_group::isolated::") === 0, "MCP Case 1: right-hand splitter must have isolated groupKey");

    const devByPath1 = state1.devByPath;
    assert.strictEqual(Math.round(devByPath1["live_set tracks 0 devices 0 chains 1 devices 0"].params["F1 Low"].value), 6000, "MCP Case 1: Chain 1 F1 Low must sync with Chain 0 left-most (6000)");
    assert.strictEqual(Math.round(devByPath1["live_set tracks 0 devices 0 chains 0 devices 1"].params["F1 Low"].value), 5000, "MCP Case 1: right-hand isolated splitter F1 Low must remain independent (5000)");

    // -------------------------------------------------------------------------
    // MCP Case 2: Same-Chain Reordering (swap d1 to devices 0 and d0 to devices 1)
    // -------------------------------------------------------------------------
    arrangeSplitters([
        { devId: d1, target: "c0", index: 0 }
    ]);
    const state2 = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
    const peerByPath2 = state2.peerByPath;
    const newLeftC0 = peerByPath2["live_set tracks 0 devices 0 chains 0 devices 0"];
    const newRightC0 = peerByPath2["live_set tracks 0 devices 0 chains 0 devices 1"];

    assert.strictEqual(newLeftC0.deviceId, d1, "MCP Case 2: d1 must now be at chains 0 devices 0");
    assert.strictEqual(newLeftC0.isLeftMostInChain, true, "MCP Case 2: d1 at devices 0 must become left-most");
    assert.strictEqual(newLeftC0.curNumBands, 3, "MCP Case 2: d1 must join the 3-band Outer Rack chain");
    assert.strictEqual(newRightC0.deviceId, d0, "MCP Case 2: d0 must now be at chains 0 devices 1");
    assert.strictEqual(newRightC0.isLeftMostInChain, false, "MCP Case 2: displaced d0 at devices 1 must no longer be left-most");
    assert.strictEqual(newRightC0.curNumBands, 1, "MCP Case 2: displaced d0 must drop into its own empty 1-band chain");

    const devByPath2 = state2.devByPath;
    assert.strictEqual(Math.round(devByPath2["live_set tracks 0 devices 0 chains 0 devices 0"].params["F1 Low"].value), 6000, "MCP Case 2: newly promoted left-most splitter must inherit Outer Rack's F1 Low (6000)");

    // -------------------------------------------------------------------------
    // MCP Case 3: Nested Sub-Rack ("Chain Within a Chain") Isolation
    // Move d0 and d3 into Nested Sub-Rack (chains 3 devices 0 chains 0..1)
    // -------------------------------------------------------------------------
    arrangeSplitters([
        { devId: d1, target: "c0", index: 0 },
        { devId: d2, target: "c1", index: 0 },
        { devId: d0, target: "subC0", index: 0 },
        { devId: d3, target: "subC1", index: 0 }
    ]);
    mcpCall(port, "ableton_set_device_parameter", {
        path: "live_set tracks 0 devices 0 chains 3 devices 0 chains 0 devices 0",
        paramName: "F1 Low",
        value: 6800
    });

    const state3 = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
    const peerByPath3 = state3.peerByPath;
    assert.strictEqual(peerByPath3["live_set tracks 0 devices 0 chains 0 devices 0"].curNumBands, 2, "MCP Case 3: Outer Rack must shrink to 2 bands");
    assert.strictEqual(peerByPath3["live_set tracks 0 devices 0 chains 3 devices 0 chains 0 devices 0"].curNumBands, 2, "MCP Case 3: Nested Sub-Rack must form an isolated 2-band group");
    assert.strictEqual(peerByPath3["live_set tracks 0 devices 0 chains 3 devices 0 chains 0 devices 0"].effectiveMask, 1, "MCP Case 3: Nested Sub-Rack Chain 0 must be LOW (mask 1)");
    assert.strictEqual(peerByPath3["live_set tracks 0 devices 0 chains 3 devices 0 chains 1 devices 0"].effectiveMask, 2, "MCP Case 3: Nested Sub-Rack Chain 1 must be HIGH (mask 2)");

    const devByPath3 = state3.devByPath;
    assert.strictEqual(Math.round(devByPath3["live_set tracks 0 devices 0 chains 3 devices 0 chains 1 devices 0"].params["F1 Low"].value), 6800, "MCP Case 3: Nested Sub-Rack Chain 1 must sync F1 Low (6800) from Nested Sub-Rack Chain 0");
    assert.strictEqual(Math.round(devByPath3["live_set tracks 0 devices 0 chains 0 devices 0"].params["F1 Low"].value), 6000, "MCP Case 3: Outer Rack F1 Low must remain isolated (6000) from Nested Sub-Rack");

    // -------------------------------------------------------------------------
    // MCP Case 4: Cross-Chain Reordering & Restore Clean Initial State
    // Move Outer Rack Chain 0 -> Chain 2 so Chain 1 is LOW and Chain 2 is HIGH
    // -------------------------------------------------------------------------
    arrangeSplitters([
        { devId: d2, target: "c1", index: 0 },
        { devId: d1, target: "c2", index: 0 }
    ]);
    const state4 = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
    const peerByPath4 = state4.peerByPath;
    assert.strictEqual(peerByPath4["live_set tracks 0 devices 0 chains 1 devices 0"].effectiveMask, 1, "MCP Case 4: After moving Chain 0 -> Chain 2, Chain 1 must compact to Rank 0 (LOW, mask 1)");
    assert.strictEqual(peerByPath4["live_set tracks 0 devices 0 chains 2 devices 0"].effectiveMask, 2, "MCP Case 4: Chain 2 must become Rank 1 (HIGH, mask 2)");

    // Restore initial 4-splitter configuration (c0: d0, d1; c1: d2; c2: d3)
    arrangeSplitters([
        { devId: d0, target: "c0", index: 0 },
        { devId: d1, target: "c0", index: 1 },
        { devId: d2, target: "c1", index: 0 },
        { devId: d3, target: "c2", index: 0 }
    ]);

    // -------------------------------------------------------------------------
    // MCP Case 5: Live Device Deletion (Left-Most Promotion + Band Shrink) & Undo Restoration
    // -------------------------------------------------------------------------
    // 5a. Delete left-most splitter in Chain 0 (chains 0 devices 0) -> right-hand splitter (d1) shifts to devices 0 and promotes into 3-band Outer Rack
    mcpCall(port, "ableton_delete_device", {
        path: "live_set tracks 0 devices 0 chains 0 devices 0"
    });
    mcpCall(port, "ableton_eval_lom_js", {
        code: `
            var bus = new Global("mbsplit_shared_bus");
            if (bus && bus.peers) {
                var ids = Object.keys(bus.peers);
                for (var i = 0; i < ids.length; i++) {
                    var p = bus.peers[ids[i]];
                    if (p && typeof p.refreshSelfLomState === "function") p.refreshSelfLomState(true);
                }
                for (var j = 0; j < ids.length; j++) {
                    var p2 = bus.peers[ids[j]];
                    if (p2 && typeof p2.onPeerBandsChanged === "function") p2.onPeerBandsChanged();
                }
            }
            return { ok: true };
        `
    });
    const state5a = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
    const promotedC0 = state5a.peerByPath["live_set tracks 0 devices 0 chains 0 devices 0"];
    assert.ok(promotedC0, "MCP Case 5a: Right-hand splitter in Chain 0 must shift to chains 0 devices 0 after deleting left-most");
    assert.strictEqual(promotedC0.deviceId, d1, "MCP Case 5a: Shifted splitter at chains 0 devices 0 must be d1");
    assert.strictEqual(promotedC0.isLeftMostInChain, true, "MCP Case 5a: d1 must become isLeftMostInChain === true");
    assert.strictEqual(promotedC0.curNumBands, 3, "MCP Case 5a: Promoted d1 must join the 3-band Outer Rack chain");
    assert.strictEqual(promotedC0.effectiveMask, 1, "MCP Case 5a: Promoted d1 must take Band 1 (LOW, mask 1)");

    // 5b. Delete Chain 2 splitter (chains 2 devices 0) -> Outer Rack shrinks 3 -> 2 bands
    mcpCall(port, "ableton_delete_device", {
        path: "live_set tracks 0 devices 0 chains 2 devices 0"
    });
    const state5b = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
    assert.strictEqual(state5b.peerByPath["live_set tracks 0 devices 0 chains 0 devices 0"].curNumBands, 2, "MCP Case 5b: Deleting Chain 2 splitter must shrink Outer Rack from 3 -> 2 bands");
    assert.strictEqual(state5b.peerByPath["live_set tracks 0 devices 0 chains 1 devices 0"].effectiveMask, 2, "MCP Case 5b: Chain 1 must compact to HIGH (mask 2)");

    // 5c. Undo both deletions and wait for M4L v8ui initialization to re-register all 4 splitters
    mcpCall(port, "ableton_transport", { action: "undo" });
    mcpCall(port, "ableton_transport", { action: "undo" });
    let restoredState = null;
    for (let attempt = 0; attempt < 12; attempt++) {
        execFileSync(process.execPath, ["-e", "setTimeout(()=>{}, 350)"]);
        restoredState = normalizeMcpState(mcpCall(port, "ableton_inspect_mbsplit", {}));
        if (restoredState.lomDevices.length >= 4 && Object.keys(restoredState.peerByPath).length >= 4) {
            break;
        }
    }
    assert.ok(restoredState && restoredState.lomDevices.length >= 4, "MCP Case 5c: Undo must restore all 4 Multiband Split devices");
    assert.strictEqual(restoredState.peerByPath["live_set tracks 0 devices 0 chains 0 devices 0"].curNumBands, 3, "MCP Case 5c: Restored left-most Chain 0 splitter must be back in 3-band Outer Rack");
    assert.strictEqual(restoredState.peerByPath["live_set tracks 0 devices 0 chains 0 devices 1"].curNumBands, 1, "MCP Case 5c: Right-hand Chain 0 splitter must return to its own empty 1-band chain");

    console.log(`[MCP] All 5 Live Ableton MCP regression test cases passed on port ${port}!`);
}

if (process.env.MBSPLIT_SKIP_LIVE_MCP) {
    console.log("[MCP] MBSPLIT_SKIP_LIVE_MCP set; skipping live MCP suite.");
} else {
    runLiveMcpRegressionSuite();
}

console.log("All Multiband Split tests passed! (UI 2, 8192-FFT harmonics, auto 1..4 instance bands, -inf..+18dB volume slider, clickable link badge)");

require("./test_mbsplit_paint_bounds.js");
