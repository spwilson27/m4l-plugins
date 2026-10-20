// Mega Modulator — UI design A "Tiles" (Bitwig-style modulator grid + editor panel + mapping inspector).
// Uses ONLY the mgraphics subset listed in the API CONTRACT (src/megamod_config.js).
// Prepended: header (mgraphics init) + megamod_config.js + megamod_mapper.js. All helpers are prefixed `ui`.
//
// Layout (local coords, device height 169, main v8ui y = 4, h = 161):
//   [grid: columns of 2 square tiles (+ trailing "+" tile)] [editor panel (~164)] [inspector (~172)]
// Device width = grid + editor (if a tile is expanded) + inspector (if open); see uiLayout().
// Persisted in state.ui: {exp: expanded slot or -1, insp: 0/1, scroll: first visible inspector item}.

const UI_PAD = 3;
const UI_GAP = 3;
const UI_TILE = 76;
const UI_EDW = 164;
const UI_INW = 172;
const UI_H = 161;
const UI_ADD_TYPES = [MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG];
const UI_ORANGE = [0.96, 0.64, 0.19];
const UI_CYAN = [0.31, 0.76, 0.96];
const UI_RED = [0.93, 0.35, 0.33];
const UI_TYPE_COL = [[0.5, 0.5, 0.5], [0.36, 0.78, 0.96], [0.50, 0.85, 0.46], [0.95, 0.50, 0.62], [0.97, 0.78, 0.30], [0.72, 0.58, 0.98]];
const UI_LOG_KEYS = { rate: 1, attack: 1, release: 1 };
const UI_HIST = 44;
const UI_ROW_HEAD = 15;
const UI_ROW_MAP = 14;
const UI_ROW_NONE = 12;
const UI_MENU_ROW = 13;

var uiMx = -1;
var uiMy = -1;
var uiCtl = [];
var uiDrag = null;
var uiMenu = null; // {} when the add-menu is open
var uiHist = [];
var uiLastW = 0;
var uiFrame = 0;
for (let i = 0; i < MAX_MODS; i++) uiHist.push([]);

// ------------------------------------------------------------------ small helpers
function uiSlots() {
    const out = [];
    for (let i = 0; i < MAX_MODS; i++) if (MM.state.mods[i]) out.push(i);
    return out;
}

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

function uiRRectStroke(x, y, w, h, r, c, a, lw) {
    uiCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.stroke();
}

function uiMeasure(s, size) {
    mgraphics.set_font_size(size);
    const m = mgraphics.text_measure(String(s));
    return m && m.length ? m[0] : String(s).length * size * 0.56;
}

function uiFit(s, maxW, size) {
    s = String(s);
    if (uiMeasure(s, size) <= maxW) return s;
    while (s.length > 1 && uiMeasure(s + "..", size) > maxW) s = s.slice(0, -1);
    return s + "..";
}

function uiText(s, x, y, size, c, a, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    uiCol(c, a);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(s));
}

function uiTextC(s, cx, y, size, c, a, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    uiText(s, cx - uiMeasure(s, size) / 2, y, size, c, a, bold);
}

function uiTextR(s, rx, y, size, c, a, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    uiText(s, rx - uiMeasure(s, size), y, size, c, a, bold);
}

function uiLine(x0, y0, x1, y1, c, a, lw) {
    uiCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(x0, y0);
    mgraphics.line_to(x1, y1);
    mgraphics.stroke();
}

function uiPoly(pts, c, a, lw) {
    if (pts.length < 2) return;
    uiCol(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) mgraphics.line_to(pts[k][0], pts[k][1]);
    mgraphics.stroke();
}

function uiPolyFill(pts, baseY, c, a) {
    if (pts.length < 2) return;
    uiCol(c, a);
    mgraphics.move_to(pts[0][0], baseY);
    for (let k = 0; k < pts.length; k++) mgraphics.line_to(pts[k][0], pts[k][1]);
    mgraphics.line_to(pts[pts.length - 1][0], baseY);
    mgraphics.close_path();
    mgraphics.fill();
}

function uiDot(cx, cy, r, c, a) {
    uiCol(c, a);
    mgraphics.arc(cx, cy, r, 0, Math.PI * 2);
    mgraphics.fill();
}

function uiIn(x, y, r) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function uiUI() {
    const u = MM.getUI() || {};
    const exp = typeof u.exp === "number" && MM.state.mods[u.exp] ? u.exp : -1;
    return { exp, insp: u.insp ? 1 : 0, scroll: Math.max(0, Math.floor(num(u.scroll, 0))) };
}

function uiTel() {
    return MM.readTelemetry();
}

// ------------------------------------------------------------------ layout (pure)
function uiLayout() {
    const slots = uiSlots();
    const tiles = slots.length + (slots.length < MAX_MODS ? 1 : 0);
    const cols = Math.max(1, Math.ceil(tiles / 2));
    const u = uiUI();
    let x = UI_PAD + cols * (UI_TILE + UI_GAP);
    const L = { slots, tiles, cols, gridX1: x, exp: u.exp, insp: u.insp, ed: null, in: null };
    if (u.exp >= 0) {
        L.ed = { x, y: UI_PAD, w: UI_EDW, h: UI_H - 2 * UI_PAD };
        x += UI_EDW + UI_GAP;
    }
    if (u.insp) {
        L.in = { x, y: UI_PAD, w: UI_INW, h: UI_H - 2 * UI_PAD };
        x += UI_INW + UI_GAP;
    }
    L.rawWidth = x;
    L.width = Math.max(MIN_WIDTH, x);
    return L;
}

function uiWidth() {
    return uiLayout().width;
}

function uiTileRect(t) {
    return { x: UI_PAD + Math.floor(t / 2) * (UI_TILE + UI_GAP), y: UI_PAD + (t % 2) * (UI_TILE + UI_GAP), w: UI_TILE, h: UI_TILE };
}

function uiArrowRect(tr) {
    return { x: tr.x + 4, y: tr.y + tr.h - 18, w: 26, h: 15 };
}

function uiDelRect(tr) {
    return { x: tr.x + 2, y: tr.y + 2, w: 12, h: 12 };
}

function uiInspBtnRect(L) {
    // top-right of the grid area (inside the last column's top tile corner)
    return { x: L.gridX1 - UI_GAP - 17, y: UI_PAD + 3, w: 14, h: 12 };
}

// What is under (x, y) in the grid? -> {kind:"insp"|"del"|"arrow"|"tile"|"plus", slot, t} | null
function uiGridHit(x, y, L) {
    L = L || uiLayout();
    if (uiIn(x, y, uiInspBtnRect(L))) return { kind: "insp" };
    for (let t = 0; t < L.tiles; t++) {
        const tr = uiTileRect(t);
        if (!uiIn(x, y, tr)) continue;
        if (t >= L.slots.length) return { kind: "plus", t };
        const slot = L.slots[t];
        if (uiIn(x, y, uiArrowRect(tr))) return { kind: "arrow", slot, t };
        if (uiIn(x, y, uiDelRect(tr))) return { kind: "del", slot, t };
        return { kind: "tile", slot, t };
    }
    return null;
}

function uiMenuRect(L) {
    const tr = uiTileRect(L.slots.length);
    const h = 14 + UI_ADD_TYPES.length * UI_MENU_ROW + 3;
    return { x: tr.x, y: Math.min(tr.y, UI_H - UI_PAD - h), w: Math.min(86, UI_TILE + 10), h };
}

