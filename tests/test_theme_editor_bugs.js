#!/usr/bin/env node
/**
 * Pass 1 bug-hunt RED tests for Theme Editor (tests/test_theme_editor_bugs.js).
 *
 * Each check encodes behaviour the current code in src/theme_engine.js and
 * src/theme_editor_node.js gets wrong (see BUGS.md at the repo root).
 * Every check FAILS on the unmodified tree and should pass once the
 * corresponding bug is fixed. Style follows tests/test_theme_editor.js
 * (plain node, assert, check(name, fn)); failures are collected so a
 * single run reports all bugs at once.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let passes = 0;
const failures = [];
function check(name, fn) {
    try {
        fn();
        passes++;
        console.log("  PASS  " + name);
    } catch (err) {
        failures.push(name);
        console.log("  FAIL  " + name);
        console.log("        " + String(err && err.message));
    }
}
async function checkAsync(name, fn) {
    try {
        await fn();
        passes++;
        console.log("  PASS  " + name);
    } catch (err) {
        failures.push(name);
        console.log("  FAIL  " + name);
        console.log("        " + String(err && err.message));
    }
}

console.log("=== Theme Editor Pass 1 Bug-Hunt Red Tests ===");

const te = require(path.join(ROOT, "src", "theme_engine.js"));

check("m4lSetThemeState sanitises non-numeric satScale/contrast to the 1.0 defaults instead of storing NaN", () => {
    delete global.__M4L_THEME_STATE__;
    te.m4lSetThemeState({
        version: 1,
        preset: "Cyber Cyan",
        macros: { hueShift: "wide", satScale: "loud", contrast: "hard", brightness: "dim" },
        tokens: {},
        deviceOverrides: {}
    });
    const st = te.m4lGetThemeState();
    assert.strictEqual(st.macros.hueShift, 0, "control: hueShift already falls back to 0");
    assert.strictEqual(st.macros.brightness, 0, "control: brightness already falls back to 0");
    assert.strictEqual(st.macros.satScale, 1.0, "satScale must fall back to 1.0, not NaN");
    assert.strictEqual(st.macros.contrast, 1.0, "contrast must fall back to 1.0, not NaN");
});

check("Macro state survives a JSON save/load round trip (NaN must not decay into satScale 0)", () => {
    delete global.__M4L_THEME_STATE__;
    te.m4lSetThemeState({
        version: 1,
        preset: "Cyber Cyan",
        macros: { hueShift: 0, satScale: "loud", contrast: 1.0, brightness: 0 },
        tokens: {},
        deviceOverrides: {}
    });
    const revived = JSON.parse(JSON.stringify(te.m4lGetThemeState()));
    te.m4lSetThemeState(revived);
    const st = te.m4lGetThemeState();
    assert.strictEqual(st.macros.satScale, 1.0, "satScale after a JSON round trip must be 1.0, not 0");
    te.m4lSetThemeState(te.m4lDefaultState());
});

check("m4lApplyMacros treats a null alpha as opaque 1.0, not transparent 0", () => {
    const out = te.m4lApplyMacros([0.25, 0.5, 0.75, null], { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 });
    assert.strictEqual(out[3], 1.0, "a null alpha (what JSON produces from NaN) must fall back to opaque 1.0");
});

async function testNodeServer() {
    process.env.M4L_THEME_NO_AUTOSTART = "1";
    const tmpStateFile = path.join(os.tmpdir(), "m4l_theme_bugs_" + process.pid + ".json");
    process.env.M4L_THEME_STATE_FILE = tmpStateFile;
    const nodeMod = require(path.join(ROOT, "src", "theme_editor_node.js"));
    const srv = nodeMod.createThemeServer();
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const port = srv.address().port;
    const getJson = (urlPath) => new Promise((resolve, reject) => {
        http.get("http://127.0.0.1:" + port + urlPath, (res) => {
            let d = "";
            res.on("data", (c) => { d += c; });
            res.on("end", () => resolve(JSON.parse(d)));
        }).on("error", reject);
    });
    const postJson = (urlPath, payload) => new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req = http.request({
            hostname: "127.0.0.1",
            port,
            path: urlPath,
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
        }, (res) => {
            let d = "";
            res.on("data", (c) => { d += c; });
            res.on("end", () => resolve(JSON.parse(d)));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
    try {
        await postJson("/api/state", {
            preset: "Amber LCD",
            macros: { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
            tokens: {},
            deviceOverrides: {},
            customPresets: { Mine: { tokens: { live_lcd_bg: [0.1, 0.1, 0.1, 1.0] } } },
            abletonUi: { enabled: true, theme: "Default", appearance: "Dark", tone: "Neutral", highContrast: false, gridLineIntensity: 100, brightness: 95, colorIntensity: 40, colorHue: 200 }
        });
        await checkAsync("POST /api/state with a partial body preserves abletonUi and customPresets", async () => {
            await postJson("/api/state", { preset: "Cyber Cyan" });
            const after = await getJson("/api/state");
            assert.strictEqual(after.state.preset, "Cyber Cyan");
            assert.ok(after.state.abletonUi && after.state.abletonUi.enabled === true && after.state.abletonUi.brightness === 95, "abletonUi must survive a partial POST");
            assert.ok(after.state.customPresets && after.state.customPresets.Mine, "customPresets must survive a partial POST");
        });
        await checkAsync("POST /api/state with a partial macros object keeps the sibling macro values", async () => {
            await postJson("/api/state", { macros: { hueShift: 25 } });
            const after = await getJson("/api/state");
            assert.strictEqual(after.state.macros.hueShift, 25);
            assert.strictEqual(after.state.macros.satScale, 1.0, "satScale must not be dropped by a partial macros POST");
            assert.strictEqual(after.state.macros.contrast, 1.0, "contrast must not be dropped by a partial macros POST");
        });
        await checkAsync("State persisted to disk keeps abletonUi after partial POSTs", async () => {
            const disk = JSON.parse(fs.readFileSync(tmpStateFile, "utf8"));
            assert.ok(disk.abletonUi && disk.abletonUi.enabled === true, "the on-disk state file must keep abletonUi");
        });
    } finally {
        srv.close();
        if (fs.existsSync(tmpStateFile)) fs.unlinkSync(tmpStateFile);
    }
}

testNodeServer().then(() => {
    console.log("");
    console.log(passes + " passed, " + failures.length + " failed.");
    if (failures.length > 0) {
        console.log("Failing checks (expected on the unmodified tree - these are the Pass 1 bugs):");
        for (const f of failures) console.log("  - " + f);
        process.exit(1);
    }
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
