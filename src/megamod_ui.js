// Mega Modulator — UI ("Rack Strips": one channel strip per modulator, plus a mapping list and remap editor).
// Uses ONLY the mgraphics subset listed in the API CONTRACT (src/megamod_config.js).
// Prepended: header (mgraphics init) + megamod_config.js + megamod_mapper.js.
//
// Layout: [rail 20px] [strip 56px | expanded strip 204px]... [+ strip]   or, in Mapping-list mode,
// [rail] [Bitwig-style mapping list, 172px] [remap editor (MSEG transfer curve) for the selected row, 138px].
// Learning lives on the rail LRN button only: click = single-shot for the selected modulator, Shift-click = multi-learn
// (stays armed, follows the selection), click while armed = disarm.
// Selection / expanded strip / list open+scroll / display order live in MM state.ui
// ({sel, exp, pb (list open), pbScroll (first visible list item), pbSel (selected mapping id), order}).
// Reordering is purely visual (state.ui.order) so no shared API is needed.

const UB_RAIL = 20;
const UB_GAP = 2;
const UB_STRIP = 56;
const UB_EXP = 204;
const UB_PLUS = 26;
const UB_PLUS_EMPTY = 92;
const UB_EDGE = 8; // device width = layout width + 2 * 4 px margin around the v8ui
const UB_LIST_W = 172;
const UB_LIST_GAP = 6;
const UB_PANEL_W = 144; // right-side remap panel (rounded, like the list panel)
const UB_PANEL_PAD = 6; // left / right padding inside the panel
const UB_DETAIL_W = UB_PANEL_W - 2 * UB_PANEL_PAD;
const UB_ROW_HEAD = 15;
const UB_ROW_MAP = 14;
const UB_ROW_NONE = 12;
const UB_FULL_FRAMES = 75; // "mapping pool full" pill lifetime in telemetry frames (~2.5 s)
const UB_ORANGE = [0.98, 0.62, 0.18];
const UB_CYAN = [0.30, 0.85, 0.95];
// remap editor / mapping-row accents: Mod mode is cyan, Remote (remap) mode is orange
const UB_MOD_COL = UB_CYAN;
const UB_REM_COL = UB_ORANGE;
const UB_MOD_BG = [0.05, 0.12, 0.15];
const UB_REM_BG = [0.075, 0.085, 0.1];
const UB_RED = [0.95, 0.32, 0.32];
const UB_TYPES = [MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG];
const UB_HIST = 200;

var ubDrag = null;
var ubHover = null; // {x, y, hit}
var ubPopup = null; // {mode: "add"|"type", slot, x, y}
var ubEdit = null; // {slot, text}
var ubDelArm = -1;
var ubLastReq = 0;
var ubFullTTL = 0;
var ubHist = [];
var ubFrame = 0;
for (let i = 0; i < MAX_MODS; i++) ubHist.push([]);

// ------------------------------------------------------------------ small drawing helpers
function ubCol(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1 : a);
}
function ubRect(x, y, w, h, c, a) {
    ubCol(c, a);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}
function ubRR(x, y, w, h, r, c, a) {
    ubCol(c, a);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.fill();
}
function ubRRStroke(x, y, w, h, r, c, a, lw) {
    ubCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.stroke();
}
function ubCircle(cx, cy, r, c, a, fill, lw) {
    ubCol(c, a);
    mgraphics.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) mgraphics.fill();
    else { mgraphics.set_line_width(lw || 1); mgraphics.stroke(); }
}
function ubLine(x1, y1, x2, y2, c, a, lw) {
    ubCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(x1, y1);
    mgraphics.line_to(x2, y2);
    mgraphics.stroke();
}
function ubPoly(pts, c, a, lw) {
    if (pts.length < 2) return;
    ubCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.stroke();
}
function ubFillPoly(pts, base, c, a) {
    if (pts.length < 2) return;
    ubCol(c, a);
    mgraphics.move_to(pts[0][0], base);
    for (let i = 0; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.line_to(pts[pts.length - 1][0], base);
    mgraphics.close_path();
    mgraphics.fill();
}
function ubText(s, x, y, size, c, a) {
    ubCol(c, a);
    mgraphics.set_font_size(size);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(s));
}
function ubTextW(s, size) {
    mgraphics.set_font_size(size);
    const m = mgraphics.text_measure(String(s));
    return m && m.length ? m[0] : String(s).length * size * 0.56;
}
function ubFit(s, maxW, size) {
    s = String(s);
    if (ubTextW(s, size) <= maxW) return s;
    while (s.length > 1 && ubTextW(s + "..", size) > maxW) s = s.slice(0, -1);
    return s + "..";
}
function ubTextC(s, cx, y, size, c, a) {
    ubText(s, cx - ubTextW(s, size) / 2, y, size, c, a);
}
function ubIn(r, x, y) {
    return x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
}
function ubModCol(mod) {
    return MOD_COLORS[mod.color % MOD_COLORS.length];
}

// ------------------------------------------------------------------ ui state accessors
function ubUIs() {
    return MM.getUI() || {};
}
function ubOrder() {
    const have = [];
    for (let i = 0; i < MAX_MODS; i++) if (MM.state.mods[i]) have.push(i);
    const saved = Array.isArray(ubUIs().order) ? ubUIs().order : [];
    const out = [];
    for (const s of saved) if (have.indexOf(s) >= 0 && out.indexOf(s) < 0) out.push(s);
    for (const s of have) if (out.indexOf(s) < 0) out.push(s);
    return out;
}
function ubValidSlot(s) {
    return typeof s === "number" && s >= 0 && s < MAX_MODS && !!MM.state.mods[s];
}
function ubSel() {
    const s = ubUIs().sel;
    return ubValidSlot(s) ? s : -1;
}
function ubExp() {
    const s = ubUIs().exp;
    return ubValidSlot(s) ? s : -1;
}
function ubPb() {
    return !!ubUIs().pb;
}
function ubTel(slot) {
    return MM.readTelemetry().mods[slot];
}

// ------------------------------------------------------------------ geometry (shared by paint + hit testing)
function ubStrips() {
    const ord = ubOrder();
    const exp = ubExp();
    let x = UB_RAIL + UB_GAP;
    const list = [];
    for (const slot of ord) {
        const w = slot === exp ? UB_EXP : UB_STRIP;
        list.push({ slot, x, w, exp: slot === exp });
        x += w + UB_GAP;
    }
    const plus = ord.length < MAX_MODS ? { x, w: ord.length ? UB_PLUS : UB_PLUS_EMPTY } : null;
    const end = plus ? plus.x + plus.w : x - UB_GAP;
    return { list, plus, end };
}
function ubListGeom() {
    const lx = UB_RAIL + UB_GAP;
    const px = lx + UB_LIST_W + UB_LIST_GAP;
    const dx = px + UB_PANEL_PAD;
    return { lx, lw: UB_LIST_W, px, pw: UB_PANEL_W, panel: [px, 0, UB_PANEL_W, 161], dx, dw: UB_DETAIL_W, end: px + UB_PANEL_W };
}
function ubLayoutWidth() {
    if (ubPb()) return ubListGeom().end;
    return ubStrips().end;
}
function ubSyncWidth(force) {
    const w = ubLayoutWidth() + UB_EDGE;
    if (!force && w === ubLastReq) return;
    ubLastReq = w;
    MM.requestWidth(w);
}

// key control specs: {key, label, lo, hi, log, fmt, def}
function ubRateSpec(mod) {
    if (mod.p.sync) {
        return { key: "syncDiv", label: "Div", lo: 0, hi: 15, log: false, fmt: (v) => SYNC_LABELS[clamp(Math.round(v), 0, 15)] };
    }
    return { key: "rate", label: "Rate", lo: 0.01, hi: 40, log: true, fmt: (v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v))) + "Hz", short: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))) };
}
const UB_PCT = (v) => Math.round(v * 100) + "%";
function ubKnobs(mod) {
    const rate = ubRateSpec(mod);
    const depth = { key: "depth", label: "Depth", lo: 0, hi: 1, log: false, fmt: UB_PCT };
    switch (mod.type) {
        case MOD_LFO:
            return [rate, depth, { key: "phase", label: "Phase", lo: 0, hi: 1, log: false, fmt: (v) => Math.round(v * 360) + "°" }];
        case MOD_ENV:
            return [
                { key: "attack", label: "Atk", lo: 0.05, hi: 2000, log: true, fmt: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))) + "ms", short: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))) },
                { key: "release", label: "Rel", lo: 0.5, hi: 5000, log: true, fmt: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "s" : Math.round(v) + "ms"), short: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v))) },
                { key: "gain", label: "Gain", lo: -24, hi: 36, log: false, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(0) + "dB" },
                depth,
            ];
        case MOD_RANDOM:
            return [rate, { key: "smooth", label: "Smooth", lo: 0, hi: 1, log: false, fmt: UB_PCT }, depth, { key: "seed", label: "Seed", lo: 0, hi: 1000, log: false, fmt: (v) => String(Math.round(v)) }];
        case MOD_STEPS:
            return [rate, { key: "steps", label: "Steps", lo: 1, hi: 32, log: false, fmt: (v) => String(Math.round(v)) }, { key: "glide", label: "Glide", lo: 0, hi: 1, log: false, fmt: UB_PCT }, depth];
        default:
            return [rate, depth, { key: "loopStart", label: "Start", lo: 0, hi: 0.95, log: false, fmt: UB_PCT }, { key: "loopEnd", label: "End", lo: 0.05, hi: 1, log: false, fmt: UB_PCT }];
    }
}
function ubKnobNorm(spec, v) {
    if (spec.log) return clamp(Math.log(v / spec.lo) / Math.log(spec.hi / spec.lo), 0, 1);
    return clamp((v - spec.lo) / (spec.hi - spec.lo), 0, 1);
}
function ubKnobValue(spec, n) {
    const c = clamp(n, 0, 1);
    return spec.log ? spec.lo * Math.pow(spec.hi / spec.lo, c) : spec.lo + (spec.hi - spec.lo) * c;
}

// toggle chips shown under the editor of the expanded strip
function ubChips(mod) {
    const p = mod.p;
    const chips = [];
    if (mod.type === MOD_LFO) for (let s = 0; s < 5; s++) chips.push({ id: "shape" + s, w: 16, glyph: s, on: Math.round(p.shape) === s, tip: LFO_SHAPES[s] });
    if (mod.type !== MOD_ENV) chips.push({ id: "sync", w: 30, label: "SYNC", on: !!p.sync, tip: "Tempo sync" });
    chips.push({ id: "bip", w: 28, label: "BIP", on: !!p.bipolar, tip: "Bipolar output" });
    if (mod.type === MOD_STEPS || mod.type === MOD_MSEG) chips.push({ id: "osh", w: 28, label: "1SH", on: !!p.oneshot, tip: "One shot" });
    if (mod.type === MOD_MSEG) chips.push({ id: "loop", w: 30, label: "LOOP", on: !!p.loopOn, tip: "Loop window" });
    if (mod.type !== MOD_ENV) chips.push({ id: "rtg", w: 28, label: "RTG", on: !!p.retrig, tip: "Retrigger on transport start" });
    return chips;
}

function ubStripRects(g) {
    const mod = MM.state.mods[g.slot];
    const x = g.x;
    const w = g.w;
    const R = { g, head: [x, 0, w, 17], icon: [x + 2, 2, 14, 13], knobs: [], chips: [] };
    const specs = ubKnobs(mod);
    if (!g.exp) {
        R.name = [x + 17, 0, w - 19, 17];
        R.viz = [x + 4, 19, 38, 66];
        R.meter = [x + 45, 19, 7, 112];
        for (let k = 0; k < 2; k++) {
            const cx = x + 14 + 19 * k;
            R.knobs.push({ spec: specs[k], cx, cy: 103, r: 8, hit: [cx - 9.5, 92, 19, 43], valY: 123, labY: 132 });
        }
        R.count = [x + 4, 143, 48, 12];
    } else {
        R.name = [x + 17, 0, w - 17 - 38 - 46, 17];
        R.type = [x + w - 36 - 46, 2, 44, 13];
        R.del = [x + w - 36, 1, 16, 15];
        R.collapse = [x + w - 19, 1, 16, 15];
        R.viz = [x + 4, 18, w - 18, 71];
        R.meter = [x + w - 11, 18, 7, 71];
        let cxp = x + 4;
        for (const c of ubChips(mod)) {
            R.chips.push(Object.assign({ rect: [cxp, 92, c.w, 12] }, c));
            cxp += c.w + 3;
        }
        const step = Math.min(46, (w - 8) / specs.length);
        for (let k = 0; k < specs.length; k++) {
            const cx = x + 4 + step * (k + 0.5);
            R.knobs.push({ spec: specs[k], cx, cy: 116, r: 8, hit: [cx - step / 2, 105, step, 41], valY: 134, labY: 143 });
        }
        R.count = [x + w / 2 - 30, 147, 60, 12];
    }
    return R;
}