// ------------------------------------------------------------------ inspector model
function uiInspItems() {
    const items = [];
    for (const i of uiSlots()) {
        items.push({ kind: "head", i, h: UI_ROW_HEAD });
        const maps = MM.mappingsFor(i);
        if (!maps.length) items.push({ kind: "none", i, h: UI_ROW_NONE });
        for (const m of maps) items.push({ kind: "map", i, m, h: UI_ROW_MAP });
    }
    return items;
}

function uiInspArea(R) {
    return { y: R.y + 16, h: R.h - 16 - 15 };
}

function uiInspMaxScroll(items, area) {
    let acc = 0;
    let k = items.length;
    while (k > 0 && acc + items[k - 1].h <= area.h) { acc += items[k - 1].h; k--; }
    return k;
}

// visible items with their y positions
function uiInspVisible(R, items, scroll) {
    items = items || uiInspItems();
    const area = uiInspArea(R);
    const first = clamp(scroll === undefined ? uiUI().scroll : scroll, 0, uiInspMaxScroll(items, area));
    const out = [];
    let y = area.y;
    for (let k = first; k < items.length; k++) {
        if (y + items[k].h > area.y + area.h) break;
        out.push({ item: items[k], y, h: items[k].h, index: k });
        y += items[k].h;
    }
    return { rows: out, first, area, total: items.length };
}

// column x offsets inside a mapping row
function uiRowParts(R, y) {
    return {
        del: { x: R.x + 3, y: y + 1, w: 11, h: 12 },
        name: { x: R.x + 16, y: y + 1, w: 68, h: 12 },
        curve: { x: R.x + 87, y: y + 2, w: 15, h: 10 },
        val: { x: R.x + 106, y: y + 1, w: 44, h: 12 },
        mode: { x: R.x + 152, y: y + 2, w: 15, h: 10 },
    };
}

function uiHeadArrowRect(R, y) {
    return { x: R.x + R.w - 33, y: y, w: 26, h: 14 };
}

function uiInspHit(x, y, L) {
    L = L || uiLayout();
    if (!L.in || !uiIn(x, y, L.in)) return null;
    const vis = uiInspVisible(L.in);
    for (const r of vis.rows) {
        if (y < r.y || y >= r.y + r.h) continue;
        if (r.item.kind === "head") {
            if (uiIn(x, y, uiHeadArrowRect(L.in, r.y))) return { kind: "harrow", i: r.item.i };
            return { kind: "head", i: r.item.i };
        }
        if (r.item.kind === "map") {
            const P = uiRowParts(L.in, r.y);
            for (const k of ["del", "name", "curve", "val", "mode"]) if (uiIn(x, y, P[k])) return { kind: k, m: r.item.m, i: r.item.i, rect: P[k] };
            return { kind: "row", m: r.item.m, i: r.item.i };
        }
        return { kind: "none", i: r.item.i };
    }
    return { kind: "blank" };
}

// ------------------------------------------------------------------ param <-> control math
function uiNorm(key, v) {
    const r = MOD_PARAM_RANGE[key];
    if (UI_LOG_KEYS[key]) return clamp(Math.log(Math.max(r[0], v) / r[0]) / Math.log(r[1] / r[0]), 0, 1);
    return clamp((v - r[0]) / (r[1] - r[0]), 0, 1);
}

function uiDenorm(key, n) {
    const r = MOD_PARAM_RANGE[key];
    n = clamp(n, 0, 1);
    let v = UI_LOG_KEYS[key] ? r[0] * Math.pow(r[1] / r[0], n) : r[0] + n * (r[1] - r[0]);
    if (r[2]) v = Math.round(v);
    return v;
}

function uiFmt(key, p) {
    const v = p[key];
    switch (key) {
        case "rate": return v >= 10 ? v.toFixed(1) + " Hz" : v.toFixed(2) + " Hz";
        case "syncDiv": return SYNC_LABELS[clamp(Math.round(v), 0, 15)];
        case "attack": case "release": return v >= 1000 ? (v / 1000).toFixed(2) + " s" : v >= 100 ? v.toFixed(0) + " ms" : v.toFixed(1) + " ms";
        case "gain": return (v >= 0 ? "+" : "") + v.toFixed(1) + " dB";
        case "phase": return Math.round(v * 360) + "°";
        case "steps": case "seed": return String(Math.round(v));
        default: return Math.round(v * 100) + "%";
    }
}

function uiRateKey(p) {
    return p.sync ? "syncDiv" : "rate";
}

// ------------------------------------------------------------------ control registry (editor widgets, built while painting)
function uiReg(o) {
    uiCtl.push(o);
    return o;
}

function uiCtlAt(x, y) {
    for (let k = uiCtl.length - 1; k >= 0; k--) if (uiIn(x, y, uiCtl[k])) return uiCtl[k];
    return null;
}

function uiKnob(i, key, cx, cy, r, label, o) {
    const m = MM.state.mods[i];
    const n = uiNorm(key, m.p[key]);
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const track = [];
    const val = [];
    const steps = 28;
    for (let s = 0; s <= steps; s++) {
        const a = a0 + (sweep * s) / steps;
        track.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        if (s / steps <= n + 1e-6) val.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    uiDot(cx, cy, r - 3, [0.11, 0.12, 0.14]);
    uiPoly(track, [0.30, 0.32, 0.36], 1, 2.5);
    if (val.length > 1) uiPoly(val, UI_ORANGE, 1, 2.5);
    const ang = a0 + sweep * n;
    uiLine(cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8), cx + Math.cos(ang) * (r - 3), cy + Math.sin(ang) * (r - 3), [0.95, 0.95, 0.95], 1, 1.5);
    if (label) uiTextC(label, cx, cy + r + 8, 6, [0.55, 0.58, 0.62]);
    if (o && o.value) uiTextC(uiFmt(key, m.p), cx, cy + r + 16, 7, UI_ORANGE);
    const start = { n: 0 };
    return uiReg({
        x: cx - r, y: cy - r, w: r * 2, h: r * 2, kind: "knob", mod: i, key,
        onDown() { start.n = uiNorm(key, MM.state.mods[i].p[key]); },
        onDrag(x, y, sx, sy, shift) { MM.setParam(i, key, uiDenorm(key, start.n + (sy - y) / (shift ? 600 : 140))); },
        onDbl() { MM.setParam(i, key, defaultParams(MM.state.mods[i].type)[key]); MM.commit(); },
    });
}

function uiDragNum(i, key, x, y, w, label) {
    const m = MM.state.mods[i];
    const n = uiNorm(key, m.p[key]);
    uiRRect(x, y, w, 14, 3, [0.13, 0.14, 0.16]);
    uiRect(x + 1, y + 11, (w - 2) * n, 2, UI_ORANGE, 0.55);
    uiText(label, x + 4, y + 10, 7, [0.58, 0.61, 0.66]);
    uiTextR(uiFmt(key, m.p), x + w - 4, y + 10, 7.5, UI_ORANGE);
    const start = { n: 0 };
    return uiReg({
        x, y, w, h: 14, kind: "dragnum", mod: i, key,
        onDown() { start.n = uiNorm(key, MM.state.mods[i].p[key]); },
        onDrag(mx, my, sx, sy, shift) { MM.setParam(i, key, uiDenorm(key, start.n + ((mx - sx) - (my - sy)) / (shift ? 700 : 110))); },
        onDbl() { MM.setParam(i, key, defaultParams(MM.state.mods[i].type)[key]); MM.commit(); },
    });
}

