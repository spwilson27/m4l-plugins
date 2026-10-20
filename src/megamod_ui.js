// Mega Modulator — UI ("Rack Strips": one channel strip per modulator, plus a mapping list and remap editor).
// Uses ONLY the mgraphics subset listed in the API CONTRACT (src/megamod_config.js).
// Prepended: header (mgraphics init) + megamod_config.js + megamod_mapper.js.
//
// Layout: [rail 20px] [strip 56px | expanded strip 204px]... [+ strip]   or, in Mapping-list mode,
// [rail] [Bitwig-style mapping list, 172px] [remap editor for the selected row, 138px].
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
const UB_DETAIL_W = 138;
const UB_ROW_HEAD = 15;
const UB_ROW_MAP = 14;
const UB_ROW_NONE = 12;
const UB_FULL_FRAMES = 75; // "mapping pool full" pill lifetime in telemetry frames (~2.5 s)
const UB_ORANGE = [0.98, 0.62, 0.18];
const UB_CYAN = [0.30, 0.85, 0.95];
const UB_RED = [0.95, 0.32, 0.32];
const UB_TYPES = [MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG];
const UB_HIST = 200;

var ubDrag = null;
var ubHover = null; // {x, y, hit}
var ubLatch = false;
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
    const dx = lx + UB_LIST_W + UB_LIST_GAP;
    return { lx, lw: UB_LIST_W, dx, dw: UB_DETAIL_W, end: dx + UB_DETAIL_W };
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
        R.viz = [x + 4, 19, 38, 44];
        R.meter = [x + 45, 19, 7, 68];
        for (let k = 0; k < 2; k++) {
            const cx = x + 14 + 19 * k;
            R.knobs.push({ spec: specs[k], cx, cy: 77, r: 8, hit: [cx - 9.5, 66, 19, 43], valY: 97, labY: 106 });
        }
        R.count = [x + 4, 112, 48, 12];
        R.map = { cx: x + w / 2, cy: 142, r: 11 };
    } else {
        R.name = [x + 17, 0, w - 17 - 38 - 46, 17];
        R.type = [x + w - 36 - 46, 2, 44, 13];
        R.del = [x + w - 36, 1, 16, 15];
        R.collapse = [x + w - 19, 1, 16, 15];
        R.viz = [x + 4, 18, w - 18, 68];
        R.meter = [x + w - 11, 18, 7, 68];
        let cxp = x + 4;
        for (const c of ubChips(mod)) {
            R.chips.push(Object.assign({ rect: [cxp, 89, c.w, 12] }, c));
            cxp += c.w + 3;
        }
        const step = Math.min(46, (w - 8) / specs.length);
        for (let k = 0; k < specs.length; k++) {
            const cx = x + 4 + step * (k + 0.5);
            R.knobs.push({ spec: specs[k], cx, cy: 113, r: 8, hit: [cx - step / 2, 102, step, 41], valY: 131, labY: 140 });
        }
        R.map = { cx: x + 14, cy: 152, r: 7 };
        R.count = [x + 26, 146, 44, 12];
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
        del: [x + 3, y + 1, 11, 12],
        name: [x + 16, y + 1, 68, 12],
        curve: [x + 87, y + 2, 15, 10],
        val: [x + 106, y + 1, 44, 12],
        mode: [x + 152, y + 2, 15, 10],
    };
}
function ubHeadArrowRect(y) {
    const g = ubListGeom();
    return [g.lx + g.lw - 33, y, 26, 14];
}
function ubPbSelMapping() {
    const id = ubUIs().pbSel;
    return id ? MM.getMapping(id) : null;
}
function ubValueText(m) {
    if (m.mode === "remote") return Math.round(m.min * 100) + ".." + Math.round(m.max * 100);
    const a = Math.round(m.amount * 100);
    return (a > 0 ? "+" : "") + a + "%";
}
function ubTargetPath(m) {
    const t = m.target;
    return (t.trackName || "?") + " > " + (t.deviceName || "?") + " > " + (t.paramName || t.name || "?");
}

