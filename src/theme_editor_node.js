/**
 * Theme Editor — Node for Max WebUI Server (`src/theme_editor_node.js`)
 *
 * Runs inside `node.codebox` (`@autostart 1`) and listens on `http://127.0.0.1:<port>`
 * (default `9888`, configurable via `M4L_THEME_PORT`, auto-scanning `9888..9899`).
 *
 * Responsibilities:
 *  1. Serves the interactive Theme Studio WebUI (`GET /`) with `src/theme_engine.js` inlined.
 *  2. Synchronizes theme state bi-directionally between the WebUI (HTTP + SSE `/api/events`),
 *     disk (`~/.m4l_theme_state.json`), and Max/Ableton (`theme_sync` -> `v8ui` -> `Global("m4l_theme_bus")`).
 *  3. Extracts presentation layouts (`panels`, `widgets`) and captures `v8ui` `paint()` command streams
 *     from all `.amxd` devices in `devices/` via an in-process `vm` sandbox (`GET /api/devices`).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const vm = require("vm");
const { execFile } = require("child_process");

let Max = null;
try {
    Max = require("max-api");
} catch (_) {
    Max = (/** @type {any} */ (global)).__MAX_API_MOCK__ || {
        post: () => {},
        outlet: () => {},
        addHandler: () => {}
    };
}

const BASE_PORT = Number(process.env.M4L_THEME_PORT) || 9888;
const MAX_PORT_SCAN = 12;
const HOST = "127.0.0.1";
const STATE_FILE = process.env.M4L_THEME_STATE_FILE || path.join(os.homedir(), ".m4l_theme_state.json");

/** @type {any} */
let currentState = {
    version: 1,
    preset: "Default",
    macros: { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
    tokens: {},
    deviceOverrides: {},
    customPresets: {},
    abletonUi: {
        enabled: false,
        theme: "Default",
        appearance: "Dark",
        tone: "Neutral",
        highContrast: false,
        gridLineIntensity: 100,
        brightness: 100,
        colorIntensity: 0,
        colorHue: 0
    }
};

/** @type {Object<string, number[]> | null} */
let hostLiveColors = null;

let activePort = BASE_PORT;
/** @type {import("http").Server | null} */
let server = null;
/** @type {Set<import("http").ServerResponse>} */
const sseClients = new Set();
/** @type {any[] | null} */
let cachedDevices = null;

function loadStateFromDisk() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            if (raw && typeof raw === "object") {
                currentState = Object.assign(currentState, raw);
            }
        }
    } catch (_) {}
    return currentState;
}

function saveStateToDisk(st) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), "utf8");
    } catch (_) {}
}

function broadcastSse(st) {
    const payload = `data: ${JSON.stringify({ state: st, hostLiveColors })}\n\n`;
    for (const res of sseClients) {
        try {
            res.write(payload);
        } catch (_) {
            sseClients.delete(res);
        }
    }
}

