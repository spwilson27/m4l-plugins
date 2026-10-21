#!/usr/bin/env node
/**
 * Mega Modulator parameter faces in REAL Ableton Live (AGENTS.md 1a: the VM only; section 21: "Parameter faces").
 *
 *   scripts/vm_live_lock.sh megamod-faces -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh faces'
 *
 * Through the bridge (`--port`, LOM + `receive megamod-test`) and real OS mouse events in the VM (`--ssh`, scripts/mm_os_input.py):
 *   1. add two LFO strips with real clicks (also finds the v8ui on screen)
 *   2. `test_faces`: the faces exist, are unhidden at the drawn controls' rects (v8ui origin + control rect), all others hidden, and
 *      hiding them did not remove any parameter from Live's list (257 parameters)
 *   3. a real LEFT DRAG on the Rate face of strip 1 changes the LOM parameter `M1 A` and the model (modulator rate)
 *   4. double-click on the face (reset)
 *   5. a real RIGHT CLICK on the face: look for Live's context menu (System Events menu items); needs a manual check when none is found
 *   6. opening the type popup hides every face; closing it brings them back
 *   7. expand the LFO strip: the Phase face exists at the Phase knob (a 27 x 28 live.dial centred on it), every knob / chip has its face;
 *      a real drag on the Phase face changes the LOM parameter `M1 D`; a real click on the SYNC face flips `M1 Sync` and the model; a real
 *      click on a shape cell sets `M1 Shape`; a real right click on the Phase face opens the native menu window
 * Exit status is non-zero when a check fails.
 */
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg("--port", 0)) || null;
const VM_DIR = arg("--vm-dir", "Software/ableton-mmnames");
const PROC = arg("--process", "Live");
let SSH_TARGET = arg("--ssh", "");
if (!SSH_TARGET) {
    let ip = "";
    for (const a of [["ip", "macos-1"], ["ip", "--resolver=arp", "macos-1"]]) {
        try { ip = execFileSync("tart", a, { encoding: "utf8" }).trim(); } catch (e) { /* next form */ }
        if (ip) break;
    }
    SSH_TARGET = "admin@" + (ip || "192.168.64.4");
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    for (let attempt = 0; ; attempt++) {
        let txt;
        try { txt = execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26 }); } catch (e) { txt = String(e.stdout || ""); }
        let out = null;
        try { out = JSON.parse(txt); } catch (e) { /* retry */ }
        if (out && !out.error) return out.result;
        if (attempt >= 3 || (out && !/timed out/.test(out.error))) throw new Error(out ? out.error : "no answer from the bridge");
        sleep(2000); // Live was busy (a popup opening, a repaint): try again
    }
}
function os(...a) {
    const cmd = `cd ${VM_DIR} && /usr/bin/python3 scripts/mm_os_input.py ${a.join(" ")}`;
    return execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", SSH_TARGET, cmd],
        { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) }).trim();
}
let failed = 0;
function check(name, ok, detail) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : "")); }
const info = (s) => console.log("INFO " + s);
const near = (a, b, t) => Math.abs(a - b) <= t;

const found = evalLom(`
    var out = [];
    var set = new LiveAPI("live_set");
    for (var t = 0; t < set.getcount("tracks"); t++) {
        var tp = "live_set tracks " + t;
        var tr = new LiveAPI(tp);
        for (var i = 0; i < tr.getcount("devices"); i++) {
            var d = new LiveAPI(tp + " devices " + i);
            if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), path: tp + " devices " + i, track: t, trackName: String(tr.get("name")) });
        }
    }
    return out;
`);
if (!found.length) { console.error("No Mega Modulator in the set. Run scripts/vm_megamod_keys.sh live first."); process.exit(1); }
const dev = found.find((d) => d.trackName === "Mega Mod Keys") || found[0];
info(`device ${dev.id} at ${dev.path}`);

const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function globalJson(prop, hookName) {
    const raw = evalLom(`
        var g = new Global("megamod_test");
        g[${JSON.stringify(prop + "_" + dev.id)}] = "";
        messnamed("megamod-test", ${JSON.stringify(hookName)});
        var r = g[${JSON.stringify(prop + "_" + dev.id)}];
        return r ? String(r) : "";
    `);
    return raw ? JSON.parse(raw) : null;
}
const report = () => globalJson("report", "test_report");
const faces = () => { sleep(500); return globalJson("faces", "test_faces"); };
function param(name) {
    return evalLom(`
        var d = new LiveAPI(${JSON.stringify(dev.path)});
        var n = d.getcount("parameters");
        for (var i = 0; i < n; i++) {
            var p = new LiveAPI(${JSON.stringify(dev.path)} + " parameters " + i);
            if (String(p.get("name")) === ${JSON.stringify(name)}) return { value: Number(p.get("value")), str: String(p.call("str_for_value", Number(p.get("value")))), count: n };
        }
        return null;
    `);
}