// detail panel controls: [{id, rect}]
function ubDetailRects(gm, m) {
    const x = gm.dx;
    const w = gm.dw;
    const out = [];
    out.push({ id: "preview", rect: [x, 36, w, 46] });
    for (let k = 0; k < 5; k++) out.push({ id: "curve" + k, rect: [x + k * 27, 85, 24, 14], curve: k });
    out.push({ id: "camt", rect: [x, 103, w, 11] });
    if (m && m.mode === "remote") {
        out.push({ id: "min", rect: [x, 116, w, 11] });
        out.push({ id: "max", rect: [x, 129, w, 11] });
    } else {
        out.push({ id: "amt", rect: [x, 116, w, 11] });
    }
    out.push({ id: "inv", rect: [x, 144, 30, 15] });
    out.push({ id: "bip", rect: [x + 33, 144, 30, 15] });
    out.push({ id: "mode", rect: [x + 66, 144, 48, 15] });
    out.push({ id: "del", rect: [x + 117, 144, 21, 15] });
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
    if (ubIn(rr.learn, x, y)) return { kind: "rail_learn", tip: ubLatch ? "Learn latch ON: touch Live params to map to the selected strip" : "Learn latch: map every touched param to the selected strip" };
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
        const mp = R.map;
        if ((x - mp.cx) * (x - mp.cx) + (y - mp.cy) * (y - mp.cy) <= (mp.r + 1) * (mp.r + 1)) {
            return { kind: "map", slot, tip: "Map: click = single, Shift-click = multi-learn" };
        }
        if (ubIn(R.viz, x, y)) return { kind: "viz", slot, rect: R.viz, tip: g.exp ? "" : "Double-click to expand" };
        if (ubIn(R.meter, x, y)) return { kind: "meter", slot };
        return { kind: "body", slot, tip: g.exp ? "" : "Double-click to expand" };
    }
    return { kind: "none" };
}
function ubHitList(x, y) {
    const gm = ubListGeom();
    if (x >= gm.dx - 3) {
        const m = ubPbSelMapping();
        if (m) {
            for (const d of ubDetailRects(gm, m)) if (ubIn(d.rect, x, y)) return { kind: "detail", id: d.id, rect: d.rect, curve: d.curve, tip: "" };
        }
        return { kind: "detail_bg" };
    }
    if (x < gm.lx || x >= gm.lx + gm.lw) return { kind: "list_bg" };
    for (const r of ubListVisible().rows) {
        if (y < r.y || y >= r.y + r.h) continue;
        const it = r.item;
        if (it.kind === "head") {
            if (ubIn(ubHeadArrowRect(r.y), x, y)) return { kind: "ls_harrow", slot: it.i, tip: "Map: click = single, Shift-click = multi-learn" };
            return { kind: "ls_head", slot: it.i, tip: MM.state.mods[it.i].name };
        }
        if (it.kind === "none") return { kind: "ls_none", slot: it.i, tip: "Click the arrow to map a parameter" };
        const P = ubRowParts(r.y);
        const base = { slot: it.i, m: it.m, tip: ubTargetPath(it.m) };
        for (const k of ["del", "curve", "val", "mode"]) {
            if (ubIn(P[k], x, y)) return Object.assign({ kind: "ls_" + k, rect: P[k] }, base, { tip: { del: "Delete mapping", curve: "Click = next curve", val: "Drag = amount / range", mode: "Mod / Remote" }[k] });
        }
        return Object.assign({ kind: "ls_row" }, base);
    }
    return { kind: "list_bg" };
}