function ubPopupRect() {
    const pw = 94;
    const ph = 4 + UB_TYPES.length * 17;
    const px = clamp(ubPopup.x, 2, Math.max(2, ubLayoutWidth() - pw - 2));
    return [px, ubPopup.y, pw, ph];
}

function ubRailRects() {
    return { learn: [2, 4, 16, 16], list: [2, 40, 16, 16] };
}

// ------------------------------------------------------------------ mapping list model (Bitwig-inspector style)
function ubListItems() {
    const items = [];
    for (const i of ubOrder()) {
        items.push({ kind: "head", i, h: UB_ROW_HEAD });
        const maps = MM.mappingsFor(i);
        if (!maps.length) items.push({ kind: "none", i, h: UB_ROW_NONE });
        for (const m of maps) items.push({ kind: "map", i, m, h: UB_ROW_MAP });
    }
    return items;
}
function ubListArea() {
    return { y: 16, h: 161 - 16 - 15 };
}
function ubListMaxScroll(items) {
    const area = ubListArea();
    let acc = 0;
    let k = items.length;
    while (k > 0 && acc + items[k - 1].h <= area.h) { acc += items[k - 1].h; k--; }
    return k;
}
function ubListVisible(items) {
    items = items || ubListItems();
    const area = ubListArea();
    const first = clamp(Math.floor(num(ubUIs().pbScroll, 0)), 0, ubListMaxScroll(items));
    const rows = [];
    let y = area.y;
    for (let k = first; k < items.length; k++) {
        if (y + items[k].h > area.y + area.h) break;
        rows.push({ item: items[k], y, h: items[k].h, index: k });
        y += items[k].h;
    }
    return { rows, first, area, total: items.length };
}
function ubRowParts(y) {
    const x = ubListGeom().lx;
    return {
        tog: [x + 3, y + 1, 11, 12],
        name: [x + 16, y + 1, 60, 12],
        curve: [x + 78, y + 2, 15, 10],
        val: [x + 96, y + 1, 38, 12],
        mode: [x + 137, y + 2, 15, 10],
        del: [x + 155, y + 1, 12, 12],
    };
}
// modulator enable button at the left end of a list header (same glyph as the strip's corner button)
function ubHeadPwrRect(y) {
    return [ubListGeom().lx + 4, y, 15, 15];
}
function ubPbSelMapping() {
    const id = ubUIs().pbSel;
    return id ? MM.getMapping(id) : null;
}
function ubValueText(m) {
    // Remote: the absolute window "20\u201380%" (min \u2013 max of the target parameter)
    if (m.mode === "remote") return Math.round(m.min * 100) + "\u2013" + Math.round(m.max * 100) + "%";
    // Mod: polarity glyph + range: "+50%", "\u00b150%", "\u221250%"
    return (m.polarity > 0 ? "+" : m.polarity < 0 ? "\u2212" : "\u00b1") + Math.round(m.range * 100) + "%";
}
function ubTargetPath(m) {
    const t = m.target;
    return (t.trackName || "?") + " > " + (t.deviceName || "?") + " > " + (t.paramName || t.name || "?");
}

// detail panel controls: [{id, rect}]
const UB_OUTMETER_W = 13; // output bar + range markers to the right of the remap MSEG (Phase Plant style, but a bar)
const UB_POL_TIPS = {
    1: "Positive: output 0 to +range",
    0: "Bipolar: output -range to +range",
    "-1": "Negative: output 0 to -range"
};
const UB_TAB_W = 40; // MOD / REM tabs: same size in both modes, so a mode switch never moves the tab under the cursor
const UB_PRESETS = 4; // remap shape presets: CURVE_LINEAR..CURVE_S (the Stepped curve is not offered here)
const UB_POL_W = 15; // one cell of the polarity control (Mod only, right end of the tab row)
// The readout's width is FIXED to the widest text it can ever show ("100\u2013100%" in Remote; Mod's "\u00b1100%" is
// narrower), independent of the mapping and its values, so the presets row never shuffles while values change.
const UB_READOUT_SIZE = 7.5;
function ubReadoutW() {
    return Math.ceil(Math.max(ubTextW("100\u2013100%", UB_READOUT_SIZE), ubTextW("\u00b1100%", UB_READOUT_SIZE))) + 1;
}
function ubDetailRects(gm, m) {
    const x = gm.dx;
    const w = gm.dw;
    const out = [];
    const rem = m.mode === "remote";
    const my = 50;
    const py = 143; // presets row at the bottom (h 13 -> 156, 5 px above the panel edge)
    const mh = py - 3 - my; // MSEG + output bar, same height in both modes
    const colW = UB_OUTMETER_W;
    const msegW = w - colW - 3;
    const msegR = [x, my, msegW, mh];
    const meterX = x + msegW + 3 + (colW - UB_OUTMETER_W) / 2;
    const meterH = mh;
    // tab row: MOD / REM tabs on the left; in Mod the polarity control sits at the right end (empty in Remote)
    out.push({ id: "tabmod", rect: [x + 1, 36, UB_TAB_W, 12], mode: "mod", tip: "Mod: modulates around the parameter's value" });
    out.push({ id: "tabrem", rect: [x + 1 + UB_TAB_W + 2, 36, UB_TAB_W, 12], mode: "remote", tip: "Remote: takes over the parameter (absolute min / max)" });
    out.push({ id: "mseg", rect: msegR });
    out.push({ id: "meter", rect: [meterX, my, UB_OUTMETER_W, meterH],
        tip: !rem ? "Drag the triangle to set the range (+ and \u2212 keep zero fixed, \u00b1 moves both); double-click = full"
            : "Drag the nearest triangle: filled = max, outline = min (double-click resets it)" });
    // the presets (Linear / Exp / Log / S; no Stepped) share the row, leaving its right end for the readout
    const pbw = (w - ubReadoutW() - 3 - (UB_PRESETS - 1) * 2) / UB_PRESETS;
    const pstep = pbw + 2;
    for (let k = 0; k < UB_PRESETS; k++) out.push({ id: "preset" + k, rect: [x + k * pstep, py, pbw, 13], curve: k, tip: CURVE_NAMES[k] + " preset" });
    if (!rem) {
        const px = x + w - 3 * UB_POL_W;
        [1, 0, -1].forEach((p, k) => out.push({ id: "pol" + p, rect: [px + k * UB_POL_W, 36, UB_POL_W, 12], pol: p, tip: UB_POL_TIPS[p] }));
    }
    return out;
}

// ------------------------------------------------------------------ hit testing
function ubHit(x, y) {
    if (ubPopup) {
        const pr = ubPopupRect();
        if (ubIn(pr, x, y)) {
            const k = Math.floor((y - pr[1] - 2) / 17);
            if (k >= 0 && k < UB_TYPES.length) return { kind: "popup", type: UB_TYPES[k], tip: "Choose type" };
            return { kind: "popup_pad" };
        }
        return { kind: "popup_out" };
    }
    const rr = ubRailRects();
    if (ubIn(rr.learn, x, y)) {
        const L = MM.learn;
        return { kind: "rail_learn", tip: L.armed ? "Learning: click to stop" + (L.multi ? "" : " (maps one parameter)") : "Learn: click = map one parameter, Shift-click = keep mapping" };
    }
    if (ubIn(rr.list, x, y)) return { kind: "rail_list", tip: ubPb() ? "Back to rack strips" : "Mapping list (all mappings)" };
    if (x < UB_RAIL) return { kind: "rail" };
    if (ubPb()) return ubHitList(x, y);
    const sg = ubStrips();
    if (sg.plus && ubIn([sg.plus.x, 0, sg.plus.w, 161], x, y)) return { kind: "plus", tip: "Add modulator" };
    for (const g of sg.list) {
        if (x < g.x || x >= g.x + g.w) continue;
        const R = ubStripRects(g);
        const slot = g.slot;
        if (g.exp) {
            if (ubIn(R.collapse, x, y)) return { kind: "collapse", slot, tip: "Collapse" };
            if (ubIn(R.del, x, y)) return { kind: "del", slot, tip: "Delete modulator (click twice)" };
        }
        if (ubIn(R.icon, x, y)) return { kind: "pwr", slot, tip: "Enable / bypass" };
        if (g.exp && ubIn(R.type, x, y)) return { kind: "typechip", slot, tip: "Change type" };
        if (ubIn(R.head, x, y)) return { kind: "head", slot, tip: g.exp ? "Drag to reorder, double-click to collapse" : "Drag to reorder, double-click to rename" };
        for (let k = 0; k < R.knobs.length; k++) {
            if (ubIn(R.knobs[k].hit, x, y)) return { kind: "knob", slot, k, tip: R.knobs[k].spec.label + " (double-click resets)" };
        }
        for (const c of R.chips) if (ubIn(c.rect, x, y)) return { kind: "chip", slot, chip: c.id, tip: c.tip };
        if (ubIn(R.count, x, y)) return { kind: "count", slot, tip: "Show mappings in the list" };
        if (ubIn(R.viz, x, y)) return { kind: "viz", slot, rect: R.viz, tip: g.exp ? "" : "Double-click to expand" };
        if (ubIn(R.meter, x, y)) return { kind: "meter", slot };
        return { kind: "body", slot, tip: g.exp ? "" : "Double-click to expand" };
    }
    return { kind: "none" };
}
function ubHitList(x, y) {
    const gm = ubListGeom();
    if (x >= gm.px) {
        const m = ubPbSelMapping();
        if (m) {
            for (const d of ubDetailRects(gm, m)) {
                if (!ubIn(d.rect, x, y)) continue;
                let which = d.which;
                if (d.pick) { which = d.pick(x, y); if (!which) continue; }
                return { kind: "detail", id: d.id, rect: d.drect || d.rect, curve: d.curve, pol: d.pol, which, mode: d.mode, tip: d.tip || (d.id === "mseg" ? "Click = add point, drag = move / bend, double-click a point = delete" : "") };
            }
        }
        return { kind: "detail_bg" };
    }
    if (x < gm.lx || x >= gm.lx + gm.lw) return { kind: "list_bg" };
    for (const r of ubListVisible().rows) {
        if (y < r.y || y >= r.y + r.h) continue;
        const it = r.item;
        if (it.kind === "head") {
            if (ubIn(ubHeadPwrRect(r.y), x, y)) return { kind: "ls_hpwr", slot: it.i, tip: "Enable / bypass modulator" };
            return { kind: "ls_head", slot: it.i, tip: MM.state.mods[it.i].name };
        }
        if (it.kind === "none") return { kind: "ls_none", slot: it.i, tip: "Select the modulator and press LRN to map a parameter" };
        const P = ubRowParts(r.y);
        const base = { slot: it.i, m: it.m, tip: ubTargetPath(it.m) };
        for (const k of ["tog", "del", "curve", "val", "mode"]) {
            if (ubIn(P[k], x, y)) return Object.assign({ kind: "ls_" + k, rect: P[k] }, base, { tip: { tog: "Mapping on / off", del: "Delete mapping", curve: "Transfer curve (click = edit)", val: "Drag = range / window", mode: "Mod / Remote" }[k] });
        }
        return Object.assign({ kind: "ls_row" }, base);
    }
    return { kind: "list_bg" };
}