function diag() {
    try {
        const ps = execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", SSH_TARGET, "ps -axo pid,stat,etime,command | grep -i 'MacOS/Live\\|MacOS/Max' | grep -v grep; ls -t ~/Library/Logs/DiagnosticReports 2>/dev/null | head -3"], { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) });
        info("VM processes / newest crash reports:\n" + ps);
    } catch (e) { info("diag failed: " + e.message.split("\n")[0]); }
}
function showDevice() {
    // A device is only painted once its track is shown in the Detail view: selecting the master track and then the device's track
    // again (plus focus_view) is what made the v8ui paint in the VM (select_device alone left it unpainted: `paints 0`).
    evalLom(`
        var v = new LiveAPI("live_set view");
        var a = new LiveAPI("live_app view");
        a.call("hide_view", "Browser"); // the browser sidebar would push the device chain to the right
        a.call("show_view", "Detail");
        a.call("show_view", "Detail/DeviceChain");
        v.set("selected_track", "id", Number(new LiveAPI("live_set master_track").id));
        return 1;
    `);
    sleep(1200);
    evalLom(`
        var v = new LiveAPI("live_set view");
        var a = new LiveAPI("live_app view");
        v.set("selected_track", "id", Number(new LiveAPI(${JSON.stringify("live_set tracks " + dev.track)}).id));
        v.call("select_device", "id", ${Number(dev.id)});
        a.call("show_view", "Detail/DeviceChain");
        a.call("focus_view", "Detail/DeviceChain");
        return 1;
    `);
    sleep(1500);
}
let origin = null;
const click = (lx, ly, dbl) => os("click", Math.round(origin.x + lx), Math.round(origin.y + ly), dbl ? "double" : "");
// v8ui geometry (src/megamod_ui.js): rail 20 + gap 2, strips 56 wide + 2 gap, `+` 26 wide (92 when empty), type popup 94 wide at y 22
const plusCenter = (n) => (n === 0 ? [68, 80] : [35 + 58 * n, 80]);
const popupItem = (n, k) => { const right = n === 0 ? 114 : 48 + 58 * n; return [right - 50, 22 + 2 + 17 * k + 8]; };
function tryAdd(o, n, k) {
    origin = o;
    const p = plusCenter(n);
    click(p[0], p[1]);
    sleep(300);
    const it = popupItem(n, k);
    click(it[0], it[1]);
    sleep(400);
    const r = report();
    return !!r && r.mods.filter((m) => m).length === n + 1;
}
// Where is the v8ui on screen? The v8ui reports the pointer over it (`ubHover`, `hover` in test_report), so move the pointer over a
// grid of screen points until a point is inside it; origin = screen point - reported local point (exact, no clicks).
const hoverOf = () => { const r = report(); return r && r.hover ? r.hover : null; };
function calibrate(w) {
    for (let sy = w.y + w.h - 30; sy > w.y + 240; sy -= 40) {
        for (let sx = w.x + 14; sx < w.x + 700; sx += 40) {
            os("move", Math.round(sx), Math.round(sy), 0.25);
            const h = hoverOf();
            if (process.env.MM_DEBUG) console.log(`  move (${Math.round(sx)},${Math.round(sy)}) -> hover ${JSON.stringify(h)}`);
            if (h) {
                os("move", Math.round(sx) + 1, Math.round(sy) + 1, 0.3); // a second point: the first report may be a frame old
                const h2 = hoverOf();
                if (h2) return { x: Math.round(sx) + 1 - h2[0], y: Math.round(sy) + 1 - h2[1] };
            }
        }
    }
    return null;
}
function addModulator(n, k, guess) {
    origin = guess;
    const p = plusCenter(n);
    click(p[0], p[1]);
    sleep(400);
    const it = popupItem(n, k);
    click(it[0], it[1]);
    sleep(500);
    const r = report();
    return r && r.mods.filter((m) => m).length === n + 1 ? guess : null;
}