function uiBtn(x, y, w, h, label, on, fn, col) {
    uiRRect(x, y, w, h, 3, on ? (col || UI_ORANGE) : [0.15, 0.16, 0.19], on ? 0.9 : 1);
    uiTextC(label, x + w / 2, y + h - 4, 7.5, on ? [0.1, 0.1, 0.1] : [0.65, 0.68, 0.72], 1, true);
    return uiReg({ x, y, w, h, kind: "btn", onDown: fn });
}

function uiSeg(x, y, w, h, labels, sel, fn) {
    const sw = w / labels.length;
    uiRRect(x, y, w, h, 3, [0.13, 0.14, 0.16]);
    for (let k = 0; k < labels.length; k++) {
        if (k === sel) uiRRect(x + k * sw + 1, y + 1, sw - 2, h - 2, 2, UI_ORANGE, 0.9);
        uiTextC(labels[k], x + k * sw + sw / 2, y + h - 4, 7.5, k === sel ? [0.1, 0.1, 0.1] : [0.65, 0.68, 0.72], 1, k === sel);
        const kk = k;
        uiReg({ x: x + k * sw, y, w: sw, h, kind: "seg", onDown() { fn(kk); } });
    }
}

// ------------------------------------------------------------------ glyphs
function uiArrow(x, y, armed, multi, hover) {
    const cy = y + 7.5;
    if (armed && multi) uiRRect(x - 1, y, 26, 15, 4, UI_CYAN, 0.25);
    let a = hover ? 0.95 : 0.7;
    if (armed && !multi) a = 0.35 + 0.65 * Math.abs(Math.sin(uiFrame * 0.22));
    if (armed && multi) a = 1;
    uiDot(x + 5, cy, 2.6, UI_CYAN, a);
    uiLine(x + 7, cy, x + 18, cy, UI_CYAN, a, 1.4);
    uiCol(UI_CYAN, a);
    mgraphics.move_to(x + 21, cy);
    mgraphics.line_to(x + 16, cy - 3);
    mgraphics.line_to(x + 16, cy + 3);
    mgraphics.close_path();
    mgraphics.fill();
}

function uiShapeGlyph(shape, x, y, w, h, c, a) {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
        const ph = k / 16;
        const v = shape === 4 ? (ph < 0.5 ? 1 : 0) : lfoShape(shape, ph);
        pts.push([x + w * ph, y + h - h * v]);
    }
    if (shape === 4) {
        uiPoly([[x, y + h], [x, y], [x + w / 2, y], [x + w / 2, y + h], [x + w, y + h]], c, a, 1.3);
        return;
    }
    uiPoly(pts, c, a, 1.3);
}

function uiCurveGlyph(m, x, y, w, h, c, a) {
    const pts = [];
    for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        let v = shapeCurve(u, m.curve, m.curveAmt, m.curveSteps);
        if (m.invert) v = 1 - v;
        pts.push([x + w * u, y + h - h * clamp(v, 0, 1)]);
    }
    if (m.curve === CURVE_STEPPED) {
        const st = [];
        const n = clamp(Math.round(m.curveSteps || 4), 2, 16);
        for (let k = 0; k < n; k++) {
            const v = shapeCurve((k + 0.5) / n, m.curve, m.curveAmt, m.curveSteps);
            const vv = m.invert ? 1 - v : v;
            st.push([x + (w * k) / n, y + h - h * clamp(vv, 0, 1)]);
            st.push([x + (w * (k + 1)) / n, y + h - h * clamp(vv, 0, 1)]);
        }
        uiPoly(st, c, a, 1.2);
        return;
    }
    uiPoly(pts, c, a, 1.2);
}

// ------------------------------------------------------------------ tile visualisations
function uiTrace(hist, x, y, w, h, c, fill, stepped) {
    const n = hist.length;
    if (n < 2) return;
    const pts = [];
    for (let k = 0; k < n; k++) {
        const px = x + (w * k) / (UI_HIST - 1) + w * (1 - (n - 1) / (UI_HIST - 1));
        const py = y + h - h * clamp(hist[k], 0, 1);
        if (stepped && k > 0) pts.push([px, pts[pts.length - 1][1]]);
        pts.push([px, py]);
    }
    if (fill) uiPolyFill(pts, y + h, c, 0.28);
    uiPoly(pts, c, 1, 1.3);
}

function uiModCurveU(m, ph) {
    // 0..1 height of an LFO / MSEG curve at cycle phase ph, as the engine would output it
    const s = m.type === MOD_MSEG ? evalMseg(m.points, ph) : lfoShape(m.p.shape, frac(ph + m.p.phase));
    return (outputFromU(s, m.p.bipolar, m.p.depth) + 1) / 2;
}

function uiViz(i, m, x, y, w, h, tel, col) {
    uiRRect(x, y, w, h, 3, [0.095, 0.105, 0.12]);
    uiLine(x + 2, y + h / 2, x + w - 2, y + h / 2, [0.25, 0.27, 0.31], 0.7, 0.5);
    const ix = x + 2;
    const iw = w - 4;
    const iy = y + 3;
    const ih = h - 6;
    const t = tel.mods[i];
    const on = m.enabled ? 1 : 0.35;
    if (m.type === MOD_LFO || m.type === MOD_MSEG) {
        const pts = [];
        const N = 36;
        for (let k = 0; k <= N; k++) pts.push([ix + (iw * k) / N, iy + ih - ih * uiModCurveU(m, k / N)]);
        uiPolyFill(pts, iy + ih, col, 0.16 * on);
        uiPoly(pts, col, on, 1.4);
        const px = ix + iw * clamp(t.phase, 0, 1);
        const py = iy + ih - ih * clamp(t.u, 0, 1);
        uiLine(px, iy, px, iy + ih, [1, 1, 1], 0.14 * on, 0.7);
        uiDot(px, py, 2.4, [1, 1, 1], on);
    } else if (m.type === MOD_STEPS) {
        const n = clamp(m.p.steps, 1, STEPS_MAX);
        const cur = Math.floor(clamp(t.phase, 0, 0.9999) * n);
        const bw = iw / n;
        for (let k = 0; k < n; k++) {
            const v = clamp(m.stepVals[k], 0, 1);
            const bh = Math.max(1, ih * v);
            uiRect(ix + k * bw + (bw > 3 ? 0.5 : 0), iy + ih - bh, Math.max(1, bw - (bw > 3 ? 1 : 0)), bh, k === cur ? [1, 1, 1] : col, (k === cur ? 1 : 0.62) * on);
        }
    } else if (m.type === MOD_ENV) {
        uiTrace(uiHist[i], ix, iy, iw, ih, col, true, false);
    } else {
        uiTrace(uiHist[i], ix, iy, iw, ih, col, false, true);
    }
}