// ------------------------------------------------------------------ actions
// multi-learn follows the selection (single-shot stays on the modulator it was armed for)
function ubRetarget(slot) {
    if (MM.learn.armed && MM.learn.multi && MM.learn.mod !== slot) MM.armLearn(slot, true);
}
function ubSelect(slot) {
    if (!ubValidSlot(slot) || ubSel() === slot) return;
    MM.setUI({ sel: slot });
    ubRetarget(slot);
}
// rail learn button: click = single-shot for the selected modulator, Shift-click = multi-learn, click while armed = off
function ubRailLearn(shift) {
    if (MM.learn.armed) { MM.disarmLearn(); return; }
    let s = ubSel();
    if (s < 0) {
        const o = ubOrder();
        if (!o.length) return;
        s = o[0];
        MM.setUI({ sel: s });
    }
    MM.armLearn(s, !!shift);
}
function ubAddType(type) {
    const slot = MM.addModulator(type);
    if (slot >= 0) {
        const o = ubOrder();
        MM.setUI({ order: o, sel: slot });
        ubRetarget(slot);
        ubSyncWidth();
    }
    return slot;
}
function ubSetExpanded(slot) {
    MM.setUI({ exp: slot, sel: slot >= 0 ? slot : ubSel() });
    if (slot >= 0) ubRetarget(slot);
    ubSyncWidth();
}
function ubTogglePb(on) {
    MM.setUI({ pb: on ? 1 : 0 });
    ubSyncWidth();
}
function ubChipClick(slot, id) {
    const m = MM.state.mods[slot];
    if (!m) return;
    if (id.indexOf("shape") === 0) { MM.setParam(slot, "shape", Number(id.slice(5))); return; }
    const key = { sync: "sync", bip: "bipolar", osh: "oneshot", loop: "loopOn", rtg: "retrig" }[id];
    if (key) MM.setParam(slot, key, m.p[key] ? 0 : 1);
}
function ubEndDrag() {
    if (ubDrag && ubDrag.dirty) MM.commit();
    ubDrag = null;
}

// ------------------------------------------------------------------ mouse
function onidle(x, y) {
    if (ubDrag) ubEndDrag(); // the button was released
    const h = ubHit(x, y);
    ubHover = { x, y, hit: h };
    if (ubDelArm >= 0 && !(h.kind === "del" && h.slot === ubDelArm)) ubDelArm = -1;
    mgraphics.redraw();
}
function onidleout() {
    ubHover = null;
    mgraphics.redraw();
}

function onclick(x, y, but, cmd, shift, caps, opt, ctrl) {
    ubEndDrag();
    if (ubEdit && !(ubHit(x, y).kind === "head" && ubHit(x, y).slot === ubEdit.slot)) ubCommitEdit();
    const h = ubHit(x, y);
    if (ubPopup) {
        const pop = ubPopup;
        if (h.kind === "popup") {
            ubPopup = null;
            if (pop.mode === "add") ubAddType(h.type);
            else if (MM.state.mods[pop.slot]) MM.setModType(pop.slot, h.type);
        } else if (h.kind !== "popup_pad") ubPopup = null;
        mgraphics.redraw();
        return;
    }
    if (ubDelArm >= 0 && !(h.kind === "del" && h.slot === ubDelArm)) ubDelArm = -1;
    switch (h.kind) {
        case "rail_learn": ubRailLearn(shift); break;
        case "rail_list": ubTogglePb(!ubPb()); break;
        case "plus": ubPopup = { mode: "add", slot: -1, x: Math.max(2, ubStrips().plus.x + ubStrips().plus.w - 94), y: 22 }; break;
        case "collapse": ubSetExpanded(-1); break;
        case "del":
            if (ubDelArm === h.slot) {
                ubDelArm = -1;
                MM.removeModulator(h.slot);
                if (ubExp() < 0 && ubUIs().exp !== undefined && ubUIs().exp !== -1) MM.setUI({ exp: -1 });
                ubSyncWidth();
            } else ubDelArm = h.slot;
            break;
        case "pwr": ubSelect(h.slot); MM.setParam(h.slot, "enabled", MM.state.mods[h.slot].enabled ? 0 : 1); break;
        case "typechip": {
            ubSelect(h.slot);
            const tg = ubStrips().list.filter((g) => g.slot === h.slot)[0];
            ubPopup = { mode: "type", slot: h.slot, x: ubStripRects(tg).type[0], y: 18 };
            break;
        }
        case "head":
            ubSelect(h.slot);
            ubDrag = { kind: "reorder", slot: h.slot, x0: x, active: false };
            break;
        case "knob": {
            ubSelect(h.slot);
            const mod = MM.state.mods[h.slot];
            const spec = ubKnobs(mod)[h.k];
            ubDrag = { kind: "knob", slot: h.slot, spec, y: y, n: ubKnobNorm(spec, mod.p[spec.key]), dirty: false };
            break;
        }
        case "chip": ubSelect(h.slot); ubChipClick(h.slot, h.chip); break;
        case "count":
            ubSelect(h.slot);
            ubTogglePb(true);
            { const ms = MM.mappingsFor(h.slot); MM.setUI({ pbSel: ms.length ? ms[0].id : 0 }); ubListReveal(ms.length ? ms[0].id : 0, h.slot); }
            break;
        case "viz": ubSelect(h.slot); ubVizClick(h, x, y); break;
        case "meter":
        case "body": ubSelect(h.slot); break;
        case "ls_hpwr": ubSelect(h.slot); MM.setParam(h.slot, "enabled", MM.state.mods[h.slot].enabled ? 0 : 1); break;
        case "ls_head": ubSelect(h.slot); break;
        case "ls_none": ubSelect(h.slot); break;
        case "ls_row": case "ls_tog": case "ls_del": case "ls_curve": case "ls_val": case "ls_mode": ubListRowClick(h, x, y); break;
        case "detail": ubDetailClick(h, x, y); break;
        default: break;
    }
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift) {
    if (!ubDrag) return;
    if (but === 0) { ubEndDrag(); return; }
    const d = ubDrag;
    if (d.kind === "reorder") {
        if (!d.active && Math.abs(x - d.x0) < 4) return;
        d.active = true;
        const others = ubStrips().list.filter((g) => g.slot !== d.slot);
        const idx = others.filter((g) => g.x + g.w / 2 < x).length;
        const slots = others.map((g) => g.slot);
        slots.splice(idx, 0, d.slot);
        const cur = ubOrder();
        if (slots.join(",") !== cur.join(",")) { MM.setUI({ order: slots }); d.dirty = true; }
    } else if (d.kind === "knob") {
        d.n = clamp(d.n + (d.y - y) / (shift ? 600 : 130), 0, 1);
        d.y = y;
        MM.setParam(d.slot, d.spec.key, ubKnobValue(d.spec, d.n));
        d.dirty = true;
    } else if (d.kind === "mseg") ubMsegDrag(d, x, y);
    else if (d.kind === "steps") ubStepsDrag(d, x, y);
    else if (d.kind === "lfo") ubLfoDrag(d, x, y);
    else if (d.kind === "lval") {
        const m = MM.getMapping(d.id);
        if (m) {
            const dv = ((x - d.x) - (y - d.y)) / (shift ? 400 : 90);
            if (m.mode === "remote") {
                // Remote: the row value drags the whole window (min and max together, width kept)
                const sh = clamp(dv, -Math.min(d.min0, d.max0), 1 - Math.max(d.min0, d.max0));
                MM.updateMapping(d.id, { min: d.min0 + sh, max: d.max0 + sh });
            } else MM.updateMapping(d.id, { range: clamp(d.v0 + dv, 0, 1) });
            d.dirty = true;
        }
    } else if (d.kind === "limit") {
        ubApplyLimit(d, x, y);
        d.dirty = true;
    } else if (d.kind === "range") {
        ubApplyRange(d, y);
        d.dirty = true;
    }
    mgraphics.redraw();
}

function ondblclick(x, y, but, cmd, shift) {
    const h = ubHit(x, y);
    if (ubPopup) return;
    switch (h.kind) {
        case "head": {
            const g = ubStrips().list.filter((s) => s.slot === h.slot)[0];
            if (g && g.exp) ubSetExpanded(-1);
            else { ubEdit = { slot: h.slot, text: MM.state.mods[h.slot].name }; }
            break;
        }
        case "viz":
        case "meter":
        case "body": {
            const g = ubStrips().list.filter((s) => s.slot === h.slot)[0];
            if (g && !g.exp) ubSetExpanded(h.slot);
            else if (g && g.exp && h.kind === "viz") ubVizDblClick(h, x, y);
            break;
        }
        case "knob": {
            const mod = MM.state.mods[h.slot];
            const spec = ubKnobs(mod)[h.k];
            MM.setParam(h.slot, spec.key, defaultParams(mod.type)[spec.key]);
            break;
        }
        case "ls_row": case "ls_val": case "ls_curve":
            if (h.m && MM.getMapping(h.m.id)) MM.updateMapping(h.m.id, { enabled: MM.getMapping(h.m.id).enabled ? 0 : 1 });
            break;
        case "detail":
            if (h.id === "mseg" && ubPbSelMapping()) ubMsegDbl(ubMapTgt(ubPbSelMapping().id), h.rect, x, y);
            else if (h.id === "meter" && ubPbSelMapping()) {
                const mm = ubPbSelMapping();
                if (mm.mode !== "remote") MM.updateMapping(mm.id, { range: 1 });
                else { const wh = ubNearestLimit(mm, ubLimitFromY(h.rect, y)); MM.updateMapping(mm.id, ubLimitPatch(wh, wh === "min" ? 0 : 1)); }
            }
            break;
        default: break;
    }
    mgraphics.redraw();
}

function onwheel(x, y, dx, dy) {
    if (ubPb()) {
        const gm = ubListGeom();
        if (x >= gm.lx && x < gm.lx + gm.lw) {
            const items = ubListItems();
            const cur = ubListVisible(items).first;
            const next = clamp(cur + (dy > 0 ? -1 : 1), 0, ubListMaxScroll(items));
            if (next !== cur) MM.setUI({ pbScroll: next });
            mgraphics.redraw();
        }
        return;
    }
    const h = ubHit(x, y);
    if (h.kind === "knob") {
        const mod = MM.state.mods[h.slot];
        const spec = ubKnobs(mod)[h.k];
        const n = ubKnobNorm(spec, mod.p[spec.key]) + (dy > 0 ? 1 : -1) * 0.03;
        MM.setParam(h.slot, spec.key, ubKnobValue(spec, n));
    }
}

// ------------------------------------------------------------------ name editing
function ubCommitEdit() {
    if (ubEdit && ubEdit.text.trim()) MM.setName(ubEdit.slot, ubEdit.text.trim());
    ubEdit = null;
}
function onkeydown(keycode, textcharacter, down) {
    if (!down || !ubEdit) return 0;
    const k = Number(keycode) || 0;
    const ch = typeof textcharacter === "string" ? textcharacter : Number(textcharacter) >= 32 ? String.fromCharCode(Number(textcharacter)) : "";
    const code = typeof textcharacter === "number" ? textcharacter : k;
    if (code === 13 || code === 3 || k === 13 || k === 36) { ubCommitEdit(); }
    else if (code === 27 || k === 27) ubEdit = null;
    else if (code === 8 || code === 127 || k === 8 || k === 127 || k === -3 || k === -4 || k === 51) ubEdit.text = ubEdit.text.slice(0, -1);
    else if (ch.length === 1 && ch >= " " && ubEdit.text.length < 16) ubEdit.text += ch;
    else return 0;
    mgraphics.redraw();
    return 1;
}

// ------------------------------------------------------------------ expanded editors (interaction)
function ubVizClick(h, x, y) {
    const mod = MM.state.mods[h.slot];
    const g = ubStrips().list.filter((s) => s.slot === h.slot)[0];
    if (!g || !g.exp) return;
    const r = h.rect;
    if (mod.type === MOD_MSEG) ubMsegClick(ubMsegTgt(h.slot), r, x, y);
    else if (mod.type === MOD_STEPS) {
        ubDrag = { kind: "steps", slot: h.slot, rect: r, last: -1, lastV: 0, dirty: true };
        ubStepsDrag(ubDrag, x, y);
    } else if (mod.type === MOD_LFO) ubDrag = { kind: "lfo", slot: h.slot, rect: r, x: x, y: y, ph: mod.p.phase, dep: mod.p.depth, dirty: false };
    else if (mod.type === MOD_RANDOM) {
        MM.setParam(h.slot, "seed", Math.floor(Math.random() * 1000));
        MM.retrigger(h.slot);
    } else if (mod.type === MOD_ENV) { /* read-only trace */ }
}
function ubVizDblClick(h, x, y) {
    const mod = MM.state.mods[h.slot];
    if (mod.type === MOD_MSEG) ubMsegDbl(ubMsegTgt(h.slot), h.rect, x, y);
    else if (mod.type === MOD_LFO) { MM.setParam(h.slot, "phase", 0); MM.setParam(h.slot, "depth", 1); }
}
function ubLfoDrag(d, x, y) {
    const r = d.rect;
    MM.setParam(d.slot, "phase", clamp(frac(d.ph + (x - d.x) / r[2]), 0, 1));
    MM.setParam(d.slot, "depth", clamp(d.dep - (y - d.y) / r[3], 0, 1));
    d.dirty = true;
}
function ubStepsDrag(d, x, y) {
    const mod = MM.state.mods[d.slot];
    const n = clamp(Math.round(mod.p.steps), 1, STEPS_MAX);
    const r = d.rect;
    const idx = clamp(Math.floor(((x - r[0]) / r[2]) * n), 0, n - 1);
    const v = clamp(1 - (y - r[1]) / r[3], 0, 1);
    if (d.last >= 0 && d.last !== idx) {
        const a = Math.min(d.last, idx);
        const b = Math.max(d.last, idx);
        for (let i = a; i <= b; i++) {
            const t = b === a ? 1 : (i - d.last) / (idx - d.last);
            MM.setStep(d.slot, i, d.lastV + (v - d.lastV) * clamp(t, 0, 1));
        }
    } else MM.setStep(d.slot, idx, v);
    d.last = idx;
    d.lastV = v;
    d.dirty = true;
}