// Collapsed strip j (x = 22 + 58 j, 56 px wide): the power face, and a 27 x 28 live.dial centred on each of the two knobs (Rate / Depth)
function collapsedFaces(j, x) {
    const exp = {};
    exp["ap_" + (j * 6 + 5)] = [x, 0, 17, 17]; // enable glyph  (M<j+1> On)
    exp["ap_" + (j * 6 + 0)] = [x + 1, 88, 27, 28]; // Rate  (M<j+1> A)
    exp["ap_" + (j * 6 + 2)] = [x + 28, 88, 27, 28]; // Depth (M<j+1> C)
    return exp;
}
function expectedFaces(strips) {
    const exp = {};
    for (let j = 0; j < strips; j++) Object.assign(exp, collapsedFaces(j, 22 + 58 * j));
    return exp;
}
// strip 0 (LFO, free-running) expanded to 204 px: three knobs (Rate / Depth / Phase) at a 46 px pitch, the shape tab over the five shape
// chips and the SYNC / BIP / RTG chips; strips 1 and 2 stay collapsed, shifted right by 148
function expandedFaces() {
    const exp = {};
    exp["ap_5"] = [22, 0, 17, 17];
    exp["ap_0"] = [36, 95, 27, 28]; // Rate  (M1 A)
    exp["ap_2"] = [82, 95, 27, 28]; // Depth (M1 C)
    exp["ap_3"] = [128, 95, 27, 28]; // Phase (M1 D)
    exp["at_0"] = [26, 82, 92, 12]; // shape tab (M1 Shape)
    exp["at_1"] = [121, 82, 30, 12]; // SYNC (M1 Sync)
    exp["at_2"] = [154, 82, 28, 12]; // BIP  (M1 Bipolar)
    exp["at_3"] = [185, 82, 28, 12]; // RTG  (M1 Retrig)
    Object.assign(exp, collapsedFaces(1, 22 + 204 + 2), collapsedFaces(2, 22 + 204 + 2 + 58));
    return exp;
}
function checkFaces(f, strips, label, exp0) {
    const exp = exp0 || expectedFaces(strips);
    const shown = Object.keys(f.shown).sort();
    check(`${label}: exactly the expected ${Object.keys(exp).length} faces are shown`, JSON.stringify(shown) === JSON.stringify(Object.keys(exp).sort()), shown.join(","));
    for (const [k, r0] of Object.entries(exp)) {
        const real = f.real[k];
        const want = r0.map((v, i) => v + (i < 2 ? 4 : 0));
        const ok = real && real.rect && real.hidden === 0 && real.rect.every((v, i) => near(v, want[i], 0.05));
        check(`${label}: ${k} is unhidden at the control's rect in Live`, !!ok, real ? `${real.cls} rect ${JSON.stringify(real.rect)} hidden ${real.hidden}, expected ${JSON.stringify(want)}` : "missing");
    }
    check(`${label}: all other pool objects are hidden`, f.hiddenCount === 256 - shown.length, `hidden ${f.hiddenCount} of 256`);
}

function gv(prop, call) { return evalLom(`var g = new Global("megamod_test"); g.${prop} = ""; ${call} return String(g.${prop});`); }
// Why did the drag reach the v8ui? (z-order, transparency) - each variant: select strip 1 through the hook, drag the Rate face of strip 0,
// read ui.sel: 0 = the v8ui took the drag, 1 = the face did.
function experiments() {
    const c0 = [origin.x + 22 + 14.5, origin.y + 88 + 14];
    const trial = (label) => {
        hook("test_selui", 1); sleep(300);
        const b = param("M1 A").value;
        os("drag", c0[0], c0[1], 0, -20);
        sleep(600);
        const a = param("M1 A").value;
        const sel = report().ui.sel;
        console.log(`EXPERIMENT ${label}: M1 A ${b.toFixed(2)} -> ${a.toFixed(2)}, ui.sel ${sel} => handled by ${sel === 1 ? "the FACE" : "the v8ui"}`);
        return sel;
    };
    trial("baseline (transparent faces, as loaded)");
    console.log("EXPERIMENT z-order: " + gv("zorder", 'messnamed("megamod-test", "test_zorder");'));
    hook("test_alpha", 0.01); sleep(600);
    trial("all face colours alpha 0.01");
    hook("test_alpha", 0.5); sleep(600);
    trial("all face colours alpha 0.5");
    hook("test_alpha", 0); sleep(300);
    console.log("EXPERIMENT bringtofront shown faces: " + gv("front", 'messnamed("megamod-test", "test_front");'));
    sleep(600);
    trial("after patcher.bringtofront, alpha 0");
    hook("test_alpha", 0.01); sleep(300);
    trial("after bringtofront, alpha 0.01");
}