// ------------------------------------------------------------------ painting: grid
function uiPaintTile(t, L, tel) {
    const tr = uiTileRect(t);
    const hover = uiIn(uiMx, uiMy, tr);
    if (t >= L.slots.length) {
        const open = !!uiMenu;
        uiRRect(tr.x, tr.y, tr.w, tr.h, 7, hover || open ? [0.17, 0.18, 0.21] : [0.12, 0.13, 0.15]);
        uiRRectStroke(tr.x + 0.5, tr.y + 0.5, tr.w - 1, tr.h - 1, 7, [0.26, 0.28, 0.32], 1, 1);
        const cx = tr.x + tr.w / 2;
        const cy = tr.y + tr.h / 2;
        uiLine(cx - 8, cy, cx + 8, cy, hover ? UI_ORANGE : [0.45, 0.48, 0.53], 1, 2);
        uiLine(cx, cy - 8, cx, cy + 8, hover ? UI_ORANGE : [0.45, 0.48, 0.53], 1, 2);
        return;
    }
    const i = L.slots[t];
    const m = MM.state.mods[i];
    const col = UI_TYPE_COL[m.type];
    const sel = L.exp === i;
    uiRRect(tr.x, tr.y, tr.w, tr.h, 7, hover ? [0.19, 0.20, 0.23] : [0.155, 0.165, 0.185]);
    uiRRectStroke(tr.x + 0.5, tr.y + 0.5, tr.w - 1, tr.h - 1, 7, sel ? UI_ORANGE : [0.26, 0.28, 0.32], 1, sel ? 1.5 : 1);
    // header: delete on hover, else type colour pip + name
    const dr = uiDelRect(tr);
    if (hover) {
        const dh = uiIn(uiMx, uiMy, dr);
        uiRRect(dr.x, dr.y, dr.w, dr.h, 3, dh ? UI_RED : [0.25, 0.17, 0.18], dh ? 0.9 : 1);
        uiLine(dr.x + 3.5, dr.y + 3.5, dr.x + 8.5, dr.y + 8.5, [1, 1, 1], 0.9, 1.2);
        uiLine(dr.x + 8.5, dr.y + 3.5, dr.x + 3.5, dr.y + 8.5, [1, 1, 1], 0.9, 1.2);
        uiText(uiFit(m.name, tr.w - 22, 7), tr.x + 17, tr.y + 11, 7, [0.8, 0.83, 0.87]);
    } else {
        uiDot(tr.x + 8, tr.y + 8, 2.5, col, m.enabled ? 1 : 0.3);
        uiText(uiFit(m.name, tr.w - 22, 7), tr.x + 14, tr.y + 11, 7, [0.8, 0.83, 0.87], m.enabled ? 1 : 0.45);
    }
    uiViz(i, m, tr.x + 5, tr.y + 17, tr.w - 10, 38, tel, col);
    // bottom strip: map arrow, learn pill, mapping-count badge
    const ar = uiArrowRect(tr);
    const armed = MM.learn.armed && MM.learn.mod === i;
    uiArrow(ar.x, ar.y, armed, armed && MM.learn.multi, uiIn(uiMx, uiMy, ar));
    if (armed && MM.learn.multi) {
        uiRRect(tr.x + 31, tr.y + tr.h - 15, 24, 10, 5, UI_CYAN, 0.95);
        uiTextC("LEARN", tr.x + 43, tr.y + tr.h - 7.5, 5, [0.05, 0.1, 0.14], 1, true);
    }
    const cnt = MM.mappingsFor(i).length;
    uiRRect(tr.x + tr.w - 19, tr.y + tr.h - 16, 15, 11, 5, cnt ? UI_CYAN : [0.22, 0.24, 0.27], cnt ? 0.22 : 1);
    uiTextC(String(cnt), tr.x + tr.w - 11.5, tr.y + tr.h - 7.5, 7, cnt ? UI_CYAN : [0.5, 0.53, 0.58], 1, true);
}

function uiPaintInspBtn(L) {
    const r = uiInspBtnRect(L);
    const hov = uiIn(uiMx, uiMy, r);
    uiRRect(r.x, r.y, r.w, r.h, 3, L.insp ? UI_ORANGE : [0.2, 0.22, 0.25], L.insp ? 0.95 : hov ? 1 : 0.8);
    const c = L.insp ? [0.1, 0.1, 0.1] : [0.72, 0.75, 0.8];
    for (let k = 0; k < 3; k++) {
        uiDot(r.x + 3.5, r.y + 3 + k * 3, 0.8, c);
        uiLine(r.x + 6, r.y + 3 + k * 3, r.x + r.w - 3, r.y + 3 + k * 3, c, 1, 1);
    }
}

function uiPaintMenu(L) {
    const R = uiMenuRect(L);
    uiRRect(R.x, R.y, R.w, R.h, 5, [0.1, 0.11, 0.13]);
    uiRRectStroke(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, 5, UI_ORANGE, 0.9, 1);
    uiText("ADD", R.x + 6, R.y + 10, 6.5, [0.55, 0.58, 0.62], 1, true);
    for (let k = 0; k < UI_ADD_TYPES.length; k++) {
        const ty = R.y + 14 + k * UI_MENU_ROW;
        const hov = uiMx >= R.x && uiMx < R.x + R.w && uiMy >= ty && uiMy < ty + UI_MENU_ROW;
        if (hov) uiRRect(R.x + 2, ty, R.w - 4, UI_MENU_ROW - 1, 3, [0.22, 0.24, 0.28]);
        uiDot(R.x + 9, ty + 6, 2.5, UI_TYPE_COL[UI_ADD_TYPES[k]]);
        uiText(MOD_TYPE_NAMES[UI_ADD_TYPES[k]], R.x + 16, ty + 9, 8, hov ? [1, 1, 1] : [0.8, 0.83, 0.87]);
    }
}

// ------------------------------------------------------------------ painting: editor panel
function uiEditorHeader(i, m, R) {
    const col = UI_TYPE_COL[m.type];
    uiDot(R.x + 9, R.y + 9, 3, col, m.enabled ? 1 : 0.3);
    uiText(uiFit(m.name, R.w - 90, 8), R.x + 16, R.y + 12, 8, [0.9, 0.92, 0.95], m.enabled ? 1 : 0.5, true);
    uiTextR(MOD_TYPE_NAMES[m.type], R.x + R.w - 32, R.y + 12, 6.5, col);
    // enable (power) + close glyphs
    const px = R.x + R.w - 28;
    uiRRectStroke(px + 0.5, R.y + 4.5, 9, 9, 4.5, m.enabled ? UI_ORANGE : [0.5, 0.52, 0.56], 1, 1.2);
    uiLine(px + 5, R.y + 3, px + 5, R.y + 8, m.enabled ? UI_ORANGE : [0.5, 0.52, 0.56], 1, 1.2);
    uiReg({ x: px - 2, y: R.y + 2, w: 14, h: 14, kind: "power", onDown() { MM.setParam(i, "enabled", m.enabled ? 0 : 1); MM.commit(); } });
    const cx = R.x + R.w - 12;
    uiLine(cx + 1, R.y + 5, cx + 8, R.y + 12, [0.7, 0.72, 0.76], 1, 1.4);
    uiLine(cx + 8, R.y + 5, cx + 1, R.y + 12, [0.7, 0.72, 0.76], 1, 1.4);
    uiReg({ x: cx - 2, y: R.y + 2, w: 14, h: 14, kind: "close", onDown() { MM.setUI({ exp: -1 }); } });
    uiLine(R.x + 4, R.y + 17, R.x + R.w - 4, R.y + 17, [0.24, 0.26, 0.3], 1, 1);
}