function slugifyName(name) {
    return String(name || "")
        .replace(/\.amxd$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "device";
}

function captureV8CommandsInVm(jsCode, w, h) {
    /** @type {any[]} */
    const cmds = [];
    const noop = () => {};
    const mgraphicsMock = {
        size: [w, h],
        _fs: 10,
        init: noop,
        redraw: noop,
        set_source_rgba(r, g, b, a = 1.0) {
            if (Array.isArray(r)) {
                cmds.push({ op: "rgba", r: Number(r[0]) || 0, g: Number(r[1]) || 0, b: Number(r[2]) || 0, a: r.length > 3 ? Number(r[3]) : 1.0 });
            } else {
                cmds.push({ op: "rgba", r: Number(r) || 0, g: Number(g) || 0, b: Number(b) || 0, a: a === undefined ? 1.0 : Number(a) });
            }
        },
        set_source_rgb(r, g, b) {
            if (Array.isArray(r)) {
                cmds.push({ op: "rgba", r: Number(r[0]) || 0, g: Number(r[1]) || 0, b: Number(r[2]) || 0, a: 1.0 });
            } else {
                cmds.push({ op: "rgba", r: Number(r) || 0, g: Number(g) || 0, b: Number(b) || 0, a: 1.0 });
            }
        },
        set_line_width(lw) { cmds.push({ op: "line_width", w: Number(lw) || 1 }); },
        rectangle(x, y, rw, rh) { cmds.push({ op: "rect", x: Number(x) || 0, y: Number(y) || 0, w: Number(rw) || 0, h: Number(rh) || 0 }); },
        rectangle_rounded(x, y, rw, rh, rx, ry) { cmds.push({ op: "rrect", x: Number(x) || 0, y: Number(y) || 0, w: Number(rw) || 0, h: Number(rh) || 0, rx: Number(rx) || 2, ry: Number(ry) || 2 }); },
        move_to(x, y) { cmds.push({ op: "move_to", x: Number(x) || 0, y: Number(y) || 0 }); },
        line_to(x, y) { cmds.push({ op: "line_to", x: Number(x) || 0, y: Number(y) || 0 }); },
        curve_to(x1, y1, x2, y2, x3, y3) { cmds.push({ op: "curve_to", x1, y1, x2, y2, x3, y3 }); },
        close_path() { cmds.push({ op: "close_path" }); },
        arc(x, y, r, a1, a2) { cmds.push({ op: "arc", x: Number(x) || 0, y: Number(y) || 0, r: Number(r) || 1, a1: Number(a1) || 0, a2: Number(a2) || 0 }); },
        ellipse(x, y, rw, rh) { cmds.push({ op: "arc", x: x + rw * 0.5, y: y + rh * 0.5, r: Math.min(rw, rh) * 0.5, a1: 0, a2: Math.PI * 2 }); },
        text_measure(t) { return [String(t).length * (this._fs || 10) * 0.56, this._fs || 10]; },
        fill() { cmds.push({ op: "fill", preserve: false }); },
        fill_preserve() { cmds.push({ op: "fill", preserve: true }); },
        stroke() { cmds.push({ op: "stroke", preserve: false }); },
        select_font_face(face) { cmds.push({ op: "font_face", face: String(face || "") }); },
        set_font_size(size) { this._fs = Number(size) || 10; cmds.push({ op: "font_size", size: this._fs }); },
        show_text(text) { cmds.push({ op: "show_text", text: String(text || "") }); },
        save() { cmds.push({ op: "save" }); },
        restore() { cmds.push({ op: "restore" }); },
        translate(x, y) { cmds.push({ op: "translate", x: Number(x) || 0, y: Number(y) || 0 }); },
        rotate(a) { cmds.push({ op: "rotate", a: Number(a) || 0 }); }
    };
    const sandbox = {
        mgraphics: mgraphicsMock,
        inlets: 1,
        outlets: 2,
        outlet: noop,
        notifyclients: noop,
        post: noop,
        arrayfromargs: (a) => Array.from(a || []),
        Buffer: function () {
            this.poke = noop;
            this.peek = () => 0;
            this.framecount = () => 4096;
            this.channelcount = () => 2;
        },
        Task: function () {
            this.schedule = noop;
            this.repeat = noop;
            this.cancel = noop;
        },
        Global: function () { return {}; },
        Math, Number, String, Array, Object, JSON, Date, Float32Array, Float64Array, Int32Array, Uint8Array, RegExp, Map, Set, parseInt, parseFloat, isNaN, isFinite
    };
    try {
        vm.createContext(sandbox);
        vm.runInContext(jsCode, sandbox, { timeout: 600 });
        if (typeof (/** @type {any} */ (sandbox)).preview === "function") (/** @type {any} */ (sandbox)).preview();
        else if (typeof (/** @type {any} */ (sandbox)).setphase === "function") (/** @type {any} */ (sandbox)).setphase(0.32);
        if (typeof (/** @type {any} */ (sandbox)).paint === "function") (/** @type {any} */ (sandbox)).paint();
    } catch (_) {}
    return cmds;
}

function tokenFromSaa(box, attr) {
    const saa = box.saved_attribute_attributes || {};
    const entry = saa[attr];
    if (entry && typeof entry === "object" && typeof entry.expression === "string" && entry.expression.startsWith("themecolor.")) {
        return entry.expression.slice("themecolor.".length);
    }
    return undefined;
}

function isTransparentWidget(box) {
    const mc = String(box.maxclass || "");
    if (!mc.startsWith("live.") || mc === "live.comment") return false;
    const cols = [];
    for (const [k, v] of Object.entries(box)) {
        if (k.includes("color") && k !== "focusbordercolor" && Array.isArray(v) && v.length === 4) {
            cols.push(v);
        }
    }
    return cols.length > 0 && cols.every((c) => c[3] === 0);
}

function extractDevicePreviewModel(amxdPath) {
    const raw = fs.readFileSync(amxdPath);
    const doc = JSON.parse(raw.slice(32).toString("utf8"));
    const p = doc.patcher || {};
    const name = path.basename(amxdPath, ".amxd");
    const slug = slugifyName(name);
    const width = Math.round(Number(p.devicewidth || (p.openrect && p.openrect[2]) || 400));
    const boxes = (p.boxes || []).map((b) => b.box).filter((b) => b && b.presentation === 1 && !b.hidden);

    const panels = [];
    const widgets = [];

    for (const b of boxes) {
        const rect = b.presentation_rect || [0, 0, 40, 20];
        if (b.maxclass === "panel") {
            const bgFill = b.bgfillcolor && Array.isArray(b.bgfillcolor.color) ? b.bgfillcolor.color : (Array.isArray(b.bgfillcolor) ? b.bgfillcolor : null);
            panels.push({
                id: b.id,
                rect,
                rounded: b.rounded !== undefined ? b.rounded : 4,
                bgcolor: b.bgcolor || bgFill || [0.125, 0.145, 0.17, 1.0],
                bordercolor: b.bordercolor || b.bgcolor || [0.06, 0.07, 0.08, 1.0],
                bgToken: tokenFromSaa(b, "bgfillcolor") || tokenFromSaa(b, "bgcolor"),
                bdToken: tokenFromSaa(b, "bordercolor") || tokenFromSaa(b, "bgfillcolor")
            });
            continue;
        }
        if (isTransparentWidget(b)) continue;

        const mc = b.maxclass;
        if (mc === "v8ui" && b.textfile && b.textfile.text) {
            const cmds = captureV8CommandsInVm(b.textfile.text, rect[2], rect[3]);
            widgets.push({ id: b.id, mc: "v8ui", rect, cmds });
        } else if (mc === "live.comment") {
            widgets.push({
                id: b.id,
                mc,
                rect,
                text: b.text || "",
                fontsize: b.fontsize || 9.0,
                textcolor: b.textcolor || [0.82, 0.85, 0.90, 1.0],
                tcToken: tokenFromSaa(b, "textcolor")
            });
        } else if (mc === "live.line") {
            widgets.push({
                id: b.id,
                mc,
                rect,
                linecolor: b.linecolor || [0.22, 0.24, 0.28, 1.0],
                lcToken: tokenFromSaa(b, "linecolor")
            });
        } else if (mc === "live.dial" || mc === "live.numbox" || mc === "live.menu" || mc === "live.tab" || mc === "live.text") {
            const vof = (b.saved_attribute_attributes && b.saved_attribute_attributes.valueof) || {};
            const initVal = Array.isArray(vof.parameter_initial) ? Number(vof.parameter_initial[0]) || 0 : 0;
            const lo = vof.parameter_mmin !== undefined ? Number(vof.parameter_mmin) : 0;
            const hi = vof.parameter_mmax !== undefined ? Number(vof.parameter_mmax) : 100;
            const enums = Array.isArray(vof.parameter_enum) ? vof.parameter_enum : null;
            const norm = Math.max(0, Math.min(1, (initVal - lo) / Math.max(1e-6, hi - lo)));
            const label = vof.parameter_shortname || b.text || "";
            const valStr = enums ? String(enums[Math.max(0, Math.min(enums.length - 1, Math.round(initVal)))] || "") : String(Math.round(initVal * 10) / 10);
            widgets.push({
                id: b.id,
                mc,
                rect,
                appearance: b.appearance || 0,
                showname: b.showname,
                shownumber: b.shownumber,
                label,
                valStr,
                norm,
                activedialcolor: b.activedialcolor || [0.30, 0.82, 0.95, 1.0],
                bgcolor: b.activebgcolor || b.bgcolor || [0.09, 0.11, 0.13, 1.0],
                textcolor: b.textcolor || b.lcdcolor || [0.88, 0.90, 0.94, 1.0],
                acToken: tokenFromSaa(b, "activedialcolor"),
                bgToken: tokenFromSaa(b, "activebgcolor") || tokenFromSaa(b, "bgcolor"),
                tcToken: tokenFromSaa(b, "textcolor") || tokenFromSaa(b, "lcdcolor")
            });
        }
    }

    return { name, slug, width, panels, widgets };
}

function findDevicesDir() {
    const candidates = [
        process.env.M4L_DEVICES_DIR || "",
        path.resolve(__dirname, "..", "devices"),
        path.resolve(process.cwd(), "devices"),
        "/tmp/ableton/theme-engine/devices",
        "/Users/mrwilson/software/ableton/devices"
    ].filter(Boolean);
    for (const d of candidates) {
        if (fs.existsSync(d)) return d;
    }
    return candidates[0] || path.resolve(__dirname, "..", "devices");
}

function getAllDeviceModels() {
    if (cachedDevices) return cachedDevices;
    const dir = findDevicesDir();
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".amxd")).sort();
    const out = [];
    for (const f of files) {
        try {
            out.push(extractDevicePreviewModel(path.join(dir, f)));
        } catch (_) {}
    }
    cachedDevices = out;
    return out;
}