(function main() {
    const w = JSON.parse(os("window", PROC));
    showDevice();
    os("front", PROC);
    sleep(800);
    let r = report();
    if (!r) { console.error("test_report got no answer; reload the device"); process.exit(1); }
    let n = r.mods.filter((m) => m).length;
    while (n < 2) { hook("test_add", 1); sleep(500); n++; } // two LFO strips through the hook (no clicks yet)
    hook("test_setparam", 0, "sync", 0);
    hook("test_setparam", 1, "sync", 0);
    sleep(1000);
    const f = faces();
    check("test_faces answered", !!f);
    if (!f) { diag(); process.exit(1); }
    info(`faces: paints ${f.paints}, hover ${JSON.stringify(f.hover)}, setattr calls ${f.stats.setattrs}, applies ${f.stats.applies}, origin ${JSON.stringify(f.origin)}`);
    info("views: " + JSON.stringify(evalLom(`var a = new LiveAPI("live_app view"); var o = {}; ["Browser", "Detail", "Detail/DeviceChain", "Session"].forEach(function (n) { o[n] = a.call("is_view_visible", n); }); var d = new LiveAPI(${JSON.stringify(dev.path + " view")}); o.collapsed = d.get("is_collapsed"); return o;`)));
    checkFaces(f, 2, "2 strips");
    const p0 = param("M1 A");
    check("hidden / moved faces did not remove parameters from Live's list", p0 && p0.count === 257, `parameters ${p0 && p0.count}`);
    // a layout change moves the faces: expand strip 2 (Envelope knobs spread over 204 px)
    hook("test_add", 1); sleep(600);
    const f3 = faces();
    check("a third strip adds its faces (setattr only for the new ones)", f3 && Object.keys(f3.shown).length === 9, f3 && Object.keys(f3.shown).join(","));
    if (f3) info(`setattr calls 2 strips -> 3 strips: ${f.stats.setattrs} -> ${f3.stats.setattrs}`);
    hook("test_setparam", 2, "sync", 0);
    n = 3;

    // ---- real mouse
    os("front", PROC);
    let guess = calibrate(w);
    if (!guess) {
        check("find the device UI on screen with the real pointer (the v8ui reports the pointer over it)", false, "the v8ui never reported a hover: the real-mouse checks (left drag, right click) could not run");
        const fz = faces();
        info(`paints ${fz && fz.paints} (0 = Live never asked the device to paint: it is not rendered in this VM session)`);
        diag();
        if (failed) { console.log(`FAILED (${failed})`); process.exit(1); }
        return;
    }
    origin = guess;
    info(`v8ui origin on screen (${origin.x}, ${origin.y})`);
    check("the pointer position over the device UI is reported by the v8ui (real mouse events reach it)", true);

    if (process.argv.includes("--experiments")) { experiments(); return; }
    const typesNow = () => JSON.stringify(report().mods.filter((m) => m));
    info("modulator types at the start of the real-mouse steps: " + typesNow());
    // ---- 3. real left drag on the Rate face of strip 1
    const c0 = [origin.x + 22 + 14.5, origin.y + 88 + 14]; // the Rate dial face of strip 1 (27 x 28, centred on the knob)
    hook("test_selui", 1); // the drawn knob would select its strip (ubSelect); a native face drag does not
    sleep(300);
    const before = param("M1 A");
    const modBefore = report().modP[0].rate;
    info(`left drag at screen (${c0}) by -30 px; M1 A before ${before.value.toFixed(2)} (${before.str}), rate ${modBefore.toFixed(3)} Hz`);
    os("drag", c0[0], c0[1], 0, -30);
    sleep(600);
    const after = param("M1 A");
    const modAfter = report().modP[0].rate;
    info(`after: M1 A ${after.value.toFixed(2)} (${after.str}), rate ${modAfter.toFixed(3)} Hz  (drawn knob: 130 px = 100 %, so -30 px would be +23.1)`);
    check("real left drag up on the face raises the LOM parameter M1 A", after.value > before.value + 1, `${before.value.toFixed(2)} -> ${after.value.toFixed(2)}`);
    check("the model (modulator rate) followed the face drag", modAfter > modBefore + 1e-6, `${modBefore.toFixed(3)} -> ${modAfter.toFixed(3)} Hz`);
    const selAfter = report().ui.sel;
    check("the drag was handled by the native face, not the v8ui (the drawn knob would have selected strip 0)", selAfter === 1, `ui.sel ${selAfter}`);
    os("drag", c0[0], c0[1], 0, 60);
    sleep(500);
    const down = param("M1 A");
    check("dragging down lowers it again", down.value < after.value - 1, `${after.value.toFixed(2)} -> ${down.value.toFixed(2)}`);

    info("types after the drags: " + typesNow());
    // ---- 4. double-click = reset
    os("click", c0[0], c0[1], "double");
    sleep(500);
    const reset = param("M1 A");
    info(`double-click on the face: M1 A ${down.value.toFixed(2)} -> ${reset.value.toFixed(2)} (saved default 0; the LFO's own default is 56)`);

    info("types after the double-click: " + typesNow());
    // ---- 5. real right click: Live's context menu is its own window (layer >= 101), seen through the window server
    const wins = () => { try { return JSON.parse(os("cgwindows", PROC)); } catch (e) { return null; } };
    function rightClickCheck(label, x, y) {
        const w0 = wins();
        os("rclick", x, y);
        sleep(600);
        const w1 = wins();
        info(`Live windows before the right click: ${JSON.stringify(w0)}`);
        info(`Live windows after the right click:  ${JSON.stringify(w1)}`);
        const ids0 = new Set((w0 || []).map((q) => q[6]));
        const fresh = (w1 || []).filter((q) => !ids0.has(q[6]));
        check(`right click on the ${label} face opens a new native window (Live's parameter context menu)`, fresh.length > 0, fresh.length ? `new window ${JSON.stringify(fresh)}` : "no new window: needs a manual check");
        // the menu items are not readable (no accessibility), so only dismiss it: Escape, then a click on the window's title bar
        os("key", "escape");
        sleep(500);
        let w2 = wins();
        if (w2 && w2.some((q) => !ids0.has(q[6]))) { os("click", w.x + 500, w.y + 12); sleep(500); w2 = wins(); }
        check(`the ${label} menu is dismissed again`, !!w2 && !w2.some((q) => !ids0.has(q[6])), JSON.stringify(w2));
    }
    rightClickCheck("Rate", c0[0], c0[1]);

    info("types after the right click: " + typesNow());
    // ---- 6. popup hides faces
    click(22 + 58 * 3 + 13, 80); // the `+` strip
    sleep(600);
    const fp = faces();
    info(`after the click on the + strip: popup ${fp && fp.popup}, maps popover ${fp && fp.maps}, modulators ${fp && fp.nmods}`);
    check("type popup open: every face is hidden", fp && fp.popup === true && Object.keys(fp.shown).length === 0, fp && `popup ${fp.popup}, faces ${Object.keys(fp.shown).join(",")}`);
    info("types with the popup open: " + typesNow());
    os("key", "escape");
    sleep(400);
    info("types after Escape: " + typesNow() + ", popup " + JSON.stringify(faces().popup));
    click(100, 70); // anywhere else on the device closes the popup (popup_out)
    sleep(800);
    info("types after the closing click: " + typesNow());
    const fb = faces();
    info(`after closing the popup: popup ${fb && fb.popup}, ${fb ? Object.keys(fb.shown).length : "?"} faces shown`);
    check("faces return when the type popup closes", fb && fb.popup === false && Object.keys(fb.shown).length === 9, fb && `popup ${fb.popup}, faces ${Object.keys(fb.shown).length}`);

    info("types after the popup steps: " + typesNow());
    // ---- 7. the expanded LFO strip: Phase face, toggles, shape tab, real clicks / drags / right click
    hook("test_setparam", 0, "sync", 0);
    hook("test_expand", 0);
    sleep(1200);
    hook("test_selui", 1); // a native face takes the click; the drawn control would select strip 0 (ui.sel)
    sleep(300);
    const fx = faces();
    check("expanded LFO: faces answered", !!fx);
    if (!fx) { diag(); process.exit(1); }
    checkFaces(fx, 3, "expanded LFO strip", expandedFaces());
    const pAll = ["M1 A", "M1 C", "M1 D", "M1 Shape", "M1 Sync", "M1 Bipolar", "M1 Retrig"].map((nm) => [nm, param(nm)]);
    check("every expanded LFO control has a Live parameter (M1 A / C / D / Shape / Sync / Bipolar / Retrig)", pAll.every((q) => q[1]), JSON.stringify(pAll.map((q) => [q[0], !!q[1]])));
    check("the parameter list now holds 257 parameters (Device On + 96 + 96 + 64)", pAll[0][1] && pAll[0][1].count === 257, `parameters ${pAll[0][1] && pAll[0][1].count}`);
    // Phase: a real drag on the dial face centred on the Phase knob (local x 128..155, y 95..123)
    const ph = [origin.x + 128 + 13.5, origin.y + 95 + 14];
    const phB = param("M1 D");
    const modPhB = report().modP[0].phase;
    info(`left drag on the Phase face at screen (${ph}) by -30 px; M1 D before ${phB.value.toFixed(2)} (${phB.str}), phase ${modPhB.toFixed(3)}`);
    os("drag", ph[0], ph[1], 0, -30);
    sleep(600);
    const phA = param("M1 D");
    const modPhA = report().modP[0].phase;
    info(`after: M1 D ${phA.value.toFixed(2)} (${phA.str}), phase ${modPhA.toFixed(3)}`);
    check("real left drag up on the Phase face raises the LOM parameter M1 D", phA.value > phB.value + 1, `${phB.value.toFixed(2)} -> ${phA.value.toFixed(2)}`);
    check("the model (LFO phase) followed the Phase face drag", modPhA > modPhB + 1e-6, `${modPhB.toFixed(3)} -> ${modPhA.toFixed(3)}`);
    check("the Phase drag was handled by the native face, not the v8ui", report().ui.sel === 1, `ui.sel ${report().ui.sel}`);
    // SYNC: a real click on the live.text face flips the LOM toggle and the model; a second click flips it back
    const sy = [origin.x + 121 + 15, origin.y + 82 + 6];
    const syB = param("M1 Sync");
    const modSyB = report().modP[0].sync;
    os("click", sy[0], sy[1], "");
    sleep(600);
    const syA = param("M1 Sync");
    const modSyA = report().modP[0].sync;
    info(`SYNC click at screen (${sy}): M1 Sync ${syB.value} -> ${syA.value}, model sync ${modSyB} -> ${modSyA}`);
    check("real click on the SYNC face flips the LOM toggle M1 Sync", syA.value === 1 - syB.value, `${syB.value} -> ${syA.value}`);
    check("the model followed the SYNC face click", modSyA === 1 - modSyB, `${modSyB} -> ${modSyA}`);
    check("the SYNC click was handled by the native face, not the v8ui", report().ui.sel === 1, `ui.sel ${report().ui.sel}`);
    const fs = faces();
    check("synced LFO: the Rate knob's face is now Div (M1 B), at the same rect", fs && fs.shown.ap_1 && !fs.shown.ap_0 && fs.real.ap_1 && fs.real.ap_1.rect.every((v, i) => near(v, [36, 95, 27, 28][i] + (i < 2 ? 4 : 0), 0.05)), fs && JSON.stringify(fs.real.ap_1));
    os("click", sy[0], sy[1], "");
    sleep(600);
    check("a second click on the SYNC face flips it back", param("M1 Sync").value === syB.value && report().modP[0].sync === modSyB, `${param("M1 Sync").value}, model ${report().modP[0].sync}`);
    // shape tab: a real click on the third cell (Saw Up) sets M1 Shape = 2
    const sh = [origin.x + 26 + (92 / 5) * 2.5, origin.y + 82 + 6];
    os("click", sh[0], sh[1], "");
    sleep(600);
    const shA = param("M1 Shape");
    check("real click on the third shape cell sets the LOM parameter M1 Shape = 2 and the model", shA && Math.round(shA.value) === 2 && report().modP[0].shape === 2, `M1 Shape ${shA && shA.value} (${shA && shA.str}), model ${report().modP[0].shape}`);
    rightClickCheck("Phase", ph[0], ph[1]);
    hook("test_expand", -1);
    sleep(600);

    if (failed) { console.log(`FAILED (${failed})`); process.exit(1); }
    console.log("megamod faces Live test passed");
})();