function uiRateBlock(i, m, R, y0, big) {
    const p = m.p;
    const rk = uiRateKey(p);
    const r = big ? 16 : 12;
    const cy = y0 + r + 2;
    uiKnob(i, rk, R.x + 26, cy, r, "RATE", { value: false });
    uiSeg(R.x + 54, y0 + 1, 104, 14, ["Hz", "Sync"], p.sync ? 1 : 0, (k) => { MM.setParam(i, "sync", k); MM.commit(); });
    uiText(uiFmt(rk, p), R.x + 56, y0 + (big ? 36 : 32), big ? 12 : 11, UI_ORANGE, 1, true);
    return cy + r;
}

function uiMeter(m, R, y, tel, i) {
    const v = clamp(tel.mods[i].out, -1, 1);
    const x = R.x + 6;
    const w = R.w - 12;
    uiRRect(x, y, w, 5, 2, [0.1, 0.11, 0.13]);
    const hw = w / 2;
    const c = UI_TYPE_COL[m.type];
    if (v >= 0) uiRect(x + hw, y + 0.5, hw * v, 4, c);
    else uiRect(x + hw + hw * v, y + 0.5, -hw * v, 4, c);
    uiLine(x + hw, y - 1, x + hw, y + 6, [0.8, 0.82, 0.86], 0.6, 1);
}

function uiEditorFooter(i, m, R, loopStyle) {
    const y = R.y + R.h - 19;
    uiBtn(R.x + 6, y, 24, 14, "±", !!m.p.bipolar, () => { MM.setParam(i, "bipolar", m.p.bipolar ? 0 : 1); MM.commit(); });
    if (m.type === MOD_ENV) return;
    if (loopStyle) uiSeg(R.x + 36, y, 80, 14, ["Loop", "1-Shot"], m.p.oneshot ? 1 : 0, (k) => { MM.setParam(i, "oneshot", k); MM.commit(); });
    else uiSeg(R.x + 36, y, 80, 14, ["Free", "Retrig"], m.p.retrig ? 1 : 0, (k) => { MM.setParam(i, "retrig", k); MM.commit(); });
    // manual retrigger button (arrow-restart glyph)
    const bx = R.x + 122;
    uiRRect(bx, y, 24, 14, 3, [0.15, 0.16, 0.19]);
    uiCol([0.7, 0.73, 0.78]);
    mgraphics.move_to(bx + 8, y + 4);
    mgraphics.line_to(bx + 8, y + 10);
    mgraphics.line_to(bx + 16, y + 7);
    mgraphics.close_path();
    mgraphics.fill();
    uiReg({ x: bx, y, w: 24, h: 14, kind: "retrig", onDown() { MM.retrigger(i); } });
}

function uiPaintStepsEditor(i, m, x, y, w, h, tel) {
    uiRRect(x, y, w, h, 3, [0.095, 0.105, 0.12]);
    const n = clamp(m.p.steps, 1, STEPS_MAX);
    const bw = (w - 4) / n;
    const cur = Math.floor(clamp(tel.mods[i].phase, 0, 0.9999) * n);
    for (let k = 0; k < n; k++) {
        const v = clamp(m.stepVals[k], 0, 1);
        const bh = Math.max(1, (h - 4) * v);
        uiRect(x + 2 + k * bw + 0.5, y + h - 2 - bh, Math.max(1, bw - 1), bh, k === cur ? [1, 1, 1] : UI_TYPE_COL[MOD_STEPS], k === cur ? 1 : 0.75);
    }
    const setAt = (mx, my) => {
        const k = clamp(Math.floor((mx - x - 2) / bw), 0, n - 1);
        MM.setStep(i, k, 1 - (my - y - 2) / (h - 4));
    };
    uiReg({
        x, y, w, h, kind: "steps", mod: i,
        onDown(mx, my) { setAt(mx, my); },
        onDrag(mx, my) { setAt(mx, my); },
    });
}

function uiMsegMap(x, y, w, h) {
    return { px: (nx) => x + 4 + nx * (w - 8), py: (ny) => y + h - 4 - ny * (h - 8), nx: (sx) => clamp((sx - x - 4) / (w - 8), 0, 1), ny: (sy) => clamp((h - 4 - (sy - y)) / (h - 8), 0, 1) };
}

function uiPaintMsegEditor(i, m, x, y, w, h, tel) {
    uiRRect(x, y, w, h, 3, [0.095, 0.105, 0.12]);
    const mp = uiMsegMap(x, y, w, h);
    for (let g = 1; g < 4; g++) uiLine(mp.px(g / 4), y + 2, mp.px(g / 4), y + h - 2, [0.2, 0.22, 0.26], 1, 0.5);
    uiLine(x + 2, mp.py(0.5), x + w - 2, mp.py(0.5), [0.2, 0.22, 0.26], 1, 0.5);
    const col = UI_TYPE_COL[MOD_MSEG];
    const pts = [];
    for (let k = 0; k <= 60; k++) pts.push([mp.px(k / 60), mp.py(evalMseg(m.points, k / 60))]);
    uiPolyFill(pts, mp.py(0), col, 0.18);
    uiPoly(pts, col, 1, 1.5);
    const sel = uiMsegSel === null || uiMsegSel.mod !== i ? -1 : uiMsegSel.k;
    for (let k = 0; k < m.points.length; k++) {
        const px = mp.px(m.points[k].x);
        const py = mp.py(m.points[k].y);
        uiRect(px - 2.5, py - 2.5, 5, 5, k === sel ? UI_ORANGE : [0.95, 0.95, 0.95]);
    }
    const phx = mp.px(clamp(tel.mods[i].phase, 0, 1));
    uiLine(phx, y + 2, phx, y + h - 2, [1, 1, 1], 0.3, 1);
    uiDot(phx, mp.py(evalMseg(m.points, clamp(tel.mods[i].phase, 0, 1))), 2.2, UI_ORANGE);
    uiReg(uiMsegCtl(i, x, y, w, h, mp));
}

var uiMsegSel = null;

function uiMsegHitPoint(m, mp, mx, my) {
    let best = -1;
    let bd = 7 * 7;
    for (let k = 0; k < m.points.length; k++) {
        const dx = mp.px(m.points[k].x) - mx;
        const dy = mp.py(m.points[k].y) - my;
        const d = dx * dx + dy * dy;
        if (d <= bd) { bd = d; best = k; }
    }
    return best;
}

