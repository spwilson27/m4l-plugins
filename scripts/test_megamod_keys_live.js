#!/usr/bin/env node
/**
 * Mega Modulator hotkeys in REAL Ableton Live, with real OS key and mouse events.
 *
 * Live runs only in the tart VM (AGENTS.md 1a). This script runs on the host and talks to
 *   - the VM's Ableton MCP Bridge through an ssh tunnel (`--port`): LOM reads / `receive megamod-test`
 *     (`test_learn`, `test_report` -> Global("megamod_test")), and
 *   - the VM's macOS GUI session over ssh (`--ssh`): scripts/mm_os_input.py posts the System Events key
 *     presses and the CGEvent mouse clicks (Live's window position comes from System Events).
 *
 * `scripts/vm_megamod_keys.sh live` writes + opens megamod_keys_test.als (MCP Bridge on Main, one audio
 * track "Mega Mod Keys" holding one Mega Modulator); `scripts/vm_megamod_keys.sh test` opens the tunnel and
 * runs this.
 *
 * What it does (a fresh device has no modulators, so it first finds the device UI on screen by adding
 * modulators with real clicks on the `+` strip and the type popup; that also proves real clicks reach the
 * v8ui in Live):
 *   1. keyboard focus on Live's Session view (device NOT clicked): Delete / Cmd-Z must not change the modulators
 *   2. click a strip + Delete: the selected modulator and its mapping are deleted (device still in the track)
 *   3. Cmd-Z restores both; Shift-Cmd-Z redoes; Cmd-Z again; Ctrl-Y redoes; Ctrl-Z undoes
 *   4. click beside the device UI, Delete: nothing changes in the device
 *   Live-level side effects are measured for every step (INTERCEPT lines): the devices left on the track (did
 *   Live delete the device?) and a marker Live edit (track volume set through the LOM, Live-undoable) to see
 *   whether Cmd-Z undid it.
 *
 *   node scripts/test_megamod_keys_live.js --port 19880 [--ssh admin@192.168.64.4] [--vm-dir Software/ableton-mmnames]
 * Exit status is non-zero when a check fails.
 */

const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : dflt;
};
const PORT = Number(arg("--port", 0)) || null;
const VM_DIR = arg("--vm-dir", "Software/ableton-mmnames");
const PROC = arg("--process", "Live");
let SSH_TARGET = arg("--ssh", "");
if (!SSH_TARGET) {
    let ip = "";
    for (const a of [["ip", "macos-1"], ["ip", "--resolver=arp", "macos-1"]]) {
        try { ip = execFileSync("tart", a, { encoding: "utf8" }).trim(); } catch (e) { /* try the next form */ }
        if (ip) break;
    }
    SSH_TARGET = "admin@" + (ip || "192.168.64.4");
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
    if (out.error) throw new Error(out.error);
    return out.result;
}

function os(...a) {
    const cmd = `cd ${VM_DIR} && /usr/bin/python3 scripts/mm_os_input.py ${a.join(" ")}`;
    return execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", SSH_TARGET, cmd],
        { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) }).trim();
}

let failed = 0;
function check(name, ok, detail) {
    if (!ok) failed++;
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
}
const info = (s) => console.log("INFO " + s);

// ------------------------------------------------------------------------------------------- LOM helpers
const found = evalLom(`
    var out = [];
    var set = new LiveAPI("live_set");
    for (var t = 0; t < set.getcount("tracks"); t++) {
        var tp = "live_set tracks " + t;
        var tr = new LiveAPI(tp);
        for (var i = 0; i < tr.getcount("devices"); i++) {
            var d = new LiveAPI(tp + " devices " + i);
            if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), track: t, trackName: String(tr.get("name")), index: i });
        }
    }
    return out;
`);
if (!found.length) {
    console.error("No Mega Modulator at the top level of a track. Run scripts/vm_megamod_keys.sh live first.");
    process.exit(1);
}
const dev = found.find((d) => d.trackName === "Mega Mod Keys") || found[0];
const TRACK = dev.track;
info(`device id ${dev.id} on track ${TRACK} "${dev.trackName}" (${found.length} Mega Modulator${found.length > 1 ? "s" : ""} in the set)`);

function report() {
    const raw = evalLom(`
        var g = new Global("megamod_test");
        g["report_${dev.id}"] = "";
        messnamed("megamod-test", "test_report");
        var r = g["report_${dev.id}"];
        return r ? String(r) : "";
    `);
    if (!raw) return null; // no answer: the device (and its `receive`) is gone
    const rep = JSON.parse(raw);
    return {
        alive: rep.mods.map((m, i) => (m === null ? -1 : i)).filter((i) => i >= 0),
        maps: rep.mappings.map((m) => `${m.id}:${m.mod}:${m.mode}`).sort(),
    };
}

