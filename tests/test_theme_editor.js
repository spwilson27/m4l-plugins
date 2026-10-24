#!/usr/bin/env node
/**
 * Automated Verification Suite for `src/theme_engine.js` & `devices/Theme Editor.amxd`
 * (`tests/test_theme_editor.js`).
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const AMXD_PATH = path.join(ROOT, "devices", "Theme Editor.amxd");

let passes = 0;
function check(name, fn) {
    fn();
    passes++;
    console.log(`  PASS  ${name}`);
}

console.log("=== Theme Engine & Theme Editor Verification Suite ===");

// 1. Core Theme Engine Unit Tests
const te = require(path.join(ROOT, "src", "theme_engine.js"));

check("Preset catalog and semantic token completeness", () => {
    assert.strictEqual(te.M4L_PRESET_NAMES.length, 8);
    assert.ok(te.M4L_TOKEN_KEYS.length >= 22);
    for (const name of te.M4L_PRESET_NAMES) {
        const p = te.M4L_PRESET_THEMES[name];
        assert.ok(p, `Missing preset ${name}`);
        for (const tk of te.M4L_TOKEN_KEYS) {
            const col = p.tokens[tk] || te.M4L_DEFAULT_TOKENS[tk];
            assert.ok(Array.isArray(col) && col.length === 4, `${name}.${tk} must be RGBA`);
            for (const c of col) assert.ok(c >= 0 && c <= 1, `${name}.${tk} component in 0..1`);
        }
    }
});

check("Default mode is 100% identity pass-through", () => {
    delete global.__M4L_THEME_STATE__;
    te.m4lSetThemeState(te.m4lDefaultState());
    assert.strictEqual(te.m4lIsActive(), false);
    assert.deepStrictEqual(te.m4lMapRgba(0.12, 0.34, 0.56, 0.78), [0.12, 0.34, 0.56, 0.78]);
});

check("Active theme token resolution, hue-sector remapping, and no double-mapping", () => {
    te.m4lSetThemeState({
        version: 2,
        preset: "Cyber Cyan",
        macros: { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
        tokens: {},
        deviceOverrides: {}
    });
    assert.strictEqual(te.m4lIsActive(), true);
    const lcd = te.m4lColor("live_lcd_bg");
    assert.deepStrictEqual(lcd, [0.032, 0.046, 0.072, 1.0]);
    // A color already returned by m4lColor must pass through m4lMapRgba unchanged
    assert.deepStrictEqual(te.m4lMapRgba(lcd[0], lcd[1], lcd[2], 1.0), lcd);

    // Saturated cyan/blue maps to Cyber Cyan's accent
    const mappedCyan = te.m4lMapRgba(0.28, 0.80, 0.95, 0.9);
    assert.strictEqual(mappedCyan[3], 0.9);
    assert.ok(mappedCyan[0] > 0.8 && mappedCyan[2] > 0.6, "Cyan sector maps to Cyber Cyan alt accent");
});

check("Per-device overrides isolate device theme from global theme", () => {
    te.m4lSetThemeState({
        version: 3,
        preset: "Amber LCD",
        macros: { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
        tokens: {},
        deviceOverrides: {
            tiny_space: {
                preset: "Light Studio",
                macros: {},
                tokens: { live_lcd_bg: [0.91, 0.92, 0.93, 1.0] }
            }
        }
    });
    global.M4L_DEVICE_SLUG = "sand";
    te.m4lRefreshTheme();
    const sandLcd = te.m4lColor("live_lcd_bg");
    assert.ok(sandLcd[0] < 0.1, "Sand uses global Amber LCD dark background");

    global.M4L_DEVICE_SLUG = "tiny_space";
    te.m4lRefreshTheme();
    const tsLcd = te.m4lColor("live_lcd_bg");
    assert.deepStrictEqual(tsLcd, [0.91, 0.92, 0.93, 1.0], "Tiny Space uses its device override");
    delete global.M4L_DEVICE_SLUG;
});

check("Patcher widget styler (m4lApplyPatcherTheme) applies 38% slider pre-blend and restores Default", () => {
    const attrCalls = {};
    const fakePatcher = {
        getnamed(name) {
            return {
                setattr(attr, r, g, b, a) {
                    if (!attrCalls[name]) attrCalls[name] = {};
                    attrCalls[name][attr] = [r, g, b, a];
                }
            };
        }
    };
    global.M4L_PATCHER_THEME_MAP = {
        "obj-panel-bg": {
            cls: "panel",
            attrs: { bgcolor: [0.12, 0.14, 0.16, 1.0] }
        },
        "obj-numbox-1": {
            cls: "live.numbox",
            attrs: {
                activebgcolor: [0.08, 0.10, 0.12, 1.0],
                activeslidercolor: [0.30, 0.80, 0.95, 1.0],
                textcolor: [0.90, 0.92, 0.95, 1.0]
            }
        }
    };

    te.m4lSetThemeState({
        version: 4,
        preset: "Amber LCD",
        macros: { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
        tokens: {},
        deviceOverrides: {}
    });
    const updated = te.m4lApplyPatcherTheme(fakePatcher);
    assert.ok(updated >= 4, "Updated panel and numbox attributes");
    assert.ok(attrCalls["obj-numbox-1"].activeslidercolor[0] < 0.65, "activeslidercolor is pre-blended (38% accent + 62% bg)");

    // Resetting to Default restores exact original colors
    te.m4lSetThemeState(te.m4lDefaultState());
    te.m4lApplyPatcherTheme(fakePatcher);
    assert.deepStrictEqual(attrCalls["obj-panel-bg"].bgcolor, [0.12, 0.14, 0.16, 1.0]);
    assert.deepStrictEqual(attrCalls["obj-numbox-1"].activeslidercolor, [0.30, 0.80, 0.95, 1.0]);
    delete global.M4L_PATCHER_THEME_MAP;
});

check("Ableton Live 12 .ask UI color model & inverse settings estimator (verified against macos-1 VM)", () => {
    assert.strictEqual(Object.keys(te.M4L_ABLETON_ASK_THEMES).length, 18, "All 18 Ableton Live 12 .ask themes embedded");

    // Ground-truth max.getcolor measurements captured from Ableton Live 12.4.7 in the macos-1 VM
    const vmGroundTruth = [
        {
            name: "Default Dark Neutral Medium (100% Brt, 0% Int, 0 deg Hue)",
            ui: { theme: "Default", appearance: "Dark", tone: "Neutral", highContrast: false, brightness: 100, colorIntensity: 0, colorHue: 0 },
            obs: {
                live_lcd_bg: [24 / 255, 24 / 255, 24 / 255, 1],
                live_control_bg: [30 / 255, 30 / 255, 30 / 255, 1],
                live_surface_frame: [36 / 255, 36 / 255, 36 / 255, 1],
                live_desktop: [42 / 255, 42 / 255, 42 / 255, 1],
                live_surface_bg: [54 / 255, 54 / 255, 54 / 255, 1],
                live_lcd_frame: [62 / 255, 62 / 255, 62 / 255, 1],
                live_control_zombie: [117 / 255, 117 / 255, 117 / 255, 1],
                live_display_scale_text: [134 / 255, 134 / 255, 134 / 255, 1],
                live_control_fg: [181 / 255, 181 / 255, 181 / 255, 1],
                live_control_selection: [1.0, 173 / 255, 86 / 255, 1]
            }
        },
        {
            name: "Default Dark Neutral Medium (95% Brt, 100% Int, 196 deg Hue)",
            ui: { theme: "Default", appearance: "Dark", tone: "Neutral", highContrast: false, brightness: 95, colorIntensity: 100, colorHue: 196 },
            obs: {
                live_lcd_bg: [17 / 255, 26 / 255, 29 / 255, 1],
                live_control_bg: [22 / 255, 32 / 255, 36 / 255, 1],
                live_surface_frame: [26 / 255, 39 / 255, 43 / 255, 1],
                live_desktop: [30 / 255, 45 / 255, 50 / 255, 1],
                live_surface_bg: [39 / 255, 58 / 255, 65 / 255, 1],
                live_lcd_frame: [45 / 255, 67 / 255, 75 / 255, 1],
                live_control_zombie: [85 / 255, 126 / 255, 141 / 255, 1],
                live_display_scale_text: [98 / 255, 144 / 255, 161 / 255, 1],
                live_control_fg: [156 / 255, 185 / 255, 196 / 255, 1],
                live_control_selection: [1.0, 173 / 255, 86 / 255, 1]
            }
        },
        {
            name: "User Screenshot: Default Dark Cool High (95% Brt, 100% Int, 196 deg Hue)",
            ui: { theme: "Default", appearance: "Dark", tone: "Cool", highContrast: true, brightness: 95, colorIntensity: 100, colorHue: 196 },
            obs: {
                live_lcd_bg: [11 / 255, 17 / 255, 23 / 255, 1],
                live_control_bg: [16 / 255, 25 / 255, 32 / 255, 1],
                live_surface_frame: [21 / 255, 32 / 255, 40 / 255, 1],
                live_desktop: [26 / 255, 40 / 255, 50 / 255, 1],
                live_surface_bg: [38 / 255, 57 / 255, 69 / 255, 1],
                live_lcd_frame: [46 / 255, 70 / 255, 84 / 255, 1],
                live_control_zombie: [118 / 255, 157 / 255, 178 / 255, 1],
                live_display_scale_text: [145 / 255, 175 / 255, 193 / 255, 1],
                live_control_fg: [204 / 255, 217 / 255, 228 / 255, 1],
                live_control_selection: [1.0, 173 / 255, 86 / 255, 1]
            }
        }
    ];

    for (const tc of vmGroundTruth) {
        const pred = te.m4lComputeAbletonUiTokens(tc.ui);
        for (const k of Object.keys(tc.obs)) {
            for (let c = 0; c < 3; c++) {
                const diff = Math.abs(Math.round(pred[k][c] * 255) - Math.round(tc.obs[k][c] * 255));
                assert.ok(diff <= 5, `${tc.name} ${k}[${c}] diff=${diff} > 5`);
            }
        }
        const est = te.m4lEstimateAbletonUiSettings(tc.obs);
        assert.strictEqual(est.appearance, tc.ui.appearance, `${tc.name}: estimated appearance`);
        assert.strictEqual(est.tone, tc.ui.tone, `${tc.name}: estimated tone`);
        assert.strictEqual(est.highContrast, tc.ui.highContrast, `${tc.name}: estimated highContrast`);
        assert.strictEqual(est.brightness, tc.ui.brightness, `${tc.name}: estimated brightness`);
        assert.strictEqual(est.colorIntensity, tc.ui.colorIntensity, `${tc.name}: estimated colorIntensity`);
        if (tc.ui.colorIntensity > 0) {
            assert.ok(Math.abs(est.colorHue - tc.ui.colorHue) <= 2, `${tc.name}: estimated colorHue ${est.colorHue} vs ${tc.ui.colorHue}`);
        }
        assert.ok(est.rmse < 2.0, `${tc.name}: RMSE ${est.rmse} < 2.0`);
    }
});

// 2. Built Device (`devices/Theme Editor.amxd`) Verification
check("devices/Theme Editor.amxd binary format, layout, and z-order", () => {
    const raw = fs.readFileSync(AMXD_PATH);
    assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf");
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa");
    const jsonLen = raw.readUInt32LE(28);
    const doc = JSON.parse(raw.slice(32, 32 + jsonLen).toString("utf8"));
    const p = doc.patcher;
    assert.strictEqual(p.openinpresentation, 1);
    assert.deepStrictEqual(p.openrect, [0.0, 0.0, 320.0, 169.0]);
    const lastBox = p.boxes[p.boxes.length - 1].box;
    assert.strictEqual(lastBox.maxclass, "panel");
    assert.strictEqual(lastBox.background, 1);

    // Verify p ThemeWebWindow auto-resizes jweb to match window size
    const webWin = p.boxes.find((b) => b.box.id === "obj-web-win").box.patcher;
    const wBoxes = Object.fromEntries(webWin.boxes.map((b) => [b.box.id, b.box]));
    assert.strictEqual(wBoxes["obj-qmetro"].text, "qmetro 50 @active 1");
    assert.strictEqual(wBoxes["obj-getsize"].text, "window getsize");
    assert.strictEqual(wBoxes["obj-expr-wh"].text, "vexpr $i2 - $i1");
    assert.strictEqual(wBoxes["obj-prect"].text, "presentation_rect 0. 0. $1 $2, patching_rect 0. 0. $1 $2");
});

check("Theme Editor v8ui interaction, preset switching, macro drag, and blob serialization", () => {
    const raw = fs.readFileSync(AMXD_PATH);
    const doc = JSON.parse(raw.slice(32, 32 + raw.readUInt32LE(28)).toString("utf8"));
    const vizBox = doc.patcher.boxes.find((b) => b.box.id === "obj-viz").box;
    const code = vizBox.textfile.text;
    assert.ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(code), "No shadowed Max globals");

    const drawCmds = [];
    const emitted = [];
    const globalStore = {};
    const sb = {
        mgraphics: {
            size: [308, 157],
            _fs: 9.5,
            init() {},
            redraw() { if (typeof sb.paint === "function") sb.paint(); },
            set_source_rgba(r, g, b, a) { drawCmds.push({ op: "rgba", r, g, b, a }); },
            set_source_rgb(r, g, b) { drawCmds.push({ op: "rgba", r, g, b, a: 1 }); },
            set_line_width() {},
            rectangle() {},
            rectangle_rounded(x, y, w, h) { drawCmds.push({ op: "rrect", x, y, w, h }); },
            arc(x, y, r) { drawCmds.push({ op: "arc", x, y, r }); },
            move_to() {},
            line_to() {},
            fill() {},
            stroke() {},
            select_font_face() {},
            set_font_size(s) { this._fs = s; },
            text_measure(t) { return [String(t).length * 5, 9]; },
            show_text(t) { drawCmds.push({ op: "text", t }); }
        },
        inlets: 1,
        outlets: 2,
        outlet: (idx, ...args) => emitted.push([idx, ...args]),
        notifyclients: () => {},
        arrayfromargs: (a) => Array.from(a),
        Task: function () { this.repeat = () => {}; this.cancel = () => {}; },
        Global: function (name) {
            if (!globalStore[name]) globalStore[name] = {};
            return globalStore[name];
        },
        Math, Number, String, Array, Object, JSON
    };
    vm.createContext(sb);
    vm.runInContext(code, sb);
    sb.loadbang();
    sb.paint();
    assert.ok(drawCmds.length > 20, "v8ui paints header, presets, macros, and swatches");
    assert.strictEqual(sb.uiZones.filter((z) => z.kind === "preset").length, 8, "8 preset zones");
    assert.strictEqual(sb.uiZones.filter((z) => z.kind === "macro").length, 4, "4 macro zones");
    assert.strictEqual(sb.uiZones.filter((z) => z.kind === "swatch").length, 12, "12 swatch zones");

    // Click "Cyber Cyan" preset pill
    const cyberZone = sb.uiZones.find((z) => z.kind === "preset" && z.key === "Cyber Cyan");
    sb.onclick(cyberZone.x + 5, cyberZone.y + 5);
    const bus = globalStore["m4l_theme_bus"];
    assert.ok(bus && bus.state && bus.state.preset === "Cyber Cyan", "Global bus updated to Cyber Cyan");
    assert.ok(emitted.some((e) => e[0] === 0 && e[1] === "sync_state"), "Emitted sync_state to node.codebox");

    // Drag Hue macro slider and double-click to reset
    const hueZone = sb.uiZones.find((z) => z.kind === "macro" && z.key === "hueShift");
    sb.onclick(hueZone.x + 10, hueZone.y + 10);
    sb.ondrag(hueZone.x + 30, hueZone.y + 10, 1);
    assert.ok(bus.state.macros.hueShift > 0, "Dragging Hue macro updates hueShift");
    sb.ondblclick(hueZone.x + 10, hueZone.y + 10);
    assert.strictEqual(bus.state.macros.hueShift, 0, "Double-click resets Hue macro to 0");

    // Blob serialization round-trip
    const blob = sb.getvalueof();
    assert.strictEqual(blob[0], 1);
    sb.onclick(sb.uiZones.find((z) => z.key === "reset").x + 2, sb.uiZones.find((z) => z.key === "reset").y + 2);
    assert.strictEqual(globalStore["m4l_theme_bus"].state.preset, "Default");
    sb.setvalueof(...blob);
    assert.strictEqual(globalStore["m4l_theme_bus"].state.preset, "Cyber Cyan");
});

// 3. Node WebUI HTTP Server Verification
async function testNodeServer() {
    process.env.M4L_THEME_NO_AUTOSTART = "1";
    const tmpStateFile = path.join(os.tmpdir(), `m4l_theme_test_${process.pid}.json`);
    process.env.M4L_THEME_STATE_FILE = tmpStateFile;
    const nodeMod = require(path.join(ROOT, "src", "theme_editor_node.js"));

    const html = nodeMod.buildWebHtmlPayload();
    assert.ok(html.includes("M4L THEME STUDIO") && html.includes("M4L_PRESET_THEMES"), "WebUI HTML inlines theme_engine.js");

    const model = nodeMod.extractDevicePreviewModel(AMXD_PATH);
    assert.strictEqual(model.slug, "theme_editor");
    assert.strictEqual(model.width, 320);
    assert.ok(model.widgets.some((w) => w.mc === "v8ui" && w.cmds.length > 10), "Extracted v8ui command stream");

    const srv = nodeMod.createThemeServer();
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const port = srv.address().port;

    const getJson = (urlPath) => new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
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

    const health = await getJson("/health");
    assert.strictEqual(health.ok, true);
    assert.strictEqual(health.service, "m4l-theme-editor");

    const posted = await postJson("/api/state", {
        preset: "Solarized Dark",
        macros: { hueShift: 15, satScale: 1.1, contrast: 1.0, brightness: 0.0 },
        tokens: { live_lcd_bg: [0.01, 0.12, 0.16, 1.0] }
    });
    assert.strictEqual(posted.ok, true);
    assert.strictEqual(posted.state.preset, "Solarized Dark");

    const stateRes = await getJson("/api/state");
    assert.strictEqual(stateRes.state.preset, "Solarized Dark");

    srv.close();
    if (fs.existsSync(tmpStateFile)) fs.unlinkSync(tmpStateFile);
    passes++;
    console.log("  PASS  Theme Editor Node HTTP + state persistence + device preview extraction");
}

testNodeServer().then(() => {
    console.log(`\nAll ${passes} Theme Engine & WebUI Studio checks passed.`);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