function uiMsegCtl(i, x, y, w, h, mp) {
    const st = { k: -1, seg: -1, c0: 0 };
    const clonePts = () => MM.state.mods[i].points.map((p) => ({ x: p.x, y: p.y, curve: p.curve, sCurve: p.sCurve }));
    return {
        x, y, w, h, kind: "mseg", mod: i,
        onDown(mx, my, shift) {
            const m = MM.state.mods[i];
            const k = uiMsegHitPoint(m, mp, mx, my);
            st.seg = -1;
            if (k >= 0) { st.k = k; uiMsegSel = { mod: i, k }; return; }
            const nx = mp.nx(mx);
            if (shift) {
                // shift-drag on a segment bends its curve
                let s = 0;
                while (s < m.points.length - 2 && m.points[s + 1].x < nx) s++;
                st.seg = s;
                st.c0 = m.points[s].curve || 0;
                st.k = -1;
                return;
            }
            const pts = clonePts();
            pts.push({ x: nx, y: mp.ny(my), curve: 0, sCurve: 0 });
            MM.setMsegPoints(i, pts);
            const sorted = MM.state.mods[i].points;
            let nk = 0;
            for (let q = 0; q < sorted.length; q++) if (Math.abs(sorted[q].x - nx) < 1e-6) nk = q;
            st.k = nk;
            uiMsegSel = { mod: i, k: nk };
        },
        onDrag(mx, my, sx, sy) {
            const m = MM.state.mods[i];
            const pts = clonePts();
            if (st.seg >= 0) {
                pts[st.seg].curve = clamp(st.c0 + (my - sy) / 40, -1, 1);
                MM.setMsegPoints(i, pts);
                return;
            }
            const k = st.k;
            if (k < 0 || k >= pts.length) return;
            const last = pts.length - 1;
            if (k > 0 && k < last) pts[k].x = clamp(mp.nx(mx), pts[k - 1].x + 0.004, pts[k + 1].x - 0.004);
            pts[k].y = mp.ny(my);
            MM.setMsegPoints(i, pts);
        },
        onDbl(mx, my) {
            const m = MM.state.mods[i];
            const k = uiMsegHitPoint(m, mp, mx, my);
            if (k > 0 && k < m.points.length - 1) {
                const pts = clonePts();
                pts.splice(k, 1);
                MM.setMsegPoints(i, pts);
                MM.commit();
                uiMsegSel = null;
            }
        },
    };
}

function uiPaintEditor(L, tel) {
    const R = L.ed;
    const i = L.exp;
    const m = MM.state.mods[i];
    uiRRect(R.x, R.y, R.w, R.h, 7, [0.145, 0.155, 0.175]);
    uiRRectStroke(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, 7, [0.26, 0.28, 0.32], 1, 1);
    uiEditorHeader(i, m, R);
    const p = m.p;
    const top = R.y + 22;
    if (m.type === MOD_LFO) {
        uiRateBlock(i, m, R, top, true);
        const gy = top + 44;
        const gw = 28;
        for (let k = 0; k < 5; k++) {
            const gx = R.x + 6 + k * (gw + 3);
            const on = p.shape === k;
            uiRRect(gx, gy, gw, 20, 3, on ? UI_ORANGE : [0.13, 0.14, 0.16], on ? 0.18 : 1);
            if (on) uiRRectStroke(gx + 0.5, gy + 0.5, gw - 1, 19, 3, UI_ORANGE, 1, 1);
            uiShapeGlyph(k, gx + 6, gy + 5, gw - 12, 10, on ? UI_ORANGE : [0.62, 0.65, 0.7], 1);
            const kk = k;
            uiReg({ x: gx, y: gy, w: gw, h: 20, kind: "shape", onDown() { MM.setParam(i, "shape", kk); MM.commit(); } });
        }
        uiDragNum(i, "phase", R.x + 6, top + 70, 72, "Phase");
        uiDragNum(i, "depth", R.x + 86, top + 70, 72, "Depth");
    } else if (m.type === MOD_ENV) {
        const wx = R.x + 6;
        const ww = R.w - 12;
        uiRRect(wx, top, ww, 42, 3, [0.095, 0.105, 0.12]);
        uiTrace(uiHist[i], wx + 2, top + 3, ww - 4, 36, UI_TYPE_COL[MOD_ENV], true, false);
        uiText("INPUT LEVEL", wx + 4, top + 10, 5.5, [0.5, 0.53, 0.58]);
        const ky = top + 66;
        uiKnob(i, "attack", R.x + 30, ky, 12, "ATTACK", { value: true });
        uiKnob(i, "release", R.x + 82, ky, 12, "RELEASE", { value: true });
        uiKnob(i, "gain", R.x + 134, ky, 12, "GAIN", { value: true });
        uiDragNum(i, "depth", R.x + 6, R.y + R.h - 53, 72, "Depth");
    } else if (m.type === MOD_RANDOM) {
        uiRateBlock(i, m, R, top, true);
        uiDragNum(i, "smooth", R.x + 6, top + 48, 72, "Smooth");
        uiDragNum(i, "seed", R.x + 86, top + 48, 72, "Seed");
        uiDragNum(i, "depth", R.x + 6, top + 68, 72, "Depth");
        uiTrace(uiHist[i], R.x + 86, top + 68, 72, 14, UI_TYPE_COL[MOD_RANDOM], false, true);
    } else if (m.type === MOD_STEPS) {
        uiPaintStepsEditor(i, m, R.x + 6, top, R.w - 12, 50, tel);
        uiRateBlock(i, m, R, top + 56, false);
        uiDragNum(i, "steps", R.x + 6, top + 86, 72, "Steps");
        uiDragNum(i, "glide", R.x + 86, top + 86, 72, "Glide");
    } else {
        uiPaintMsegEditor(i, m, R.x + 6, top, R.w - 12, 50, tel);
        uiRateBlock(i, m, R, top + 56, false);
        uiDragNum(i, "depth", R.x + 6, top + 86, 72, "Depth");
        uiDragNum(i, "phase", R.x + 86, top + 86, 72, "Phase");
    }
    uiMeter(m, R, R.y + R.h - 29, tel, i);
    uiEditorFooter(i, m, R, m.type === MOD_STEPS || m.type === MOD_MSEG);
}

// ------------------------------------------------------------------ painting: inspector
function uiMapStatusCol(id) {
    const s = MM.mappingStatus(id);
    if (s === "missing") return UI_RED;
    return null;
}

function uiValueText(m) {
    if (m.mode === "remote") return Math.round(m.min * 100) + ".." + Math.round(m.max * 100);
    const a = Math.round(m.amount * 100);
    return (a > 0 ? "+" : "") + a + "%";
}