// MSEG editor (modulator MSEG and the per-mapping transfer curve share it). A target is
// {pts(): current points, set(pts): store, addOnClick: bool}.
// Drag points, drag a segment's centre handle to bend it, double-click a point to delete it. Adding a point is a
// double-click on empty space for a modulator MSEG and a single click for a mapping shape (the new point is dragged on).
function ubMsegTgt(slot) {
    return { pts: () => MM.state.mods[slot].points, set: (p) => MM.setMsegPoints(slot, p), addOnClick: false };
}
function ubMapTgt(id) {
    return {
        mapId: id, pts: () => { const m = MM.getMapping(id); return m ? m.shape : linearShape(); }, set: (p) => MM.updateMapping(id, { shape: p }), addOnClick: true,
    };
}
function ubMsegXY(r, p) {
    return [r[0] + 2 + p.x * (r[2] - 4), r[1] + 3 + (1 - p.y) * (r[3] - 6)];
}
// shape y 0..1 from a pixel y
function ubMsegRawY(r, y) {
    return clamp(1 - (y - r[1] - 3) / (r[3] - 6), 0, 1);
}
function ubMsegCopy(pts) {
    return pts.map((p) => ({ x: p.x, y: p.y, curve: p.curve, sCurve: p.sCurve }));
}
function ubMsegHit(tgt, r, x, y) {
    const pts = tgt.pts();
    for (let i = 0; i < pts.length; i++) {
        const q = ubMsegXY(r, pts[i]);
        if ((q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y) <= 36) return { type: "point", i };
    }
    for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = evalMseg(pts, mx);
        const q = ubMsegXY(r, { x: mx, y: my });
        if ((q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y) <= 30) return { type: "seg", i };
    }
    return { type: "none" };
}
function ubMsegPos(r, x, y) {
    return { x: clamp((x - r[0] - 2) / (r[2] - 4), 0.01, 0.99), y: ubMsegRawY(r, y) };
}
function ubMsegClick(tgt, r, x, y) {
    const hit = ubMsegHit(tgt, r, x, y);
    if (hit.type === "point") ubDrag = { kind: "mseg", mode: "point", tgt, rect: r, i: hit.i, dirty: false };
    else if (hit.type === "seg") ubDrag = { kind: "mseg", mode: "seg", tgt, rect: r, i: hit.i, y0: y, c0: tgt.pts()[hit.i].curve || 0, dirty: false };
    else if (tgt.addOnClick) {
        const pts = ubMsegCopy(tgt.pts());
        const np = ubMsegPos(r, x, y);
        pts.push({ x: np.x, y: np.y, curve: 0, sCurve: 0 });
        tgt.set(pts);
        const now = tgt.pts();
        let idx = 1;
        for (let k = 0; k < now.length; k++) if (Math.abs(now[k].x - np.x) < 1e-6 && Math.abs(now[k].y - np.y) < 1e-6) idx = k;
        ubDrag = { kind: "mseg", mode: "point", tgt, rect: r, i: idx, dirty: true };
    }
}
function ubMsegDrag(d, x, y) {
    const pts = ubMsegCopy(d.tgt.pts());
    const r = d.rect;
    if (d.mode === "point") {
        const p = pts[d.i];
        p.y = ubMsegRawY(r, y);
        if (d.i > 0 && d.i < pts.length - 1) {
            const lo = pts[d.i - 1].x + 0.002;
            const hi = pts[d.i + 1].x - 0.002;
            if (hi >= lo) p.x = clamp((x - r[0] - 2) / (r[2] - 4), lo, hi);
        }
    } else {
        const a = pts[d.i];
        const b = pts[d.i + 1];
        const dir = b.y >= a.y ? 1 : -1;
        a.curve = clamp(d.c0 + (dir * (d.y0 - y)) / ((r[3] - 6) * 0.5), -1, 1);
    }
    d.tgt.set(pts);
    d.dirty = true;
}
function ubMsegDbl(tgt, r, x, y) {
    const hit = ubMsegHit(tgt, r, x, y);
    const pts = ubMsegCopy(tgt.pts());
    if (hit.type === "point") {
        if (hit.i === 0 || hit.i === pts.length - 1) return;
        pts.splice(hit.i, 1);
    } else if (hit.type === "seg") {
        pts[hit.i].curve = 0;
    } else {
        if (tgt.addOnClick) return;
        const np = ubMsegPos(r, x, y);
        pts.push({ x: np.x, y: np.y, curve: 0, sCurve: 0 });
    }
    tgt.set(pts);
    MM.commit();
}

// ------------------------------------------------------------------ mapping-list interactions
function ubListRowClick(h, x, y) {
    const m = MM.getMapping(h.m.id);
    if (!m) return;
    if (h.kind === "ls_tog") { MM.updateMapping(m.id, { enabled: m.enabled ? 0 : 1 }); return; }
    ubSelect(h.slot);
    if (h.kind === "ls_del") {
        MM.deleteMapping(m.id);
        if (ubUIs().pbSel === m.id) MM.setUI({ pbSel: 0 });
        return;
    }
    MM.setUI({ pbSel: m.id });
    if (h.kind === "ls_mode") MM.updateMapping(m.id, { mode: m.mode === "remote" ? "mod" : "remote" });
    else if (h.kind === "ls_val") {
        ubDrag = { kind: "lval", id: m.id, v0: m.range, min0: m.min, max0: m.max, x, y, dirty: false };
    }
}
function ubListReveal(mapId, slot) {
    const items = ubListItems();
    let idx = -1;
    for (let k = 0; k < items.length; k++) if ((mapId && items[k].kind === "map" && items[k].m.id === mapId) || (!mapId && items[k].kind === "head" && items[k].i === slot)) { idx = k; break; }
    if (idx >= 0) MM.setUI({ pbScroll: clamp(idx - 1, 0, ubListMaxScroll(items)) });
}
// Remote min / max helpers (absolute 0..1 of the target parameter)
function ubLimitPatch(which, v) {
    return which === "min" ? { min: v } : { max: v };
}
function ubLimitFromY(rect, y) {
    return clamp(1 - (y - rect[1] - 3) / (rect[3] - 6), 0, 1);
}
// the closer of the two limits to v (a tie goes to min below it and max above it)
function ubNearestLimit(m, v) {
    const dn = Math.abs(v - m.min);
    const dx = Math.abs(v - m.max);
    if (dn < dx) return "min";
    if (dx < dn) return "max";
    return v <= m.min ? "min" : "max";
}
// drag of one limit triangle on the right-hand bar
function ubApplyLimit(d, x, y) {
    const m = MM.getMapping(d.mapId);
    if (!m) return;
    MM.updateMapping(m.id, ubLimitPatch(d.which, ubLimitFromY(d.rect, y)));
}
function ubStartLimit(m, which, rect, x, y) {
    ubDrag = { kind: "limit", which, rect, mapId: m.id, dirty: true };
    ubApplyLimit(ubDrag, x, y);
}
function ubDetailClick(h, x, y) {
    const m = ubPbSelMapping();
    if (!m) return;
    const id = h.id;
    if (id.indexOf("preset") === 0) MM.updateMapping(m.id, { shape: curveToShape(Number(id.slice(6)), 0.5, 4) });
    else if (id === "mseg") ubMsegClick(ubMapTgt(m.id), h.rect, x, y);
    else if (id === "meter" && m.mode === "remote") ubStartLimit(m, ubNearestLimit(m, ubLimitFromY(h.rect, y)), h.rect, x, y);
    else if (id === "tabmod" || id === "tabrem") MM.updateMapping(m.id, { mode: h.mode });
    else if (id === "meter") {
        // the visible marker(s) follow the polarity: a press on the hidden zero side (+ below / \u2212 above the centre) is ignored
        if (!ubRangeSideOk(m.polarity, h.rect, y)) return;
        ubDrag = { kind: "range", rect: h.rect, mapId: m.id, dirty: true };
        ubApplyRange(ubDrag, y);
    } else if (id.indexOf("pol") === 0) MM.updateMapping(m.id, { polarity: h.pol });
}

// ------------------------------------------------------------------ painting: icons
function ubGlyph(type, x, y, w, h, c, a) {
    const pts = [];
    if (type === MOD_LFO) {
        for (let i = 0; i <= 12; i++) pts.push([x + (w * i) / 12, y + h * (0.5 - 0.42 * Math.sin((i / 12) * Math.PI * 2))]);
        ubPoly(pts, c, a, 1.2);
    } else if (type === MOD_ENV) {
        ubPoly([[x, y + h], [x + w * 0.25, y + 1], [x + w * 0.45, y + h * 0.45], [x + w * 0.7, y + h * 0.7], [x + w, y + h]], c, a, 1.2);
    } else if (type === MOD_RANDOM) {
        const v = [0.55, 0.15, 0.8, 0.35, 0.65];
        for (let i = 0; i < 5; i++) {
            pts.push([x + (w * i) / 5, y + h * v[i]]);
            pts.push([x + (w * (i + 1)) / 5, y + h * v[i]]);
        }
        ubPoly(pts, c, a, 1.2);
    } else if (type === MOD_STEPS) {
        const v = [0.5, 0.9, 0.3, 0.7];
        for (let i = 0; i < 4; i++) ubRect(x + (w * i) / 4 + 0.5, y + h * (1 - v[i]), w / 4 - 1.5, h * v[i], c, a);
    } else {
        ubPoly([[x, y + h], [x + w * 0.3, y + h * 0.15], [x + w * 0.6, y + h * 0.6], [x + w, y + h * 0.2]], c, a, 1.2);
        ubCircle(x + w * 0.3, y + h * 0.15, 1.5, c, a, true);
        ubCircle(x + w * 0.6, y + h * 0.6, 1.5, c, a, true);
    }
}
function ubShapeGlyph(s, x, y, w, h, c, a) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
        const ph = i / 10;
        pts.push([x + w * ph, y + h * (1 - lfoShape(s, Math.min(ph, 0.999)))]);
    }
    ubPoly(pts, c, a, 1.1);
}
function ubCurveGlyph(type, x, y, w, h, c, a) {
    const pts = [];
    const shape = curveToShape(type, 0.5, 4);
    for (let i = 0; i <= 14; i++) {
        const u = i / 14;
        pts.push([x + w * u, y + h * (1 - evalMseg(shape, u))]);
    }
    ubPoly(pts, c, a, 1.2);
}
function ubLearnIcon(r, on, c) {
    const cx = r[0] + r[2] / 2;
    const cy = r[1] + r[3] / 2;
    ubCircle(cx, cy, 5.5, c, 1, false, 1.3);
    ubCircle(cx, cy, 1.8, c, 1, true);
    ubLine(cx, cy - 8, cx, cy - 3.5, c, 1, 1.2);
    ubLine(cx, cy + 3.5, cx, cy + 8, c, 1, 1.2);
    ubLine(cx - 8, cy, cx - 3.5, cy, c, 1, 1.2);
    ubLine(cx + 3.5, cy, cx + 8, cy, c, 1, 1.2);
}
function ubListIcon(r, c) {
    for (let j = 0; j < 3; j++) {
        ubRect(r[0] + 2.5, r[1] + 3 + j * 4.4, 2.4, 2.4, c, 1);
        ubRect(r[0] + 6.5, r[1] + 3.5 + j * 4.4, 7, 1.4, c, j === 0 ? 1 : 0.6);
    }
}
// enable / bypass button in a strip's upper-left corner: lit ring + type glyph when on, hollow grey when off
function ubPowerGlyph(cx, cy, mod, c, hot) {
    if (mod.enabled) {
        ubCircle(cx, cy, 6.3, c, 0.26, true);
        ubCircle(cx, cy, 6.3, c, 1, false, 1.3);
        ubGlyph(mod.type, cx - 4, cy - 3, 8, 6, c, 1);
    } else {
        ubCircle(cx, cy, 6.3, [0.1, 0.11, 0.13], 1, true);
        ubCircle(cx, cy, 6.3, hot ? [0.62, 0.65, 0.7] : [0.38, 0.4, 0.45], 1, false, 1.1);
        ubGlyph(mod.type, cx - 4, cy - 3, 8, 6, [0.38, 0.4, 0.45], 1);
    }
}
function ubPowerButton(R, mod, c, hot) {
    ubPowerGlyph(R.icon[0] + 7, R.icon[1] + 6.5, mod, c, hot);
}
// per-mapping on/off: a power symbol (open ring + stem). Lit in the modulator colour when on, grey when off.
function ubMapToggle(r, on, c, hot) {
    const cx = r[0] + r[2] / 2;
    const cy = r[1] + r[3] / 2 + 0.5;
    const col = on ? c : hot ? [0.62, 0.65, 0.7] : [0.4, 0.42, 0.47];
    const ring = [];
    for (let i = 0; i <= 14; i++) {
        const a = (-90 + 38 + (284 * i) / 14) * Math.PI / 180;
        ring.push([cx + Math.cos(a) * 3.6, cy + Math.sin(a) * 3.6]);
    }
    ubPoly(ring, col, 1, 1.3);
    ubLine(cx, cy - 5, cx, cy - 0.8, col, 1, 1.3);
}
function ubIconButton(r, on, tint) {
    ubRR(r[0], r[1], r[2], r[3], 3, on ? tint : [0.17, 0.18, 0.21], on ? 0.22 : 1);
    ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, on ? tint : [0.30, 0.32, 0.37], 1, 1);
}

