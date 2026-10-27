// Theme Editor — In-Device v8ui Face (`src/theme_editor_ui.js`, 308 x 157 px inside 320 x 169 px device).
// `src/theme_engine.js` is prepended at build time.
//
// Outlet 0 -> `node.codebox` (`sync_state <json>`, `open_browser`)
// Outlet 1 -> `p ThemeWebWindow` subpatcher (`open`, `url <http://127.0.0.1:port>`)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;

var TE_W = 308;
var TE_H = 157;

var serverOnline = 1;
var serverPort = 9888;
var hoverZoneId = "";
var hoverHint = "";
/** @type {{ kind: string, key: string, startX: number, startVal: number } | null} */
var activeDrag = null;
/** @type {Array<{ id: string, kind: string, key: string, x: number, y: number, w: number, h: number, hint: string }>} */
var uiZones = [];

var SWATCH_TOKENS = [
    ["surf", "live_surface_bg"],
    ["desk", "live_desktop"],
    ["lcd", "live_lcd_bg"],
    ["fg", "live_control_fg"],
    ["sel", "live_control_selection"],
    ["amb", "live_lcd_control_fg"],
    ["cyn", "live_lcd_control_fg_alt"],
    ["ln1", "live_display_line_one"],
    ["ln2", "live_display_line_two"],
    ["alrt", "live_alert"],
    ["grn", "accent_green"],
    ["vio", "accent_violet"]
];

var MACRO_DEFS = [
    { key: "hueShift", label: "Hue", lo: -180, hi: 180, def: 0, fmt: function (/** @type {number} */ v) { return (v >= 0 ? "+" : "") + Math.round(v) + "d"; } },
    { key: "satScale", label: "Sat", lo: 0.0, hi: 2.0, def: 1.0, fmt: function (/** @type {number} */ v) { return Math.round(v * 100) + "%"; } },
    { key: "contrast", label: "Cont", lo: 0.5, hi: 1.6, def: 1.0, fmt: function (/** @type {number} */ v) { return Math.round(v * 100) + "%"; } },
    { key: "brightness", label: "Brt", lo: -0.3, hi: 0.3, def: 0.0, fmt: function (/** @type {number} */ v) { return (v >= 0 ? "+" : "") + Math.round(v * 100) + "%"; } }
];

function teBroadcastState(sendToNode) {
    var st = m4lGetThemeState();
    m4lSetThemeState(st);
    if (sendToNode) {
        outlet(0, "sync_state", JSON.stringify(m4lGetThemeState()));
    }
    notifyclients();
    mgraphics.redraw();
}

function set_server_status(online, portNum) {
    serverOnline = Number(online) ? 1 : 0;
    if (Number(portNum) >= 1024) serverPort = Number(portNum);
    outlet(1, "url", "http://127.0.0.1:" + serverPort + "/");
    mgraphics.redraw();
}

function theme_sync(jsonStr) {
    try {
        var parsed = JSON.parse(String(jsonStr || "{}"));
        if (parsed && typeof parsed === "object") {
            m4lSetThemeState(parsed);
            notifyclients();
            mgraphics.redraw();
        }
    } catch (e) {}
}

function teEmitHostColors() {
    var names = [
        "live_desktop", "live_surface_bg", "live_surface_frame",
        "live_lcd_bg", "live_lcd_frame", "live_lcd_title",
        "live_lcd_control_fg", "live_lcd_control_fg_alt",
        "live_display_line_one", "live_display_line_two",
        "live_display_handle_one", "live_display_handle_two",
        "live_display_scale_text", "live_control_bg", "live_control_fg",
        "live_control_fg_on", "live_control_selection", "live_control_zombie",
        "live_alert", "live_contrast_frame", "live_dial_fg", "live_dial_needle",
        "live_value_arc", "live_value_bar", "live_macro_title"
    ];
    /** @type {Object<string, number[]>} */
    var out = {};
    var hasAny = false;
    for (var i = 0; i < names.length; i++) {
        var k = names[i];
        try {
            if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
                var c = max.getcolor(k);
                if (c && c.length >= 3) {
                    out[k] = [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1.0];
                    hasAny = true;
                }
            }
        } catch (e) {}
    }
    if (hasAny) {
        outlet(0, "host_live_colors", JSON.stringify(out));
    }
}