function uiPaintInspector(L) {
    const R = L.in;
    uiRRect(R.x, R.y, R.w, R.h, 7, [0.125, 0.135, 0.155]);
    uiRRectStroke(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, 7, [0.26, 0.28, 0.32], 1, 1);
    const total = MM.allMappings().length;
    uiText("MAPPINGS", R.x + 8, R.y + 12, 7, UI_ORANGE, 1, true);
    uiTextR(String(total), R.x + R.w - 8, R.y + 12, 7, [0.6, 0.63, 0.68]);
    uiLine(R.x + 4, R.y + 15, R.x + R.w - 4, R.y + 15, [0.24, 0.26, 0.3], 1, 1);
    const vis = uiInspVisible(R);
    const hov = uiInspHit(uiMx, uiMy, L);
    let hudText = total + " mapping" + (total === 1 ? "" : "s") + " | click curve to cycle";
    for (const r of vis.rows) {
        const it = r.item;
        const m0 = MM.state.mods[it.i];
        const col = UI_TYPE_COL[m0.type];
        if (it.kind === "head") {
            uiRect(R.x + 3, r.y + 1, R.w - 6, r.h - 2, [0.17, 0.18, 0.21]);
            uiDot(R.x + 9, r.y + 7.5, 2.5, col);
            uiText(uiFit(m0.name, R.w - 70, 7.5), R.x + 16, r.y + 10.5, 7.5, [0.9, 0.92, 0.95], 1, true);
            const ar = uiHeadArrowRect(R, r.y);
            const armed = MM.learn.armed && MM.learn.mod === it.i;
            uiArrow(ar.x, ar.y, armed, armed && MM.learn.multi, hov && hov.kind === "harrow" && hov.i === it.i);
            uiTextR(String(MM.mappingsFor(it.i).length), ar.x - 3, r.y + 10.5, 7, [0.6, 0.63, 0.68]);
        } else if (it.kind === "none") {
            uiText("no mappings - click the arrow", R.x + 18, r.y + 9, 6.5, [0.42, 0.45, 0.5]);
        } else {
            const m = it.m;
            const P = uiRowParts(R, r.y);
            const status = MM.mappingStatus(m.id);
            const miss = status === "missing";
            const dis = status === "disabled" || !m.enabled;
            const a = miss ? 0.6 : dis ? 0.45 : 1;
            const rowHov = hov && hov.m && hov.m.id === m.id;
            if (rowHov) uiRect(R.x + 3, r.y, R.w - 6, r.h, [0.18, 0.19, 0.22]);
            if (miss) uiRect(R.x + 3, r.y, R.w - 6, r.h, UI_RED, 0.08);
            const delHot = rowHov && hov.kind === "del";
            uiText("×", P.del.x + 2, r.y + 10.5, 9, delHot ? UI_RED : [0.6, 0.63, 0.68], a, true);
            const nm = m.target.paramName || m.target.name || "?";
            uiText(uiFit(nm, P.name.w, 7.5), P.name.x, r.y + 10, 7.5, miss ? UI_RED : [0.84, 0.86, 0.9], a);
            uiCurveGlyph(m, P.curve.x, P.curve.y, P.curve.w, P.curve.h, rowHov && hov.kind === "curve" ? [1, 1, 1] : [0.6, 0.64, 0.7], a);
            const remote = m.mode === "remote";
            uiTextR(uiValueText(m), P.val.x + P.val.w, r.y + 10, 7.5, UI_ORANGE, a, true);
            uiRRect(P.mode.x, P.mode.y, P.mode.w, P.mode.h, 3, remote ? UI_CYAN : [0.22, 0.24, 0.28], remote ? 0.85 : 1);
            uiTextC(remote ? "R" : "M", P.mode.x + P.mode.w / 2, P.mode.y + 8, 6.5, remote ? [0.05, 0.1, 0.14] : [0.7, 0.73, 0.78], 1, true);
            if (rowHov) {
                const t = m.target;
                hudText = (t.trackName || "?") + " > " + (t.deviceName || "?") + " > " + nm + (miss ? "  (missing)" : "");
            }
        }
    }
    // scrollbar
    if (vis.total > vis.rows.length) {
        const ah = vis.area.h;
        const th = Math.max(8, (ah * vis.rows.length) / vis.total);
        const ty = vis.area.y + ((ah - th) * vis.first) / Math.max(1, vis.total - vis.rows.length);
        uiRRect(R.x + R.w - 4, ty, 2, th, 1, [0.5, 0.53, 0.58], 0.8);
    }
    // footer HUD
    uiLine(R.x + 4, R.y + R.h - 15, R.x + R.w - 4, R.y + R.h - 15, [0.24, 0.26, 0.3], 1, 1);
    uiText(uiFit(hudText, R.w - 14, 6.5), R.x + 7, R.y + R.h - 5, 6.5, [0.62, 0.65, 0.7]);
}

// ------------------------------------------------------------------ paint
function paint() {
    const W = mgraphics.size[0];
    const H = mgraphics.size[1];
    uiCtl = [];
    const L = uiLayout();
    const tel = uiTel();
    uiRect(0, 0, W, H, [0.09, 0.10, 0.12]);
    if (!L.slots.length) {
        uiText("Add a modulator,", UI_PAD + UI_TILE + UI_GAP + 8, 66, 8, [0.5, 0.54, 0.6]);
        uiText("then map it with the arrow", UI_PAD + UI_TILE + UI_GAP + 8, 78, 8, [0.5, 0.54, 0.6]);
    }
    for (let t = 0; t < L.tiles; t++) uiPaintTile(t, L, tel);
    if (L.ed) uiPaintEditor(L, tel);
    if (L.in) uiPaintInspector(L);
    uiPaintInspBtn(L);
    if (uiMenu) uiPaintMenu(L);
}

// ------------------------------------------------------------------ model hooks
function uiRequest() {
    const w = uiWidth();
    if (w !== uiLastW) {
        uiLastW = w;
        MM.requestWidth(w);
    }
}

function uiReady() {
    uiRequest();
}

function uiChanged(ev) {
    if (ev.kind === "load" || ev.kind === "mods" || ev.kind === "ui") uiRequest();
    if (ev.kind === "mods" && uiMenu) uiMenu = null;
}

function uiTelemetry(frame) {
    uiFrame++;
    const t = frame || MM.readTelemetry();
    for (let i = 0; i < MAX_MODS; i++) {
        if (!MM.state.mods[i]) { if (uiHist[i].length) uiHist[i] = []; continue; }
        const h = uiHist[i];
        h.push(clamp(t.mods[i].u, 0, 1));
        if (h.length > UI_HIST) h.shift();
    }
    mgraphics.redraw();
}

// ------------------------------------------------------------------ interaction
function uiSetExp(i) {
    MM.setUI({ exp: i });
}

function uiLearnClick(i, shift) {
    const l = MM.learn;
    if (l.armed && l.mod === i && (!!l.multi === !!shift || !shift)) { MM.disarmLearn(); return; }
    if (l.armed && l.mod === i && shift && !l.multi) { MM.armLearn(i, true); return; }
    MM.armLearn(i, !!shift);
}

function uiCycleCurve(m) {
    MM.updateMapping(m.id, { curve: (m.curve + 1) % CURVE_NAMES.length });
    MM.commit();
}

function onidle(x, y) {
    uiMx = x;
    uiMy = y;
    mgraphics.redraw();
}

function onidleout() {
    uiMx = -1;
    uiMy = -1;
    mgraphics.redraw();
}

function uiMakeInspDrag(h, x, y) {
    const m = MM.getMapping(h.m.id);
    if (!m) return null;
    if (h.kind === "val") {
        const remote = m.mode === "remote";
        const which = remote ? (x < h.rect.x + h.rect.w / 2 ? "min" : "max") : "amount";
        const v0 = m[which];
        const lo = which === "amount" ? -1 : 0;
        return {
            onDrag(mx, my, sx, sy, shift) {
                const d = ((mx - sx) - (my - sy)) / (shift ? 400 : 90);
                const patch = {};
                patch[which] = clamp(v0 + d, lo, 1);
                if (which === "min") patch.min = Math.min(patch.min, m.max);
                if (which === "max") patch.max = Math.max(patch.max, m.min);
                MM.updateMapping(m.id, patch);
            },
        };
    }
    if (h.kind === "curve") {
        const a0 = m.curveAmt;
        return {
            onDrag(mx, my, sx, sy) {
                if (Math.abs(my - sy) < 2) return;
                MM.updateMapping(m.id, { curveAmt: clamp(a0 + (sy - my) / 50, 0, 1) });
            },
        };
    }
    return null;
}