function buildWebHtmlPayload() {
    if (typeof M4L_THEME_WEB_HTML === "string" && M4L_THEME_WEB_HTML.length > 0) {
        return M4L_THEME_WEB_HTML;
    }
    try {
        const srcDir = path.resolve(__dirname);
        const htmlRaw = fs.readFileSync(path.join(srcDir, "theme_editor_web.html"), "utf8");
        const engRaw = fs.readFileSync(path.join(srcDir, "theme_engine.js"), "utf8");
        return htmlRaw.replace('<script id="m4lThemeEngineInline"></script>', `<script id="m4lThemeEngineInline">\n${engRaw}\n</script>`);
    } catch (e) {
        return "<html><body><h1>M4L Theme Studio</h1></body></html>";
    }
}

function mergeThemeState(prev, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return prev;
    const next = Object.assign({}, prev, patch);
    if (patch.macros && typeof patch.macros === "object") {
        next.macros = Object.assign({}, prev.macros || {}, patch.macros);
    }
    // Present map fields replace (so WebUI full-state deletes stick); absent fields keep prev.
    if (patch.tokens && typeof patch.tokens === "object") {
        next.tokens = Object.assign({}, patch.tokens);
    }
    if (patch.deviceOverrides && typeof patch.deviceOverrides === "object") {
        next.deviceOverrides = Object.assign({}, patch.deviceOverrides);
    }
    if (patch.customPresets && typeof patch.customPresets === "object") {
        next.customPresets = Object.assign({}, patch.customPresets);
    }
    if (patch.abletonUi && typeof patch.abletonUi === "object") {
        next.abletonUi = Object.assign({}, prev.abletonUi || {}, patch.abletonUi);
    }
    return next;
}