function liveState() {
    return evalLom(`
        var set = new LiveAPI("live_set");
        var tr = new LiveAPI("live_set tracks ${TRACK}");
        var names = [];
        for (var i = 0; i < tr.getcount("devices"); i++) names.push(String(new LiveAPI("live_set tracks ${TRACK} devices " + i).get("name")));
        var vol = new LiveAPI("live_set tracks ${TRACK} mixer_device volume");
        return { devices: names, volume: Number(vol.get("value")), canUndo: Number(set.get("can_undo")), canRedo: Number(set.get("can_redo")), tracks: set.getcount("tracks") };
    `);
}

const sum = (r) => (r ? `modulators ${JSON.stringify(r.alive)}, ${r.maps.length} mappings` : "no report (device gone)");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------------------------------- screen helpers
function showDevice() {
    evalLom(`
        var v = new LiveAPI("live_set view");
        v.call("select_device", "id", ${Number(dev.id)});
        var a = new LiveAPI("live_app view");
        a.call("show_view", "Detail");
        a.call("show_view", "Detail/DeviceChain");
        return 1;
    `);
}
function focusSession() {
    // keyboard focus on the Session view: the neutral Live state, device not clicked
    evalLom(`
        var a = new LiveAPI("live_app view");
        a.call("show_view", "Session");
        a.call("focus_view", "Session");
        return 1;
    `);
}

let origin = null; // screen point of the v8ui's (0, 0)
const click = (lx, ly, dbl) => os("click", Math.round(origin.x + lx), Math.round(origin.y + ly), dbl ? "double" : "");
const key = (name) => os("key", name);

// v8ui geometry (src/megamod_ui.js): rail 20 + gap 2, strips 56 wide with a 2 px gap, `+` strip 26 wide (92 when empty),
// the type popup is 94 wide at y = 22 with 17 px rows (LFO, Env, Random, Steps, MSEG)
const plusCenter = (n) => (n === 0 ? [68, 80] : [35 + 58 * n, 80]);
const popupItem = (n, k) => {
    const right = n === 0 ? 114 : 48 + 58 * n;
    return [right - 50, 22 + 2 + 17 * k + 8];
};
const stripViz = (j) => [45 + 58 * j, 52]; // the mini-visualization of strip j: a click only selects it

function tryAdd(o, n, k) {
    origin = o;
    const p = plusCenter(n);
    click(p[0], p[1]);
    sleep(300);
    const it = popupItem(n, k);
    click(it[0], it[1]);
    sleep(400);
    const r = report();
    return !!r && r.alive.length === n + 1;
}

function addModulator(n, k, guess) {
    // scan around the guess: y in 14 px steps (popup rows are 17 px, so an origin within +-8 hits the row), x within +-42
    const cands = [];
    for (let dy = 0; dy <= 120; dy += 14) {
        for (const sy of dy ? [-1, 1] : [1]) {
            for (const dx of [0, -14, 14, -28, 28, -42, 42]) cands.push({ x: guess.x + dx, y: guess.y + sy * dy });
        }
    }
    for (const c of cands) {
        if (tryAdd(c, n, k)) return c;
    }
    return null;
}

function finish() {
    try { evalLom(`new LiveAPI("live_set tracks ${TRACK} mixer_device volume").set("value", 0.85); return 1;`); } catch (e) { /* the device track may be gone */ }
    if (failed) {
        console.log(`FAILED (${failed} check${failed > 1 ? "s" : ""})`);
        process.exit(1);
    }
    console.log("megamod Live hotkey test passed");
    process.exit(0);
}

