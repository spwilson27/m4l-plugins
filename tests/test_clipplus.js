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
    for (let i = 0; i < C.CLIP_FIR_N; i++) worst = Math.max(worst, Math.abs(C.cpFirCoef(i) - G.cp_fir_coef(i)));
    assert.ok(worst < 1e-9, "cp_fir_coef matches");
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
    assert.ok(boxes.some((b) => String(b.text || "").indexOf("buffer~ #0-clipscope") === 0));
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
    const reset = boxes.find((b) => b.id === "obj-reset");
    assert.ok(meters && meters.hidden === 1 && reset && reset.hidden === 1, "meters start hidden");
    assert.ok(!overlaps(meters, reset), "meter canvas clears the Reset button");
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
    const menus = boxes.filter((b) => b.maxclass === "live.menu");
    assert.ok(menus.length >= 4, "Clip+ uses live.menu popup selection boxes");
    for (const m of menus) assert.deepStrictEqual(m.tricolor, [0, 0, 0, 0], `${m.id} hides its dropdown triangle via tricolor alpha 0`);
    const autoMenu = boxes.find((b) => b.id === "obj-ctrl-auto");
    assert.strictEqual(autoMenu.maxclass, "live.menu", "Auto is a live.menu popup selector");
    assert.deepStrictEqual(autoMenu.tricolor, [0, 0, 0, 0], "Auto live.menu hides the dropdown triangle via tricolor alpha 0");
    assert.deepStrictEqual(autoMenu.saved_attribute_attributes.valueof.parameter_enum, ["Man", "Auto"]);
    const viewMenu = boxes.find((b) => b.id === "obj-ctrl-view");
    assert.strictEqual(viewMenu.maxclass, "live.menu", "Meter View is a live.menu selection box");
    assert.deepStrictEqual(viewMenu.tricolor, [0, 0, 0, 0]);
    assert.ok(viewMenu.presentation_rect[0] >= 298, "Meter View selection box is in the right-hand Options panel");
    assert.ok(!boxes.some((b) => b.id === "obj-ctrl-midw"), "Mid Size control is removed");
    const vizBox = boxes.find((b) => b.id === "obj-viz");
    assert.strictEqual(vizBox.presentation_rect[2], 180, "Central display width is fixed to 180 px");
    const msMenu = boxes.find((b) => b.id === "obj-ctrl-msmode");
    assert.strictEqual(msMenu.maxclass, "live.menu", "Stereo Mode (L/R vs M/S) is a live.menu");
    assert.deepStrictEqual(msMenu.tricolor, [0, 0, 0, 0], "Stereo Mode hides the dropdown triangle");
    assert.deepStrictEqual(msMenu.saved_attribute_attributes.valueof.parameter_enum, ["L/R", "M/S"]);
    const chMenu = boxes.find((b) => b.id === "obj-ctrl-chmode");
    assert.strictEqual(chMenu.maxclass, "live.menu", "Channel Mode (Both / L / R) is a live.menu");
    assert.deepStrictEqual(chMenu.tricolor, [0, 0, 0, 0], "Channel Mode hides the dropdown triangle");
    assert.deepStrictEqual(chMenu.saved_attribute_attributes.valueof.parameter_enum, ["Both", "L", "R"]);
    assert.strictEqual(msMenu.presentation_rect[0], chMenu.presentation_rect[0], "Stereo Mode and Channel Mode sit on separate rows at the same x");
    assert.ok(chMenu.presentation_rect[1] >= msMenu.presentation_rect[1] + msMenu.presentation_rect[3], "Channel Mode row is below Stereo Mode row");
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
    run(meterCode, 128, 122, "meters");
    run(meterCode, 128, 122, "meters-preview", (face) => {
        face.preview();
    });
    run(meterCode, 128, 122, "meters-full", (face) => {
        const m = face.cpMeter;
        for (let i = 0; i < 80; i++) m.push(0.01, 0.008, 0.012, 0.009, 0.4, 0.3);
    });
    console.log("[paint] bounds");
}

console.log("test_clipplus: ok");