// ------------------------------------------------------------------ painting: strips
function ubMeter(r, out, c, dim) {
    ubRR(r[0], r[1], r[2], r[3], 2, [0.06, 0.07, 0.085], 1);
    const mid = r[1] + r[3] / 2;
    const v = clamp(out, -1, 1);
    const hh = (r[3] / 2 - 1) * Math.abs(v);
    if (v >= 0) ubRect(r[0] + 1, mid - hh, r[2] - 2, Math.max(0.5, hh), c, dim ? 0.3 : 1);
    else ubRect(r[0] + 1, mid, r[2] - 2, Math.max(0.5, hh), c, dim ? 0.3 : 1);
    ubLine(r[0], mid, r[0] + r[2], mid, [0.4, 0.42, 0.46], 1, 1);
}
function ubKnob(k, mod, c, dim, compact) {
    const spec = k.spec;
    const v = mod.p[spec.key];
    const n = ubKnobNorm(spec, v);
    const a0 = Math.PI * 0.75;
    const a1 = a0 + Math.PI * 1.5 * n;
    const track = [];
    const val = [];
    for (let i = 0; i <= 16; i++) {
        const a = a0 + (Math.PI * 1.5 * i) / 16;
        track.push([k.cx + Math.cos(a) * (k.r), k.cy + Math.sin(a) * (k.r)]);
    }
    for (let i = 0; i <= 16; i++) {
        const a = a0 + (a1 - a0) * (i / 16);
        val.push([k.cx + Math.cos(a) * (k.r), k.cy + Math.sin(a) * (k.r)]);
    }
    ubCircle(k.cx, k.cy, k.r - 2.5, [0.17, 0.18, 0.205], 1, true);
    ubPoly(track, [0.30, 0.32, 0.36], 1, 2);
    if (n > 0.005) ubPoly(val, UB_ORANGE, dim ? 0.4 : 1, 2);
    ubLine(k.cx + Math.cos(a1) * 1.5, k.cy + Math.sin(a1) * 1.5, k.cx + Math.cos(a1) * (k.r - 3), k.cy + Math.sin(a1) * (k.r - 3), [0.92, 0.93, 0.95], 1, 1.3);
    ubTextC(compact && spec.short ? spec.short(v) : spec.fmt(v), k.cx, k.valY, 7, UB_ORANGE, dim ? 0.5 : 1);
    ubTextC(spec.label, k.cx, k.labY, 7, [0.58, 0.61, 0.67], 1);
}
function ubDrawViz(slot, mod, r, big) {
    const c = ubModCol(mod);
    const t = ubTel(slot);
    const p = mod.p;
    const dim = !mod.enabled;
    ubRR(r[0], r[1], r[2], r[3], 3, [0.075, 0.085, 0.1], 1);
    const ix = r[0] + 2;
    const iy = r[1] + 3;
    const iw = r[2] - 4;
    const ih = r[3] - 6;
    if (big) {
        for (let k = 1; k < 4; k++) ubLine(ix, iy + (ih * k) / 4, ix + iw, iy + (ih * k) / 4, [0.16, 0.17, 0.2], 1, 1);
        for (let k = 1; k < 8; k++) ubLine(ix + (iw * k) / 8, iy, ix + (iw * k) / 8, iy + ih, [0.13, 0.14, 0.17], 1, 1);
    } else {
        ubLine(ix, iy + ih / 2, ix + iw, iy + ih / 2, [0.16, 0.17, 0.2], 1, 1);
    }
    const a = dim ? 0.35 : 1;
    const Y = (u) => iy + (1 - u) * ih;
    if (mod.type === MOD_LFO || mod.type === MOD_MSEG) {
        const n = Math.max(12, Math.floor(iw));
        const pts = [];
        for (let i = 0; i < n; i++) {
            const x01 = i / (n - 1);
            const u = mod.type === MOD_LFO ? lfoShape(Math.round(p.shape), frac(x01 * 0.9999)) : evalMseg(mod.points, x01);
            pts.push([ix + x01 * iw, Y(u)]);
        }
        let ls = 0;
        let le = 1;
        if (mod.type === MOD_MSEG && p.loopOn) {
            ls = p.loopStart; le = Math.max(p.loopEnd, ls + 0.05);
            ubRect(ix + ls * iw, iy, (le - ls) * iw, ih, c, 0.12);
            ubLine(ix + ls * iw, iy, ix + ls * iw, iy + ih, c, 0.7, 1);
            ubLine(ix + le * iw, iy, ix + le * iw, iy + ih, c, 0.7, 1);
        }
        ubFillPoly(pts, iy + ih, c, 0.14 * a);
        ubPoly(pts, c, a, big ? 1.5 : 1.2);
        const px = mod.type === MOD_MSEG ? ls + clamp(t.phase, 0, 1) * (le - ls) : clamp(t.phase, 0, 1);
        ubLine(ix + px * iw, iy, ix + px * iw, iy + ih, [1, 1, 1], 0.55, 1);
        ubCircle(ix + px * iw, Y(clamp(t.u, 0, 1)), big ? 2.8 : 2.2, [1, 1, 1], 1, true);
        if (big && mod.type === MOD_MSEG) {
            const sel = ubDrag && ubDrag.kind === "mseg" ? ubDrag.i : -1;
            for (let i = 0; i < mod.points.length; i++) {
                const q = ubMsegXY(r, mod.points[i]);
                ubCircle(q[0], q[1], 3.2, c, 1, true);
                ubCircle(q[0], q[1], 3.2, i === sel ? [1, 1, 1] : [0.08, 0.09, 0.1], 1, false, 1);
            }
            for (let i = 0; i < mod.points.length - 1; i++) {
                const mx = (mod.points[i].x + mod.points[i + 1].x) / 2;
                const q = ubMsegXY(r, { x: mx, y: evalMseg(mod.points, mx) });
                ubRect(q[0] - 2, q[1] - 2, 4, 4, [0.12, 0.13, 0.15], 1);
                ubCol(c, 0.9);
                mgraphics.set_line_width(1);
                mgraphics.rectangle(q[0] - 2, q[1] - 2, 4, 4);
                mgraphics.stroke();
            }
        }
    } else if (mod.type === MOD_ENV) {
        const h = ubHist[slot];
        const n = Math.max(2, Math.floor(iw));
        const stride = big ? 1 : 3;
        const pts = [];
        for (let i = 0; i < n; i++) {
            const idx = h.length - 1 - (n - 1 - i) * stride;
            const v = idx >= 0 ? h[idx] : 0;
            pts.push([ix + i * (iw / (n - 1)), Y(clamp(v, 0, 1))]);
        }
        ubFillPoly(pts, iy + ih, c, 0.2 * a);
        ubPoly(pts, c, a, big ? 1.5 : 1.2);
        ubCircle(ix + iw, Y(clamp(t.u, 0, 1)), big ? 2.8 : 2.2, [1, 1, 1], 1, true);
    } else if (mod.type === MOD_RANDOM) {
        const sm = Object.assign({}, mod, { p: Object.assign({}, p, { phase: 0 }) });
        const win = big ? 5 : 3;
        const head = (t.aux || 0) + clamp(t.phase, 0, 1);
        const n = Math.max(12, Math.floor(iw));
        const pts = [];
        const play = 0.72;
        for (let i = 0; i < n; i++) {
            const acc = head - play * win + (win * i) / (n - 1);
            pts.push([ix + (iw * i) / (n - 1), Y(evalModulator(sm, acc).u)]);
        }
        ubFillPoly(pts, iy + ih, c, 0.14 * a);
        ubPoly(pts, c, a, big ? 1.5 : 1.2);
        ubLine(ix + play * iw, iy, ix + play * iw, iy + ih, [1, 1, 1], 0.55, 1);
        ubCircle(ix + play * iw, Y(clamp(t.u, 0, 1)), big ? 2.8 : 2.2, [1, 1, 1], 1, true);
    } else if (mod.type === MOD_STEPS) {
        const n = clamp(Math.round(p.steps), 1, STEPS_MAX);
        const bw = iw / n;
        const cur = Math.floor(t.aux || 0) % n;
        for (let i = 0; i < n; i++) {
            const v = mod.stepVals[i];
            const on = i === cur;
            const gap = bw > 4 ? 1 : 0;
            ubRect(ix + i * bw, Y(v), Math.max(0.8, bw - gap), Math.max(1, v * ih), c, (on ? 1 : 0.55) * a);
        }
    }
}

function ubPaintStrip(g) {
    const slot = g.slot;
    const mod = MM.state.mods[slot];
    const c = ubModCol(mod);
    const R = ubStripRects(g);
    const sel = ubSel() === slot;
    const armed = MM.learn.armed && MM.learn.mod === slot;
    const dim = !mod.enabled;
    const t = ubTel(slot);
    ubRR(g.x, 0, g.w, 161, 5, [0.125, 0.135, 0.155], 1);
    // border: selected = type colour, learning = cyan
    ubRRStroke(g.x + 0.5, 0.5, g.w - 1, 160, 5, armed ? UB_CYAN : sel ? c : [0.21, 0.23, 0.27], 1, armed || sel ? 1.6 : 1);
    ubRR(g.x + 1.5, 1.5, g.w - 3, 2, 1, armed ? UB_CYAN : c, dim ? 0.25 : sel ? 1 : 0.7);
    // header
    ubPowerButton(R, mod, c, ubHover && ubHover.hit && ubHover.hit.kind === "pwr" && ubHover.hit.slot === slot);
    if (ubEdit && ubEdit.slot === slot) {
        ubRR(R.name[0] - 1, 3, R.name[2] + 1, 12, 2, [0.04, 0.05, 0.06], 1);
        ubRRStroke(R.name[0] - 0.5, 3.5, R.name[2], 11, 2, UB_CYAN, 1, 1);
        ubText(ubFit(ubEdit.text + "|", R.name[2] - 3, 8), R.name[0] + 2, 12, 8, [1, 1, 1], 1);
    } else {
        ubText(ubFit(mod.name, R.name[2], 8), R.name[0], 12, 8, [0.9, 0.92, 0.95], dim ? 0.5 : 1);
    }
    if (g.exp) {
        const tr = R.type;
        const thot = ubHover && ubHover.hit && ubHover.hit.kind === "typechip" && ubHover.hit.slot === slot;
        ubRR(tr[0], tr[1], tr[2], tr[3], 3, thot ? [0.22, 0.24, 0.29] : [0.17, 0.18, 0.21], 1);
        ubRRStroke(tr[0] + 0.5, tr[1] + 0.5, tr[2] - 1, tr[3] - 1, 3, [0.30, 0.32, 0.37], 1, 1);
        ubGlyph(mod.type, tr[0] + 3, tr[1] + 3.5, 8, 6, c, dim ? 0.5 : 1);
        ubText(MOD_TYPE_SHORT[mod.type], tr[0] + 14, tr[1] + 9.5, 7, [0.85, 0.87, 0.92], 1);
        ubPoly([[tr[0] + tr[2] - 9, tr[1] + 5], [tr[0] + tr[2] - 6, tr[1] + 8], [tr[0] + tr[2] - 3, tr[1] + 5]], [0.7, 0.72, 0.78], 1, 1.2);
        const delOn = ubDelArm === slot;
        ubLine(R.del[0] + 4, R.del[1] + 4, R.del[0] + 12, R.del[1] + 12, delOn ? UB_RED : [0.55, 0.57, 0.62], 1, 1.4);
        ubLine(R.del[0] + 12, R.del[1] + 4, R.del[0] + 4, R.del[1] + 12, delOn ? UB_RED : [0.55, 0.57, 0.62], 1, 1.4);
        const cx = R.collapse[0] + 8;
        const cy = R.collapse[1] + 8;
        ubPoly([[cx + 3, cy - 4], [cx - 2, cy], [cx + 3, cy + 4]], [0.75, 0.77, 0.82], 1, 1.5);
    }
    // viz + meter
    ubDrawViz(slot, mod, R.viz, g.exp);
    ubMeter(R.meter, t.out, c, dim);
    for (const ch of R.chips) {
        const r = ch.rect;
        ubRR(r[0], r[1], r[2], r[3], 3, ch.on ? c : [0.17, 0.18, 0.21], ch.on ? 0.28 : 1);
        ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, ch.on ? c : [0.30, 0.32, 0.37], 1, 1);
        if (ch.glyph !== undefined) ubShapeGlyph(ch.glyph, r[0] + 3, r[1] + 3, r[2] - 6, r[3] - 6, ch.on ? [1, 1, 1] : [0.6, 0.62, 0.68], 1);
        else ubTextC(ch.label, r[0] + r[2] / 2, r[1] + 9, 7, ch.on ? [1, 1, 1] : [0.6, 0.62, 0.68], 1);
    }
    for (const k of R.knobs) ubKnob(k, mod, c, dim, !g.exp);
    // count chip
    const cnt = MM.mappingsFor(slot).length;
    ubRR(R.count[0], R.count[1], R.count[2], R.count[3], 5, cnt ? UB_CYAN : [0.2, 0.21, 0.24], cnt ? 0.16 : 1);
    ubRRStroke(R.count[0] + 0.5, R.count[1] + 0.5, R.count[2] - 1, R.count[3] - 1, 5, cnt ? UB_CYAN : [0.3, 0.32, 0.37], 1, 1);
    ubTextC(cnt + (cnt === 1 ? " map" : " maps"), R.count[0] + R.count[2] / 2, R.count[1] + 9, 7, cnt ? UB_CYAN : [0.55, 0.57, 0.62], 1);
}