function onclick(x, y, but, cmd, shift, caps, opt, ctrl) {
    uiMx = x;
    uiMy = y;
    uiDrag = null;
    const L = uiLayout();
    const rightClick = but === 2 || !!ctrl;
    // popup menu swallows the click
    if (uiMenu) {
        const R = uiMenuRect(L);
        uiMenu = null;
        if (uiIn(x, y, R)) {
            const k = Math.floor((y - R.y - 14) / UI_MENU_ROW);
            if (k >= 0 && k < UI_ADD_TYPES.length) {
                const s = MM.addModulator(UI_ADD_TYPES[k]);
                if (s >= 0 && !shift) { /* keep the editor where it is */ }
            }
        }
        mgraphics.redraw();
        return;
    }
    const g = uiGridHit(x, y, L);
    if (g) {
        if (g.kind === "insp") { MM.setUI({ insp: L.insp ? 0 : 1 }); return; }
        if (g.kind === "plus") { if (MM.learn.armed) MM.disarmLearn(); uiMenu = {}; mgraphics.redraw(); return; }
        if (g.kind === "arrow") { uiLearnClick(g.slot, !!shift); return; }
        if (g.kind === "del" || (g.kind === "tile" && rightClick)) {
            if (MM.state.ui.exp === g.slot) MM.setUI({ exp: -1 });
            MM.removeModulator(g.slot);
            return;
        }
        if (MM.learn.armed) MM.disarmLearn();
        mgraphics.redraw();
        return;
    }
    // inspector
    const h = uiInspHit(x, y, L);
    if (h) {
        if (h.kind === "harrow") { uiLearnClick(h.i, !!shift); return; }
        if (MM.learn.armed && h.kind !== "blank") MM.disarmLearn();
        if (h.kind === "del") { MM.deleteMapping(h.m.id); return; }
        if (h.kind === "mode") { MM.updateMapping(h.m.id, { mode: h.m.mode === "remote" ? "mod" : "remote" }); MM.commit(); return; }
        if (h.kind === "curve") {
            if (opt) { MM.updateMapping(h.m.id, { invert: h.m.invert ? 0 : 1 }); MM.commit(); }
            else uiCycleCurve(h.m);
            uiDrag = uiMakeInspDrag(h, x, y);
            if (uiDrag) { uiDrag.sx = x; uiDrag.sy = y; }
            return;
        }
        if (h.kind === "val") {
            if (cmd) { MM.updateMapping(h.m.id, { bipolar: h.m.bipolar ? 0 : 1 }); MM.commit(); return; }
            uiDrag = uiMakeInspDrag(h, x, y);
            if (uiDrag) { uiDrag.sx = x; uiDrag.sy = y; }
            return;
        }
        if (h.kind === "name") { MM.updateMapping(h.m.id, { enabled: h.m.enabled ? 0 : 1 }); MM.commit(); }
        return;
    }
    // editor widgets
    if (L.ed && uiIn(x, y, L.ed)) {
        if (MM.learn.armed) MM.disarmLearn();
        const c = uiCtlAt(x, y);
        if (c) {
            if (c.onDown) c.onDown(x, y, !!shift);
            uiDrag = c.onDrag ? { onDrag: c.onDrag, sx: x, sy: y } : null;
        }
        mgraphics.redraw();
        return;
    }
    if (MM.learn.armed) MM.disarmLearn();
}

function ondrag(x, y, but, cmd, shift) {
    uiMx = x;
    uiMy = y;
    if (!uiDrag) return;
    if (!but) {
        uiDrag = null;
        MM.commit();
        mgraphics.redraw();
        return;
    }
    if (uiDrag.onDrag) uiDrag.onDrag(x, y, uiDrag.sx, uiDrag.sy, !!shift);
    mgraphics.redraw();
}

function ondblclick(x, y) {
    const L = uiLayout();
    const g = uiGridHit(x, y, L);
    if (g) {
        if (g.kind === "tile") MM.setUI({ exp: L.exp === g.slot ? -1 : g.slot });
        return;
    }
    if (L.ed && uiIn(x, y, L.ed)) {
        const c = uiCtlAt(x, y);
        if (c && c.onDbl) c.onDbl(x, y);
    }
}

function onwheel(x, y, dx, dy) {
    const L = uiLayout();
    if (!L.in || !uiIn(x, y, L.in)) return;
    const items = uiInspItems();
    const maxS = uiInspMaxScroll(items, uiInspArea(L.in));
    const cur = uiUI().scroll;
    const next = clamp(cur + (dy > 0 ? -1 : 1), 0, maxS);
    if (next !== cur) MM.setUI({ scroll: next });
}

function onkeydown(keycode) {
    if (keycode === 27 || keycode === 0x1b) {
        if (uiMenu) uiMenu = null;
        if (MM.learn.armed) MM.disarmLearn();
        mgraphics.redraw();
    }
}

// ------------------------------------------------------------------ preview
function preview() {
    MM.demo();
    const s = MM.state;
    const tel = MM.readTelemetry();
    const adds = [
        [0, "Resonance", "Wavetable", "Lead", CURVE_EXP, "mod"],
        [0, "Filter Freq", "Auto Filter", "Bass", CURVE_S, "remote"],
        [1, "Dry/Wet", "Reverb", "Pads", CURVE_LOG, "mod"],
        [2, "Osc 2 Pitch", "Operator", "Keys", CURVE_STEPPED, "mod"],
        [3, "Feedback", "Echo", "Drums", CURVE_LINEAR, "mod"],
        [4, "Macro 1", "Instrument Rack", "A Very Long Track Name", CURVE_LINEAR, "remote"],
    ];
    for (let k = 0; k < adds.length; k++) {
        const a = adds[k];
        const mp = defaultMapping(s.nextMapId++, a[0], { path: "live_set tracks " + k + " devices 0 parameters " + (k + 3), paramName: a[1], deviceName: a[2], trackName: a[3] });
        mp.curve = a[4];
        mp.curveAmt = 0.5 + 0.1 * k;
        mp.curveSteps = 5;
        mp.mode = a[5];
        mp.amount = 0.3 + 0.12 * k - (k === 3 ? 1 : 0);
        mp.min = 0.1 * k;
        mp.max = 0.55 + 0.07 * k;
        if (k === 2) mp.invert = 1;
        if (k === 4) mp.enabled = 0;
        s.mappings.push(mp);
    }
    s.mods[0].name = "LFO 1";
    s.mods[3].p.steps = 12;
    for (let i = 0; i < 5; i++) {
        uiHist[i] = [];
        for (let k = 0; k < UI_HIST; k++) {
            let v = 0.5 + 0.4 * Math.sin(k * 0.3 + i);
            if (i === 1) v = Math.max(0, 0.15 + 0.7 * Math.abs(Math.sin(k * 0.22)) * Math.exp(-((k % 14) / 9)));
            if (i === 2) v = [0.2, 0.8, 0.45, 0.7, 0.3, 0.9, 0.15][Math.floor(k / 6) % 7];
            uiHist[i].push(clamp(v, 0, 1));
        }
        tel.mods[i].u = uiHist[i][UI_HIST - 1];
        tel.mods[i].out = tel.mods[i].u * 2 - 1;
    }
    tel.mods[0].phase = 0.31;
    tel.mods[0].u = uiModCurveU(s.mods[0], 0.31);
    tel.mods[3].phase = 0.37;
    tel.mods[4].phase = 0.62;
    tel.mods[4].u = uiModCurveU(s.mods[4], 0.62);
    MM.armLearn(1, true);
    s.ui = { exp: 0, insp: 1, scroll: 0 };
    uiMx = 40;
    uiMy = 40;
}