Max.addHandler("sync_state", (jsonStr) => {
    try {
        const parsed = JSON.parse(String(jsonStr || "{}"));
        if (parsed && typeof parsed === "object") {
            currentState = mergeThemeState(currentState, parsed);
            saveStateToDisk(currentState);
            broadcastSse(currentState);
        }
    } catch (_) {}
});

Max.addHandler("host_live_colors", (jsonStr) => {
    try {
        const parsed = JSON.parse(String(jsonStr || "{}"));
        if (parsed && typeof parsed === "object") {
            hostLiveColors = parsed;
            broadcastSse(currentState);
        }
    } catch (_) {}
});

Max.addHandler("open_browser", (urlStr) => {
    const targetUrl = String(urlStr || `http://${HOST}:${activePort}/`);
    if (process.platform === "darwin") {
        try {
            execFile("open", [targetUrl], () => {});
        } catch (_) {}
    }
});

function createThemeServer() {
    return http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const urlPath = (req.url || "/").split("?")[0];

        if (req.method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
            const html = buildWebHtmlPayload();
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
        }

        if (req.method === "GET" && urlPath === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                ok: true,
                service: "m4l-theme-editor",
                port: activePort,
                pid: process.pid,
                max_ppid: process.ppid,
                preset: currentState.preset || "Default"
            }));
            return;
        }

        if (req.method === "GET" && urlPath === "/api/state") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, state: currentState, hostLiveColors }));
            return;
        }

        if (req.method === "GET" && urlPath === "/api/host-live-colors") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, hostLiveColors }));
            return;
        }

        if (req.method === "POST" && urlPath === "/api/state") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const patch = JSON.parse(body || "{}");
                    const next = mergeThemeState(currentState, patch);
                    next.version = (Number(currentState.version) || 0) + 1;
                    currentState = next;
                    saveStateToDisk(currentState);
                    broadcastSse(currentState);
                    try {
                        Max.outlet("theme_sync", JSON.stringify(currentState));
                    } catch (_) {}
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, state: currentState }));
                } catch (err) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: String(err) }));
                }
            });
            return;
        }

        if (req.method === "GET" && urlPath === "/api/devices") {
            const devs = getAllDeviceModels();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, devices: devs }));
            return;
        }

        if (req.method === "GET" && urlPath === "/api/events") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });
            res.write(`data: ${JSON.stringify({ state: currentState })}\n\n`);
            sseClients.add(res);
            req.on("close", () => { sseClients.delete(res); });
            return;
        }

        if (req.method === "POST" && urlPath === "/api/shutdown") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            setTimeout(() => {
                if (server) {
                    try { server.close(); } catch (_) {}
                    server = null;
                }
            }, 25);
            return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
    });
}

function startListening(port, attempt) {
    if (attempt >= MAX_PORT_SCAN) return;
    const srv = createThemeServer();
    srv.on("error", (/** @type {any} */ err) => {
        if (err && err.code === "EADDRINUSE") {
            startListening(port + 1, attempt + 1);
        }
    });
    srv.listen(port, HOST, () => {
        server = srv;
        activePort = port;
        try {
            Max.outlet("server_status", 1, activePort);
            Max.outlet("theme_sync", JSON.stringify(currentState));
        } catch (_) {}
    });
}

loadStateFromDisk();
if (!process.env.M4L_THEME_NO_AUTOSTART) {
    startListening(BASE_PORT, 0);
}

var _teNodeModule = (typeof module !== "undefined") ? module : undefined;
if (_teNodeModule && _teNodeModule.exports) {
    _teNodeModule.exports = {
        loadStateFromDisk,
        saveStateToDisk,
        extractDevicePreviewModel,
        getAllDeviceModels,
        buildWebHtmlPayload,
        createThemeServer,
        getState: () => currentState,
        setState: (/** @type {any} */ s) => { currentState = s; },
        stopServer: () => {
            if (server) {
                try { server.close(); } catch (_) {}
                server = null;
            }
        }
    };
}