function ubPaintPlus(sg) {
    const p = sg.plus;
    const open = ubPopup && ubPopup.mode === "add";
    ubRR(p.x, 0, p.w, 161, 5, [0.1, 0.108, 0.125], 1);
    ubRRStroke(p.x + 0.5, 0.5, p.w - 1, 160, 5, open ? UB_CYAN : [0.2, 0.22, 0.26], 1, 1);
    const cx = p.x + p.w / 2;
    ubLine(cx - 5, 80, cx + 5, 80, open ? UB_CYAN : [0.6, 0.63, 0.68], 1, 1.8);
    ubLine(cx, 75, cx, 85, open ? UB_CYAN : [0.6, 0.63, 0.68], 1, 1.8);
    if (!sg.list.length) {
        ubTextC("Add a", cx, 98, 8, [0.6, 0.63, 0.68], 1);
        ubTextC("modulator", cx, 108, 8, [0.6, 0.63, 0.68], 1);
    }
}

function ubPaintPopup() {
    const pr = ubPopupRect();
    ubRR(pr[0], pr[1], pr[2], pr[3], 4, [0.07, 0.075, 0.09], 1);
    ubRRStroke(pr[0] + 0.5, pr[1] + 0.5, pr[2] - 1, pr[3] - 1, 4, UB_CYAN, 1, 1);
    for (let k = 0; k < UB_TYPES.length; k++) {
        const ty = UB_TYPES[k];
        const ry = pr[1] + 2 + k * 17;
        const hov = ubHover && ubIn([pr[0], ry, pr[2], 17], ubHover.x, ubHover.y);
        if (hov) ubRR(pr[0] + 2, ry, pr[2] - 4, 16, 3, [0.2, 0.23, 0.28], 1);
        const col = MOD_COLORS[(k * 3) % MOD_COLORS.length];
        ubGlyph(ty, pr[0] + 6, ry + 4, 14, 9, col, 1);
        ubText(MOD_TYPE_NAMES[ty], pr[0] + 26, ry + 12, 8, [0.9, 0.92, 0.95], 1);
    }
}

// pulse of the single-shot learn state (0.35 .. 1)
function ubPulse() {
    return 0.35 + 0.65 * Math.abs(Math.sin(ubFrame * 0.22));
}
function ubPaintRail() {
    ubRR(0, 0, UB_RAIL, 161, 5, [0.1, 0.108, 0.125], 1);
    const rr = ubRailRects();
    const L = MM.learn;
    const single = L.armed && !L.multi;
    const multi = L.armed && L.multi;
    const lr = rr.learn;
    // armed: single-shot pulses, multi is solid with an outer ring
    ubRR(lr[0], lr[1], lr[2], lr[3], 3, multi ? UB_CYAN : [0.17, 0.18, 0.21], multi ? 0.9 : 1);
    if (single) ubRR(lr[0], lr[1], lr[2], lr[3], 3, UB_CYAN, 0.55 * ubPulse());
    ubRRStroke(lr[0] + 0.5, lr[1] + 0.5, lr[2] - 1, lr[3] - 1, 3, L.armed ? UB_CYAN : [0.30, 0.32, 0.37], single ? ubPulse() : 1, 1);
    if (multi) ubRRStroke(lr[0] - 1, lr[1] - 1, lr[2] + 2, lr[3] + 2, 4, UB_CYAN, 0.55, 1.2);
    ubLearnIcon(lr, L.armed, multi ? [0.05, 0.08, 0.1] : L.armed ? UB_CYAN : [0.6, 0.64, 0.7]);
    ubTextC("LRN", UB_RAIL / 2, 31, 6, L.armed ? UB_CYAN : [0.5, 0.53, 0.58], single ? ubPulse() : 1);
    ubIconButton(rr.list, ubPb(), UB_ORANGE);
    ubListIcon(rr.list, ubPb() ? UB_ORANGE : [0.6, 0.64, 0.7]);
    ubTextC("LST", UB_RAIL / 2, 67, 6, ubPb() ? UB_ORANGE : [0.5, 0.53, 0.58], 1);
    ubTextC(String(MM.modCount()), UB_RAIL / 2, 143, 7, [0.75, 0.77, 0.82], 1);
    ubLine(4, 147, UB_RAIL - 4, 147, [0.3, 0.32, 0.36], 1, 1);
    ubTextC("16", UB_RAIL / 2, 156, 7, [0.45, 0.47, 0.52], 1);
}

