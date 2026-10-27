#!/usr/bin/env node
/** Sweep 2 red tests for Theme Editor (tests/test_theme_editor_sweep2.js). */
"use strict";
const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
async function check(name, fn) {
    try { await fn(); pass++; console.log("  PASS  " + name); }
    catch (e) { fail++; console.log("  FAIL  " + name + "\n        " + String(e.message).split("\n")[0]); }
}
function loadUi(extra) {
    const raw = fs.readFileSync(path.join(ROOT, "devices", "Theme Editor.amxd"));
    const doc = JSON.parse(raw.slice(32).toString("utf8"));
    const code = doc.patcher.boxes.find((b) => b.box.id === "obj-viz").box.textfile.text;
    const texts = [];
    const fsz = { v: 10 };
    const noop = () => {};
    const sb = Object.assign({
        mgraphics: new Proxy({
            size: [308, 157], init: noop, redraw: noop,
            set_font_size(s) { fsz.v = s; },
            text_measure(t) { return [String(t).length * fsz.v * 0.56, fsz.v]; },
            show_text(t) { texts.push({ t: String(t), size: fsz.v, x: sb.__x }); },
            move_to(x) { sb.__x = x; },
        }, { get: (t, k) => (k in t ? t[k] : noop) }),
        outlet: noop, notifyclients: noop, post: noop,
        arrayfromargs: (a) => Array.from(a), Task: function () { this.schedule = noop; this.repeat = noop; },
        console, Math, JSON, Object, Number, String, Array, isFinite, isNaN, Date,
    }, extra || {});
    vm.createContext(sb);
    vm.runInContext(code, sb);
    return { sb, texts };
}

(async () => {
    await check("S3: hover hint (preset description) stays inside the header, left of the Popout button", () => {
        const { sb, texts } = loadUi();
        sb.paint();
        const z = sb.eval ? null : null;
        // hover the Ableton Live preset (long description)
        vm.runInContext("onidle(60, 40)", sb);
        texts.length = 0;
        sb.paint();
        const hint = texts.find((t) => t.size === 8.5 && t.x === 98);
        assert.ok(hint, "hint text drawn");
        const width = hint.t.length * 8.5 * 0.56;
        assert.ok(98 + width <= 204 - 2, `hint "${hint.t}" ends at x=${(98 + width).toFixed(0)}, over the Popout button at x=204 / canvas 308`);
    });

    await check("S3: when every port 9888.. is taken the server reports offline (server_status 0) so the LED turns red", async () => {
        const base = 40000 + Math.floor(Math.random() * 15000);
        const blockers = [];
        for (let i = 0; i < 12; i++) {
            await new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(base + i, "127.0.0.1", () => { blockers.push(s); res(); }); });
        }
        const outs = [];
        global.__MAX_API_MOCK__ = { post() {}, addHandler() {}, outlet: (...a) => outs.push(a) };
        process.env.M4L_THEME_PORT = String(base);
        process.env.M4L_THEME_STATE_FILE = path.join(os.tmpdir(), "te_sweep2_state_" + process.pid + ".json");
        delete require.cache[require.resolve(path.join(ROOT, "src", "theme_editor_node.js"))];
        try {
            const mod = require(path.join(ROOT, "src", "theme_editor_node.js"));
            await new Promise((r) => setTimeout(r, 400));
            const off = outs.some((a) => a[0] === "server_status" && Number(a[1]) === 0);
            mod.stopServer();
            assert.ok(off, "no server_status 0 emitted; LED stays green with no server");
        } finally {
            blockers.forEach((s) => s.close());
            try { fs.unlinkSync(process.env.M4L_THEME_STATE_FILE); } catch (_) {}
        }
    });

    console.log(`\n${pass} passed, ${fail} failed.`);
    process.exit(fail ? 1 : 0);
})();
