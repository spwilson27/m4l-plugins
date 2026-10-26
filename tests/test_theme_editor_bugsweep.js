#!/usr/bin/env node
/**
 * Bugsweep Pass 1 RED tests for Theme Editor (tests/test_theme_editor_bugsweep.js).
 *
 * New bugs found on the bugsweep/theme_editor baseline, distinct from the
 * three bugs already covered by tests/test_theme_editor_bugs.js (those now
 * pass on this tree: m4lSetThemeState NaN macros, m4lApplyMacros null
 * alpha, node partial-POST state loss). Each check below FAILS on the
 * unmodified tree for the stated reason (see the Theme Editor bugsweep
 * section in BUGS.md at the repo root) and should pass once fixed.
 * Style follows tests/test_theme_editor_bugs.js (plain node, assert,
 * check/checkAsync collecting all failures in one run).
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

console.log("=== Theme Editor Bugsweep Pass 1 Red Tests ===");

const te = require(path.join(ROOT, "src", "theme_engine.js"));
const NEUTRAL_MACROS = { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 };

check("Resolved-token cache follows M4L_DEVICE_SLUG: a second device must not inherit the first devices override tokens", () => {
    delete global.__M4L_THEME_STATE__;
    te.m4lSetThemeState({
        version: 1,
        preset: "Cyber Cyan",
        macros: Object.assign({}, NEUTRAL_MACROS),
        tokens: {},
        deviceOverrides: {
            dev_a: { preset: "Cyber Cyan", macros: {}, tokens: { live_lcd_bg: [1, 0, 0, 1] } },
            dev_b: { preset: "Cyber Cyan", macros: {}, tokens: { live_lcd_bg: [0, 0, 1, 1] } }
        }
    });
    global.M4L_DEVICE_SLUG = "dev_a";
    assert.deepStrictEqual(te.m4lColor("live_lcd_bg"), [1, 0, 0, 1], "control: dev_a resolves its own red override");
    global.M4L_DEVICE_SLUG = "dev_b";
    assert.deepStrictEqual(te.m4lColor("live_lcd_bg"), [0, 0, 1, 1], "dev_b must resolve its own blue override, not dev_a cached tokens (the WebUI sets window.M4L_DEVICE_SLUG per device in mapDevColor/renderDeviceCanvas and never refreshes between devices)");
    delete global.M4L_DEVICE_SLUG;
    te.m4lSetThemeState(te.m4lDefaultState());
});

check("m4lApplyMacros treats a null satScale as 1.0 (identity), not 0 (full desaturation)", () => {
    const out = te.m4lApplyMacros([0.2, 0.4, 0.6, 1], { hueShift: 0, satScale: null, contrast: 1.0, brightness: 0 });
    assert.deepStrictEqual(out, [0.2, 0.4, 0.6, 1], "a null satScale (what JSON produces from NaN) must fall back to 1.0 like undefined does, not Number(null) === 0");
});

check("m4lApplyMacros treats a null contrast as 1.0 (identity), not 0 (flat mid-grey)", () => {
    const out = te.m4lApplyMacros([0.2, 0.4, 0.6, 1], { hueShift: 0, satScale: 1.0, contrast: null, brightness: 0 });
    assert.deepStrictEqual(out, [0.2, 0.4, 0.6, 1], "a null contrast must fall back to 1.0 like undefined does, not Number(null) === 0");
});

check("Device-override macros with a null satScale survive: override colours must not render desaturated", () => {
    delete global.__M4L_THEME_STATE__;
    global.M4L_DEVICE_SLUG = "dev_null";
    te.m4lSetThemeState({
        version: 1,
        preset: "Cyber Cyan",
        macros: Object.assign({}, NEUTRAL_MACROS),
        tokens: {},
        deviceOverrides: {
            dev_null: { preset: "Cyber Cyan", macros: { satScale: null }, tokens: { live_lcd_bg: [0.2, 0.4, 0.6, 1] } }
        }
    });
    assert.deepStrictEqual(te.m4lColor("live_lcd_bg"), [0.2, 0.4, 0.6, 1], "m4lSetThemeState sanitises the global macros but copies deviceOverrides verbatim, so a null override satScale reaches m4lApplyMacros via m4lEffectiveConfig and greys the colour");
    delete global.M4L_DEVICE_SLUG;
    te.m4lSetThemeState(te.m4lDefaultState());
});

check("m4lMapRgba treats a null alpha as opaque 1.0, not transparent 0", () => {
    delete global.__M4L_THEME_STATE__;
    te.m4lSetThemeState({ version: 1, preset: "Cyber Cyan", macros: Object.assign({}, NEUTRAL_MACROS), tokens: {}, deviceOverrides: {} });
    const out = te.m4lMapRgba(0.2, 0.4, 0.6, null);
    assert.strictEqual(out[3], 1.0, "null alpha (JSON-decayed NaN) must fall back to opaque 1.0, the convention m4lApplyMacros/m4lColor already use; m4lMapRgba is the mgraphics hook path for every themed device");
    te.m4lSetThemeState(te.m4lDefaultState());
});

check("m4lMapRgba treats a NaN alpha as opaque 1.0, not NaN", () => {
    delete global.__M4L_THEME_STATE__;
    te.m4lSetThemeState({ version: 1, preset: "Cyber Cyan", macros: Object.assign({}, NEUTRAL_MACROS), tokens: {}, deviceOverrides: {} });
    const out = te.m4lMapRgba(0.2, 0.4, 0.6, NaN);
    assert.strictEqual(out[3], 1.0, "NaN alpha must fall back to opaque 1.0 instead of propagating NaN into mgraphics.set_source_rgba");
    te.m4lSetThemeState(te.m4lDefaultState());
});

check("m4lEstimateAbletonUiSettings with no observations returns a sane RMSE (not the 1e9 sentinel scaled by 255)", () => {
    const est = te.m4lEstimateAbletonUiSettings({});
    assert.strictEqual(est.askName, "Default Dark Neutral Medium", "control: empty input still defaults to the default skin");
    assert.ok(Number.isFinite(est.rmse) && est.rmse <= 255, "rmse is an error in 0..255 sample units (the WebUI Detect Live banner prints it); with no compared samples it must not be sqrt(1e9)*255 = 8063808, got " + est.rmse);
    const estNull = te.m4lEstimateAbletonUiSettings(null);
    assert.ok(Number.isFinite(estNull.rmse) && estNull.rmse <= 255, "null input must also return a sane rmse, got " + estNull.rmse);
});

check("m4lComputeAbletonUiTokens treats a null/NaN brightness as the 100% default, not 0%", () => {
    const base = { theme: "Default", appearance: "Dark", tone: "Neutral", highContrast: false, colorIntensity: 0, colorHue: 0 };
    const def = te.m4lComputeAbletonUiTokens(Object.assign({}, base, { brightness: 100 }));
    const nul = te.m4lComputeAbletonUiTokens(Object.assign({}, base, { brightness: null }));
    assert.deepStrictEqual(nul, def, "brightness null (JSON-decayed NaN in a saved abletonUi) must default to 100, not Number(null) === 0 percent");
    const nan = te.m4lComputeAbletonUiTokens(Object.assign({}, base, { brightness: NaN }));
    assert.deepStrictEqual(nan, def, "brightness NaN must default to 100, not clamp to 0 percent");
});

check("WebUI device preview draws a minimum-value dial (norm 0) with an empty arc, not a half arc", () => {
    const html = fs.readFileSync(path.join(ROOT, "src", "theme_editor_web.html"), "utf8");
    assert.ok(!/wid\.norm \|\| 0\.5/.test(html), "renderDeviceBody must not use (wid.norm || 0.5) for the dial arc end angle: extractDevicePreviewModel legitimately produces norm 0 for a dial at its parameter minimum, and 0 || 0.5 draws it at 50%");
});

async function testNodeServer() {
    process.env.M4L_THEME_NO_AUTOSTART = "1";
    const tmpStateFile = path.join(os.tmpdir(), "m4l_theme_bugsweep_" + process.pid + ".json");
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
    const fullState = {
        preset: "Cyber Cyan",
        macros: { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
        tokens: { live_lcd_bg: [0.1, 0.2, 0.3, 1.0] },
        deviceOverrides: { dev_x: { preset: "Amber LCD", macros: {}, tokens: { live_lcd_bg: [1, 0, 0, 1] } } },
        customPresets: { Mine: { tokens: { live_lcd_bg: [0.1, 0.1, 0.1, 1.0] } } },
        abletonUi: { enabled: true, theme: "Default", appearance: "Dark", tone: "Neutral", highContrast: false, gridLineIntensity: 100, brightness: 95, colorIntensity: 40, colorHue: 200 }
    };
    try {
        await postJson("/api/state", fullState);
        await checkAsync("A full-state POST (the WebUI schedulePush shape) that removes a token, a device override and a custom preset actually deletes them", async () => {
            const afterDelete = JSON.parse(JSON.stringify(fullState));
            delete afterDelete.tokens.live_lcd_bg;
            delete afterDelete.deviceOverrides.dev_x;
            delete afterDelete.customPresets.Mine;
            await postJson("/api/state", afterDelete);
            const after = await getJson("/api/state");
            assert.ok(!(after.state.tokens && "live_lcd_bg" in after.state.tokens), "deleted token override must stay deleted (WebUI token reset button deletes the key and posts the full state); mergeThemeState currently resurrects it from the previous state");
            assert.ok(!(after.state.deviceOverrides && "dev_x" in after.state.deviceOverrides), "deleted device override must stay deleted (WebUI Reset Target deletes deviceOverrides[target] and posts the full state)");
            assert.ok(!(after.state.customPresets && "Mine" in after.state.customPresets), "removed custom preset must stay removed");
        });
        await checkAsync("Deletions from a full-state POST persist to the on-disk state file", async () => {
            const disk = JSON.parse(fs.readFileSync(tmpStateFile, "utf8"));
            assert.ok(!(disk.tokens && "live_lcd_bg" in disk.tokens), "on-disk state must not keep the deleted token");
            assert.ok(!(disk.deviceOverrides && "dev_x" in disk.deviceOverrides), "on-disk state must not keep the deleted device override");
            assert.ok(!(disk.customPresets && "Mine" in disk.customPresets), "on-disk state must not keep the removed custom preset");
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
        console.log("Failing checks (expected on the unmodified tree - these are the bugsweep Pass 1 bugs):");
        for (const f of failures) console.log("  - " + f);
        process.exit(1);
    }
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