// ------------------------------------------------------------------ painting: patchbay
// editable transfer curve: x = modulator value 0..1, y = output 0..1 (the mapping's MSEG)
const UB_OFF_GREY = [0.42, 0.44, 0.48];
// Output bar of the remap editor (Phase Plant style, centred): zero is the vertical centre, positive output fills up, negative
// fills down. `range` is the limit marker's distance from the centre (0..1 of the half height). "+" shows only the upper
// triangle, "\u2212" only the lower one (the zero side is hidden and fixed at the centre); "\u00b1" shows both, linked
// symmetrically. The fill is the live signed modulation o = range * (...), so it reflects the real output.
// A bypassed modulator (or disabled mapping) shows the markers and band but no live value.
function ubMeterGeom(r) {
    const iy = r[1] + 3;
    const ih = r[3] - 6;
    return { tx: r[0] + 5, tw: r[2] - 6, iy, ih, cy: iy + ih / 2, hh: ih / 2 };
}
function ubPaintOutMeter(r, m, mod) {
    const g = ubMeterGeom(r);
    const live = mod.enabled && m.enabled;
    const c = live ? ubModCol(mod) : UB_OFF_GREY;
    const pol = m.polarity;
    ubRR(g.tx, r[1], g.tw, r[3], 3, [0.075, 0.085, 0.1], 1);
    const yHi = g.cy - g.hh * m.range;
    const yLo = g.cy + g.hh * m.range;
    // limit band: centre..limit ("+" up, "\u2212" down) or both sides ("\u00b1")
    if (pol >= 0) ubRect(g.tx + 1, yHi, g.tw - 2, Math.max(0, g.cy - yHi), c, 0.16);
    if (pol <= 0) ubRect(g.tx + 1, g.cy, g.tw - 2, Math.max(0, yLo - g.cy), c, 0.16);
    if (live) {
        const o = clamp(mappingOutput(Object.assign({}, m, { mode: "mod" }), ubTel(m.mod).out), -1, 1);
        const ty = g.cy - g.hh * o;
        ubRect(g.tx + 2, Math.min(ty, g.cy), g.tw - 4, Math.abs(g.cy - ty), c, 0.6);
        ubRect(g.tx + 1, ty - 0.75, g.tw - 2, 1.5, [1, 1, 1], 0.95);
    }
    ubLine(g.tx, g.cy, g.tx + g.tw, g.cy, [0.62, 0.64, 0.7], 1, 1);
    const hot = ubDrag && ubDrag.kind === "range" && ubDrag.mapId === m.id;
    const mc = hot ? [1, 1, 1] : [0.78, 0.8, 0.85];
    if (pol >= 0) ubRangeMarker(r[0], yHi, mc);
    if (pol <= 0) ubRangeMarker(r[0], yLo, mc);
}
function ubRangeMarker(x, y, c) {
    ubCol(c, 1);
    mgraphics.move_to(x, y - 3.5);
    mgraphics.line_to(x + 4.5, y);
    mgraphics.line_to(x, y + 3.5);
    mgraphics.close_path();
    mgraphics.fill();
}
// A press is only accepted on a visible marker's side of the centre: "+" above it, "\u2212" below it, "\u00b1" anywhere.
function ubRangeSideOk(pol, rect, y) {
    const g = ubMeterGeom(rect);
    return pol === 0 || (pol > 0 ? y <= g.cy : y >= g.cy);
}
// range 0..1 from a y position (during a drag the hidden side just pins to 0)
function ubRangeValue(rect, pol, y) {
    const g = ubMeterGeom(rect);
    const d = pol === 0 ? Math.abs(y - g.cy) : pol > 0 ? g.cy - y : y - g.cy;
    return clamp(d / g.hh, 0, 1);
}
function ubApplyRange(d, y) {
    const m = MM.getMapping(d.mapId);
    if (!m) return;
    MM.updateMapping(m.id, { range: ubRangeValue(d.rect, m.polarity, y) });
}
function ubPaintShapeEditor(r, m, mod) {
    // a bypassed modulator greys the editor and hides its scan line; editing still works
    const off = !mod.enabled;
    const cyan = m.mode === "remote"; // the whole Remote editor is cyan
    const ac = off ? UB_OFF_GREY : cyan ? UB_REM_COL : UB_MOD_COL;
    ubRR(r[0], r[1], r[2], r[3], 3, cyan ? UB_REM_BG : UB_MOD_BG, 1);
    const ix = r[0] + 2;
    const iy = r[1] + 3;
    const iw = r[2] - 4;
    const ih = r[3] - 6;
    const gh = cyan ? [0.09, 0.19, 0.23] : [0.14, 0.15, 0.18];
    const gv = cyan ? [0.08, 0.17, 0.2] : [0.12, 0.13, 0.16];
    for (let k = 1; k < 4; k++) ubLine(ix, iy + (ih * k) / 4, ix + iw, iy + (ih * k) / 4, gh, 1, 1);
    for (let k = 1; k < 4; k++) ubLine(ix + (iw * k) / 4, iy, ix + (iw * k) / 4, iy + ih, gv, 1, 1);
    ubLine(ix, iy + ih, ix + iw, iy, cyan ? [0.13, 0.27, 0.32] : [0.2, 0.22, 0.26], 1, 1);
    const shape = m.shape;
    const n = Math.max(24, Math.floor(iw));
    const pts = [];
    for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        pts.push([ix + iw * u, iy + ih * (1 - evalMseg(shape, u))]);
    }
    ubFillPoly(pts, iy + ih, ac, 0.1);
    ubPoly(pts, ac, 1, 1.6);
    if (!off) {
        const out = ubTel(m.mod).out;
        const u = clamp((out + 1) / 2, 0, 1);
        const v = evalMseg(shape, u);
        ubLine(ix + iw * u, iy, ix + iw * u, iy + ih, ubModCol(mod), 0.5, 1);
        ubCircle(ix + iw * u, iy + ih * (1 - v), 2.4, [1, 1, 1], 1, true);
    }
    // handles: points (white ring while dragged) and segment bend squares
    const sel = ubDrag && ubDrag.kind === "mseg" && ubDrag.tgt && ubDrag.tgt.mapId === m.id ? ubDrag.i : -1;
    for (let i = 0; i < shape.length - 1; i++) {
        const mx = (shape[i].x + shape[i + 1].x) / 2;
        const q = ubMsegXY(r, { x: mx, y: evalMseg(shape, mx) });
        ubRect(q[0] - 2, q[1] - 2, 4, 4, [0.12, 0.13, 0.15], 1);
        ubCol(ac, 0.9);
        mgraphics.set_line_width(1);
        mgraphics.rectangle(q[0] - 2, q[1] - 2, 4, 4);
        mgraphics.stroke();
    }
    for (let i = 0; i < shape.length; i++) {
        const q = ubMsegXY(r, shape[i]);
        ubCircle(q[0], q[1], 3.2, ac, 1, true);
        ubCircle(q[0], q[1], 3.2, i === sel ? [1, 1, 1] : [0.08, 0.09, 0.1], 1, false, 1);
    }
}
// Remote output bar: absolute 0..1 of the target parameter, no centre line. The min..max band is shaded, the fill runs from
// min to the live value, and two independent triangles mark the limits (max filled, min outlined).
function ubPaintAbsMeter(r, m, mod) {
    const g = ubMeterGeom(r);
    const live = mod.enabled && m.enabled;
    const c = live ? UB_REM_COL : UB_OFF_GREY;
    ubRR(g.tx, r[1], g.tw, r[3], 3, UB_REM_BG, 1);
    const yOf = (v) => g.iy + g.ih * (1 - v);
    const y0 = yOf(m.min);
    const y1 = yOf(m.max);
    ubRect(g.tx + 1, Math.min(y0, y1), g.tw - 2, Math.abs(y1 - y0), c, 0.18);
    if (live) {
        const yv = yOf(clamp(mappingOutput(m, ubTel(m.mod).out), 0, 1));
        ubRect(g.tx + 2, Math.min(y0, yv), g.tw - 4, Math.max(1, Math.abs(yv - y0)), c, 0.6);
        ubRect(g.tx + 1, yv - 0.75, g.tw - 2, 1.5, [1, 1, 1], 0.95);
    }
    const hot = ubDrag && ubDrag.kind === "limit" && ubDrag.mapId === m.id ? ubDrag.which : "";
    ubLimitMarker(r[0], y0, hot === "min" ? [1, 1, 1] : c, false);
    ubLimitMarker(r[0], y1, hot === "max" ? [1, 1, 1] : c, true);
}
// limit triangle pointing at the bar: filled = max, outlined = min
function ubLimitMarker(x, y, c, filled) {
    mgraphics.move_to(x, y - 3.5);
    mgraphics.line_to(x + 4.5, y);
    mgraphics.line_to(x, y + 3.5);
    mgraphics.close_path();
    if (filled) { ubCol(c, 1); mgraphics.fill(); } else { ubCol(c, 1); mgraphics.set_line_width(1.1); mgraphics.stroke(); }
}
// MOD / REM tab (rounded top, lit tab in its mode colour)
function ubPaintModeTab(r, label, on, accent) {
    ubRR(r[0], r[1], r[2], r[3] + 1, 4, on ? accent : [0.17, 0.18, 0.21], on ? 0.28 : 1);
    ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3], 4, on ? accent : [0.30, 0.32, 0.37], 1, 1);
    ubTextC(label, r[0] + r[2] / 2, r[1] + 9, 7, on ? [1, 1, 1] : [0.55, 0.57, 0.62], 1);
}
// does the mapping's shape equal preset k (for the preset buttons' lit state)?
function ubShapeIsPreset(m, k) {
    const a = m.shape;
    const b = curveToShape(k, 0.5, 4);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i].x - b[i].x) > 0.002 || Math.abs(a[i].y - b[i].y) > 0.002 || Math.abs(a[i].curve - b[i].curve) > 0.002 || !!a[i].sCurve !== !!b[i].sCurve) return false;
    }
    return true;
}
function ubPaintDetail(gm) {
    const m = ubPbSelMapping();
    const x = gm.dx;
    const w = gm.dw;
    const P = gm.panel;
    ubRR(P[0], P[1], P[2], P[3], 6, [0.125, 0.135, 0.155], 1);
    ubRRStroke(P[0] + 0.5, 0.5, P[2] - 1, 160, 6, [0.26, 0.28, 0.32], 1, 1);
    if (!m) {
        ubTextC("Select a row", x + w / 2, 70, 8, [0.6, 0.63, 0.68], 1);
        ubTextC("to edit its curve,", x + w / 2, 82, 7, [0.45, 0.47, 0.52], 1);
        ubTextC("range & mode", x + w / 2, 91, 7, [0.45, 0.47, 0.52], 1);
        ubTextC(MM.allMappings().length + " mappings", x + w / 2, 110, 8, UB_REM_COL, 1);
        return;
    }
    const mod = MM.state.mods[m.mod];
    const off = !mod.enabled;
    const c = off ? UB_OFF_GREY : ubModCol(mod);
    const st = MM.mappingStatus(m.id);
    const rem = m.mode === "remote";
    const hl = off ? UB_OFF_GREY : rem ? UB_REM_COL : UB_MOD_COL;
    const pname = m.target.paramName || m.target.name || "?";
    ubText(ubFit(pname, w, 8), x, 12, 8, st === "missing" ? UB_RED : [0.92, 0.94, 0.97], 1);
    ubText(ubFit((m.target.trackName || "?") + " / " + (m.target.deviceName || "?"), w, 7), x, 22, 7, [0.55, 0.58, 0.64], 1);
    ubCircle(x + 3, 31.5, 2.8, c, 1, true);
    ubText(ubFit(mod.name + (st === "missing" ? "  MISSING" : st === "disabled" ? "  off" : ""), w - 10, 7), x + 9, 34, 7, st === "missing" ? UB_RED : c, 1);
    // Remote: a cyan frame around the tab row and the editor
    if (rem) ubRRStroke(x - 1.5, 35.5, w + 1, 143 - 2 - 35.5, 4, off ? UB_OFF_GREY : UB_REM_COL, 0.85, 1);
    for (const d of ubDetailRects(gm, m)) {
        const r = d.rect;
        if (d.id === "mseg") ubPaintShapeEditor(r, m, mod);
        else if (d.id === "meter") { if (rem) ubPaintAbsMeter(r, m, mod); else ubPaintOutMeter(r, m, mod); }
        else if (d.id === "tabmod") ubPaintModeTab(r, "MOD", !rem, off ? UB_OFF_GREY : UB_MOD_COL);
        else if (d.id === "tabrem") ubPaintModeTab(r, "REM", rem, off ? UB_OFF_GREY : UB_REM_COL);
        else if (d.id.indexOf("preset") === 0) {
            const on = ubShapeIsPreset(m, d.curve);
            ubRR(r[0], r[1], r[2], r[3], 3, on ? hl : [0.17, 0.18, 0.21], on ? 0.25 : 1);
            ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, on ? hl : [0.30, 0.32, 0.37], 1, 1);
            ubCurveGlyph(d.curve, r[0] + (r[2] < 22 ? 3.5 : 5), r[1] + 3, r[2] - (r[2] < 22 ? 7 : 10), r[3] - 6, on ? hl : [0.62, 0.64, 0.7], 1);
        } else if (d.id.indexOf("pol") === 0) ubPaintPolarity(r, d.pol, m.polarity === d.pol, hl);
    }
    ubPaintReadout(ubReadoutSpec(gm, m), m, mod);
}
// Range readout: plain text at the right end of the presets row (the presets shrink to leave room).
// Text is the list-row value text: Mod "\u00b170%" / "+45%" / "\u221230%", Remote "20\u201380%" (min first, so "80\u201320%" reads inverted).
function ubReadoutSpec(gm, m) {
    const W = ubReadoutW();
    return { text: ubValueText(m), size: UB_READOUT_SIZE, base: 143 + 9.5, rect: [gm.dx + gm.dw - W, 143, W, 13] };
}
function ubPaintReadout(ro, m, mod) {
    const rem = m.mode === "remote";
    const off = !mod.enabled || !m.enabled;
    const ac = off ? UB_OFF_GREY : rem ? UB_REM_COL : UB_MOD_COL;
    const hot = ubDrag && (ubDrag.kind === "range" || ubDrag.kind === "limit") && ubDrag.mapId === m.id;
    ubText(ro.text, ro.rect[0] + ro.rect[2] - ubTextW(ro.text, ro.size), ro.base, ro.size, hot ? [1, 1, 1] : ac, 1);
}
// polarity control, vector glyphs only (+, plus over minus, minus): a segmented 3-cell control, the first cell paints the container
function ubPaintPolarity(r, pol, on, hl) {
    const edge = [0.30, 0.32, 0.37];
    if (pol === 1) ubRR(r[0], r[1], r[2] * 3, r[3], 3, [0.17, 0.18, 0.21], 1);
    if (on) ubRR(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2, 2, hl, 0.3);
    if (pol === 1) ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] * 3 - 1, r[3] - 1, 3, edge, 1, 1);
    else ubLine(r[0] + 0.5, r[1] + 1, r[0] + 0.5, r[1] + r[3] - 1, edge, 1, 1);
    const c = on ? [1, 1, 1] : [0.6, 0.62, 0.68];
    const cx = r[0] + r[2] / 2;
    const cy = r[1] + r[3] / 2;
    const lw = on ? 1.6 : 1.3;
    const s = Math.min(3.5, r[3] / 3.6); // glyph half-size, fits the row height
    if (pol === 1) {
        ubLine(cx - s, cy, cx + s, cy, c, 1, lw);
        ubLine(cx, cy - s, cx, cy + s, c, 1, lw);
    } else if (pol === 0) {
        const d = s * 0.85;
        ubLine(cx - s * 0.7, cy - d, cx + s * 0.7, cy - d, c, 1, lw);
        ubLine(cx, cy - d - s * 0.7, cx, cy - d + s * 0.7, c, 1, lw);
        ubLine(cx - s * 0.7, cy + d, cx + s * 0.7, cy + d, c, 1, lw);
    } else {
        ubLine(cx - s, cy, cx + s, cy, c, 1, lw);
    }
}
function ubCurveRowGlyph(m, x, y, w, h, c, a) {
    const pts = [];
    for (let k = 0; k <= 10; k++) {
        const u = k / 10;
        const v = evalMseg(m.shape, u);
        pts.push([x + w * u, y + h - h * clamp(v, 0, 1)]);
    }
    ubPoly(pts, c, a, 1.2);
}
// tint of the selected modulator's list header / mapping rows (always dimmer than the selected-mapping highlight)
const UB_TINT_HEAD = 0.2;
const UB_TINT_ROW = 0.075;
const UB_SELROW_FILL = 0.14;
function ubPaintList(gm) {
    const R = [gm.lx, 0, gm.lw, 161];
    const total = MM.allMappings().length;
    const sel = ubPbSelMapping();
    ubRR(R[0], R[1], R[2], R[3], 6, [0.125, 0.135, 0.155], 1);
    ubRRStroke(R[0] + 0.5, 0.5, R[2] - 1, 160, 6, [0.26, 0.28, 0.32], 1, 1);
    ubText("MAPPINGS", R[0] + 8, 12, 7, UB_ORANGE, 1);
    ubText(String(total), R[0] + R[2] - 8 - ubTextW(String(total), 7), 12, 7, [0.6, 0.63, 0.68], 1);
    ubLine(R[0] + 4, 15, R[0] + R[2] - 4, 15, [0.24, 0.26, 0.3], 1, 1);
    const vis = ubListVisible();
    const hv = ubHover && ubHover.hit ? ubHover.hit : null;
    let hud = total + " mapping" + (total === 1 ? "" : "s") + " | click a row to edit";
    if (!ubOrder().length) ubText("Add a modulator first", R[0] + 18, 70, 8, [0.5, 0.54, 0.6], 1);
    for (const r of vis.rows) {
        const it = r.item;
        const m0 = MM.state.mods[it.i];
        const col = ubModCol(m0);
        const selMod = it.i === ubSel();
        if (it.kind === "head") {
            ubRect(R[0] + 3, r.y + 1, R[2] - 6, r.h - 2, [0.17, 0.18, 0.21], 1);
            if (selMod) {
                ubRect(R[0] + 3, r.y + 1, R[2] - 6, r.h - 2, col, UB_TINT_HEAD);
            }
            const pr = ubHeadPwrRect(r.y);
            ubPowerGlyph(pr[0] + 7.5, pr[1] + 7.5, m0, col, !!(hv && hv.kind === "ls_hpwr" && hv.slot === it.i));
            ubText(ubFit(m0.name, R[2] - 56, 7.5), R[0] + 22, r.y + 10.5, 7.5, [0.9, 0.92, 0.95], m0.enabled ? 1 : 0.5);
            const cs = String(MM.mappingsFor(it.i).length);
            ubText(cs, R[0] + R[2] - 10 - ubTextW(cs, 7), r.y + 10.5, 7, [0.6, 0.63, 0.68], 1);
        } else if (it.kind === "none") {
            if (selMod) ubRect(R[0] + 3, r.y, R[2] - 6, r.h, col, UB_TINT_ROW);
            ubText("no mappings - press LRN to map", R[0] + 18, r.y + 9, 6.5, [0.42, 0.45, 0.5], 1);
        } else {
            const m = it.m;
            const P = ubRowParts(r.y);
            const status = MM.mappingStatus(m.id);
            const miss = status === "missing";
            const dis = status === "disabled" || !m.enabled;
            const a = miss ? 0.75 : dis ? 0.45 : 1;
            const isSel = !!(sel && sel.id === m.id);
            const rowHov = !!(hv && hv.m && hv.m.id === m.id);
            if (selMod) ubRect(R[0] + 3, r.y, R[2] - 6, r.h, col, UB_TINT_ROW);
            if (isSel) {
                ubRect(R[0] + 3, r.y, R[2] - 6, r.h, UB_CYAN, UB_SELROW_FILL);
                ubRRStroke(R[0] + 3.5, r.y + 0.5, R[2] - 7, r.h - 1, 2, UB_CYAN, 0.9, 1);
            } else if (rowHov) ubRect(R[0] + 3, r.y, R[2] - 6, r.h, [0.18, 0.19, 0.22], 1);
            if (miss) ubRect(R[0] + 3, r.y, R[2] - 6, r.h, UB_RED, 0.08);
            ubMapToggle(P.tog, !!m.enabled, col, !!(hv && hv.kind === "ls_tog" && hv.m && hv.m.id === m.id));
            const nm = m.target.paramName || m.target.name || "?";
            ubText(ubFit(nm, P.name[2], 7.5), P.name[0], r.y + 10, 7.5, miss ? UB_RED : [0.84, 0.86, 0.9], a);
            ubCurveRowGlyph(m, P.curve[0], P.curve[1], P.curve[2], P.curve[3], rowHov && hv.kind === "ls_curve" ? [1, 1, 1] : [0.6, 0.64, 0.7], a);
            const vt = ubValueText(m);
            const remote = m.mode === "remote";
            const mc = remote ? UB_REM_COL : UB_MOD_COL;
            ubText(vt, P.val[0] + P.val[2] - ubTextW(vt, 7.5), r.y + 10, 7.5, mc, a);
            ubRR(P.mode[0], P.mode[1], P.mode[2], P.mode[3], 3, mc, 0.85);
            ubTextC(remote ? "R" : "M", P.mode[0] + P.mode[2] / 2, P.mode[1] + 8, 6.5, [0.06, 0.07, 0.09], 1);
            const dx = P.del[0] + P.del[2] / 2;
            const dy = P.del[1] + P.del[3] / 2;
            const dc = rowHov && hv.kind === "ls_del" ? UB_RED : [0.55, 0.58, 0.63];
            ubLine(dx - 2.5, dy - 2.5, dx + 2.5, dy + 2.5, dc, a, 1.2);
            ubLine(dx + 2.5, dy - 2.5, dx - 2.5, dy + 2.5, dc, a, 1.2);
            if (rowHov) hud = ubTargetPath(m) + (miss ? "  (missing)" : "");
        }
    }
    if (vis.total > vis.rows.length) {
        const ah = vis.area.h;
        const th = Math.max(8, (ah * vis.rows.length) / vis.total);
        const ty = vis.area.y + ((ah - th) * vis.first) / Math.max(1, vis.total - vis.rows.length);
        ubRR(R[0] + R[2] - 4, ty, 2, th, 1, [0.5, 0.53, 0.58], 0.8);
    }
    ubLine(R[0] + 4, 161 - 15, R[0] + R[2] - 4, 161 - 15, [0.24, 0.26, 0.3], 1, 1);
    ubText(ubFit(hud, R[2] - 14, 6.5), R[0] + 7, 161 - 5, 6.5, [0.62, 0.65, 0.7], 1);
    ubPaintDetail(gm);
}

