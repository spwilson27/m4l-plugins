#!/usr/bin/env node
/**
 * Live end-to-end test for XO Sample Map, driven through the Ableton MCP Bridge
 * (`scripts/ableton_mcp_server.js`, `ableton_eval_lom_js`).
 *
 * Needs xo_test.als (audio track "XO Sample Map" + the bridge on Main). Live runs only in the tart VM
 * (AGENTS.md 1a): `scripts/vm_xo.sh live`, then `scripts/vm_xo.sh test` (tunnels the bridge port and passes
 * --ssh so rendered files can be inspected in the VM). Uses the device's test hook: `messnamed("#0-xo-test", ...)`
 * reaches the mini-map v8ui (`test_report`, `test_select`, `test_replay`, `test_wheel`, `test_click`, ...) and
 * `test_report` writes its state to Global("xo_test") as `last`. Checks:
 *   a  device loads, node.codebox indexes (map points arrive)
 *   b  every Saved / Filters / Playback (x Options) combination, in BOTH themes (LCD, Focus), matches computeXoLayout (rects,
 *      hidden, device width, map pane); the map pane is the same width in both themes; Options shows the Theme selector and the
 *      theme style (panel colours, button texts) is applied
 *   b2 theme mirrors: set a parameter through the LOM -> its live.dial / live.numbox mirror shows it; change it through the
 *      mirror -> the LOM parameter follows (both themes)
 *   c  a sample is selected and `selected_wave` arrives with n > 0 columns
 *   d  arrow-key actions (prev / next similar, history back / forward) each fire once and navigate correctly
 *   e  zoom / pan state through the v8ui handlers (synthetic arguments); raw arguments of real events if any
 *   f  Speed 50 % + Pitch +7 in every mode: rendered file exists, length = input / 0.5, track meter > 0 while auditioning
 *   g  Pitch +12 at Speed 100 % renders (not plain repitch) with unchanged length
 *
 *   node scripts/test_xo_live.js [--port 19879] [--ssh admin@192.168.64.4] [--variant C]
 *   (--variant picks src/xo_layouts/<V>.js; the set must hold devices/XO Sample Map <V>.amxd: scripts/vm_xo.sh run C)
 */

