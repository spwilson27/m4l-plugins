#!/usr/bin/env node
/**
 * Mega Modulator: device width vs the v8ui's drawable width in REAL Ableton Live (AGENTS.md 1a / 21 "Width").
 *   scripts/vm_live_lock.sh megamod-width -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_width_live.js'
 * Four LFOs, three expanded (about 1200 px), then 1600 px: `test_geom` must show obj-viz presentation_rect = width - 2 * margin and
 * full-width panels, and a REAL click on the SYNC chip of the right-most expanded strip must flip it. Exit status non-zero on failure.
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

const geom = () => { sleep(400); return globalJson("geom", "test_geom"); };
function widthCase(label, expectAtLeast) {
    sleep(1200);
    const g = geom();
    check(label + ": test_geom answered", !!g);
    if (!g) return null;
    info(label + " geom " + JSON.stringify({ req: g.reqWidth, layout: g.uiLayout, viz: g.viz, panel0: g.panels[0], boxRect: g.boxRect, gfx: g.gfx, devwidth: g.devwidth, openrect: g.openrect }));
    check(label + ": requested width >= " + expectAtLeast, g.reqWidth >= expectAtLeast, "req " + g.reqWidth);
    check(label + ": obj-viz presentation_rect width = device width - 2 * margin", Array.isArray(g.viz) && Math.abs(g.viz[2] - (g.reqWidth - 2 * g.viz[0])) <= 0.5, "viz " + JSON.stringify(g.viz) + " req " + g.reqWidth);
    check(label + ": background panel spans the device width", Array.isArray(g.panels[0]) && Math.abs(g.panels[0][2] - g.reqWidth) <= 0.5, "panel " + JSON.stringify(g.panels[0]));
    return g;
}
function realClick(label, g) {
    const w0 = JSON.parse(os("window", PROC));
    const o0 = origin || { x: 255 };
    // the VM screen is 1024 px wide: click the right-most expanded strip whose chip is on screen (strips beyond it are checked by the rects)
    const last = g.strips.filter((s) => s.exp && s.sync && o0.x + s.sync[0] + 15 < w0.x + w0.w - 150 && (!process.env.MM_STRIP || s.slot === Number(process.env.MM_STRIP))).pop();
    check(label + ": a right-most expanded strip with a SYNC chip exists", !!last, JSON.stringify(g.strips));
    if (!last) return;
    const w = JSON.parse(os("window", PROC));
    os("front", PROC);
    const o = calibrate(w);
    check(label + ": the pointer over the v8ui is reported (origin found)", !!o, o && JSON.stringify(o));
    if (!o) return;
    origin = o;
    if (process.env.MM_CHIP) { const c = last.chips.find((q) => q[0] === process.env.MM_CHIP); if (c) { last.sync = c[2]; last.key = c[1]; } }
    const cx = last.sync[0] + last.sync[2] / 2, cy = last.sync[1] + last.sync[3] / 2;
    const key = last.key || "sync";
    const slot = last.slot;
    for (const ctl of g.strips.filter((q) => q.exp && q.sync).slice(0, 1)) { // control: the left-most strip (where the faces test already clicks)
        const b0 = !!report().modP[ctl.slot].sync;
        click(ctl.sync[0] + 15, ctl.sync[1] + 6); sleep(700);
        const a0 = !!report().modP[ctl.slot].sync;
        check(label + ": control click on the left-most strip's SYNC chip toggles it", a0 !== b0, b0 + " -> " + a0);
        click(ctl.sync[0] + 15, ctl.sync[1] + 6); sleep(500);
    }
    os("move", Math.round(origin.x + cx), Math.round(origin.y + cy - 30), 0.3); // over the v8ui just above the chip: is the far strip reachable?
    const hv = hoverOf();
    check(label + ": the pointer over the right-most strip is reported by the v8ui", !!hv && Math.abs(hv[0] - cx) <= 3, "hover " + JSON.stringify(hv) + " expected x " + cx);
    // a click on the strip's body (no native face there) must reach the v8ui at the far x: proves the v8ui is hit-testable that far right
    click(cx, 50); sleep(500);
    const lc = (geom() || {}).lastClick;
    check(label + ": real click on the right-most strip's body reaches the v8ui at local x " + Math.round(cx), !!lc && Math.abs(lc.x - cx) <= 3 && lc.slot === slot, "lastClick " + JSON.stringify(lc));
    const before = !!report().modP[slot][key];
    info(label + ": clicking SYNC of slot " + slot + " at local (" + cx + ", " + cy + "), strip x " + last.x + ".." + (last.x + last.w) + ", sync was " + before);
    click(cx, cy);
    sleep(700);
    { const f = globalJson("faces", "test_faces"); const near = f ? Object.entries(f.real).filter(([k, v]) => v && v.rect && Math.abs(v.rect[0] - (cx + 4 - 15)) < 40 && v.rect[1] < 100).map(([k, v]) => k + ":" + JSON.stringify(v.rect) + (v.hidden ? "H" : "")) : []; info(label + ": chip-row faces: " + (f ? Object.entries(f.real).filter(([k, v]) => v && v.rect && v.rect[1] === 86).sort((a, b) => a[1].rect[0] - b[1].rect[0]).map(([k, v]) => k + "@" + v.rect[0] + (v.hidden ? "H" : "")).join(" ") : "") + "; origin " + JSON.stringify(f && f.origin)); info(label + ": faces near the chip: " + near.join(" ") + "; hover " + JSON.stringify(f && f.hover)); }
    info(label + ": LOM M" + (slot + 1) + " Sync = " + JSON.stringify(param("M" + (slot + 1) + " Sync")) + ", ui.sel " + report().ui.sel);
    info(label + ": last click that reached the v8ui: " + JSON.stringify((geom() || {}).lastClick));
    const after = !!report().modP[slot][key];
    check(label + ": real click on the right-most strip's SYNC chip toggles it", after !== before, before + " -> " + after);
    click(cx, cy); sleep(500);
}
(function main() {
    showDevice();
    os("front", PROC);
    sleep(800);
    let r = report();
    if (!r) { console.error("test_report got no answer; reload the device"); process.exit(1); }
    let n = r.mods.filter((m) => m).length;
    while (n < 4) { hook("test_add", 1); sleep(500); n++; }
    hook("test_setparam", 3, "sync", 0);
    const first = process.env.MM_NARROW ? [0, 2] : [0, 1, 3];
    if (process.env.MM_NARROW) { hook("test_expand", -1); sleep(400); }
    for (const s of first) { hook("test_expand", s); sleep(500); }
    const g = widthCase("3 expanded of 4", 700);
    if (!g) { diag(); process.exit(1); }
    realClick("732px", g);
    // about 1200 px: 5 expanded of 6
    for (let k = 4; k < 6; k++) { hook("test_add", 1); sleep(400); hook("test_setparam", k, "sync", 0); }
    for (const s of [2, 4]) { hook("test_expand", s); sleep(400); }
    const g1 = widthCase("~1200px", 1100);
    if (g1) realClick("~1200px", g1);
    // near the maximum: more strips, expand until the limit
    for (let k = 6; k < 8; k++) { hook("test_add", 1); sleep(400); }
    for (const s of [5, 6, 7]) { hook("test_expand", s); sleep(400); }
    const g2 = widthCase("max", 1400);
    if (g2) realClick("max", g2);
    if (failed) { console.log(`FAILED (${failed})`); process.exit(1); }
    console.log("ALL PASS");
})();