function ubPaintFull() {
    if (ubFullTTL <= 0) return;
    const txt = "Mapping pool full (" + MM.MAX_MAPPINGS + ")";
    const w = ubTextW(txt, 8) + 18;
    const x = Math.max(2, (ubLayoutWidth() - w) / 2);
    ubRR(x, 4, w, 16, 8, [0.2, 0.07, 0.08], 0.96);
    ubRRStroke(x + 0.5, 4.5, w - 1, 15, 8, UB_RED, 1, 1.2);
    ubCircle(x + 9, 12, 2.5, UB_RED, 1, true);
    ubText(txt, x + 15, 15, 8, [1, 0.85, 0.85], 1);
}

// ------------------------------------------------------------------ paint
function ubPaintTooltip() {
    if (!ubHover || ubDrag || ubPopup) return;
    const tip = ubHover.hit && ubHover.hit.tip;
    if (!tip) return;
    const w = ubTextW(tip, 7) + 10;
    const lw = ubLayoutWidth();
    const x = clamp(ubHover.x + 8, 2, Math.max(2, lw - w - 2));
    const y = ubHover.y > 135 ? ubHover.y - 18 : ubHover.y + 12;
    ubRR(x, y, w, 13, 3, [0.04, 0.045, 0.055], 0.96);
    ubRRStroke(x + 0.5, y + 0.5, w - 1, 12, 3, UB_CYAN, 0.8, 1);
    ubText(tip, x + 5, y + 9.5, 7, [0.9, 0.95, 1], 1);
}

function paint() {
    ubPaintRail();
    if (ubPb()) ubPaintList(ubListGeom());
    else {
        const sg = ubStrips();
        for (const g of sg.list) ubPaintStrip(g);
        if (sg.plus) ubPaintPlus(sg);
    }
    if (ubPopup) ubPaintPopup();
    ubPaintFull();
    ubPaintTooltip();
}

// ------------------------------------------------------------------ lifecycle
function uiReady() {
    ubSyncWidth(true);
}
function uiTelemetry(frame) {
    ubFrame++;
    if (ubFullTTL > 0) { ubFullTTL--; mgraphics.redraw(); }
    for (let i = 0; i < MAX_MODS; i++) {
        if (!MM.state.mods[i]) continue;
        const h = ubHist[i];
        h.push(frame.mods[i].u);
        if (h.length > UB_HIST) h.shift();
    }
}
function uiChanged(ev) {
    if (ev.kind === "full") { ubFullTTL = UB_FULL_FRAMES; mgraphics.redraw(); return; }
    if (ev.kind === "learn") return;
    if (ev.kind === "load") { ubPopup = null; ubEdit = null; ubDelArm = -1; }
    if (ev.kind === "mods" || ev.kind === "load" || ev.kind === "ui") ubSyncWidth();
}

const UB_PREVIEW_REMOTE = false; // preview: the selected mapping in Remote mode (false = Mod mode)
const UB_PREVIEW_LIST = true; // preview: mapping list + remap editor (false = rack strips with MSEG expanded)
function preview() {
    MM.demo();
    const names = ["Wobble", "Follow", "Dice", "Seq 8", "Swell"];
    const s = MM.state;
    for (let i = 0; i < 5; i++) s.mods[i].name = names[i];
    s.mods[0].p.shape = 1; s.mods[0].p.rate = 1.2; s.mods[0].p.sync = 0;
    s.mods[1].p.attack = 8; s.mods[1].p.release = 240;
    s.mods[2].p.smooth = 0.35;
    s.mods[3].p.steps = 8; s.mods[3].p.glide = 0.2;
    s.mods[4].points = [
        { x: 0, y: 0.1, curve: 0, sCurve: 0 }, { x: 0.22, y: 0.9, curve: 0.5, sCurve: 0 }, { x: 0.45, y: 0.35, curve: -0.4, sCurve: 0 },
        { x: 0.7, y: 0.75, curve: 0, sCurve: 1 }, { x: 1, y: 0.05, curve: 0.3, sCurve: 0 },
    ];
    s.mods[4].p.loopOn = 1; s.mods[4].p.loopStart = 0.1; s.mods[4].p.loopEnd = 0.85; s.mods[4].p.sync = 1; s.mods[4].p.syncDiv = 12;
    s.mods[4].color = 4;
    const t = MM.readTelemetry();
    const phases = [0.22, 0, 0.6, 0.41, 0.36];
    const aux = [0, 0, 7, 3, 0];
    const outs = [0.55, 0.38, -0.2, 0.4, 0.3];
    for (let i = 0; i < 5; i++) {
        t.mods[i].phase = phases[i]; t.mods[i].aux = aux[i]; t.mods[i].out = outs[i];
        t.mods[i].u = (outs[i] + 1) / 2;
    }
    for (let k = 0; k < UB_HIST; k++) {
        const e = Math.max(0, Math.sin(k * 0.09) * Math.exp(-((k % 55) / 20))) * 0.9 + 0.05;
        ubHist[1].push(e);
    }
    t.mods[1].u = ubHist[1][ubHist[1].length - 1];
    // list view: the selected modulator (Dice) has several mappings, one of them disabled and one shaped by a bent MSEG;
    // another modulator is switched off; one target is gone (red row)
    let selId = 0;
    const add = (mod, track, dev, par, extra) => {
        const m = MM.addMapping(mod, { path: "live_set tracks " + (mod + 2) + " devices 0 parameters " + (par.length + 3), trackName: track, deviceName: dev, paramName: par });
        if (m && extra) MM.updateMapping(m.id, extra);
        if (m && par === "Frequency") selId = m.id;
    };
    add(0, "Bass", "Auto Filter", "Resonance", { range: 0.4, polarity: -1 });
    add(2, "Bass", "Auto Filter", "Frequency", {
        polarity: 0, range: 0.7,
        mode: UB_PREVIEW_REMOTE ? "remote" : "mod", min: 0.2, max: 0.8, // preview: the selected mapping is in Remote mode, 20-80%
        shape: [
            { x: 0, y: 0.05, curve: -0.5, sCurve: 0 }, { x: 0.32, y: 0.7, curve: 0.45, sCurve: 0 },
            { x: 0.62, y: 0.42, curve: 0, sCurve: 0 }, { x: 1, y: 0.95, curve: -0.3, sCurve: 0 },
        ],
    });
    add(2, "Bass", "Auto Filter", "Q", { mode: "remote", min: 0, max: 0.8, shape: curveToShape(CURVE_EXP, 0.5, 4) });
    add(2, "Pads", "Reverb", "Size", { mode: "remote", min: 0.225, max: 0.775, shape: curveToShape(CURVE_S, 0.5, 4) });
    add(2, "Pads", "Reverb", "Dry/Wet", { range: 0.3, polarity: -1 });
    add(3, "Pads", "Reverb", "Decay", { polarity: 0, range: 0.8, shape: curveToShape(CURVE_STEPPED, 0.5, 4) });
    add(4, "Pads", "Chorus", "Rate", { mode: "remote", min: 1, max: 0.4 });
    add(1, "Drums", "Drum Buss", "Drive", { range: 0.6 });
    const all = MM.allMappings();
    const gone = all.filter((m) => m.target.paramName === "Drive")[0];
    if (gone) {
        const orig = MM.mappingStatus;
        MM.mappingStatus = (id) => (id === gone.id ? "missing" : orig(id));
    }
    const dis = all.filter((m) => m.target.paramName === "Dry/Wet")[0];
    if (dis) MM.updateMapping(dis.id, { enabled: 0 });
    s.mods[3].enabled = 0; // "Seq 8" is switched off
    MM.setUI({ exp: 4, sel: 2, pb: UB_PREVIEW_LIST ? 1 : 0, pbSel: selId, pbScroll: 0 });
    ubListReveal(0, 2);
    ubFullTTL = 0;
    if (!UB_PREVIEW_LIST) { MM.armLearn(4, true); MM.setUI({ sel: 4 }); }
    else MM.armLearn(2, false);
}
