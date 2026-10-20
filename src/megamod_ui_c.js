// Mega Modulator — UI design C: "List + Editor".
// Narrow modulator list (one column per 8 modulators) + a tabbed editor ("Edit" / "Targets") that opens to the
// right on double-click, or a global "All mappings" inspector table that replaces the editor area.
// Uses ONLY the mgraphics subset listed in the API CONTRACT (src/megamod_config.js). Persisted UI state (MM.setUI):
//   sel, edOpen, tab ("edit"|"targets"), insp, sort ("mod"|"target"), sortDir (1|-1), scrollT, scrollI.
// Prepended: header (mgraphics init) + megamod_config.js + megamod_mapper.js.

const UI_LW = 130; // list column width
const UI_GAP = 6; // between list and editor area
const UI_EW = 288; // editor / inspector area width
const UI_CW = 284; // content width inside the area
const UI_HEADH = 16; // list header height
const UI_ROWH = 16; // list row pitch
const UI_ROWS = 8; // rows per column
const UI_ADDH = 17; // "+" row
const UI_COLS_MAX = 2;
const UI_TROW = 18; // Targets row pitch
const UI_TTOP = 27; // first Targets row y
const UI_TBOT = 141; // end of Targets rows
const UI_IROW = 16; // inspector row pitch
const UI_ITOP = 16; // inspector first row y
const UI_ADD_TYPES = [MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG];

const UI_BG = [0.09, 0.10, 0.12];
const UI_SURF = [0.135, 0.15, 0.175];
const UI_SURF2 = [0.185, 0.205, 0.235];
const UI_TRACK = [0.06, 0.07, 0.085];
const UI_TXT = [0.86, 0.88, 0.92];
const UI_DIM = [0.52, 0.56, 0.62];
const UI_ORANGE = [1.0, 0.62, 0.2];
const UI_CYAN = [0.30, 0.85, 0.96];
const UI_RED = [0.95, 0.36, 0.36];

var uiHits = [];
var uiDrag = null;
var uiPopup = null;
var uiMouse = { x: -1, y: -1 };
var uiHoverMap = 0;
var uiHist = [];
var uiLastW = 0;
var uiHistLen = 142;

// ------------------------------------------------------------------ small helpers
function uiCol(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1 : a);
}
function uiRect(x, y, w, h, c, a) {
    uiCol(c, a);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}
function uiRRect(x, y, w, h, r, c, a) {
    uiCol(c, a);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.fill();
}
function uiStrokeRRect(x, y, w, h, r, c, a, lw) {
    uiCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.stroke();
}
function uiDot(x, y, r, c, a) {
    uiCol(c, a);
    mgraphics.arc(x, y, r, 0, Math.PI * 2);
    mgraphics.fill();
}
function uiLine(x1, y1, x2, y2, c, a, lw) {
    uiCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(x1, y1);
    mgraphics.line_to(x2, y2);
    mgraphics.stroke();
}
function uiText(s, x, y, size, c, a) {
    uiCol(c, a);
    mgraphics.set_font_size(size);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(s));
}
function uiTextW(s, size) {
    mgraphics.set_font_size(size);
    return mgraphics.text_measure(String(s))[0];
}
function uiTextR(s, xr, y, size, c, a) {
    uiText(s, xr - uiTextW(s, size), y, size, c, a);
}
function uiFit(s, maxW, size) {
    s = String(s);
    if (uiTextW(s, size) <= maxW) return s;
    let n = s.length;
    while (n > 1 && uiTextW(s.slice(0, n) + "..", size) > maxW) n--;
    return s.slice(0, n) + "..";
}
function uiHit(x, y, w, h, o) {
    o.x = x; o.y = y; o.w = w; o.h = h;
    uiHits.push(o);
    return o;
}
function uiIn(h, x, y) {
    return x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h;
}
function uiHitAt(x, y) {
    for (let i = 0; i < uiHits.length; i++) if (uiIn(uiHits[i], x, y)) return uiHits[i];
    return null;
}
function uiPulse() {
    return 0.5 + 0.5 * Math.sin(Date.now() / 220);
}
function uiRedraw() {
    mgraphics.redraw();
}

// ------------------------------------------------------------------ persisted UI state
function uiG(k, d) {
    const u = MM.getUI();
    return u && u[k] !== undefined ? u[k] : d;
}
function uiSet(patch) {
    const u = MM.getUI();
    let same = true;
    for (const k of Object.keys(patch)) if (u[k] !== patch[k]) same = false;
    if (!same) MM.setUI(patch);
}
function uiSlots() {
    const out = [];
    for (let i = 0; i < MAX_MODS; i++) if (MM.state.mods[i]) out.push(i);
    return out;
}
function uiSel() {
    const s = Number(uiG("sel", -1));
    if (MM.state.mods[s]) return s;
    const sl = uiSlots();
    return sl.length ? sl[0] : -1;
}
function uiInsp() {
    return !!uiG("insp", 0);
}
function uiAreaOn() {
    return uiInsp() || (!!uiG("edOpen", 0) && uiSel() >= 0);
}
function uiCols() {
    return Math.max(1, Math.min(UI_COLS_MAX, Math.ceil(uiSlots().length / UI_ROWS)));
}
function uiAreaX() {
    return uiCols() * UI_LW + UI_GAP;
}
// device width in px for the current state (list columns + optional editor / inspector area + 2 * 4 px margin)
function uiWidth() {
    return uiCols() * UI_LW + (uiAreaOn() ? UI_GAP + UI_EW : 0) + 8;
}
function uiSyncWidth() {
    const w = uiWidth();
    if (w !== uiLastW) {
        uiLastW = w;
        MM.requestWidth(w);
    }
}
function uiTab() {
    return uiG("tab", "edit") === "targets" ? "targets" : "edit";
}

// ------------------------------------------------------------------ sorting
function uiTargetText(t) {
    return [t.trackName, t.deviceName, t.paramName || t.name].filter((s) => s).join(" > ");
}
// key "mod": by modulator slot then mapping id; key "target": by track, device, parameter (case-insensitive)
function uiSortMappings(list, key, dir) {
    const d = dir < 0 ? -1 : 1;
    const arr = list.slice();
    const lc = (s) => String(s || "").toLowerCase();
    arr.sort((a, b) => {
        let c = 0;
        if (key === "target") {
            const ta = a.target, tb = b.target;
            const ka = [lc(ta.trackName), lc(ta.deviceName), lc(ta.paramName || ta.name)];
            const kb = [lc(tb.trackName), lc(tb.deviceName), lc(tb.paramName || tb.name)];
            for (let i = 0; i < 3 && c === 0; i++) c = ka[i] < kb[i] ? -1 : ka[i] > kb[i] ? 1 : 0;
        } else {
            c = a.mod - b.mod;
        }
        if (c === 0) c = a.id - b.id;
        return c * d;
    });
    return arr;
}