function loadbang() {
    teEmitHostColors();
    m4lThemeWatch(function () {
        teEmitHostColors();
        mgraphics.redraw();
    });
    mgraphics.redraw();
}

function preview() {
    serverOnline = 1;
    serverPort = 9888;
}

function getvalueof() {
    var st = m4lGetThemeState();
    return [1, JSON.stringify(st)];
}

function setvalueof(v) {
    var arr = arrayfromargs(arguments);
    if (!arr || arr.length === 0) return;
    var jsonStr = arr.length >= 2 && typeof arr[0] === "number" ? String(arr[1]) : String(arr[0]);
    try {
        var parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === "object") {
            m4lSetThemeState(parsed);
            outlet(0, "sync_state", JSON.stringify(m4lGetThemeState()));
            mgraphics.redraw();
        }
    } catch (e) {}
}

function teRawRgba(r, g, b, a) {
    if (typeof _m4lOrigSetRgba === "function") {
        _m4lOrigSetRgba.call(mgraphics, r, g, b, a === undefined ? 1.0 : a);
    } else {
        mgraphics.set_source_rgba(r, g, b, a === undefined ? 1.0 : a);
    }
}

function paint() {
    uiZones = [];
    var st = m4lGetThemeState();
    var activePreset = st.preset || "Default";
    var tok = m4lResolvedTokens();

    // Background LCD card
    var bg = tok.live_lcd_bg || [0.075, 0.088, 0.112, 1];
    var desk = tok.live_desktop || [0.14, 0.15, 0.18, 1];
    var frame = tok.live_lcd_frame || [0.22, 0.25, 0.30, 1];
    var titleCol = tok.live_lcd_title || [0.75, 0.78, 0.84, 1];
    var fgCol = tok.live_control_fg || [0.86, 0.89, 0.94, 1];
    var selCol = tok.live_control_selection || [1.0, 0.68, 0.34, 1];
    var altCol = tok.live_lcd_control_fg_alt || [0.02, 0.76, 0.84, 1];

    teRawRgba(bg[0], bg[1], bg[2], 1.0);
    mgraphics.rectangle_rounded(0, 0, TE_W, TE_H, 6, 6);
    mgraphics.fill();

    teRawRgba(frame[0], frame[1], frame[2], 0.85);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle_rounded(0.5, 0.5, TE_W - 1, TE_H - 1, 6, 6);
    mgraphics.stroke();

    // 1. Header Bar (y = 0..24)
    teRawRgba(desk[0], desk[1], desk[2], 0.95);
    mgraphics.rectangle_rounded(2, 2, TE_W - 4, 22, 4, 4);
    mgraphics.fill();

    // Status LED
    if (serverOnline) {
        teRawRgba(0.24, 0.90, 0.52, 1.0);
    } else {
        teRawRgba(0.92, 0.34, 0.28, 1.0);
    }
    mgraphics.arc(11, 13, 3.5, 0, Math.PI * 2);
    mgraphics.fill();

    mgraphics.select_font_face("Ableton Sans Medium");
    mgraphics.set_font_size(9.5);
    teRawRgba(fgCol[0], fgCol[1], fgCol[2], 1.0);
    mgraphics.move_to(20, 16.5);
    mgraphics.show_text("THEME STUDIO");

    // Port / Hint badge
    mgraphics.set_font_size(8.5);
    teRawRgba(titleCol[0], titleCol[1], titleCol[2], 0.9);
    var badgeTxt = hoverHint ? hoverHint : (":" + serverPort + " · " + activePreset);
    var badgeMax = 100;
    if (mgraphics.text_measure(badgeTxt)[0] > badgeMax) {
        while (badgeTxt.length > 1 && mgraphics.text_measure(badgeTxt + "...")[0] > badgeMax) {
            badgeTxt = badgeTxt.slice(0, -1);
        }
        badgeTxt += "...";
    }
    mgraphics.move_to(98, 16.2);
    mgraphics.show_text(badgeTxt);

    // [Popout] and [WebUI] buttons in header
    var popRect = { id: "btn_popout", kind: "btn", key: "popout", x: 204, y: 4, w: 46, h: 18, hint: "Open floating jweb window" };
    var webRect = { id: "btn_webui", kind: "btn", key: "webui", x: 253, y: 4, w: 51, h: 18, hint: "Open WebUI in browser" };
    uiZones.push(popRect, webRect);

    for (var bi = 0; bi < 2; bi++) {
        var b = bi === 0 ? popRect : webRect;
        var isHov = hoverZoneId === b.id;
        if (bi === 1) {
            teRawRgba(selCol[0], selCol[1], selCol[2], isHov ? 1.0 : 0.88);
            mgraphics.rectangle_rounded(b.x, b.y, b.w, b.h, 3, 3);
            mgraphics.fill();
            teRawRgba(bg[0], bg[1], bg[2], 1.0);
        } else {
            teRawRgba(frame[0], frame[1], frame[2], isHov ? 0.95 : 0.65);
            mgraphics.rectangle_rounded(b.x, b.y, b.w, b.h, 3, 3);
            mgraphics.stroke();
            teRawRgba(fgCol[0], fgCol[1], fgCol[2], 0.95);
        }
        mgraphics.set_font_size(8.5);
        var lbl = bi === 0 ? "Popout" : "WebUI";
        var tw = mgraphics.text_measure(lbl)[0];
        mgraphics.move_to(b.x + (b.w - tw) * 0.5, b.y + 12.2);
        mgraphics.show_text(lbl);
    }

    // 2. Preset Grid (4x2 pills at y = 28..88)
    var cols = 4;
    var padX = 5;
    var gapX = 4;
    var gapY = 4;
    var cellW = (TE_W - padX * 2 - gapX * (cols - 1)) / cols;
    var cellH = 27;
    for (var pi = 0; pi < M4L_PRESET_NAMES.length; pi++) {
        var pName = M4L_PRESET_NAMES[pi];
        var pDef = M4L_PRESET_THEMES[pName];
        var pTok = (pDef && pDef.tokens) ? pDef.tokens : M4L_DEFAULT_TOKENS;
        var colIdx = pi % cols;
        var rowIdx = (pi / cols) | 0;
        var cx = padX + colIdx * (cellW + gapX);
        var cy = 28 + rowIdx * (cellH + gapY);
        var isSel = activePreset === pName;
        var zId = "preset_" + pi;
        uiZones.push({
            id: zId,
            kind: "preset",
            key: pName,
            x: cx,
            y: cy,
            w: cellW,
            h: cellH,
            hint: pDef ? pDef.desc : pName
        });

        teRawRgba(desk[0], desk[1], desk[2], isSel ? 1.0 : 0.65);
        mgraphics.rectangle_rounded(cx, cy, cellW, cellH, 4, 4);
        mgraphics.fill();

        if (isSel) {
            teRawRgba(selCol[0], selCol[1], selCol[2], 0.95);
            mgraphics.set_line_width(1.4);
        } else {
            teRawRgba(frame[0], frame[1], frame[2], hoverZoneId === zId ? 0.9 : 0.45);
            mgraphics.set_line_width(1.0);
        }
        mgraphics.rectangle_rounded(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1, 4, 4);
        mgraphics.stroke();

        // 3 mini swatch dots in top-right of preset pill
        var d1 = pTok.live_surface_bg || [0.2, 0.2, 0.2];
        var d2 = pTok.live_lcd_control_fg || [1.0, 0.68, 0.34];
        var d3 = pTok.live_lcd_control_fg_alt || [0.02, 0.76, 0.84];
        var dots = [d1, d2, d3];
        for (var di = 0; di < 3; di++) {
            var dc = dots[di];
            teRawRgba(dc[0], dc[1], dc[2], 1.0);
            mgraphics.arc(cx + cellW - 18 + di * 6, cy + 7.5, 2.2, 0, Math.PI * 2);
            mgraphics.fill();
        }

        mgraphics.set_font_size(8.2);
        if (isSel) {
            teRawRgba(selCol[0], selCol[1], selCol[2], 1.0);
        } else {
            teRawRgba(fgCol[0], fgCol[1], fgCol[2], 0.88);
        }
        var shortLbl = pName === "Solarized Dark" ? "Solarized" : (pName === "High Contrast" ? "Hi-Contrast" : pName);
        mgraphics.move_to(cx + 5, cy + 20.5);
        mgraphics.show_text(shortLbl);
    }

    // 3. Macro Strip (y = 92..118)
    var macY = 92;
    var macH = 24;
    var resetW = 38;
    var macGap = 4;
    var macAvailW = TE_W - padX * 2 - resetW - macGap * 4;
    var macW = macAvailW / 4;
    var macros = st.macros || { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 };

    for (var mi = 0; mi < MACRO_DEFS.length; mi++) {
        var md = MACRO_DEFS[mi];
        var mx = padX + mi * (macW + macGap);
        var curV = macros[md.key] === undefined ? md.def : Number(macros[md.key]);
        var norm = m4lClamp((curV - md.lo) / (md.hi - md.lo), 0, 1);
        var mzId = "macro_" + md.key;
        uiZones.push({
            id: mzId,
            kind: "macro",
            key: md.key,
            x: mx,
            y: macY,
            w: macW,
            h: macH,
            hint: "Drag " + md.label + " (double-click to reset)"
        });

        teRawRgba(desk[0], desk[1], desk[2], 0.8);
        mgraphics.rectangle_rounded(mx, macY, macW, macH, 3, 3);
        mgraphics.fill();

        // Fill bar at bottom of macro cell
        var fillW = Math.max(2, (macW - 4) * norm);
        teRawRgba(altCol[0], altCol[1], altCol[2], 0.45);
        mgraphics.rectangle_rounded(mx + 2, macY + macH - 6, fillW, 4, 1.5, 1.5);
        mgraphics.fill();

        teRawRgba(frame[0], frame[1], frame[2], hoverZoneId === mzId ? 0.9 : 0.45);
        mgraphics.set_line_width(1.0);
        mgraphics.rectangle_rounded(mx + 0.5, macY + 0.5, macW - 1, macH - 1, 3, 3);
        mgraphics.stroke();

        mgraphics.set_font_size(7.8);
        teRawRgba(titleCol[0], titleCol[1], titleCol[2], 0.9);
        mgraphics.move_to(mx + 4, macY + 11.5);
        mgraphics.show_text(md.label);

        var vStr = md.fmt(curV);
        var vTw = mgraphics.text_measure(vStr)[0];
        teRawRgba(fgCol[0], fgCol[1], fgCol[2], 0.95);
        mgraphics.move_to(mx + macW - vTw - 4, macY + 11.5);
        mgraphics.show_text(vStr);
    }

    // Reset button
    var rx = padX + 4 * (macW + macGap);
    uiZones.push({
        id: "btn_reset",
        kind: "btn",
        key: "reset",
        x: rx,
        y: macY,
        w: resetW,
        h: macH,
        hint: "Reset theme & macros to Default"
    });
    teRawRgba(desk[0], desk[1], desk[2], 0.85);
    mgraphics.rectangle_rounded(rx, macY, resetW, macH, 3, 3);
    mgraphics.fill();
    teRawRgba(frame[0], frame[1], frame[2], hoverZoneId === "btn_reset" ? 0.95 : 0.5);
    mgraphics.rectangle_rounded(rx + 0.5, macY + 0.5, resetW - 1, macH - 1, 3, 3);
    mgraphics.stroke();
    mgraphics.set_font_size(8.0);
    teRawRgba(fgCol[0], fgCol[1], fgCol[2], 0.9);
    var rTw = mgraphics.text_measure("Reset")[0];
    mgraphics.move_to(rx + (resetW - rTw) * 0.5, macY + 14.5);
    mgraphics.show_text("Reset");

    // 4. Live 12-Token Swatch Bar (y = 121..152)
    var swY = 121;
    var swH = 31;
    var swCount = SWATCH_TOKENS.length;
    var swGap = 2.5;
    var swW = (TE_W - padX * 2 - swGap * (swCount - 1)) / swCount;
    for (var si = 0; si < swCount; si++) {
        var pair = SWATCH_TOKENS[si];
        var sx = padX + si * (swW + swGap);
        var sc = tok[pair[1]] || [0.5, 0.5, 0.5, 1];
        var szId = "swatch_" + pair[0];
        uiZones.push({
            id: szId,
            kind: "swatch",
            key: pair[1],
            x: sx,
            y: swY,
            w: swW,
            h: swH,
            hint: pair[1]
        });

        teRawRgba(sc[0], sc[1], sc[2], 1.0);
        mgraphics.rectangle_rounded(sx, swY, swW, swH - 10, 2.5, 2.5);
        mgraphics.fill();

        teRawRgba(frame[0], frame[1], frame[2], hoverZoneId === szId ? 0.95 : 0.45);
        mgraphics.set_line_width(1.0);
        mgraphics.rectangle_rounded(sx + 0.5, swY + 0.5, swW - 1, swH - 10, 2.5, 2.5);
        mgraphics.stroke();

        mgraphics.set_font_size(7.0);
        teRawRgba(titleCol[0], titleCol[1], titleCol[2], 0.85);
        var sTw = mgraphics.text_measure(pair[0])[0];
        mgraphics.move_to(sx + (swW - sTw) * 0.5, swY + swH - 1.5);
        mgraphics.show_text(pair[0]);
    }
}