// ------------------------------------------------------------------------------------------- run
(function main() {
    const w = JSON.parse(os("window", PROC));
    info(`Live window ${JSON.stringify(w)}`);
    showDevice();
    os("front", PROC);
    sleep(800);

    const r0 = report();
    if (!r0) { console.error("test_report got no answer from the device; reload the device so it has the megamod-test hook"); process.exit(1); }
    info(`start: ${sum(r0)}`);

    const live0 = liveState();
    check("device present once in the track before the test", live0.devices.filter((d) => d === "Mega Modulator").length === 1, live0.devices.join(", "));

    // 1. device NOT clicked: Live's Session view has the keyboard focus
    focusSession();
    sleep(500);
    key("delete");
    key("undo");
    const rNoFocus = report();
    const liveNoFocus = liveState();
    check("no focus (device not clicked): Delete and Cmd-Z do not change the modulators", !!rNoFocus && eq(rNoFocus.alive, r0.alive) && eq(rNoFocus.maps, r0.maps), sum(rNoFocus));
    info(`INTERCEPT (device not clicked, Live Session view focused): Live devices ${JSON.stringify(live0.devices)} -> ${JSON.stringify(liveNoFocus.devices)}; canUndo ${live0.canUndo} -> ${liveNoFocus.canUndo}`);
    if (!rNoFocus) { console.log("FAILED: Live deleted the device."); process.exit(1); }

    // 2. make sure the device has modulators (real clicks) and find where its UI is on screen
    showDevice();
    os("front", PROC);
    sleep(600);
    let n = r0.alive.length;
    if (r0.alive.some((s, i) => s !== i)) { console.error("modulator slots are not contiguous; use a fresh device"); process.exit(1); }
    // the v8ui in the device view: detail view at the bottom of the window, device chain near the left edge
    let guess = { x: w.x + 22, y: w.y + Math.round(w.h * 0.62) };
    const want = Math.max(3, n + 1);
    let first = true;
    while (n < want) {
        const c = addModulator(n, n % 2, guess);
        if (!c) {
            check("find the device UI on screen with real clicks (add a modulator through the type popup)", false, `no hit scanning around (${guess.x},${guess.y})`);
            finish();
        }
        if (first) check("real clicks reach the device UI in Live: `+` strip and type popup added a modulator", true, `UI origin at screen (${c.x},${c.y})`);
        first = false;
        guess = c;
        n++;
    }
    origin = guess;

    // a mapping on the last modulator (Mod mapping of the track's Pan; the marker edit below uses Volume)
    const target = evalLom(`return Number(new LiveAPI("live_set tracks ${TRACK} mixer_device panning").id);`);
    const sel = n - 1;
    evalLom(`messnamed("megamod-test", "test_learn", ${sel}, ${target}); return 1;`);
    sleep(1200);
    const base = report();
    check("test_learn created a mapping on the last modulator", !!base && base.maps.some((m) => m.split(":")[1] === String(sel)), sum(base));
    // a Live-undoable marker edit, to see whether Cmd-Z reaches Live
    evalLom(`new LiveAPI("live_set tracks ${TRACK} mixer_device volume").set("value", 0.5); return 1;`);
    sleep(300);
    const marker = liveState();
    info(`marker: track volume ${marker.volume.toFixed(3)}, canUndo ${marker.canUndo}`);
    const baseMaps = base.maps;
    const baseAlive = base.alive;
    const deleted = baseAlive.filter((s) => s !== sel);
    const mapsAll = (m) => eq(m, baseMaps);
    const selMaps = baseMaps.filter((x) => x.split(":")[1] === String(sel)).length;
    const mapsWithout = (m) => selMaps > 0 && m.length === baseMaps.length - selMaps && m.every((x) => x.split(":")[1] !== String(sel));

    const step = (label, keyName, expectAlive, expectMaps) => {
        key(keyName);
        sleep(300);
        const r = report();
        const l = liveState();
        check(label, !!r && eq(r.alive, expectAlive) && expectMaps(r.maps), sum(r));
        const volMoved = Math.abs(l.volume - marker.volume) > 1e-3;
        info(`INTERCEPT after ${keyName}: Live devices ${JSON.stringify(l.devices)}, track volume ${l.volume.toFixed(3)}${volMoved ? " (CHANGED: Live undid the marker edit)" : " (unchanged)"}, canUndo ${l.canUndo}`);
        return { r, l };
    };

    // 3. click the last strip's visualization (selects it, focuses the device UI), then Delete
    const sv = stripViz(sel);
    click(sv[0], sv[1]);
    sleep(300);
    const s1 = step("click strip + Delete: the selected modulator and its mapping are deleted", "delete", deleted, mapsWithout);
    check("Delete did not delete the Live device", !!s1.r && s1.l.devices.includes("Mega Modulator"), s1.l.devices.join(", "));
    if (!s1.r) { info("RESULT: Live deleted the Mega Modulator device on Delete; remaining steps are meaningless"); finish(); }
    step("Cmd-Z restores the modulator and its mapping", "undo", baseAlive, mapsAll);
    step("Shift-Cmd-Z redoes the delete", "redo", deleted, mapsWithout);
    step("Cmd-Z restores again", "undo", baseAlive, mapsAll);
    step("Ctrl-Y redoes the delete", "ctrl_y", deleted, mapsWithout);
    step("Ctrl-Z undoes (like Cmd-Z)", "ctrl_z", baseAlive, mapsAll);

    // 4. click outside the device UI (blank detail area to its right): the device must ignore the keys
    const total = 22 + 58 * n + 26;
    const awayX = Math.min(w.x + w.w - 60, origin.x + total + 140);
    if (awayX > origin.x + total + 20) {
        os("click", Math.round(awayX), Math.round(origin.y + 80));
        sleep(300);
        key("delete");
        const r = report();
        const l = liveState();
        const deviceDeleted = !r || !l.devices.includes("Mega Modulator");
        info(`INTERCEPT (clicked beside the device UI, Delete): ${deviceDeleted ? "Live deleted the device" : "device still in the track"}`);
        check("click outside the device UI: Delete does not change the modulators", !!r && eq(r.alive, baseAlive) && eq(r.maps, baseMaps), sum(r));
        if (deviceDeleted) { key("undo"); info("Live's own undo (Cmd-Z) was sent to bring the device back; its modulator state is lost (the set is a scratch copy)"); }
    } else {
        info("window too small for the 'click outside the device UI' check; skipped");
    }
    finish();
})();