// ------------------------------------------------------------------ vector icons
function uiPoly(pts, x, y, w, h, c, a, lw) {
    uiCol(c, a);
    mgraphics.set_line_width(lw || 1);
    for (let i = 0; i < pts.length; i++) {
        const px = x + pts[i][0] * w, py = y + pts[i][1] * h;
        if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();
}
function uiTypeIcon(type, x, y, s, c, a) {
    if (type === MOD_LFO) {
        const pts = [];
        for (let k = 0; k <= 12; k++) pts.push([k / 12, 0.5 - 0.42 * Math.sin((k / 12) * Math.PI * 2)]);
        uiPoly(pts, x, y, s, s, c, a, 1.2);
    } else if (type === MOD_ENV) {
        uiPoly([[0, 0.9], [0.22, 0.12], [0.42, 0.62], [0.62, 0.32], [1, 0.9]], x, y, s, s, c, a, 1.2);
    } else if (type === MOD_RANDOM) {
        uiPoly([[0, 0.7], [0.25, 0.7], [0.25, 0.2], [0.5, 0.2], [0.5, 0.85], [0.75, 0.85], [0.75, 0.45], [1, 0.45]], x, y, s, s, c, a, 1.2);
    } else if (type === MOD_STEPS) {
        const hs = [0.5, 0.9, 0.3, 0.7];
        for (let k = 0; k < 4; k++) uiRect(x + k * (s / 4) + 0.5, y + s * (1 - hs[k]), s / 4 - 1, s * hs[k], c, a);
    } else {
        uiPoly([[0, 0.9], [0.3, 0.2], [0.6, 0.65], [1, 0.1]], x, y, s, s, c, a, 1.2);
        uiDot(x + 0.3 * s, y + 0.2 * s, 1.3, c, a);
        uiDot(x + 0.6 * s, y + 0.65 * s, 1.3, c, a);
    }
}
function uiArrowGlyph(x, y, c, a, dbl) {
    uiLine(x, y, x + 7, y, c, a, 1.2);
    uiPoly([[0, 0], [0.5, 0.5], [0, 1]], x + 4.5, y - 3, 4, 6, c, a, 1.2);
    if (dbl) uiPoly([[0, 0], [0.5, 0.5], [0, 1]], x + 1.5, y - 3, 4, 6, c, a, 1.2);
}
function uiCloseGlyph(x, y, s, c, a) {
    uiLine(x, y, x + s, y + s, c, a, 1.3);
    uiLine(x + s, y, x, y + s, c, a, 1.3);
}
function uiTrashGlyph(x, y, c, a) {
    uiLine(x, y + 2, x + 8, y + 2, c, a, 1.2);
    uiLine(x + 2.5, y, x + 5.5, y, c, a, 1.2);
    uiCol(c, a);
    mgraphics.set_line_width(1.1);
    mgraphics.move_to(x + 1, y + 3.5);
    mgraphics.line_to(x + 1.8, y + 9.5);
    mgraphics.line_to(x + 6.2, y + 9.5);
    mgraphics.line_to(x + 7, y + 3.5);
    mgraphics.stroke();
}
function uiListGlyph(x, y, c, a) {
    for (let k = 0; k < 3; k++) {
        uiDot(x + 1.2, y + 1.5 + k * 3.6, 0.9, c, a);
        uiLine(x + 3.5, y + 1.5 + k * 3.6, x + 10, y + 1.5 + k * 3.6, c, a, 1.1);
    }
}
function uiWaveGlyph(shape, x, y, w, h, c, a, lw) {
    const pts = [];
    for (let k = 0; k <= 24; k++) {
        const ph = k / 24;
        let u = lfoShape(shape, ph >= 1 ? 0.9999 : ph);
        pts.push([ph, 1 - u]);
    }
    uiPoly(pts, x, y, w, h, c, a, lw || 1.2);
}
function uiCurveGlyph(m, x, y, w, h, c, a) {
    const pts = [];
    const n = m.curve === CURVE_STEPPED ? 40 : 20;
    for (let k = 0; k <= n; k++) {
        const u = k / n;
        let v = shapeCurve(u, m.curve, m.curveAmt, m.curveSteps);
        if (m.invert) v = 1 - v;
        pts.push([u, 1 - v]);
    }
    uiPoly(pts, x, y, w, h, c, a, 1.2);
}

// ------------------------------------------------------------------ formatting
function uiFmtParam(key, v) {
    switch (key) {
        case "rate": return (v >= 10 ? v.toFixed(1) : v.toFixed(2)) + "Hz";
        case "phase": return Math.round(v * 360) + "d";
        case "depth": case "smooth": case "glide": case "loopStart": case "loopEnd": return Math.round(v * 100) + "%";
        case "attack": return v < 10 ? v.toFixed(1) + "ms" : Math.round(v) + "ms";
        case "release": return v < 1000 ? Math.round(v) + "ms" : (v / 1000).toFixed(1) + "s";
        case "gain": return (v >= 0 ? "+" : "") + v.toFixed(1) + "dB";
        default: return String(Math.round(v));
    }
}
const UI_LABELS = {
    rate: "Rate", syncDiv: "Div", phase: "Phase", depth: "Depth", attack: "Attack", release: "Release", gain: "Gain",
    smooth: "Smooth", seed: "Seed", steps: "Steps", glide: "Glide", loopStart: "Loop In", loopEnd: "Loop Out",
};
// descriptor for a draggable value bar: {key, label, text, norm, lo, hi, int, log}
function uiBarSpec(m, key) {
    const p = m.p;
    let k = key;
    let r = MOD_PARAM_RANGE[k] || [0, 1, false];
    let log = false;
    if (key === "rate") {
        if (p.sync) { k = "syncDiv"; r = MOD_PARAM_RANGE.syncDiv; } else log = true;
    }
    if (key === "attack" || key === "release") log = true;
    const v = p[k];
    const lo = r[0], hi = r[1];
    const norm = log ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
    const text = k === "syncDiv" ? SYNC_LABELS[v] : uiFmtParam(k, v);
    let label = UI_LABELS[k];
    if (key === "rate" && !p.sync && m.type === MOD_STEPS) label = "Steps/s";
    return { key: k, label, text, norm: clamp(norm, 0, 1), lo, hi, int: !!r[2], log };
}
function uiBarValue(h, nx) {
    const n = clamp(nx, 0, 1);
    let v = h.log ? h.lo * Math.pow(h.hi / h.lo, n) : h.lo + (h.hi - h.lo) * n;
    if (h.int) v = Math.round(v);
    return v;
}

// ------------------------------------------------------------------ widgets
function uiBar(x, y, w, h, m, i, key) {
    const s = uiBarSpec(m, key);
    const c = MOD_COLORS[m.color];
    uiRRect(x, y, w, h, 2, UI_TRACK);
    if (s.norm > 0) uiRRect(x, y, Math.max(3, w * s.norm), h, 2, c, 0.34);
    uiText(s.label, x + 4, y + h - 4, 7.5, UI_DIM);
    uiTextR(s.text, x + w - 4, y + h - 4, 7.5, UI_ORANGE);
    uiHit(x, y, w, h, { k: "bar", mod: i, key: s.key, lo: s.lo, hi: s.hi, int: s.int, log: s.log, rkey: key });
}
function uiToggle(x, y, w, h, m, i, key, label, extra) {
    const on = key === "loopOn" ? m.p.loopOn : m.p[key];
    const c = MOD_COLORS[m.color];
    uiRRect(x, y, w, h, 2, on ? c : UI_SURF2, on ? 0.38 : 1);
    if (on) uiStrokeRRect(x, y, w, h, 2, c, 0.9, 1);
    const tw = uiTextW(label, 7.5);
    uiText(label, x + (w - tw) / 2, y + h - 4, 7.5, on ? UI_TXT : UI_DIM);
    uiHit(x, y, w, h, { k: "toggle", mod: i, key });
}
function uiRow(items, y, h, fn) {
    const n = items.length;
    const gap = 3;
    const w = (UI_CW - gap * (n - 1)) / n;
    for (let k = 0; k < n; k++) fn(items[k], 0 + k * (w + gap), w);
    return { y, h };
}

// ------------------------------------------------------------------ list column
function uiListRowRect(c, r) {
    return { x: c * UI_LW + 1, y: UI_HEADH + r * UI_ROWH, w: UI_LW - 3, h: UI_ROWH - 1 };
}
function uiAddRect() {
    const c = uiCols() - 1;
    return { x: c * UI_LW + 1, y: UI_HEADH + UI_ROWS * UI_ROWH, w: UI_LW - 3, h: UI_ADDH - 1 };
}
function uiInspBtnRect() {
    return { x: UI_LW - 22, y: 2, w: 18, h: 13 };
}

function uiPaintList(tel) {
    const slots = uiSlots();
    const cols = uiCols();
    const sel = uiSel();
    const insp = uiInsp();
    // header
    uiText("MODULATORS", 6, 11, 7.5, UI_DIM);
    const ib = uiInspBtnRect();
    uiRRect(ib.x, ib.y, ib.w, ib.h, 2, insp ? UI_CYAN : UI_SURF2, insp ? 0.28 : 1);
    if (insp) uiStrokeRRect(ib.x, ib.y, ib.w, ib.h, 2, UI_CYAN, 0.9, 1);
    uiListGlyph(ib.x + 4, ib.y + 2.5, insp ? UI_CYAN : UI_DIM, 1);
    uiHit(ib.x, ib.y, ib.w, ib.h, { k: "insp" });
    if (!slots.length) uiText("Add a modulator", 8, UI_HEADH + 14, 8, UI_DIM);
    for (let p = 0; p < slots.length && p < UI_ROWS * UI_COLS_MAX; p++) {
        const i = slots[p];
        const m = MM.state.mods[i];
        const col = Math.floor(p / UI_ROWS), r = p % UI_ROWS;
        const rr = uiListRowRect(col, r);
        const x0 = rr.x, y = rr.y;
        const c = MOD_COLORS[m.color];
        const on = m.enabled ? 1 : 0.4;
        const selected = i === sel;
        const armed = MM.learn.armed && MM.learn.mod === i;
        uiRRect(x0, y, rr.w, rr.h, 2, selected ? UI_SURF2 : UI_SURF);
        if (selected) uiRect(x0, y + 2, 2, rr.h - 4, c, 1);
        if (armed) uiStrokeRRect(x0, y, rr.w, rr.h, 2, UI_CYAN, 0.55 + 0.45 * uiPulse(), 1);
        uiDot(x0 + 9, y + 7.5, 3, c, m.enabled ? 1 : 0.25);
        uiTypeIcon(m.type, x0 + 16, y + 2.5, 10, c, on);
        uiText(uiFit(m.name, 38, 8), x0 + 29, y + 11, 8, UI_TXT, on);
        // live value bar
        const u = tel.mods[i] ? clamp(tel.mods[i].u, 0, 1) : 0;
        uiRect(x0 + 70, y + 5, 30, 5, UI_TRACK);
        uiRect(x0 + 70, y + 5, Math.max(1, 30 * u), 5, c, m.enabled ? 0.9 : 0.25);
        const cnt = MM.mappingsFor(i).length;
        uiTextR(String(cnt), x0 + 112, y + 11, 8, cnt ? UI_ORANGE : UI_DIM, 1);
        const ac = armed ? UI_CYAN : cnt ? [0.2, 0.58, 0.66] : [0.4, 0.44, 0.5];
        uiArrowGlyph(x0 + 114, y + 7.5, ac, armed ? 0.55 + 0.45 * uiPulse() : 1, armed && MM.learn.multi);
        // hit zones (specific first)
        uiHit(x0, y, 17, rr.h, { k: "dot", mod: i });
        uiHit(x0 + 100, y, 12, rr.h, { k: "count", mod: i });
        uiHit(x0 + 112, y, rr.w - 112, rr.h, { k: "arrow", mod: i });
        uiHit(x0, y, rr.w, rr.h, { k: "row", mod: i, pos: p });
    }
    // add row
    const ad = uiAddRect();
    const full = slots.length >= MAX_MODS;
    uiRRect(ad.x, ad.y, ad.w, ad.h, 2, UI_SURF, 0.8);
    uiStrokeRRect(ad.x, ad.y, ad.w, ad.h, 2, [0.3, 0.34, 0.4], 1, 1);
    if (full) {
        uiText("16 / 16 FULL", ad.x + 34, ad.y + 12, 7.5, UI_DIM);
    } else {
        uiLine(ad.x + 40, ad.y + 8.5, ad.x + 48, ad.y + 8.5, UI_TXT, 1, 1.4);
        uiLine(ad.x + 44, ad.y + 4.5, ad.x + 44, ad.y + 12.5, UI_TXT, 1, 1.4);
        uiText("Add", ad.x + 53, ad.y + 12, 8, UI_TXT);
        uiHit(ad.x, ad.y, ad.w, ad.h, { k: "add" });
    }
}

// ------------------------------------------------------------------ editor: header + tabs
function uiTabRects(ax) {
    return { edit: { x: ax + 2, y: 1, w: 38, h: 15 }, targets: { x: ax + 42, y: 1, w: 62, h: 15 } };
}
function uiPaintEditor(tel) {
    const ax = uiAreaX();
    const i = uiSel();
    const m = MM.state.mods[i];
    const c = MOD_COLORS[m.color];
    const tab = uiTab();
    uiRRect(ax, 0, UI_EW, 161, 4, UI_SURF, 0.65);
    const tr = uiTabRects(ax);
    const nm = MM.mappingsFor(i).length;
    const tabs = [["edit", "Edit"], ["targets", "Targets " + nm]];
    for (const [key, label] of tabs) {
        const r = tr[key];
        const act = tab === key;
        uiRRect(r.x, r.y, r.w, r.h, 3, act ? UI_SURF2 : UI_SURF, act ? 1 : 0.7);
        if (act) uiRect(r.x + 3, r.y + r.h - 2, r.w - 6, 2, c, 1);
        uiText(label, r.x + 7, r.y + 11, 8.5, act ? UI_TXT : UI_DIM);
        uiHit(r.x, r.y, r.w, r.h, { k: "tab", tab: key });
    }
    // right side of the header: name, type chip, colour dot, trash, close
    const cx = ax + UI_EW - 16;
    uiCloseGlyph(cx + 3, 5, 7, UI_DIM, 1);
    uiHit(cx, 1, 14, 15, { k: "close" });
    uiTrashGlyph(cx - 15, 4, [0.78, 0.45, 0.45], 1);
    uiHit(cx - 18, 1, 14, 15, { k: "trash", mod: i });
    const chipX = cx - 52;
    uiRRect(chipX, 3, 30, 11, 2, c, 0.25);
    uiText(MOD_TYPE_SHORT[m.type], chipX + 6, 11.5, 7.5, c);
    uiHit(chipX, 1, 30, 15, { k: "typechip", mod: i });
    uiDot(chipX - 8, 8.5, 3.2, c, 1);
    uiHit(chipX - 14, 1, 13, 15, { k: "color", mod: i });
    uiText(uiFit(m.name, chipX - 22 - (ax + 108), 8), ax + 108, 11.5, 8, UI_TXT);
    if (tab === "targets") uiPaintTargets(tel, ax, i, m); else uiPaintEdit(tel, ax, i, m);
}

// ------------------------------------------------------------------ editor: Edit tab
function uiPaintHist(i, m, x, y, w, h, c, bipolarAxis) {
    uiRRect(x, y, w, h, 3, UI_TRACK);
    uiLine(x, y + h / 2, x + w, y + h / 2, [0.2, 0.22, 0.26], 1, 1);
    const hs = uiHist[i] || [];
    if (hs.length > 1) {
        uiCol(c, 1);
        mgraphics.set_line_width(1.3);
        const n = hs.length;
        for (let k = 0; k < n; k++) {
            const px = x + w - (n - 1 - k) * (w / uiHistLen);
            const py = y + h / 2 - clamp(hs[k], -1, 1) * (h / 2 - 3);
            if (k === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
        }
        mgraphics.stroke();
        const lastv = clamp(hs[n - 1], -1, 1);
        uiDot(x + w - 1, y + h / 2 - lastv * (h / 2 - 3), 2.5, c, 1);
        uiText((lastv >= 0 ? "+" : "") + lastv.toFixed(2), x + w - 38, y + 10, 8, UI_ORANGE);
    }
}
function uiPaintLfoTop(tel, ax, i, m) {
    const c = MOD_COLORS[m.color];
    const x0 = ax + 2;
    const n = LFO_SHAPES.length;
    const gw = (UI_CW - 3 * (n - 1)) / n;
    for (let s = 0; s < n; s++) {
        const bx = x0 + s * (gw + 3);
        const act = m.p.shape === s;
        uiRRect(bx, 22, gw, 22, 3, act ? c : UI_SURF2, act ? 0.3 : 1);
        if (act) uiStrokeRRect(bx, 22, gw, 22, 3, c, 0.9, 1);
        uiWaveGlyph(s, bx + gw / 2 - 11, 27, 22, 12, act ? UI_TXT : UI_DIM, 1, 1.3);
        uiHit(bx, 22, gw, 22, { k: "shape", mod: i, shape: s });
    }
    // preview of the shaped, phase-shifted, depth-scaled wave with the live playhead
    const px = x0, py = 48, pw = UI_CW, ph = 74;
    uiRRect(px, py, pw, ph, 3, UI_TRACK);
    uiLine(px, py + ph / 2, px + pw, py + ph / 2, [0.2, 0.22, 0.26], 1, 1);
    for (let g = 1; g < 4; g++) uiLine(px + (pw * g) / 4, py + 2, px + (pw * g) / 4, py + ph - 2, [0.14, 0.16, 0.19], 1, 1);
    uiCol(c, 1);
    mgraphics.set_line_width(1.6);
    const N = 96;
    for (let k = 0; k <= N; k++) {
        const u = lfoShape(m.p.shape, Math.min(0.9999, frac(k / N + m.p.phase)));
        const out = m.p.bipolar ? m.p.depth * (2 * u - 1) : 2 * m.p.depth * u - 1;
        const X = px + (k / N) * pw, Y = py + ph / 2 - out * (ph / 2 - 6);
        if (k === 0) mgraphics.move_to(X, Y); else mgraphics.line_to(X, Y);
    }
    mgraphics.stroke();
    const t = tel.mods[i];
    if (t) {
        const hx = px + clamp(frac(t.phase - m.p.phase), 0, 1) * pw;
        uiLine(hx, py + 2, hx, py + ph - 2, UI_TXT, 0.35, 1);
        uiDot(hx, py + ph / 2 - clamp(t.out, -1, 1) * (ph / 2 - 6), 3, UI_ORANGE, 1);
    }
}
function uiPaintStepsTop(tel, ax, i, m) {
    const c = MOD_COLORS[m.color];
    const x0 = ax + 2, y0 = 22, w = UI_CW, h = 100;
    uiRRect(x0, y0, w, h, 3, UI_TRACK);
    const n = m.p.steps;
    const sw = w / n;
    const t = tel.mods[i];
    const cur = t ? Math.floor(clamp(t.phase, 0, 0.9999) * n) : -1;
    for (let k = 0; k < n; k++) {
        const v = m.stepVals[k];
        const bx = x0 + k * sw;
        const bh = Math.max(1.5, v * (h - 6));
        uiRect(bx + 1, y0 + h - 3 - bh, Math.max(1, sw - 2), bh, c, k === cur ? 1 : 0.5);
    }
    uiLine(x0 + 2, y0 + h / 2, x0 + w - 2, y0 + h / 2, [0.28, 0.3, 0.35], 0.6, 1);
    uiHit(x0, y0, w, h, { k: "steps", mod: i });
}
function uiMsegXY(pt, r) {
    return { x: r.x + 4 + pt.x * (r.w - 8), y: r.y + 4 + (1 - pt.y) * (r.h - 8) };
}
function uiPaintMsegTop(tel, ax, i, m) {
    const c = MOD_COLORS[m.color];
    const r = { x: ax + 2, y: 22, w: UI_CW, h: 100 };
    uiRRect(r.x, r.y, r.w, r.h, 3, UI_TRACK);
    for (let g = 1; g < 8; g++) uiLine(r.x + 4 + ((r.w - 8) * g) / 8, r.y + 2, r.x + 4 + ((r.w - 8) * g) / 8, r.y + r.h - 2, [0.13, 0.15, 0.18], 1, 1);
    for (let g = 1; g < 4; g++) uiLine(r.x + 2, r.y + 4 + ((r.h - 8) * g) / 4, r.x + r.w - 2, r.y + 4 + ((r.h - 8) * g) / 4, [0.13, 0.15, 0.18], 1, 1);
    if (m.p.loopOn) {
        const lx = r.x + 4 + m.p.loopStart * (r.w - 8), le = r.x + 4 + m.p.loopEnd * (r.w - 8);
        uiRect(lx, r.y + 1, le - lx, r.h - 2, c, 0.1);
        uiRect(lx, r.y + 1, 1.5, r.h - 2, c, 0.7);
        uiRect(le - 1.5, r.y + 1, 1.5, r.h - 2, c, 0.7);
    }
    const pts = m.points;
    // filled area + curve
    const N = 120;
    uiCol(c, 0.14);
    mgraphics.move_to(r.x + 4, r.y + r.h - 4);
    for (let k = 0; k <= N; k++) {
        const y = evalMseg(pts, k / N);
        mgraphics.line_to(r.x + 4 + (k / N) * (r.w - 8), r.y + 4 + (1 - y) * (r.h - 8));
    }
    mgraphics.line_to(r.x + r.w - 4, r.y + r.h - 4);
    mgraphics.close_path();
    mgraphics.fill();
    uiCol(c, 1);
    mgraphics.set_line_width(1.6);
    for (let k = 0; k <= N; k++) {
        const y = evalMseg(pts, k / N);
        const X = r.x + 4 + (k / N) * (r.w - 8), Y = r.y + 4 + (1 - y) * (r.h - 8);
        if (k === 0) mgraphics.move_to(X, Y); else mgraphics.line_to(X, Y);
    }
    mgraphics.stroke();
    for (let k = 0; k < pts.length; k++) {
        const s = uiMsegXY(pts[k], r);
        uiDot(s.x, s.y, 3.2, UI_BG, 1);
        uiDot(s.x, s.y, 2.4, c, 1);
    }
    const t = tel.mods[i];
    if (t) {
        const hx = r.x + 4 + clamp(t.phase, 0, 1) * (r.w - 8);
        uiLine(hx, r.y + 2, hx, r.y + r.h - 2, UI_TXT, 0.35, 1);
        uiDot(hx, r.y + 4 + (1 - clamp(evalMseg(pts, clamp(t.phase, 0, 1)), 0, 1)) * (r.h - 8), 2.6, UI_ORANGE, 1);
    }
    uiHit(r.x, r.y, r.w, r.h, { k: "mseg", mod: i });
}
function uiPaintEdit(tel, ax, i, m) {
    const c = MOD_COLORS[m.color];
    const x0 = ax + 2;
    let bars, toggles;
    if (m.type === MOD_LFO) {
        uiPaintLfoTop(tel, ax, i, m);
        bars = ["rate", "phase", "depth"];
        toggles = [["sync", "Sync"], ["retrig", "Retrig"], ["bipolar", "Bipolar"], ["oneshot", "1-Shot"]];
    } else if (m.type === MOD_ENV) {
        uiPaintHist(i, m, x0, 22, UI_CW, 100, c);
        uiText("INPUT LEVEL FOLLOWER", x0 + 6, 33, 7.5, UI_DIM);
        bars = ["attack", "release", "gain", "depth"];
        toggles = [["bipolar", "Bipolar"]];
    } else if (m.type === MOD_RANDOM) {
        uiPaintHist(i, m, x0, 22, UI_CW, 100, c);
        uiText("RANDOM / S&H", x0 + 6, 33, 7.5, UI_DIM);
        bars = ["rate", "smooth", "seed", "depth"];
        toggles = [["sync", "Sync"], ["retrig", "Retrig"], ["bipolar", "Bipolar"]];
    } else if (m.type === MOD_STEPS) {
        uiPaintStepsTop(tel, ax, i, m);
        bars = ["rate", "steps", "glide", "depth"];
        toggles = [["sync", "Sync"], ["retrig", "Retrig"], ["bipolar", "Bipolar"], ["oneshot", "1-Shot"]];
    } else {
        uiPaintMsegTop(tel, ax, i, m);
        bars = ["rate", "depth", "loopStart", "loopEnd"];
        toggles = [["sync", "Sync"], ["retrig", "Retrig"], ["bipolar", "Bipolar"], ["oneshot", "1-Shot"], ["loopOn", "Loop"]];
    }
    const nb = bars.length;
    const bw = (UI_CW - 3 * (nb - 1)) / nb;
    for (let k = 0; k < nb; k++) uiBar(x0 + k * (bw + 3), 126, bw, 15, m, i, bars[k]);
    const nt = toggles.length;
    const tw = (UI_CW - 3 * (nt - 1)) / nt;
    for (let k = 0; k < nt; k++) uiToggle(x0 + k * (tw + 3), 144, tw, 15, m, i, toggles[k][0], toggles[k][1]);
}

// ------------------------------------------------------------------ range bar + mapping rows (shared)
// geometry of the draggable ends for a mapping on a track [x, x + w]
function uiRangeEnds(m, x, w) {
    if (m.mode === "remote") return { a: x + m.min * w, b: x + m.max * w, kind: "remote" };
    const cx = x + w / 2;
    if (m.bipolar) return { a: cx - m.amount * (w / 2), b: cx + m.amount * (w / 2), kind: "bipolar" };
    return { a: cx, b: cx + m.amount * (w / 2), kind: "unipolar" };
}
function uiPaintRangeBar(x, y, w, h, m, c, dim) {
    uiRRect(x, y + 3, w, h - 6, 2, UI_TRACK);
    const e = uiRangeEnds(m, x, w);
    const lo = Math.min(e.a, e.b), hi = Math.max(e.a, e.b);
    uiRect(lo, y + 3, Math.max(1, hi - lo), h - 6, c, dim ? 0.2 : 0.5);
    if (e.kind !== "remote") uiLine(x + w / 2, y + 1, x + w / 2, y + h - 1, UI_DIM, 0.8, 1);
    const hc = dim ? UI_DIM : UI_ORANGE;
    if (e.kind === "bipolar") { uiRect(e.a - 1.5, y + 1, 3, h - 2, hc, 1); uiRect(e.b - 1.5, y + 1, 3, h - 2, hc, 1); }
    else if (e.kind === "unipolar") uiRect(e.b - 1.5, y + 1, 3, h - 2, hc, 1);
    else { uiRect(e.a - 1.5, y + 1, 3, h - 2, hc, 1); uiRect(e.b - 1.5, y + 1, 3, h - 2, hc, 1); }
}
function uiRangeText(m) {
    if (m.mode === "remote") return Math.round(m.min * 100) + "-" + Math.round(m.max * 100);
    const a = Math.round(m.amount * 100);
    return (a > 0 ? "+" : "") + a + "%";
}
// which end a press at screen x grabs: "a"/"b" for bipolar & remote, "b" for unipolar
function uiRangeGrab(m, x, w, px) {
    const e = uiRangeEnds(m, x, w);
    if (e.kind === "unipolar") return "b";
    return Math.abs(px - e.a) <= Math.abs(px - e.b) ? "a" : "b";
}
function uiRangeApply(m, x, w, which, px) {
    const n = clamp((px - x) / w, 0, 1);
    if (m.mode === "remote") return which === "a" ? { min: n } : { max: n };
    const amt = (n - 0.5) * 2;
    if (m.bipolar) return { amount: clamp(which === "a" ? -amt : amt, -1, 1) };
    return { amount: clamp(amt, -1, 1) };
}

// ------------------------------------------------------------------ editor: Targets tab
function uiTargetsScrollMax(count) {
    return Math.max(0, count - Math.floor((UI_TBOT - UI_TTOP) / UI_TROW));
}
function uiMapCells(ax, scrollbar) {
    const x0 = ax + 2;
    const w = UI_CW - (scrollbar ? 5 : 0);
    return {
        del: x0, name: x0 + 13, nameW: 75, mode: x0 + 90, bip: x0 + 104, range: x0 + 119, rangeW: 80,
        curve: x0 + 203, inv: x0 + 232, val: x0 + w, w,
    };
}
function uiPaintTargets(tel, ax, i, m) {
    const maps = MM.mappingsFor(i);
    const learning = MM.learn.armed && MM.learn.mod === i;
    const total = maps.length + (learning ? 1 : 0);
    const vis = Math.floor((UI_TBOT - UI_TTOP) / UI_TROW);
    const smax = uiTargetsScrollMax(total);
    const sc = clamp(Math.round(Number(uiG("scrollT", 0))), 0, smax);
    const cells = uiMapCells(ax, smax > 0);
    const mc = MOD_COLORS[m.color];
    uiHoverMap = 0;
    // column captions
    uiText("TARGET", cells.name, 24, 6.5, UI_DIM);
    uiText("RANGE", cells.range, 24, 6.5, UI_DIM);
    uiText("CURVE", cells.curve, 24, 6.5, UI_DIM);
    for (let r = 0; r < vis && r + sc < total; r++) {
        const y = UI_TTOP + r * UI_TROW;
        const idx = r + sc;
        if (idx >= maps.length) {
            // pulsing LEARNING row
            const pl = uiPulse();
            uiRRect(ax + 2, y, cells.w, UI_TROW - 2, 2, UI_CYAN, 0.08 + 0.12 * pl);
            uiStrokeRRect(ax + 2, y, cells.w, UI_TROW - 2, 2, UI_CYAN, 0.45 + 0.55 * pl, 1);
            uiArrowGlyph(ax + 8, y + 8, UI_CYAN, 1, MM.learn.multi);
            uiText(MM.learn.multi ? "LEARNING... (multi - select params)" : "LEARNING... select a parameter", ax + 24, y + 12, 8.5, UI_CYAN, 0.6 + 0.4 * pl);
            continue;
        }
        const mp = maps[idx];
        const st = MM.mappingStatus(mp.id);
        const missing = st === "missing";
        const off = !mp.enabled || st === "disabled";
        const dim = missing || off;
        if (uiMouse.x >= ax + 2 && uiMouse.x < ax + 2 + cells.w && uiMouse.y >= y && uiMouse.y < y + UI_TROW - 2) uiHoverMap = mp.id;
        uiRRect(ax + 2, y, cells.w, UI_TROW - 2, 2, missing ? [0.25, 0.1, 0.1] : UI_SURF2, missing ? 0.9 : 0.55);
        uiCloseGlyph(cells.del + 3, y + 5, 5, [0.75, 0.4, 0.4], 1);
        uiHit(cells.del, y, 12, UI_TROW - 2, { k: "tdel", id: mp.id });
        const nm = mp.target.paramName || mp.target.name || "?";
        uiText(uiFit(nm, cells.nameW - (missing ? 27 : 0), 8), cells.name, y + 11.5, 8, missing ? UI_RED : UI_TXT, dim ? 0.55 : 1);
        if (missing) uiText("missing", cells.name + cells.nameW - 25, y + 11, 6, UI_RED, 0.9);
        uiHit(cells.name, y, cells.nameW, UI_TROW - 2, { k: "ten", id: mp.id, hover: mp.id });
        // M / R
        uiRRect(cells.mode, y + 3, 12, 11, 2, mp.mode === "remote" ? UI_CYAN : UI_SURF, mp.mode === "remote" ? 0.3 : 1);
        uiText(mp.mode === "remote" ? "R" : "M", cells.mode + 3, y + 11.5, 7.5, mp.mode === "remote" ? UI_CYAN : UI_DIM);
        uiHit(cells.mode, y, 13, UI_TROW - 2, { k: "tmode", id: mp.id });
        // bipolar toggle (mod mode only)
        if (mp.mode !== "remote") {
            uiRRect(cells.bip, y + 3, 12, 11, 2, UI_SURF, 1);
            uiText(mp.bipolar ? "+-" : "+", cells.bip + (mp.bipolar ? 1.5 : 3.5), y + 11.5, 7, UI_DIM);
            uiHit(cells.bip, y, 13, UI_TROW - 2, { k: "tbip", id: mp.id });
        }
        uiPaintRangeBar(cells.range, y, cells.rangeW, UI_TROW - 2, mp, mc, dim);
        uiHit(cells.range - 3, y, cells.rangeW + 6, UI_TROW - 2, { k: "range", id: mp.id, rx: cells.range, rw: cells.rangeW });
        // curve preview + dropdown caret
        uiRRect(cells.curve, y + 2, 26, 12, 2, UI_TRACK);
        uiCurveGlyph(mp, cells.curve + 3, y + 4, 20, 8, UI_CYAN, dim ? 0.4 : 1);
        uiHit(cells.curve, y, 27, UI_TROW - 2, { k: "tcurve", id: mp.id });
        // invert
        uiRRect(cells.inv, y + 3, 12, 11, 2, mp.invert ? UI_ORANGE : UI_SURF, mp.invert ? 0.35 : 1);
        uiText("i", cells.inv + 4.5, y + 11.5, 7.5, mp.invert ? UI_ORANGE : UI_DIM);
        uiHit(cells.inv, y, 13, UI_TROW - 2, { k: "tinv", id: mp.id });
        uiTextR(uiRangeText(mp), cells.val, y + 11.5, 7.5, UI_ORANGE, dim ? 0.55 : 1);
    }
    if (!total) uiText("No mappings yet - press + Map, then touch a Live parameter", ax + 12, 70, 8, UI_DIM);
    if (smax > 0) {
        const th = Math.max(10, (UI_TBOT - UI_TTOP) * (vis / total));
        const ty = UI_TTOP + ((UI_TBOT - UI_TTOP - th) * sc) / smax;
        uiRRect(ax + UI_EW - 5, ty, 2.5, th, 1, UI_DIM, 0.8);
    }
    // + Map
    const bx = ax + 2, by = UI_TBOT + 3, bw = UI_CW, bh = 17;
    if (learning) {
        const pl = uiPulse();
        uiRRect(bx, by, bw, bh, 3, UI_CYAN, 0.12 + 0.12 * pl);
        uiStrokeRRect(bx, by, bw, bh, 3, UI_CYAN, 0.6 + 0.4 * pl, 1.2);
        uiText(MM.learn.multi ? "STOP LEARNING  (multi)" : "CANCEL LEARNING", bx + bw / 2 - 52, by + 12, 8.5, UI_CYAN);
    } else {
        uiRRect(bx, by, bw, bh, 3, UI_SURF2, 1);
        uiStrokeRRect(bx, by, bw, bh, 3, [0.2, 0.55, 0.62], 1, 1);
        uiLine(bx + 8, by + 8.5, bx + 16, by + 8.5, UI_CYAN, 1, 1.4);
        uiLine(bx + 12, by + 4.5, bx + 12, by + 12.5, UI_CYAN, 1, 1.4);
        uiText("Map", bx + 21, by + 12, 8.5, UI_CYAN);
        uiText("click: learn one    shift-click: multi-learn", bx + 50, by + 12, 7, UI_DIM);
    }
    uiHit(bx, by, bw, bh, { k: "learn", mod: i });
    uiHit(ax, UI_TTOP, UI_EW, UI_TBOT - UI_TTOP, { k: "tscroll" });
}

// ------------------------------------------------------------------ inspector
function uiInspCells(ax, scrollbar) {
    const x0 = ax + 2;
    return {
        mod: x0, modW: 50, target: x0 + 54, targetW: 92, mode: x0 + 150, range: x0 + 166, rangeW: 68,
        curve: x0 + 238, del: x0 + 268 - (scrollbar ? 4 : 0), w: UI_CW - (scrollbar ? 5 : 0),
    };
}
function uiInspRows() {
    return Math.floor((161 - UI_ITOP) / UI_IROW);
}
function uiPaintInspector(tel) {
    const ax = uiAreaX();
    uiRRect(ax, 0, UI_EW, 161, 4, UI_SURF, 0.65);
    const all = uiSortMappings(MM.allMappings(), uiG("sort", "mod"), uiG("sortDir", 1));
    const vis = uiInspRows();
    const smax = Math.max(0, all.length - vis);
    const sc = clamp(Math.round(Number(uiG("scrollI", 0))), 0, smax);
    const cells = uiInspCells(ax, smax > 0);
    uiHoverMap = 0;
    // headers
    const sort = uiG("sort", "mod"), dir = uiG("sortDir", 1);
    const heads = [["mod", "MOD", cells.mod, cells.modW], ["target", "TARGET", cells.target, cells.targetW]];
    for (const [key, label, hx, hw] of heads) {
        const act = sort === key;
        uiRRect(hx, 2, hw, 12, 2, act ? UI_SURF2 : UI_SURF, act ? 1 : 0.6);
        uiText(label, hx + 4, 11, 7.5, act ? UI_TXT : UI_DIM);
        if (act) {
            const ax2 = hx + hw - 9;
            uiPoly(dir > 0 ? [[0, 1], [0.5, 0], [1, 1]] : [[0, 0], [0.5, 1], [1, 0]], ax2, 5, 5, 4, UI_ORANGE, 1, 1.2);
        }
        uiHit(hx, 2, hw, 12, { k: "sort", key });
    }
    uiText("M/R", cells.mode - 1, 11, 6.5, UI_DIM);
    uiText("RANGE", cells.range, 11, 6.5, UI_DIM);
    uiText("CURVE", cells.curve, 11, 6.5, UI_DIM);
    for (let r = 0; r < vis && r + sc < all.length; r++) {
        const mp = all[r + sc];
        const y = UI_ITOP + r * UI_IROW;
        const m = MM.state.mods[mp.mod];
        const c = m ? MOD_COLORS[m.color] : UI_DIM;
        const st = MM.mappingStatus(mp.id);
        const missing = st === "missing";
        const off = !mp.enabled || st === "disabled";
        const dim = missing || off;
        if (uiMouse.x >= ax + 2 && uiMouse.x < ax + 2 + cells.w && uiMouse.y >= y && uiMouse.y < y + UI_IROW - 1) uiHoverMap = mp.id;
        uiRRect(ax + 2, y, cells.w, UI_IROW - 1, 2, missing ? [0.25, 0.1, 0.1] : r % 2 ? UI_SURF : UI_SURF2, missing ? 0.9 : 0.55);
        uiDot(cells.mod + 5, y + 7.5, 2.8, c, dim ? 0.4 : 1);
        uiText(uiFit(m ? m.name : "?", cells.modW - 13, 7.5), cells.mod + 11, y + 11, 7.5, UI_TXT, dim ? 0.55 : 1);
        uiHit(cells.mod, y, cells.modW, UI_IROW - 1, { k: "imod", mod: mp.mod });
        // target: track > device > param, progressively elided from the left
        const t = mp.target;
        const pn = t.paramName || t.name || "?";
        const tw = cells.targetW - (missing ? 28 : 0);
        let txt = uiTargetText(t);
        if (uiTextW(txt, 7.5) > tw) txt = [t.deviceName, pn].filter((s) => s).join(" > ");
        if (uiTextW(txt, 7.5) > tw) txt = pn;
        uiText(uiFit(txt, tw, 7.5), cells.target, y + 11, 7.5, missing ? UI_RED : UI_TXT, dim ? 0.6 : 1);
        if (missing) uiText("missing", cells.target + cells.targetW - 26, y + 10.5, 6, UI_RED, 0.95);
        uiHit(cells.target, y, cells.targetW, UI_IROW - 1, { k: "itarget", id: mp.id });
        uiRRect(cells.mode, y + 3, 12, 10, 2, mp.mode === "remote" ? UI_CYAN : UI_TRACK, mp.mode === "remote" ? 0.3 : 1);
        uiText(mp.mode === "remote" ? "R" : "M", cells.mode + 3, y + 10.5, 7, mp.mode === "remote" ? UI_CYAN : UI_DIM);
        uiHit(cells.mode, y, 13, UI_IROW - 1, { k: "tmode", id: mp.id });
        uiPaintRangeBar(cells.range, y, cells.rangeW, UI_IROW - 1, mp, c, dim);
        uiHit(cells.range - 3, y, cells.rangeW + 6, UI_IROW - 1, { k: "range", id: mp.id, rx: cells.range, rw: cells.rangeW });
        uiRRect(cells.curve, y + 2, 26, 11, 2, UI_TRACK);
        uiCurveGlyph(mp, cells.curve + 3, y + 4, 20, 7, UI_CYAN, dim ? 0.4 : 1);
        uiHit(cells.curve, y, 27, UI_IROW - 1, { k: "icurve", id: mp.id });
        uiCloseGlyph(cells.del + 2, y + 5, 5, [0.75, 0.4, 0.4], 1);
        uiHit(cells.del - 2, y, 13, UI_IROW - 1, { k: "tdel", id: mp.id });
    }
    if (!all.length) uiText("No mappings in this set", ax + 90, 70, 8, UI_DIM);
    if (smax > 0) {
        const span = 161 - UI_ITOP;
        const th = Math.max(10, span * (vis / all.length));
        uiRRect(ax + UI_EW - 5, UI_ITOP + ((span - th) * sc) / smax, 2.5, th, 1, UI_DIM, 0.8);
    }
    uiHit(ax, UI_ITOP, UI_EW, 161 - UI_ITOP, { k: "iscroll" });
}

// ------------------------------------------------------------------ popups + hover HUD
function uiHudText(id) {
    const mp = MM.getMapping(id);
    if (!mp) return "";
    const st = MM.mappingStatus(id);
    const mod = MM.state.mods[mp.mod];
    return (mod ? mod.name + "  >  " : "") + uiTargetText(mp.target) + (st === "missing" ? "   (missing)" : "");
}
function uiPaintHud(ax) {
    if (!uiHoverMap) return;
    const txt = uiHudText(uiHoverMap);
    if (!txt) return;
    const w = Math.min(UI_EW - 8, uiTextW(txt, 8) + 12);
    const x = ax + 4, y = 147;
    uiRRect(x, y, w, 13, 3, [0.02, 0.02, 0.03], 0.94);
    uiStrokeRRect(x, y, w, 13, 3, UI_CYAN, 0.6, 1);
    uiText(txt, x + 6, y + 9.5, 8, UI_TXT);
}
const UI_POP_IH = 15;
function uiOpenPopup(kind, x, y, items, extra) {
    const w = kind === "curve" ? 74 : 84;
    const h = items.length * UI_POP_IH + 4;
    uiPopup = Object.assign({ kind, x: clamp(x, 0, 400), y: clamp(y, 0, 161 - h), w, h, items }, extra || {});
}
function uiPaintPopup() {
    const p = uiPopup;
    if (!p) return;
    uiRRect(p.x, p.y, p.w, p.h, 4, [0.05, 0.055, 0.07], 0.98);
    uiStrokeRRect(p.x, p.y, p.w, p.h, 4, UI_CYAN, 0.7, 1);
    for (let k = 0; k < p.items.length; k++) {
        const y = p.y + 2 + k * UI_POP_IH;
        const hot = uiMouse.x >= p.x && uiMouse.x < p.x + p.w && uiMouse.y >= y && uiMouse.y < y + UI_POP_IH;
        if (hot) uiRRect(p.x + 2, y, p.w - 4, UI_POP_IH, 2, UI_SURF2, 1);
        if (p.kind === "curve") {
            const fake = { curve: k, curveAmt: 0.5, curveSteps: 4, invert: 0 };
            const mp = MM.getMapping(p.id);
            if (mp) fake.curveAmt = mp.curveAmt;
            uiCurveGlyph(fake, p.x + 6, y + 3, 18, 9, p.cur === k ? UI_ORANGE : UI_CYAN, 1);
            uiText(CURVE_NAMES[k], p.x + 29, y + 11, 8, p.cur === k ? UI_ORANGE : UI_TXT);
        } else {
            const t = p.items[k];
            uiTypeIcon(t, p.x + 6, y + 2.5, 10, MOD_COLORS[(t * 3) % 16], 1);
            uiText(MOD_TYPE_NAMES[t], p.x + 22, y + 11, 8, UI_TXT);
        }
    }
}

// ------------------------------------------------------------------ paint
function paint() {
    uiHits = [];
    const tel = MM.readTelemetry();
    uiPaintList(tel);
    if (uiInsp()) uiPaintInspector(tel);
    else if (uiAreaOn()) uiPaintEditor(tel);
    if (uiAreaOn()) uiPaintHud(uiAreaX());
    uiPaintPopup();
}

// ------------------------------------------------------------------ lifecycle
function uiReady() {
    uiSyncWidth();
}
function uiChanged(ev) {
    // keep the "LEARNING..." row in view while a learn is armed (scroll position is clamped when painted)
    if (ev && (ev.kind === "learn" || ev.kind === "mapping") && MM.learn.armed && MM.learn.mod === uiSel()) uiSet({ scrollT: 999 });
    uiSyncWidth();
}
function uiTelemetry(frame) {
    for (let i = 0; i < MAX_MODS; i++) {
        if (!MM.state.mods[i]) { uiHist[i] = []; continue; }
        const h = uiHist[i] || (uiHist[i] = []);
        h.push(frame.mods[i] ? frame.mods[i].out : 0);
        if (h.length > uiHistLen) h.shift();
    }
}

// ------------------------------------------------------------------ interaction
function uiSelect(i) {
    uiSet({ sel: i });
}
function uiOpenEditor(i, tab) {
    const patch = { sel: i, edOpen: 1, insp: 0 };
    if (tab) patch.tab = tab;
    uiSet(patch);
}
function uiToggleEditor(i) {
    if (uiG("edOpen", 0) && !uiInsp() && uiSel() === i) uiSet({ edOpen: 0 });
    else uiOpenEditor(i);
}
function uiCurveMenu(id, x, y) {
    const mp = MM.getMapping(id);
    if (!mp) return;
    uiOpenPopup("curve", x, y, [0, 1, 2, 3, 4], { id, cur: mp.curve });
}
function uiPopupClick(x, y) {
    const p = uiPopup;
    if (!p || x < p.x || x >= p.x + p.w || y < p.y || y >= p.y + p.h) return false;
    const k = Math.floor((y - p.y - 2) / UI_POP_IH);
    if (k >= 0 && k < p.items.length) {
        if (p.kind === "curve") MM.updateMapping(p.id, { curve: k });
        else if (p.kind === "type") MM.setModType(p.mod, p.items[k]);
        else if (p.kind === "add") {
            const s = MM.addModulator(p.items[k]);
            if (s >= 0) uiSet({ sel: s });
        }
    }
    uiPopup = null;
    uiRedraw();
    return true;
}
function uiMsegPick(m, r, x, y) {
    const pts = m.points;
    let best = -1, bd = 7;
    for (let k = 0; k < pts.length; k++) {
        const s = uiMsegXY(pts[k], r);
        const d = Math.sqrt((s.x - x) * (s.x - x) + (s.y - y) * (s.y - y));
        if (d < bd) { bd = d; best = k; }
    }
    if (best >= 0) return { kind: "pt", idx: best };
    const nx = clamp((x - r.x - 4) / (r.w - 8), 0, 1);
    for (let k = 0; k < pts.length - 1; k++) {
        if (nx >= pts[k].x && nx <= pts[k + 1].x) {
            const sy = r.y + 4 + (1 - evalMseg(pts, nx)) * (r.h - 8);
            if (Math.abs(sy - y) < 7) return { kind: "seg", idx: k };
        }
    }
    return null;
}
function uiMsegRect(h) {
    return { x: h.x, y: h.y, w: h.w, h: h.h };
}
function uiClonePts(m) {
    return m.points.map((p) => ({ x: p.x, y: p.y, curve: p.curve, sCurve: p.sCurve }));
}
function uiStepAt(m, h, x, y) {
    const k = clamp(Math.floor(((x - h.x) / h.w) * m.p.steps), 0, m.p.steps - 1);
    return { k, v: clamp(1 - (y - h.y - 3) / (h.h - 6), 0, 1) };
}
function uiToggleParam(i, key) {
    const m = MM.state.mods[i];
    if (!m) return;
    const cur = m.p[key];
    MM.setParam(i, key, cur ? 0 : 1);
}

function onclick(x, y, but, cmd, shift, caps, opt, ctrl) {
    uiMouse = { x, y };
    uiDrag = null;
    if (uiPopup) {
        if (!uiPopupClick(x, y)) { uiPopup = null; uiRedraw(); }
        return;
    }
    const h = uiHitAt(x, y);
    if (!h) return;
    const m = h.mod !== undefined ? MM.state.mods[h.mod] : null;
    switch (h.k) {
        case "insp": uiSet({ insp: uiInsp() ? 0 : 1 }); break;
        case "dot": if (m) MM.setParam(h.mod, "enabled", m.enabled ? 0 : 1); uiSelect(h.mod); break;
        case "count": uiOpenEditor(h.mod, "targets"); break;
        case "arrow":
            uiSelect(h.mod);
            if (MM.learn.armed && MM.learn.mod === h.mod) MM.disarmLearn(); else MM.armLearn(h.mod, !!shift);
            break;
        case "row": uiSelect(h.mod); break;
        case "add": {
            const ar = uiAddRect();
            uiOpenPopup("add", ar.x + 20, ar.y - UI_ADD_TYPES.length * UI_POP_IH - 4, UI_ADD_TYPES.slice(), {});
            break;
        }
        case "tab": uiSet({ tab: h.tab }); break;
        case "close": uiSet({ edOpen: 0 }); break;
        case "trash": MM.removeModulator(h.mod); break;
        case "typechip": uiOpenPopup("type", h.x - 54, h.y + h.h, UI_ADD_TYPES.slice(), { mod: h.mod }); break;
        case "color": if (m) MM.setColor(h.mod, (m.color + 1) % MOD_COLORS.length); break;
        case "shape": MM.setParam(h.mod, "shape", h.shape); break;
        case "toggle": uiToggleParam(h.mod, h.key); break;
        case "bar":
            uiDrag = { kind: "bar", hit: h };
            MM.setParam(h.mod, h.key, uiBarValue(h, (x - h.x) / h.w));
            break;
        case "steps": {
            const s = uiStepAt(m, h, x, y);
            uiDrag = { kind: "steps", hit: h };
            MM.setStep(h.mod, s.k, s.v);
            break;
        }
        case "mseg": {
            const r = uiMsegRect(h);
            const pick = uiMsegPick(m, r, x, y);
            if (!pick) break;
            if (pick.kind === "seg" && (cmd || ctrl)) {
                const pts = uiClonePts(m);
                pts[pick.idx].sCurve = pts[pick.idx].sCurve ? 0 : 1;
                MM.setMsegPoints(h.mod, pts);
                MM.commit();
                break;
            }
            uiDrag = { kind: pick.kind, idx: pick.idx, hit: h, y0: y, c0: m.points[pick.idx].curve };
            break;
        }
        case "tdel": MM.deleteMapping(h.id); break;
        case "tmode": {
            const mp = MM.getMapping(h.id);
            if (mp) MM.updateMapping(h.id, { mode: mp.mode === "remote" ? "mod" : "remote" });
            break;
        }
        case "tbip": {
            const mp = MM.getMapping(h.id);
            if (mp) MM.updateMapping(h.id, { bipolar: mp.bipolar ? 0 : 1 });
            break;
        }
        case "tinv": {
            const mp = MM.getMapping(h.id);
            if (mp) MM.updateMapping(h.id, { invert: mp.invert ? 0 : 1 });
            break;
        }
        case "tcurve": uiCurveMenu(h.id, h.x - 20, h.y + h.h); break;
        case "icurve": {
            const mp = MM.getMapping(h.id);
            if (mp) uiDrag = { kind: "curveAmt", id: h.id, y0: y, a0: mp.curveAmt, moved: false, shift: !!shift };
            break;
        }
        case "range": {
            const mp = MM.getMapping(h.id);
            if (!mp) break;
            const which = uiRangeGrab(mp, h.rx, h.rw, x);
            uiDrag = { kind: "range", id: h.id, rx: h.rx, rw: h.rw, which };
            MM.updateMapping(h.id, uiRangeApply(mp, h.rx, h.rw, which, x));
            break;
        }
        case "learn":
            if (MM.learn.armed && MM.learn.mod === h.mod) MM.disarmLearn(); else MM.armLearn(h.mod, !!shift);
            break;
        case "sort": {
            if (uiG("sort", "mod") === h.key) uiSet({ sortDir: uiG("sortDir", 1) > 0 ? -1 : 1 });
            else uiSet({ sort: h.key, sortDir: 1 });
            break;
        }
        case "imod": uiSet({ sel: h.mod, edOpen: 1, insp: 0, tab: "targets" }); break;
        default: break;
    }
    uiRedraw();
}

function ondrag(x, y, but) {
    uiMouse = { x, y };
    const d = uiDrag;
    if (!d) return;
    if (!but) {
        // release
        if (d.kind === "curveAmt" && !d.moved) {
            const mp = MM.getMapping(d.id);
            if (mp) {
                if (d.shift) MM.updateMapping(d.id, { invert: mp.invert ? 0 : 1 });
                else MM.updateMapping(d.id, { curve: (mp.curve + 1) % 5 });
            }
        }
        uiDrag = null;
        MM.commit();
        uiRedraw();
        return;
    }
    if (d.kind === "bar") {
        MM.setParam(d.hit.mod, d.hit.key, uiBarValue(d.hit, (x - d.hit.x) / d.hit.w));
    } else if (d.kind === "steps") {
        const m = MM.state.mods[d.hit.mod];
        if (m) { const s = uiStepAt(m, d.hit, x, y); MM.setStep(d.hit.mod, s.k, s.v); }
    } else if (d.kind === "range") {
        const mp = MM.getMapping(d.id);
        if (mp) MM.updateMapping(d.id, uiRangeApply(mp, d.rx, d.rw, d.which, x));
    } else if (d.kind === "curveAmt") {
        if (Math.abs(y - d.y0) > 2) d.moved = true;
        if (d.moved) MM.updateMapping(d.id, { curveAmt: clamp(d.a0 + (d.y0 - y) / 40, 0, 1) });
    } else if (d.kind === "pt" || d.kind === "seg") {
        const m = MM.state.mods[d.hit.mod];
        if (!m) return;
        const r = uiMsegRect(d.hit);
        const pts = uiClonePts(m);
        if (d.kind === "pt") {
            const p = pts[d.idx];
            p.y = clamp(1 - (y - r.y - 4) / (r.h - 8), 0, 1);
            if (d.idx > 0 && d.idx < pts.length - 1) {
                const nx = clamp((x - r.x - 4) / (r.w - 8), 0, 1);
                p.x = clamp(nx, pts[d.idx - 1].x + 0.002, pts[d.idx + 1].x - 0.002);
            }
        } else {
            const p0 = pts[d.idx], p1 = pts[d.idx + 1];
            const sign = p1.y >= p0.y ? 1 : -1;
            p0.curve = clamp(d.c0 + (sign * (d.y0 - y)) / ((r.h - 8) * 0.4), -1, 1);
        }
        MM.setMsegPoints(d.hit.mod, pts);
    }
    uiRedraw();
}

function ondblclick(x, y, but, cmd, shift) {
    uiMouse = { x, y };
    if (uiPopup) return;
    const h = uiHitAt(x, y);
    if (!h) return;
    const m = h.mod !== undefined ? MM.state.mods[h.mod] : null;
    if (h.k === "row") {
        uiToggleEditor(h.mod);
    } else if (h.k === "bar" && m) {
        const key = h.rkey === "rate" && m.p.sync ? "syncDiv" : h.key;
        MM.setParam(h.mod, key, defaultParams(m.type)[key]);
    } else if (h.k === "mseg" && m) {
        const r = uiMsegRect(h);
        const pts = uiClonePts(m);
        const pick = uiMsegPick(m, r, x, y);
        if (pick && pick.kind === "pt") {
            if (pick.idx > 0 && pick.idx < pts.length - 1) pts.splice(pick.idx, 1); else return;
        } else {
            pts.push({ x: clamp((x - r.x - 4) / (r.w - 8), 0.002, 0.998), y: clamp(1 - (y - r.y - 4) / (r.h - 8), 0, 1), curve: 0, sCurve: 0 });
        }
        MM.setMsegPoints(h.mod, pts);
        MM.commit();
    }
    uiRedraw();
}

function onidle(x, y) {
    uiMouse = { x, y };
    uiRedraw();
}
function onidleout() {
    uiMouse = { x: -1, y: -1 };
    uiRedraw();
}

function onwheel(x, y, dx, dy) {
    const dir = dy > 0 ? -1 : 1;
    const ax = uiAreaX();
    if (!uiAreaOn() || x < ax) return;
    if (uiInsp()) {
        const smax = Math.max(0, MM.allMappings().length - uiInspRows());
        uiSet({ scrollI: clamp(Number(uiG("scrollI", 0)) + dir, 0, smax) });
    } else if (uiTab() === "targets") {
        const i = uiSel();
        const learning = MM.learn.armed && MM.learn.mod === i;
        const total = MM.mappingsFor(i).length + (learning ? 1 : 0);
        uiSet({ scrollT: clamp(Number(uiG("scrollT", 0)) + dir, 0, uiTargetsScrollMax(total)) });
    }
    uiRedraw();
}

// minimal keyboard: Delete / Backspace removes the selected modulator, i = inspector, e / Return = editor, m = learn
function onkeydown(k) {
    const code = typeof k === "number" ? k : String(k).charCodeAt(0);
    const i = uiSel();
    if (code === 127 || code === 8) { if (i >= 0) MM.removeModulator(i); }
    else if (code === 105) uiSet({ insp: uiInsp() ? 0 : 1 });
    else if ((code === 101 || code === 13) && i >= 0) uiToggleEditor(i);
    else if (code === 109 && i >= 0) { if (MM.learn.armed) MM.disarmLearn(); else MM.armLearn(i, false); }
    uiRedraw();
}

// ------------------------------------------------------------------ preview (scripts/render_preview.py)
function preview() {
    MM.demo();
    const s = MM.state;
    const names = ["Wobble", "Follower", "Drift", "Pattern", "Swell", "Pulse"];
    s.mods[5] = makeModSlot(MOD_LFO, 5);
    s.mods[5].p.shape = 4;
    for (let k = 0; k < 6; k++) { s.mods[k].name = names[k]; s.mods[k].color = k; }
    s.mods[0].p.shape = 1;
    s.mods[0].p.sync = 1;
    s.mods[4].points = [
        { x: 0, y: 0.1, curve: 0.5, sCurve: 0 }, { x: 0.18, y: 0.95, curve: -0.4, sCurve: 0 },
        { x: 0.42, y: 0.35, curve: 0, sCurve: 0 }, { x: 0.7, y: 0.8, curve: 0.3, sCurve: 1 },
        { x: 1, y: 0.2, curve: 0, sCurve: 0 },
    ];
    s.mods[4].p.loopOn = 1; s.mods[4].p.loopStart = 0.18; s.mods[4].p.loopEnd = 0.7;
    s.mappings = [];
    s.nextMapId = 1;
    const T = (tr, dev, par, n) => ({ path: "live_set tracks " + tr + " devices 0 parameters " + n, trackName: tr, deviceName: dev, paramName: par });
    const add = (mod, target, patch) => {
        const mp = defaultMapping(s.nextMapId++, mod, target);
        Object.assign(mp, patch || {});
        s.mappings.push(mp);
    };
    add(0, T("Bass", "Auto Filter", "Frequency", 1), { amount: 0.62, curve: CURVE_EXP, curveAmt: 0.6 });
    add(0, T("Bass", "Auto Filter", "Resonance", 2), { amount: -0.35, curve: CURVE_S, curveAmt: 0.5 });
    add(0, T("Lead", "Wavetable", "Osc 1 Position", 3), { mode: "remote", min: 0.2, max: 0.85, curve: CURVE_LOG, curveAmt: 0.4 });
    add(0, T("Drums", "Reverb", "Decay Time", 4), { bipolar: 0, amount: 0.8, curve: CURVE_STEPPED, curveSteps: 5 });
    add(0, T("Pad", "Delay", "Feedback", 5), { amount: 0.45, invert: 1 });
    add(0, T("Gone", "Missing Device", "Param", 6), { amount: 0.5 });
    add(1, T("Bass", "Compressor", "Threshold", 7), { amount: 0.5 });
    add(2, T("Lead", "Chorus", "Rate", 8), { amount: 0.3 });
    add(4, T("Pad", "Eq Eight", "1 Frequency A", 9), { mode: "remote", min: 0.1, max: 0.6 });
    for (let k = 0; k < 6; k++) uiHist[k] = [];
    for (let n = 0; n < uiHistLen; n++) {
        uiHist[1].push(Math.max(-1, Math.min(1, 0.7 * Math.exp(-((n % 40) / 12)) * 2 - 0.5)));
        uiHist[2].push(Math.floor(n / 14) % 2 ? 0.5 : -0.4 + 0.2 * Math.sin(Math.floor(n / 14)));
    }
    const mode = typeof process !== "undefined" && process.env && process.env.MM_PREVIEW_C ? process.env.MM_PREVIEW_C : "targets";
    const ui = { sel: 0, edOpen: 1, tab: "targets", insp: 0, sort: "mod", sortDir: 1 };
    if (mode === "edit-mseg") { ui.sel = 4; ui.tab = "edit"; }
    else if (mode === "edit-lfo") { ui.sel = 0; ui.tab = "edit"; }
    else if (mode === "edit-steps") { ui.sel = 3; ui.tab = "edit"; }
    else if (mode === "edit-env") { ui.sel = 1; ui.tab = "edit"; }
    else if (mode === "inspector") { ui.insp = 1; }
    else if (mode === "learning") { MM.armLearn(0, true); ui.scrollT = 999; }
    s.ui = ui;
    MM.mappingStatus = (id) => (id === 6 ? "missing" : "ok"); // preview only
    uiLastW = uiWidth();
}