function teFindZone(x, y) {
    for (var i = 0; i < uiZones.length; i++) {
        var z = uiZones[i];
        if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z;
    }
    return null;
}

function onidle(x, y) {
    var z = teFindZone(x, y);
    var nid = z ? z.id : "";
    var nhint = z ? z.hint : "";
    if (nid !== hoverZoneId || nhint !== hoverHint) {
        hoverZoneId = nid;
        hoverHint = nhint;
        mgraphics.redraw();
    }
}

function onidleout() {
    if (hoverZoneId || hoverHint) {
        hoverZoneId = "";
        hoverHint = "";
        mgraphics.redraw();
    }
}

function onclick(x, y) {
    var z = teFindZone(x, y);
    activeDrag = null;
    if (!z) return;
    var st = m4lGetThemeState();
    if (z.kind === "preset") {
        st.preset = z.key;
        st.tokens = {};
        teBroadcastState(true);
    } else if (z.kind === "btn") {
        if (z.key === "reset") {
            m4lSetThemeState(m4lDefaultState());
            teBroadcastState(true);
        } else if (z.key === "webui") {
            var url = "http://127.0.0.1:" + serverPort + "/";
            try {
                if (typeof max !== "undefined" && max && typeof (/** @type {any} */ (max)).launchbrowser === "function") {
                    (/** @type {any} */ (max)).launchbrowser(url);
                }
            } catch (e) {}
            outlet(0, "open_browser", url);
        } else if (z.key === "popout") {
            outlet(1, "url", "http://127.0.0.1:" + serverPort + "/");
            outlet(1, "open");
        }
    } else if (z.kind === "macro") {
        var md = null;
        for (var i = 0; i < MACRO_DEFS.length; i++) {
            if (MACRO_DEFS[i].key === z.key) md = MACRO_DEFS[i];
        }
        if (md) {
            var cur = (st.macros && st.macros[z.key] !== undefined) ? Number(st.macros[z.key]) : md.def;
            activeDrag = { kind: "macro", key: z.key, startX: x, startVal: cur };
        }
    }
}