const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const VARIANT = arg("--variant", "default");  // layout variant under test: src/xo_layouts/<VARIANT>.js (default, A..E)
const layoutModule = require(`../src/xo_layouts/${VARIANT}.js`);
const { XO_MAP_PANE_W } = layoutModule;
// The default device is themed (LCD / Focus, plus an Options section); the variant devices keep 3 section toggles.
const THEMED = Array.isArray(layoutModule.XO_THEMES);
const THEMES = THEMED ? layoutModule.XO_THEMES : [null];
const computeXoLayout = (theme, s, f, p, o) => (THEMED ? layoutModule.computeXoLayout(theme, s, f, p, o) : layoutModule.computeXoLayout(s, f, p));
const PORT = arg("--port", null);
const SSH = arg("--ssh", null);

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const hook = (...m) => evalLom(`messnamed("#0-xo-test", ${m.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function report() {
    const r = evalLom('var g = new Global("xo_test"); g.last = ""; messnamed("#0-xo-test", "test_report"); return String(g.last || "");');
    return r ? JSON.parse(r) : null;
}
function waitFor(label, fn, ms = 20000, step = 250) {
    const t0 = Date.now();
    for (;;) {
        const v = fn();
        if (v) return v;
        if (Date.now() - t0 > ms) return null;
        sleep(step);
    }
}

let failures = 0;
function check(ok, msg) {
    console.log((ok ? "PASS " : "FAIL ") + msg);
    if (!ok) failures++;
    return ok;
}
function finish() {
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- find the device and its parameters ----
const dev = evalLom(`
    var n = new LiveAPI("live_set").getcount("tracks");
    for (var t = 0; t < n; t++) {
        var nd = new LiveAPI("live_set tracks " + t).getcount("devices");
        for (var d = 0; d < nd; d++) {
            var dv = new LiveAPI("live_set tracks " + t + " devices " + d);
            if (/XO Sample Map/.test(String(dv.get("name")))) {
                var params = {};
                var np = dv.getcount("parameters");
                for (var p = 0; p < np; p++) {
                    var pa = new LiveAPI("live_set tracks " + t + " devices " + d + " parameters " + p);
                    params[String(pa.get("name"))] = { idx: p, min: Number(pa.get("min")), max: Number(pa.get("max")), value: Number(pa.get("value")) };
                }
                return { track: t, device: d, cls: String(dv.get("class_name")), params: params };
            }
        }
    }
    return null;
`);
if (!check(!!dev, "XO Sample Map device found" + (dev ? ` (track ${dev.track}, ${dev.cls}, ${Object.keys(dev.params).length} parameters)` : ""))) finish();
const P = dev.params;
// Sets a parameter by the value it DISPLAYS (str_for_value). LOM `value` is pre-exponent for dials with
// parameter_exponent (Speed: value 50 shows "20.2 %"), so a monotonic search finds the raw value; enums are raw.
const setParam = (name, v) => {
    if (!P[name]) throw new Error(`no parameter ${name}; have ${Object.keys(P).join(", ")}`);
    evalLom(`var p = new LiveAPI("live_set tracks ${dev.track} devices ${dev.device} parameters ${P[name].idx}");
        var target = ${Number(v)}, lo = Number(p.get("min")), hi = Number(p.get("max"));
        var shown = function (x) { var m = /-?[0-9.]+/.exec(String(p.call("str_for_value", x))); return m ? Number(m[0]) : NaN; };
        var raw = target;
        if (Number(p.get("is_quantized")) !== 1 && isFinite(shown(lo)) && isFinite(shown(hi))) {
            var up = shown(hi) >= shown(lo);
            for (var i = 0; i < 50; i++) { var mid = (lo + hi) / 2; if ((shown(mid) < target) === up) lo = mid; else hi = mid; }
            raw = hi; // first value that displays >= target (an Int dial rounds a mid-bucket value down)
        }
        p.set("value", raw); return 1;`);
};
const meter = () => Number(evalLom(`return new LiveAPI("live_set tracks ${dev.track}").get("output_meter_left");`));
const initial = {};
for (const k of ["MaxLen", "Tone", "Tonal", "Drums", "Pitch", "Speed", "Grain", "Trim/Dec", "Mode", "Gain"]) initial[k] = P[k] ? P[k].value : null;
const setRaw = (name, v) => evalLom(`new LiveAPI("live_set tracks ${dev.track} devices ${dev.device} parameters ${P[name].idx}").set("value", ${Number(v)}); return 1;`);

function restore() {
    try { for (const k of Object.keys(initial)) if (initial[k] !== null) setRaw(k, initial[k]); } catch (e) { console.log("restore failed: " + e.message); }
}

try {
    // ---- a. loads, node indexes ----
    const rep0 = report();
    if (!check(!!rep0, "a. v8ui test hook answers (device loaded, xo-test hook present)")) { finish(); }
    const t0 = Date.now();
    let rep = waitFor("points", () => { const r = report(); return r && r.nPoints > 0 ? r : null; }, 120000, 1000);
    check(!!rep, `a. node.codebox started and indexed: ${rep ? rep.nPoints + " map points after " + (Date.now() - t0) + " ms" : "no map points within 120 s (node did not start or no samples indexed)"}`);
    if (!rep) finish();

    // ---- c. select a sample ----
    hook("test_clear_log");
    hook("test_select", Math.min(5, rep.nPoints - 1));
    rep = waitFor("wave", () => { const r = report(); return r && r.waveN > 0 ? r : null; }, 15000);
    check(!!rep, `c. sample selected, selected_wave arrived: ${rep ? `"${rep.name}" idx ${rep.selectedIndex}, ${rep.waveN} columns, ${rep.durMs} ms` : "no selected_wave (n > 0) within 15 s"}`);
    if (!rep) finish();
    const srcMs = rep.durMs;

    // ---- b. section toggles x themes ----
    {
        let bad = [];
        const THEME_STYLE_PANEL = { LCD: [0.165, 0.110, 0.030, 1.0], Focus: [0.105, 0.120, 0.140, 1.0] };
        const widths = {};
        for (const theme of THEMES) {
            if (THEMED) hook("test_theme", theme);
            for (let combo = 0; combo < (THEMED ? 16 : 8); combo++) {
                const s = (combo >> 0) & 1, f = (combo >> 1) & 1, p = (combo >> 2) & 1, o = THEMED ? (combo >> 3) & 1 : 0;
                hook("test_section", "saved", s); hook("test_section", "filters", f); hook("test_section", "playback", p);
                if (THEMED) hook("test_section", "options", o);
                const exp = computeXoLayout(theme, s, f, p, o);
                const same = (x) => x && x.sections.join() === [s, f, p].join() && x.width === exp.deviceWidth && (!THEMED || (x.options === o && x.theme === theme));
                const r = waitFor("layout", () => { const x = report(); return same(x) ? x : null; }, 5000, 200) || report();
                const errs = [];
                if (r.sections.join() !== [s, f, p].join()) errs.push(`sections ${r.sections}`);
                if (THEMED && (r.options !== o || r.theme !== theme)) errs.push(`options ${r.options} theme ${r.theme}`);
                if (r.width !== exp.deviceWidth) errs.push(`device width ${r.width}, expected ${exp.deviceWidth}`);
                if (r.mapW !== XO_MAP_PANE_W) errs.push(`map pane ${r.mapW}, expected ${XO_MAP_PANE_W}`);
                for (const [id, spec] of Object.entries(exp.boxes)) {
                    const b = r.boxes[id];
                    if (!b) { errs.push(`${id} not found`); continue; }
                    if (b.hidden !== spec.hidden) errs.push(`${id} hidden ${b.hidden}, expected ${spec.hidden}`);
                    if (!b.rect || b.rect.some((v, i) => !near(v, spec.rect[i], 0.01))) errs.push(`${id} rect ${JSON.stringify(b.rect)}, expected ${JSON.stringify(spec.rect)}`);
                }
                if (THEMED) {
                    // the Options section shows the Theme selector; the theme's style was applied with setattr
                    if (o && r.boxes["obj-theme-tab"].hidden !== 0) errs.push("Options open but the Theme selector is hidden");
                    const pc = r.styled["obj-panel-filters"] && r.styled["obj-panel-filters"].bgcolor;
                    if (!pc || pc.some((v, i) => !near(v, THEME_STYLE_PANEL[theme][i], 0.01))) errs.push(`Filters panel colour ${JSON.stringify(pc)}, expected ${JSON.stringify(THEME_STYLE_PANEL[theme])}`);
                    const rs = r.styled["obj-reseed-filtered-btn"];
                    if (!rs || rs.text !== (theme === "LCD" ? "RESEED" : "Re-Seed")) errs.push(`Re-Seed button text ${rs && rs.text}`);
                    widths[`${theme}/${s}`] = r.boxes["obj-minimap"].rect[2];
                }
                if (errs.length) bad.push(`${theme || "-"} S${s}F${f}P${p}O${o}: ${errs.slice(0, 4).join("; ")}${errs.length > 4 ? ` (+${errs.length - 4})` : ""}`);
                else console.log(`  ${theme || "-"} S${s}F${f}P${p}O${o}: width ${r.width}, mapW ${r.mapW}, ${Object.keys(exp.boxes).length} boxes ok`);
            }
        }
        check(bad.length === 0, `b. all ${THEMED ? "2 themes x 16" : "8"} section combinations match computeXoLayout (rects, hidden, device width, map pane${THEMED ? ", Theme selector, theme style" : ""})` + (bad.length ? "\n   " + bad.join("\n   ") : ""));
        if (THEMED) check(widths["LCD/0"] === widths["Focus/0"] && widths["LCD/1"] === widths["Focus/1"], `b. the map pane has the same width in both themes (${JSON.stringify(widths)})`);
        hook("test_section", "saved", 1); hook("test_section", "filters", 1); hook("test_section", "playback", 1);
        if (THEMED) { hook("test_section", "options", 0); hook("test_theme", "LCD"); }
        sleep(500);
    }

    // ---- b2. mirrors: hidden twin parameters, LOM parameter <-> mirror, both themes ----
    if (THEMED) {
        // LOM name -> mirror box id. The mirror is a hidden parameter (invisible 2, not in the LOM), so what it DISPLAYS is
        // fixed by the attributes Max applied (range, unit style, exponent, enum, steps) and its value: both are compared
        // with the source parameter object's, and the source's display string (str_for_value) is read from the LOM.
        const MIR = { MaxLen: "obj-maxlen-dial-mir", Tone: "obj-tone-dial-mir", Tonal: "obj-filter-tonal-dial-mir", Drums: "obj-filter-drum-dial-mir",
            Pitch: "obj-pitch-dial-mir", Speed: "obj-speed-dial-mir", Grain: "obj-grain-dial-mir", "Trim/Dec": "obj-decay-dial-mir",
            Mode: "obj-stretch-mode-mir", Gain: "obj-gain-dial-mir" };
        const lom = (name, what) => evalLom(`return new LiveAPI("live_set tracks ${dev.track} devices ${dev.device} parameters ${P[name].idx}").get("${what}");`);
        const lomValue = (name) => Number(lom(name, "value"));
        const lomStr = (name, v) => String(evalLom(`return new LiveAPI("live_set tracks ${dev.track} devices ${dev.device} parameters ${P[name].idx}").call("str_for_value", ${Number(v)});`));
        const rep = () => report() || { mirrors: {}, sources: {}, mirrorAttrs: {} };
        const bad = [];
        const table = [];
        const attrsOk = rep();
        for (const name of Object.keys(MIR)) {
            const a = Object.assign({}, attrsOk.mirrorAttrs[MIR[name]]), b = Object.assign({}, attrsOk.mirrorAttrs[MIR[name].replace(/-mir$/, "")]);
            if (a._parameter_longname !== b._parameter_longname.replace(/"$/, 'View"')) bad.push(`${name}: mirror long name ${a._parameter_longname}`);
            delete a._parameter_longname; delete b._parameter_longname;
            if (!a || !b || JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${name}: mirror attributes ${JSON.stringify(a)} differ from the parameter's ${JSON.stringify(b)}`);
            else if (a._parameter_range === "null" || a._parameter_range === undefined) bad.push(`${name}: mirror has no parameter range (not a real parameter?)`);
        }
        for (const theme of THEMES) {
            hook("test_theme", theme);
            sleep(400);
            for (const name of Object.keys(MIR)) {
                if (!P[name]) { bad.push(`${theme} ${name}: no LOM parameter`); continue; }
                const { min, max } = P[name];
                // A dimmed (inactive) Grain neither outputs nor takes `set` (Cmplx ignores it): test it in Grain mode, then check
                // that the transition to Cmplx brings the mirror up to the parameter's value.
                if (name === "Grain") setRaw("Mode", 0);
                const pts = P[name].max - P[name].min <= 3 ? [min, (min + max) / 2, max] : [min, min + (max - min) * 0.25, min + (max - min) * 0.5, max];
                for (const v1 of pts) {
                    // LOM -> parameter object -> prepend set -> mirror: same value, therefore the same display text
                    setRaw(name, v1);
                    const m1 = waitFor("mirror", () => { const r = rep(); return r.mirrors[MIR[name]] !== undefined && r.mirrors[MIR[name]] === r.sources[MIR[name]] && r.sources[MIR[name]] !== null ? r : null; }, 5000, 200);
                    const r1 = m1 || rep();
                    const shown = lomStr(name, lomValue(name));
                    table.push(`${theme} ${name} LOM ${lomValue(name)} shows "${shown}": source ${r1.sources[MIR[name]]}, mirror ${r1.mirrors[MIR[name]]}`);
                    if (m1 === null) bad.push(`${theme} ${name}: LOM set ${v1}, source object ${r1.sources[MIR[name]]} but mirror ${r1.mirrors[MIR[name]]}`);
                }
                if (name === "Grain") {
                    setRaw("Grain", P.Grain.min + (P.Grain.max - P.Grain.min) * 0.75);
                    sleep(300);
                    setRaw("Mode", 1);
                    const tr = waitFor("dimmed", () => { const r = rep(); return r.mirrors[MIR.Grain] === r.sources[MIR.Grain] ? r : null; }, 5000, 200);
                    if (tr === null) bad.push(`${theme} Grain: after Cmplx dims it the mirror shows ${rep().mirrors[MIR.Grain]}, source ${rep().sources[MIR.Grain]}`);
                    setRaw("Mode", 0);
                    sleep(300);
                }
                // mirror (as a user drag, with the source's own value at another point) -> parameter object -> LOM, same display
                setRaw(name, pts[1]);
                const want = lomValue(name), wantStr = lomStr(name, want);
                const src = waitFor("src", () => { const r = rep(); return r.sources[MIR[name]] === r.mirrors[MIR[name]] ? r : null; }, 5000, 200) || rep();
                const dragV = src.sources[MIR[name]];
                setRaw(name, pts[0]);
                sleep(300);
                hook("test_mirror", MIR[name], dragV);
                const l2 = waitFor("lom", () => (near(lomValue(name), want, 1e-6 + Math.abs(want) * 1e-4) ? { ok: 1 } : null), 5000, 200);
                if (l2 === null) bad.push(`${theme} ${name}: mirror set ${dragV}, LOM parameter is ${lomValue(name)} (expected ${want})`);
                else if (lomStr(name, lomValue(name)) !== wantStr) bad.push(`${theme} ${name}: display "${lomStr(name, lomValue(name))}" != "${wantStr}"`);
                // no feedback loop: nothing drifts after the mirror write
                sleep(300);
                const after = rep();
                if (after.mirrors[MIR[name]] !== after.sources[MIR[name]] || !near(lomValue(name), want, 1e-6 + Math.abs(want) * 1e-4)) bad.push(`${theme} ${name}: unstable after the mirror write (mirror ${after.mirrors[MIR[name]]}, source ${after.sources[MIR[name]]}, LOM ${lomValue(name)})`);
            }
        }
        for (const line of table) console.log("  " + line);
        check(bad.length === 0, "b2. hidden twin parameters: same attributes (range / unit / exponent / enum) as the sources, same value and display, in sync both ways without a feedback loop, 10 controls x 2 themes" + (bad.length ? "\n   " + bad.join("\n   ") : ""));
        hook("test_theme", "LCD");
        restore();
        sleep(300);
    }

    // ---- d. arrow-key actions ----
    {
        hook("test_select", Math.min(5, rep.nPoints - 1));
        sleep(800);
        const cur = () => report();
        const step = (name) => {
            const before = cur();
            hook("test_clear_log");
            hook(name);
            sleep(900);
            const after = cur();
            return { before: before.selectedIndex, after: after.selectedIndex, fired: after.selLog.length, log: after.selLog.map((l) => l.idx) };
        };
        const s0 = cur().selectedIndex;
        const n1 = step("hotkey_next_similar");
        const n2 = step("hotkey_next_similar");
        const b1 = step("hotkey_history_back");
        const b2 = step("hotkey_history_back");
        const f1 = step("hotkey_history_forward");
        const f2 = step("hotkey_history_forward");
        const p1 = step("hotkey_prev_similar");
        console.log(`  S0=${s0}; next ${n1.after}, next ${n2.after}, back ${b1.after}, back ${b2.after}, forward ${f1.after}, forward ${f2.after}, prev ${p1.after}; selected_info counts ${[n1, n2, b1, b2, f1, f2, p1].map((x) => x.fired)}`);
        check([n1, n2, b1, b2, f1, f2, p1].every((x) => x.fired === 1), "d. every arrow action fires exactly one selection");
        check(n1.after !== s0 && n2.after !== n1.after, `d. Next Similar moves to a different sound each time (${s0} -> ${n1.after} -> ${n2.after})`);
        check(b1.after === n1.after && b2.after === s0, `d. history back returns to the previous sounds (${n2.after} -> ${b1.after} -> ${b2.after}; expected ${n1.after}, ${s0})`);
        check(f1.after === n1.after && f2.after === n2.after, `d. history forward returns to the next sounds (${f1.after}, ${f2.after}; expected ${n1.after}, ${n2.after})`);
        check(p1.fired === 1 && p1.after !== n2.after, `d. Prev Similar moves (${n2.after} -> ${p1.after})`);
    }

    // ---- e. zoom / pan ----
    {
        hook("test_select", Math.min(5, rep.nPoints - 1));
        sleep(500);
        const r0 = report();
        const z0 = r0.view.zoom;
        hook("test_wheel", 110, 70, 0, 1);
        const r1 = report();
        hook("test_click", 110, 70, 0, 1); // Option-drag pans (middle-button pans too, but can't be synthesised)
        hook("test_drag", 150, 90, 1);
        hook("test_release", 150, 90);
        const r2 = report();
        hook("test_wheel", 110, 70, 0, -3);
        hook("test_wheel", 110, 70, 0, -3);
        const r3 = report();
        console.log(`  zoom ${z0} -> ${r1.view.zoom.toFixed(3)} (wheel) ; after drag x0 ${r1.view.x0.toFixed(3)} -> ${r2.view.x0.toFixed(3)}, y0 ${r1.view.y0.toFixed(3)} -> ${r2.view.y0.toFixed(3)} ; zoom out -> ${r3.view.zoom.toFixed(3)}`);
        check(z0 === 1 && r1.view.zoom > 1.2, "e. wheel up zooms the map in (onwheel with synthetic (x, y, dx, dy))");
        check(r2.view.zoom === r1.view.zoom && (r2.view.x0 !== r1.view.x0 || r2.view.y0 !== r1.view.y0), "e. Option-dragging the zoomed map pans it (view window moved)");
        check(r3.view.zoom === 1 && r3.view.x0 === 0, "e. wheel down zooms back out to 1x and resets the window");
        const real = report();
        console.log("  real event args seen by Max: " + (Object.keys(real.rawCount).length ? JSON.stringify(real.raw) + " counts " + JSON.stringify(real.rawCount) : "none (no real mouse event could be produced in the VM; arguments of real onwheel/onclick/ondrag stay unverified)"));
    }

    // ---- f / g. stretch renders ----
    const fileInfo = (file) => {
        if (!SSH) return null;
        const q = JSON.stringify(file);
        const out = execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", SSH,
            `stat -f %z ${q} && xxd -s 24 -l 4 -e ${q} | head -1`], { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) });
        const lines = out.trim().split("\n");
        const size = Number(lines[0]);
        const sr = parseInt((lines[1].split(/\s+/)[1] || "0"), 16);
        return { size, sr, frames: (size - 44) / 4 };
    };
    // Lengths are checked against the source file's real duration (afinfo in the VM); the index's durMs must match it too.
    const sourceMs = (file) => {
        if (!SSH) return null;
        const out = execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", SSH, `afinfo ${JSON.stringify(file)} | grep "estimated duration"`],
            { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) });
        const m = /([0-9.]+) sec/.exec(out);
        return m ? Number(m[1]) * 1000 : null;
    };
    const modes = ["Grain", "Cmplx", "Textr"];
    function audition(mode, speed, pitch) {
        setParam("Mode", mode); setParam("Speed", speed); setParam("Pitch", pitch);
        sleep(400);
        hook("test_clear_log");
        hook("test_replay");
        let maxMeter = 0;
        let r = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 60000) {
            maxMeter = Math.max(maxMeter, meter());
            const x = report();
            if (x && x.audition && x.audition.mode === mode && near(x.audition.speedPct, speed, 0.6) && near(x.audition.pitchSt, pitch, 0.05)) { r = x; break; }
        }
        const tRender = Date.now() - t0;
        if (!r) { const x = report(); console.log(`  (no match for mode ${mode} speed ${speed} pitch ${pitch}; last audition ${JSON.stringify(x && x.audition)})`); }
        const t1 = Date.now();
        while (Date.now() - t1 < 1500) maxMeter = Math.max(maxMeter, meter());
        return { r, maxMeter, tRender };
    }
    setRaw("Trim/Dec", P["Trim/Dec"].max);
    sleep(300);
    // A plain audition (Speed 100, Pitch 0) plays the source file itself, which gives its path.
    const plain0 = audition(1, 100, 0).r;
    const realSrcMs = plain0 ? sourceMs(plain0.audition.file) : null;
    console.log(`  source ${plain0 ? plain0.audition.file.split("/").pop() : "?"}: real ${realSrcMs === null ? "?" : realSrcMs.toFixed(0)} ms, index durMs ${plain0 ? plain0.durMs : "?"}`);
    if (realSrcMs !== null && plain0) check(near(plain0.durMs, realSrcMs, 1.5), `f0. index durMs ${plain0.durMs} matches the file's real duration ${realSrcMs.toFixed(1)} ms`);
    for (let mode = 0; mode < 3; mode++) {
        const { r, maxMeter, tRender } = audition(mode, 50, 7);
        if (!check(!!r, `f. ${modes[mode]}: Speed 50 % + Pitch +7 audition reported`)) continue;
        const a = r.audition;
        const fi = fileInfo(a.file);
        const lenMs = fi ? fi.frames / fi.sr * 1000 : a.ms;
        const exp = (realSrcMs || r.durMs) / 0.5;
        console.log(`  ${modes[mode]}: engine ${a.engine}, rendered ${a.rendered}, ${a.frames} frames, file ${fi ? fi.size + " B, " + fi.sr + " Hz, " + lenMs.toFixed(0) + " ms" : "(not inspected: no --ssh)"}, source ${r.durMs} ms, render+report ${tRender} ms, meter max ${maxMeter.toFixed(3)}`);
        check(a.rendered === 1 && a.file.endsWith(".wav") && (!fi || fi.size > 1000), `f. ${modes[mode]}: rendered file exists (${a.file})`);
        check(near(lenMs, exp, Math.max(15, exp * 0.03)), `f. ${modes[mode]}: length ${lenMs.toFixed(0)} ms = input/0.5 = ${exp.toFixed(0)} ms (Pitch +7 does not change it)`);
        check(near(a.ms, lenMs, 3), `f. ${modes[mode]}: scan duration ${a.ms} ms matches the rendered length`);
        check(maxMeter > 0, `f. ${modes[mode]}: track output meter > 0 while auditioning (${maxMeter.toFixed(4)})`);
    }
    for (let mode = 0; mode < 3; mode++) {
        const { r } = audition(mode, 100, 12);
        if (!check(!!r, `g. ${modes[mode]}: Pitch +12 at Speed 100 % audition reported`)) continue;
        const a = r.audition;
        const fi = fileInfo(a.file);
        const lenMs = fi ? fi.frames / fi.sr * 1000 : a.ms;
        check(a.rendered === 1 && a.engine !== "plain" && a.engine !== "repitch", `g. ${modes[mode]}: +12 st at Speed 100 % is rendered by ${a.engine}, not plain repitch`);
        const srcMs = realSrcMs || r.durMs;
        check(near(lenMs, srcMs, Math.max(15, srcMs * 0.03)), `g. ${modes[mode]}: length ${lenMs.toFixed(0)} ms unchanged (source ${srcMs.toFixed(0)} ms, index says ${r.durMs} ms)`);
    }
    {
        const { r } = audition(1, 100, 0);
        check(!!r && r.audition.rendered === 0, "g. Speed 100 % + Pitch 0 (Cmplx) stays on plain sfplay~ (not rendered)");
    }
} catch (e) {
    check(false, "test error: " + (e && e.stack || e));
} finally {
    restore();
}
finish();