// ------------------------------------------------------------------ actions
function ubSelect(slot) {
    if (!ubValidSlot(slot) || ubSel() === slot) return;
    MM.setUI({ sel: slot });
    if (ubLatch) MM.armLearn(slot, true); // latch retargets learning to the new selection
}
function ubToggleLatch() {
    if (ubLatch) {
        ubLatch = false;
        MM.disarmLearn();
        return;
    }
    let s = ubSel();
    if (s < 0) {
        const o = ubOrder();
        if (!o.length) return;
        s = o[0];
        MM.setUI({ sel: s });
    }
    ubLatch = true;
    MM.armLearn(s, true);
}
function ubMapClick(slot, shift) {
    ubLatch = false;
    const L = MM.learn;
    if (L.armed && L.mod === slot && !!L.multi === !!shift) { MM.disarmLearn(); return; }
    MM.armLearn(slot, !!shift);
}
function ubAddType(type) {
    const slot = MM.addModulator(type);
    if (slot >= 0) {
        const o = ubOrder();
        MM.setUI({ order: o, sel: slot });
        if (ubLatch) MM.armLearn(slot, true);
        ubSyncWidth();
    }
    return slot;
}
function ubSetExpanded(slot) {
    MM.setUI({ exp: slot, sel: slot >= 0 ? slot : ubSel() });
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
        case "rail_learn": ubToggleLatch(); break;
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
        case "map": ubSelect(h.slot); ubMapClick(h.slot, shift); break;
        case "viz": ubSelect(h.slot); ubVizClick(h, x, y); break;
        case "meter":
        case "body": ubSelect(h.slot); break;
        case "ls_harrow": ubSelect(h.slot); ubMapClick(h.slot, shift); break;
        case "ls_head": ubSelect(h.slot); break;
        case "ls_none": ubSelect(h.slot); break;
        case "ls_row": case "ls_del": case "ls_curve": case "ls_val": case "ls_mode": ubListRowClick(h, x, y, opt); break;
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
            const patch = {};
            patch[d.which] = clamp(d.v0 + dv, d.which === "amount" ? -1 : 0, 1);
            if (d.which === "min") patch.min = Math.min(patch.min, m.max);
            if (d.which === "max") patch.max = Math.max(patch.max, m.min);
            MM.updateMapping(d.id, patch);
            d.dirty = true;
        }
    } else if (d.kind === "dbar") {
        ubApplyBar(d.id, d.rect, x, d.mapId);
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
            if (h.id === "amt" || h.id === "min" || h.id === "max" || h.id === "camt") ubResetBar(h.id);
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
    if (mod.type === MOD_MSEG) ubMsegClick(h.slot, r, x, y);
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
    if (mod.type === MOD_MSEG) ubMsegDbl(h.slot, h.rect, x, y);
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

// MSEG editor: drag points, drag a segment's centre handle to bend it, double-click to add/delete a point
function ubMsegXY(r, p) {
    return [r[0] + 2 + p.x * (r[2] - 4), r[1] + 3 + (1 - p.y) * (r[3] - 6)];
}
function ubMsegHit(slot, r, x, y) {
    const pts = MM.state.mods[slot].points;
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
function ubMsegClick(slot, r, x, y) {
    const mod = MM.state.mods[slot];
    const hit = ubMsegHit(slot, r, x, y);
    if (hit.type === "point") ubDrag = { kind: "mseg", mode: "point", slot, rect: r, i: hit.i, dirty: false };
    else if (hit.type === "seg") ubDrag = { kind: "mseg", mode: "seg", slot, rect: r, i: hit.i, y0: y, c0: mod.points[hit.i].curve || 0, dirty: false };
}
function ubMsegDrag(d, x, y) {
    const pts = MM.state.mods[d.slot].points.map((p) => ({ x: p.x, y: p.y, curve: p.curve, sCurve: p.sCurve }));
    const r = d.rect;
    if (d.mode === "point") {
        const p = pts[d.i];
        p.y = clamp(1 - (y - r[1] - 3) / (r[3] - 6), 0, 1);
        if (d.i > 0 && d.i < pts.length - 1) {
            p.x = clamp((x - r[0] - 2) / (r[2] - 4), pts[d.i - 1].x + 0.002, pts[d.i + 1].x - 0.002);
        }
    } else {
        const a = pts[d.i];
        const b = pts[d.i + 1];
        const dir = b.y >= a.y ? 1 : -1;
        a.curve = clamp(d.c0 + (dir * (d.y0 - y)) / ((r[3] - 6) * 0.5), -1, 1);
    }
    MM.setMsegPoints(d.slot, pts);
    d.dirty = true;
}
function ubMsegDbl(slot, r, x, y) {
    const hit = ubMsegHit(slot, r, x, y);
    const pts = MM.state.mods[slot].points.map((p) => ({ x: p.x, y: p.y, curve: p.curve, sCurve: p.sCurve }));
    if (hit.type === "point") {
        if (hit.i === 0 || hit.i === pts.length - 1) return;
        pts.splice(hit.i, 1);
    } else if (hit.type === "seg") {
        pts[hit.i].curve = 0;
    } else {
        const nx = clamp((x - r[0] - 2) / (r[2] - 4), 0.01, 0.99);
        const ny = clamp(1 - (y - r[1] - 3) / (r[3] - 6), 0, 1);
        pts.push({ x: nx, y: ny, curve: 0, sCurve: 0 });
    }
    MM.setMsegPoints(slot, pts);
}

// ------------------------------------------------------------------ mapping-list interactions
function ubListRowClick(h, x, y, opt) {
    const m = MM.getMapping(h.m.id);
    if (!m) return;
    ubSelect(h.slot);
    if (h.kind === "ls_del") {
        MM.deleteMapping(m.id);
        if (ubUIs().pbSel === m.id) MM.setUI({ pbSel: 0 });
        return;
    }
    MM.setUI({ pbSel: m.id });
    if (h.kind === "ls_mode") MM.updateMapping(m.id, { mode: m.mode === "remote" ? "mod" : "remote" });
    else if (h.kind === "ls_curve") {
        if (opt) MM.updateMapping(m.id, { invert: m.invert ? 0 : 1 });
        else MM.updateMapping(m.id, { curve: (m.curve + 1) % CURVE_NAMES.length });
    } else if (h.kind === "ls_val") {
        const which = m.mode === "remote" ? (x < h.rect[0] + h.rect[2] / 2 ? "min" : "max") : "amount";
        ubDrag = { kind: "lval", id: m.id, which, v0: m[which], x, y, dirty: false };
    }
}
function ubListReveal(mapId, slot) {
    const items = ubListItems();
    let idx = -1;
    for (let k = 0; k < items.length; k++) if ((mapId && items[k].kind === "map" && items[k].m.id === mapId) || (!mapId && items[k].kind === "head" && items[k].i === slot)) { idx = k; break; }
    if (idx >= 0) MM.setUI({ pbScroll: clamp(idx - 1, 0, ubListMaxScroll(items)) });
}
function ubBarValue(id, rect, x) {
    const t = clamp((x - rect[0]) / rect[2], 0, 1);
    if (id === "amt") return t * 2 - 1;
    return t;
}
function ubApplyBar(id, rect, x, mapId) {
    const m = MM.getMapping(mapId);
    if (!m) return;
    const v = ubBarValue(id, rect, x);
    if (id === "amt") MM.updateMapping(m.id, { amount: v });
    else if (id === "min") MM.updateMapping(m.id, { min: v });
    else if (id === "max") MM.updateMapping(m.id, { max: v });
    else if (id === "camt") {
        if (m.curve === CURVE_STEPPED) MM.updateMapping(m.id, { curveSteps: 2 + Math.round(v * 14) });
        else MM.updateMapping(m.id, { curveAmt: v });
    }
}
function ubResetBar(id) {
    const m = ubPbSelMapping();
    if (!m) return;
    const d = defaultMapping(1, 0, {});
    if (id === "amt") MM.updateMapping(m.id, { amount: d.amount });
    else if (id === "min") MM.updateMapping(m.id, { min: 0 });
    else if (id === "max") MM.updateMapping(m.id, { max: 1 });
    else MM.updateMapping(m.id, { curveAmt: d.curveAmt, curveSteps: d.curveSteps });
}
function ubDetailClick(h, x, y) {
    const m = ubPbSelMapping();
    if (!m) return;
    const id = h.id;
    if (id.indexOf("curve") === 0) MM.updateMapping(m.id, { curve: Number(id.slice(5)) });
    else if (id === "inv") MM.updateMapping(m.id, { invert: m.invert ? 0 : 1 });
    else if (id === "bip") { if (m.mode !== "remote") MM.updateMapping(m.id, { bipolar: m.bipolar ? 0 : 1 }); }
    else if (id === "mode") MM.updateMapping(m.id, { mode: x < h.rect[0] + h.rect[2] / 2 ? "mod" : "remote" });
    else if (id === "del") { MM.deleteMapping(m.id); MM.setUI({ pbSel: 0 }); }
    else if (id === "amt" || id === "min" || id === "max" || id === "camt") {
        ubDrag = { kind: "dbar", id, rect: h.rect, mapId: m.id, dirty: true };
        ubApplyBar(id, h.rect, x, m.id);
    }
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
    for (let i = 0; i <= 14; i++) {
        const u = i / 14;
        pts.push([x + w * u, y + h * (1 - shapeCurve(u, type, 0.5, 4))]);
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
function ubPowerButton(R, mod, c, hot) {
    const cx = R.icon[0] + 7;
    const cy = R.icon[1] + 6.5;
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
function ubMapButton(R, slot, c) {
    const mp = R.map;
    const armed = MM.learn.armed && MM.learn.mod === slot;
    const multi = armed && MM.learn.multi;
    ubCircle(mp.cx, mp.cy, mp.r, armed ? UB_CYAN : [0.17, 0.18, 0.21], 1, true);
    ubCircle(mp.cx, mp.cy, mp.r, armed ? UB_CYAN : [0.32, 0.55, 0.62], 1, false, 1.2);
    if (multi) ubCircle(mp.cx, mp.cy, mp.r + 2.5, UB_CYAN, 0.55, false, 1.2);
    const ic = armed ? [0.05, 0.08, 0.1] : UB_CYAN;
    const k = mp.r / 11;
    ubCircle(mp.cx, mp.cy, 4.5 * k + 0.3, ic, 1, false, 1.2);
    ubCircle(mp.cx, mp.cy, 1.4, ic, 1, true);
    ubLine(mp.cx, mp.cy - 7.5 * k, mp.cx, mp.cy - 3.5 * k, ic, 1, 1);
    ubLine(mp.cx, mp.cy + 3.5 * k, mp.cx, mp.cy + 7.5 * k, ic, 1, 1);
    ubLine(mp.cx - 7.5 * k, mp.cy, mp.cx - 3.5 * k, mp.cy, ic, 1, 1);
    ubLine(mp.cx + 3.5 * k, mp.cy, mp.cx + 7.5 * k, mp.cy, ic, 1, 1);
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
    // count chip + map button
    const cnt = MM.mappingsFor(slot).length;
    ubRR(R.count[0], R.count[1], R.count[2], R.count[3], 5, cnt ? UB_CYAN : [0.2, 0.21, 0.24], cnt ? 0.16 : 1);
    ubRRStroke(R.count[0] + 0.5, R.count[1] + 0.5, R.count[2] - 1, R.count[3] - 1, 5, cnt ? UB_CYAN : [0.3, 0.32, 0.37], 1, 1);
    ubTextC(cnt + (cnt === 1 ? " map" : " maps"), R.count[0] + R.count[2] / 2, R.count[1] + 9, 7, cnt ? UB_CYAN : [0.55, 0.57, 0.62], 1);
    ubMapButton(R, slot, c);
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

function ubPaintRail() {
    ubRR(0, 0, UB_RAIL, 161, 5, [0.1, 0.108, 0.125], 1);
    const rr = ubRailRects();
    ubIconButton(rr.learn, ubLatch, UB_CYAN);
    ubLearnIcon(rr.learn, ubLatch, ubLatch ? UB_CYAN : [0.6, 0.64, 0.7]);
    ubTextC("LRN", UB_RAIL / 2, 31, 6, ubLatch ? UB_CYAN : [0.5, 0.53, 0.58], 1);
    ubIconButton(rr.list, ubPb(), UB_ORANGE);
    ubListIcon(rr.list, ubPb() ? UB_ORANGE : [0.6, 0.64, 0.7]);
    ubTextC("LST", UB_RAIL / 2, 67, 6, ubPb() ? UB_ORANGE : [0.5, 0.53, 0.58], 1);
    ubTextC(String(MM.modCount()), UB_RAIL / 2, 143, 7, [0.75, 0.77, 0.82], 1);
    ubLine(4, 147, UB_RAIL - 4, 147, [0.3, 0.32, 0.36], 1, 1);
    ubTextC("16", UB_RAIL / 2, 156, 7, [0.45, 0.47, 0.52], 1);
}

// ------------------------------------------------------------------ painting: patchbay
function ubPaintCurvePreview(r, m, mod) {
    ubRR(r[0], r[1], r[2], r[3], 3, [0.075, 0.085, 0.1], 1);
    const ix = r[0] + 3;
    const iy = r[1] + 3;
    const iw = r[2] - 6;
    const ih = r[3] - 6;
    ubLine(ix, iy + ih, ix + iw, iy, [0.2, 0.22, 0.26], 1, 1);
    ubLine(ix, iy + ih / 2, ix + iw, iy + ih / 2, [0.15, 0.16, 0.19], 1, 1);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        let v = shapeCurve(u, m.curve, m.curveAmt, m.curveSteps);
        if (m.invert) v = 1 - v;
        pts.push([ix + iw * u, iy + ih * (1 - v)]);
    }
    if (m.mode === "remote") {
        ubRect(ix, iy + ih * (1 - Math.max(m.min, m.max)), iw, Math.max(1, ih * Math.abs(m.max - m.min)), UB_ORANGE, 0.12);
    }
    ubPoly(pts, UB_ORANGE, 1, 1.6);
    const out = ubTel(m.mod).out;
    const u = clamp((out + 1) / 2, 0, 1);
    let v = shapeCurve(u, m.curve, m.curveAmt, m.curveSteps);
    if (m.invert) v = 1 - v;
    ubLine(ix + iw * u, iy, ix + iw * u, iy + ih, ubModCol(mod), 0.5, 1);
    ubCircle(ix + iw * u, iy + ih * (1 - v), 2.6, [1, 1, 1], 1, true);
}
function ubPaintBar(r, label, text, n01, c, bipolar, dim) {
    ubRR(r[0], r[1], r[2], r[3], 2, [0.075, 0.085, 0.1], 1);
    if (bipolar) {
        const mid = r[0] + r[2] / 2;
        const x1 = r[0] + n01 * r[2];
        ubRect(Math.min(mid, x1), r[1] + 1, Math.max(1, Math.abs(x1 - mid)), r[3] - 2, c, dim ? 0.25 : 0.7);
        ubLine(mid, r[1], mid, r[1] + r[3], [0.5, 0.52, 0.56], 1, 1);
    } else {
        ubRect(r[0], r[1] + 1, Math.max(1, n01 * r[2]), r[3] - 2, c, dim ? 0.25 : 0.7);
    }
    ubText(label, r[0] + 3, r[1] + 8.5, 7, [0.9, 0.92, 0.95], dim ? 0.5 : 1);
    ubText(text, r[0] + r[2] - ubTextW(text, 7) - 3, r[1] + 8.5, 7, UB_ORANGE, dim ? 0.5 : 1);
}
function ubPaintDetail(gm) {
    const m = ubPbSelMapping();
    const x = gm.dx;
    const w = gm.dw;
    ubLine(x - 3, 2, x - 3, 159, [0.22, 0.24, 0.28], 1, 1);
    if (!m) {
        ubTextC("Select a row", x + w / 2, 70, 8, [0.6, 0.63, 0.68], 1);
        ubTextC("to edit its curve,", x + w / 2, 82, 7, [0.45, 0.47, 0.52], 1);
        ubTextC("range & mode", x + w / 2, 91, 7, [0.45, 0.47, 0.52], 1);
        ubTextC(MM.allMappings().length + " mappings", x + w / 2, 110, 8, UB_CYAN, 1);
        return;
    }
    const mod = MM.state.mods[m.mod];
    const c = ubModCol(mod);
    const st = MM.mappingStatus(m.id);
    ubText(ubFit(m.target.paramName || m.target.name, w, 8), x, 9, 8, st === "missing" ? UB_RED : [0.92, 0.94, 0.97], 1);
    ubText(ubFit((m.target.trackName || "?") + " / " + (m.target.deviceName || "?"), w, 7), x, 19, 7, [0.55, 0.58, 0.64], 1);
    ubCircle(x + 3, 28.5, 2.8, c, 1, true);
    ubText(ubFit(mod.name + (st === "missing" ? "  MISSING" : st === "disabled" ? "  off" : ""), w - 10, 7), x + 9, 31, 7, st === "missing" ? UB_RED : c, 1);
    for (const d of ubDetailRects(gm, m)) {
        const r = d.rect;
        if (d.id === "preview") ubPaintCurvePreview(r, m, mod);
        else if (d.id.indexOf("curve") === 0) {
            const on = m.curve === d.curve;
            ubRR(r[0], r[1], r[2], r[3], 3, on ? UB_ORANGE : [0.17, 0.18, 0.21], on ? 0.25 : 1);
            ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, on ? UB_ORANGE : [0.30, 0.32, 0.37], 1, 1);
            ubCurveGlyph(d.curve, r[0] + 5, r[1] + 3, r[2] - 10, r[3] - 6, on ? UB_ORANGE : [0.62, 0.64, 0.7], 1);
        } else if (d.id === "camt") {
            const stepped = m.curve === CURVE_STEPPED;
            const lin = m.curve === CURVE_LINEAR;
            const v = stepped ? (m.curveSteps - 2) / 14 : m.curveAmt;
            ubPaintBar(r, stepped ? "Steps" : "Curve", stepped ? String(m.curveSteps) : Math.round(m.curveAmt * 100) + "%", v, UB_ORANGE, false, lin);
        } else if (d.id === "amt") ubPaintBar(r, "Amount", (m.amount > 0 ? "+" : "") + Math.round(m.amount * 100) + "%", (m.amount + 1) / 2, c, true, false);
        else if (d.id === "min") ubPaintBar(r, "Min", Math.round(m.min * 100) + "%", m.min, c, false, false);
        else if (d.id === "max") ubPaintBar(r, "Max", Math.round(m.max * 100) + "%", m.max, c, false, false);
        else if (d.id === "inv") {
            ubRR(r[0], r[1], r[2], r[3], 3, m.invert ? UB_ORANGE : [0.17, 0.18, 0.21], m.invert ? 0.25 : 1);
            ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, m.invert ? UB_ORANGE : [0.30, 0.32, 0.37], 1, 1);
            ubTextC("INV", r[0] + r[2] / 2, r[1] + 10.5, 7, m.invert ? [1, 1, 1] : [0.6, 0.62, 0.68], 1);
        } else if (d.id === "bip") {
            const dis = m.mode === "remote";
            ubRR(r[0], r[1], r[2], r[3], 3, m.bipolar && !dis ? UB_ORANGE : [0.17, 0.18, 0.21], m.bipolar && !dis ? 0.25 : 1);
            ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, m.bipolar && !dis ? UB_ORANGE : [0.30, 0.32, 0.37], 1, 1);
            ubTextC("BIP", r[0] + r[2] / 2, r[1] + 10.5, 7, dis ? [0.4, 0.42, 0.46] : m.bipolar ? [1, 1, 1] : [0.6, 0.62, 0.68], 1);
        } else if (d.id === "mode") {
            const half = r[2] / 2;
            ubRR(r[0], r[1], r[2], r[3], 3, [0.17, 0.18, 0.21], 1);
            ubRR(r[0] + (m.mode === "remote" ? half : 0) + 1, r[1] + 1, half - 2, r[3] - 2, 2, UB_CYAN, 0.3);
            ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, [0.30, 0.32, 0.37], 1, 1);
            ubTextC("MOD", r[0] + half / 2, r[1] + 10.5, 7, m.mode === "mod" ? [1, 1, 1] : [0.55, 0.57, 0.62], 1);
            ubTextC("REM", r[0] + half * 1.5, r[1] + 10.5, 7, m.mode === "remote" ? [1, 1, 1] : [0.55, 0.57, 0.62], 1);
        } else if (d.id === "del") {
            ubRR(r[0], r[1], r[2], r[3], 3, [0.3, 0.14, 0.16], 1);
            ubRRStroke(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, [0.6, 0.28, 0.3], 1, 1);
            const cx = r[0] + r[2] / 2;
            const cy = r[1] + r[3] / 2;
            ubLine(cx - 3.5, cy - 3.5, cx + 3.5, cy + 3.5, [1, 0.6, 0.6], 1, 1.4);
            ubLine(cx + 3.5, cy - 3.5, cx - 3.5, cy + 3.5, [1, 0.6, 0.6], 1, 1.4);
        }
    }
}
function ubPaintArrow(x, y, armed, multi, hover) {
    const cy = y + 7;
    if (armed && multi) ubRR(x - 1, y, 26, 14, 4, UB_CYAN, 0.25);
    let a = hover ? 0.95 : 0.7;
    if (armed && !multi) a = 0.35 + 0.65 * Math.abs(Math.sin(ubFrame * 0.22));
    if (armed && multi) a = 1;
    ubCircle(x + 5, cy, 2.6, UB_CYAN, a, true);
    ubLine(x + 7, cy, x + 18, cy, UB_CYAN, a, 1.4);
    ubCol(UB_CYAN, a);
    mgraphics.move_to(x + 21, cy);
    mgraphics.line_to(x + 16, cy - 3);
    mgraphics.line_to(x + 16, cy + 3);
    mgraphics.close_path();
    mgraphics.fill();
}
function ubCurveRowGlyph(m, x, y, w, h, c, a) {
    const pts = [];
    for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        let v = shapeCurve(u, m.curve, m.curveAmt, m.curveSteps);
        if (m.invert) v = 1 - v;
        pts.push([x + w * u, y + h - h * clamp(v, 0, 1)]);
    }
    ubPoly(pts, c, a, 1.2);
}
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
        if (it.kind === "head") {
            ubRect(R[0] + 3, r.y + 1, R[2] - 6, r.h - 2, [0.17, 0.18, 0.21], 1);
            ubCircle(R[0] + 9, r.y + 7.5, 2.5, col, m0.enabled ? 1 : 0.4, true);
            ubText(ubFit(m0.name, R[2] - 70, 7.5), R[0] + 16, r.y + 10.5, 7.5, [0.9, 0.92, 0.95], m0.enabled ? 1 : 0.5);
            const ar = ubHeadArrowRect(r.y);
            const armed = MM.learn.armed && MM.learn.mod === it.i;
            ubPaintArrow(ar[0], ar[1], armed, armed && MM.learn.multi, !!(hv && hv.kind === "ls_harrow" && hv.slot === it.i));
            const cs = String(MM.mappingsFor(it.i).length);
            ubText(cs, ar[0] - 3 - ubTextW(cs, 7), r.y + 10.5, 7, [0.6, 0.63, 0.68], 1);
        } else if (it.kind === "none") {
            ubText("no mappings - click the arrow", R[0] + 18, r.y + 9, 6.5, [0.42, 0.45, 0.5], 1);
        } else {
            const m = it.m;
            const P = ubRowParts(r.y);
            const status = MM.mappingStatus(m.id);
            const miss = status === "missing";
            const dis = status === "disabled" || !m.enabled;
            const a = miss ? 0.75 : dis ? 0.45 : 1;
            const isSel = !!(sel && sel.id === m.id);
            const rowHov = !!(hv && hv.m && hv.m.id === m.id);
            if (isSel) {
                ubRect(R[0] + 3, r.y, R[2] - 6, r.h, UB_CYAN, 0.14);
                ubRRStroke(R[0] + 3.5, r.y + 0.5, R[2] - 7, r.h - 1, 2, UB_CYAN, 0.9, 1);
            } else if (rowHov) ubRect(R[0] + 3, r.y, R[2] - 6, r.h, [0.18, 0.19, 0.22], 1);
            if (miss) ubRect(R[0] + 3, r.y, R[2] - 6, r.h, UB_RED, 0.08);
            ubText("x", P.del[0] + 2.5, r.y + 10, 8, rowHov && hv.kind === "ls_del" ? UB_RED : [0.6, 0.63, 0.68], a);
            const nm = m.target.paramName || m.target.name || "?";
            ubText(ubFit(nm, P.name[2], 7.5), P.name[0], r.y + 10, 7.5, miss ? UB_RED : [0.84, 0.86, 0.9], a);
            ubCurveRowGlyph(m, P.curve[0], P.curve[1], P.curve[2], P.curve[3], rowHov && hv.kind === "ls_curve" ? [1, 1, 1] : [0.6, 0.64, 0.7], a);
            const vt = ubValueText(m);
            ubText(vt, P.val[0] + P.val[2] - ubTextW(vt, 7.5), r.y + 10, 7.5, UB_ORANGE, a);
            const remote = m.mode === "remote";
            ubRR(P.mode[0], P.mode[1], P.mode[2], P.mode[3], 3, remote ? UB_CYAN : [0.22, 0.24, 0.28], remote ? 0.85 : 1);
            ubTextC(remote ? "R" : "M", P.mode[0] + P.mode[2] / 2, P.mode[1] + 8, 6.5, remote ? [0.05, 0.1, 0.14] : [0.7, 0.73, 0.78], 1);
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
    if (ev.kind === "learn") {
        if (!MM.learn.armed) ubLatch = false;
        return;
    }
    if (ev.kind === "load") { ubLatch = false; ubPopup = null; ubEdit = null; ubDelArm = -1; }
    if (ev.kind === "mods" || ev.kind === "load" || ev.kind === "ui") ubSyncWidth();
}

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
    // a few more mappings so the patchbay has content
    let selId = 0;
    const add = (mod, track, dev, par, extra) => {
        const m = MM.addMapping(mod, { path: "live_set tracks " + (mod + 2) + " devices 0 parameters " + (par.length + 3), trackName: track, deviceName: dev, paramName: par });
        if (m && extra) MM.updateMapping(m.id, extra);
        if (m && par === "Frequency") selId = m.id;
    };
    add(0, "Bass", "Auto Filter", "Resonance", { amount: -0.4 });
    add(2, "Bass", "Auto Filter", "Frequency", { mode: "remote", min: 0.2, max: 0.8, curve: CURVE_EXP });
    add(3, "Pads", "Reverb", "Decay", { amount: 0.8, curve: CURVE_S });
    add(4, "Pads", "Reverb", "Dry/Wet", { amount: 0.3, invert: 1 });
    add(1, "Drums", "Drum Buss", "Drive", { amount: 0.6 });
    // one target is gone (red row), one mapping is disabled (dimmed)
    const all = MM.allMappings();
    const gone = all.filter((m) => m.target.paramName === "Drive")[0];
    if (gone) {
        const orig = MM.mappingStatus;
        MM.mappingStatus = (id) => (id === gone.id ? "missing" : orig(id));
    }
    const dis = all.filter((m) => m.target.paramName === "Dry/Wet")[0];
    if (dis) MM.updateMapping(dis.id, { enabled: 0 });
    MM.setUI({ exp: 4, sel: 4, pb: UB_PREVIEW_LIST ? 1 : 0, pbSel: selId, pbScroll: 0 });
    ubListReveal(selId, 0);
    ubFullTTL = 0;
    if (!UB_PREVIEW_LIST) s.mods[3].enabled = 0;
    if (!UB_PREVIEW_LIST) { MM.armLearn(4, true); ubLatch = true; }
    else MM.armLearn(2, false);
}