function ondrag(x, y, but) {
    if (!activeDrag || !but) {
        activeDrag = null;
        return;
    }
    if (activeDrag.kind === "macro") {
        var md = null;
        for (var i = 0; i < MACRO_DEFS.length; i++) {
            if (MACRO_DEFS[i].key === activeDrag.key) md = MACRO_DEFS[i];
        }
        if (!md) return;
        var dx = x - activeDrag.startX;
        var span = md.hi - md.lo;
        var nextVal = m4lClamp(activeDrag.startVal + (dx / 80.0) * span, md.lo, md.hi);
        var st = m4lGetThemeState();
        if (!st.macros) st.macros = { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 };
        st.macros[activeDrag.key] = Number(nextVal.toFixed(3));
        teBroadcastState(true);
    }
}

function ondblclick(x, y) {
    var z = teFindZone(x, y);
    if (!z) return;
    if (z.kind === "macro") {
        var md = null;
        for (var i = 0; i < MACRO_DEFS.length; i++) {
            if (MACRO_DEFS[i].key === z.key) md = MACRO_DEFS[i];
        }
        if (md) {
            var st = m4lGetThemeState();
            if (!st.macros) st.macros = { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 };
            st.macros[z.key] = md.def;
            teBroadcastState(true);
        }
    }
}
