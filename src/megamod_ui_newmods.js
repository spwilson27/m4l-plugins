// Mega Modulator UI: the ADSR, XY and Buttons modulators, the learn-source (output) selection of two-output modulators, and the ADSR's "MIDI From" menu.
// Appended after src/megamod_ui.js into the SAME v8ui script scope (build order: config, mapper, ui, this file), so it uses the ub* helpers and
// constants of megamod_ui.js; megamod_ui.js calls the functions below (ubNewGeomInto, ubHitNew, ubDrawNewViz, ubNewFaces, ...).
//
// Layout (everything inside the strip's viz rect `r`, so no new rect can leave the strip or overlap another control):
//   collapsed (r = 48 x 66):  XY: pad 48 x 48 + two source tabs X | Y under it;  Buttons: two buttons 23 x 48 + two source tabs under them;  ADSR: the shape.
//   expanded  (r = 196 x 62): XY: pad 62 x 62 + two big source tabs (X 50% / Y 50%);  Buttons: two buttons 96 x 44 + two source tabs under them;  ADSR: the shape.
// A source tab picks WHICH OUTPUT the rail LRN learns from (state.ui.lout[slot] = 0 | 1): a bright outline marks the selected one.

// ------------------------------------------------------------------ output (learn source) selection
// the output (0 | 1) of a two-output modulator the rail LRN learns from; single-output modulators always give 0
function ubLearnOut(slot) {
    const m = MM.state.mods[slot];
    if (!m || modOutputs(m.type) < 2) return 0;
    const l = ubUIs().lout;
    return l && l[slot] === 1 ? 1 : 0;
}
function ubSetLearnOut(slot, out) {
    const m = MM.state.mods[slot];
    if (!m || modOutputs(m.type) < 2) return;
    const l = Object.assign({}, ubUIs().lout);
    l[slot] = out === 1 ? 1 : 0;
    MM.setUI({ lout: l });
    if (MM.learn.armed && MM.learn.mod === slot) MM.setLearnOut(out === 1 ? 1 : 0);
}
// a mapping's source modulator has two outputs (XY, Buttons)
function ubTwoOut(m) {
    const mod = m ? MM.state.mods[m.mod] : null;
    return !!mod && modOutputs(mod.type) > 1;
}
// "XY 1 · X" / "Btn 2 · B": the modulator and the output a mapping reads (just the name for a single-output modulator)
function ubSrcLabel(m) {
    const mod = MM.state.mods[m.mod];
    if (!mod) return "?";
    return ubTwoOut(m) ? mod.name + " · " + outTag(mod.type, m.out) : mod.name;
}
function ubSrcShort(m) {
    const mod = MM.state.mods[m.mod];
    if (!mod) return "?";
    return ubTwoOut(m) ? mod.name + "·" + outTag(mod.type, m.out) : mod.name;
}
// stable: the rows of output A first, then those of output B (a single-output modulator keeps its order)
function ubSortOut(maps) {
    return maps.map((m, i) => [m, i]).sort((a, b) => (a[0].out === 1 ? 1 : 0) - (b[0].out === 1 ? 1 : 0) || a[1] - b[1]).map((e) => e[0]);
}
// a 9 x 9 tag chip in the source modulator's colour: X / Y, A / B
function ubOutChip(m, x, y, a) {
    const mod = MM.state.mods[m.mod];
    if (!mod) return;
    ubRR(x, y, 9, 9, 2, ubModCol(mod), 0.85 * a);
    ubTextC(outTag(mod.type, m.out), x + 4.5, y + 7.2, 6, [0.06, 0.07, 0.09], 1);
}

// ------------------------------------------------------------------ geometry
// rects of the new types inside a viz rect: {pad, btn: [r, r], src: [r, r]}
function ubNewGeom(type, r, big) {
    const x = r[0], y = r[1];
    if (type === MOD_XY) {
        if (big) return { pad: [x, y, 62, 62], src: [[x + 68, y, r[2] - 68, 30], [x + 68, y + 32, r[2] - 68, 30]] };
        return { pad: [x, y, 48, 48], src: [[x, y + 50, 24, 14], [x + 24, y + 50, 24, 14]] };
    }
    if (type === MOD_BTN) {
        if (big) return { btn: [[x, y, 96, 44], [x + 100, y, 96, 44]], src: [[x, y + 46, 96, 16], [x + 100, y + 46, 96, 16]] };
        return { btn: [[x, y, 23, 48], [x + 25, y, 23, 48]], src: [[x, y + 50, 23, 14], [x + 25, y + 50, 23, 14]] };
    }
    return {};
}
function ubNewGeomInto(R, type, viz, big) {
    const g = ubNewGeom(type, viz, big);
    if (g.pad) R.pad = g.pad;
    if (g.btn) R.btn = g.btn;
    if (g.src) R.src = g.src;
}
function ubHitNew(R, slot, x, y) {
    if (R.src) for (let o = 0; o < 2; o++) if (ubIn(R.src[o], x, y)) return { kind: "outsel", slot, out: o };
    if (R.btn) for (let b = 0; b < 2; b++) if (ubIn(R.btn[b], x, y)) return { kind: "btn", slot, b };
    if (R.pad && ubIn(R.pad, x, y)) return { kind: "pad", slot, rect: R.pad };
    return null;
}
// parameter faces: a live.text over each of the two Buttons (the pad has none: the v8ui takes the drag, the X / Y knobs carry the faces)
function ubNewFaces(g, mod, R) {
    const out = [];
    if (mod.type === MOD_BTN && R.btn) {
        out.push([MM.autoSwKeyFor(g.slot, autoSwitchIndex(MOD_BTN, "sync")), R.btn[0]]);
        out.push([MM.autoSwKeyFor(g.slot, autoSwitchIndex(MOD_BTN, "bipolar")), R.btn[1]]);
    }
    return out;
}

// ------------------------------------------------------------------ XY pad / Buttons interaction
function ubXyDrag(d, x, y) {
    const r = d.rect;
    MM.setParam(d.slot, "x", clamp((x - r[0]) / r[2], 0, 1));
    MM.setParam(d.slot, "y", clamp(1 - (y - r[1]) / r[3], 0, 1));
    d.dirty = true;
}
function ubXyStart(h, x, y) {
    ubDrag = { kind: "xy", slot: h.slot, rect: h.rect, dirty: true };
    ubXyDrag(ubDrag, x, y);
}
function ubXyReset(slot) {
    MM.setParam(slot, "x", 0.5);
    MM.setParam(slot, "y", 0.5);
}
function ubBtnClick(slot, b) {
    const m = MM.state.mods[slot];
    if (!m) return;
    const key = b === 0 ? "sync" : "bipolar";
    MM.setParam(slot, key, m.p[key] ? 0 : 1);
}

// ------------------------------------------------------------------ ADSR
// Bitwig-style FLOATING layout. Each of attack / decay / release gets a width from its time on a compressive (log) scale, UB_ADSR_MINW px at least (a dot is
// always grabbable) and half the graph at most; the sustain is a dashed segment of a FIXED width (UB_ADSR_SUSW of the graph). When the sum does not fit, only the
// variable parts (width - min) shrink together, so short times leave the envelope narrower than the graph (left aligned) and long ones fill it.
// The engine curves are drawn exactly (src/megamod_config.js adsrAttackShape / adsrExpShape), the tracking dot follows them.
const UB_ADSR_T0 = 15; // ms: the knee of the log scale
const UB_ADSR_TMAX = 5000; // ms: the longest time (the decay / release range)
const UB_ADSR_MINW = 7; // px
const UB_ADSR_SUSW = 0.14; // sustain segment width, fraction of the graph width
const UB_ADSR_MAXW = 0.5; // one segment never takes more than this fraction of the graph width
function ubAdsrTimeNorm(ms) { return clamp(Math.log(1 + Math.max(ms, 0) / UB_ADSR_T0) / Math.log(1 + UB_ADSR_TMAX / UB_ADSR_T0), 0, 1); }
function ubAdsrTimeFromNorm(n) { return UB_ADSR_T0 * (Math.exp(clamp(n, 0, 1) * Math.log(1 + UB_ADSR_TMAX / UB_ADSR_T0)) - 1); }
// widths in px for a graph of width iw: {wa, wd, ws, wr, tot, minw, span, k} (k = the shrink factor of the variable parts, 1 when everything fits)
function ubAdsrWidths(p, iw) {
    const minw = Math.min(UB_ADSR_MINW, iw / 8);
    const ws = UB_ADSR_SUSW * iw;
    const span = Math.max(iw * UB_ADSR_MAXW - minw, 0);
    const va = span * ubAdsrTimeNorm(p.attack), vd = span * ubAdsrTimeNorm(p.decay), vr = span * ubAdsrTimeNorm(p.release);
    const avail = Math.max(iw - ws - 3 * minw, 0);
    const sum = va + vd + vr;
    const k = sum > avail && sum > 0 ? avail / sum : 1;
    const wa = minw + va * k, wd = minw + vd * k, wr = minw + vr * k;
    return { wa, wd, ws, wr, tot: wa + wd + ws + wr, minw, span, k };
}
// breakpoints in pixels for a viz rect r: start (no dot), A (attack peak, dot), D (end of decay = sustain level, dot), S (end of the dashed sustain line = release
// start, NO dot), R (end of the release, dot)
function ubAdsrPts(p, r) {
    const ix = r[0] + 2, iy = r[1] + 3, iw = r[2] - 4, ih = r[3] - 6;
    const w = ubAdsrWidths(p, iw);
    const xa = ix + w.wa, xd = xa + w.wd, xs = xd + w.ws, xr = xs + w.wr;
    const ys = iy + (1 - clamp(p.sustain, 0, 1)) * ih;
    return { ix, iy, iw, ih, w, start: [ix, iy + ih], A: [xa, iy], D: [xd, ys], S: [xs, ys], R: [xr, iy + ih] };
}
// the drawn curve: {atk, dec, rel} polylines (attack from the start to A, decay A -> D, release S -> R) sampled from the engine's shapes
function ubAdsrCurves(P, p) {
    const sus = clamp(p.sustain, 0, 1);
    const yOf = (u) => P.iy + (1 - u) * P.ih;
    const atk = [], dec = [], rel = [];
    for (let i = 0; i <= 14; i++) { const s = i / 14; atk.push([P.start[0] + (P.A[0] - P.start[0]) * s, yOf(adsrAttackShape(s))]); }
    for (let i = 0; i <= 20; i++) { const s = i / 20; dec.push([P.A[0] + (P.D[0] - P.A[0]) * s, yOf(sus + (1 - sus) * adsrExpShape(s))]); }
    for (let i = 0; i <= 20; i++) { const s = i / 20; rel.push([P.S[0] + (P.R[0] - P.S[0]) * s, yOf(sus * adsrExpShape(s))]); }
    return { atk, dec, rel };
}
function ubAdsrStart(h, x, y) {
    const mod = MM.state.mods[h.slot];
    const P = ubAdsrPts(mod.p, h.rect);
    let best = null, bd = 64; // within 8 px
    for (const k of ["A", "D", "R"]) {
        const d = (P[k][0] - x) * (P[k][0] - x) + (P[k][1] - y) * (P[k][1] - y);
        if (d < bd) { bd = d; best = k; }
    }
    if (!best) return;
    ubDrag = { kind: "adsr", slot: h.slot, which: best, rect: h.rect, x0: x, y0: y, P, p0: Object.assign({}, mod.p), dirty: false };
}
// a segment's new time when its right dot moves dx px: the width follows the cursor under the layout of the drag start (inverse of ubAdsrWidths)
function ubAdsrDragTime(d, key, wKey, dx) {
    const w = d.P.w;
    const wn = Math.max(w[wKey] + dx, w.minw);
    const v = w.span > 0 ? (wn - w.minw) / (w.k > 0 ? w.k : 1) / w.span : 0;
    return autoValue(key, autoNorm(key, ubAdsrTimeFromNorm(v)));
}
function ubAdsrDrag(d, x, y) {
    const dx = x - d.x0;
    if (d.which === "A") MM.setParam(d.slot, "attack", ubAdsrDragTime(d, "attack", "wa", dx));
    else if (d.which === "R") MM.setParam(d.slot, "release", ubAdsrDragTime(d, "release", "wr", dx));
    else if (d.which === "D") {
        MM.setParam(d.slot, "decay", ubAdsrDragTime(d, "decay", "wd", dx));
        MM.setParam(d.slot, "sustain", clamp(d.p0.sustain - (y - d.y0) / d.P.ih, 0, 1));
    }
    d.dirty = true;
}
// the tracking dot on the drawn shape (telemetry: aux = stage + 10 * gate, phase = progress inside the stage, u = level): along the attack and the decay, HELD on the
// D dot for the whole sustain, along the release once the gate is off; null (hidden) while idle
function ubAdsrDot(P, t, p) {
    const stage = Math.round(t.aux || 0) % 10;
    const prog = clamp(t.phase, 0, 1);
    const ys = (u) => P.iy + (1 - clamp(u, 0, 1)) * P.ih;
    if (stage === 1) return [P.start[0] + (P.A[0] - P.start[0]) * prog, ys(t.u)];
    if (stage === 2) return [P.A[0] + (P.D[0] - P.A[0]) * prog, ys(t.u)];
    if (stage === 3) return [P.D[0], P.D[1]];
    if (stage === 4) return [P.S[0] + (P.R[0] - P.S[0]) * prog, ys(t.u)];
    return null;
}
function ubPaintAdsr(slot, mod, r, big, c, a, t) {
    const p = mod.p;
    const P = ubAdsrPts(p, r);
    const cv = ubAdsrCurves(P, p);
    for (let k = 1; k < 4; k++) ubLine(P.ix, P.iy + (P.ih * k) / 4, P.ix + P.iw, P.iy + (P.ih * k) / 4, [0.14, 0.15, 0.18], 1, 1);
    ubFillPoly(cv.atk.concat(cv.dec, cv.rel), P.iy + P.ih, c, 0.16 * a);
    for (const k of ["A", "D"]) ubLine(P[k][0], P.iy, P[k][0], P.iy + P.ih, [1, 1, 1], 0.08, 1);
    ubPoly(cv.atk.concat(cv.dec), c, a, big ? 1.6 : 1.3);
    ubPoly(cv.rel, c, a, big ? 1.6 : 1.3);
    // the sustain: a dashed horizontal line at the sustain level, from D to S
    for (let x = P.D[0]; x < P.S[0] - 0.5; x += 4) ubLine(x, P.D[1], Math.min(x + 2, P.S[0]), P.D[1], c, a, big ? 1.6 : 1.3);
    const drg = ubDrag && ubDrag.kind === "adsr" ? ubDrag.which : "";
    for (const k of ["A", "D", "R"]) {
        ubCircle(P[k][0], P[k][1], big ? 3.4 : 2.4, c, a, true);
        ubCircle(P[k][0], P[k][1], big ? 3.4 : 2.4, k === drg ? [1, 1, 1] : [0.08, 0.09, 0.1], 1, false, 1);
    }
    if (big) {
        const lab = [["A", P.start[0], P.A[0]], ["D", P.A[0], P.D[0]], ["S", P.D[0], P.S[0]], ["R", P.S[0], P.R[0]]];
        for (const l of lab) if (l[2] - l[1] >= 14) ubTextC(l[0], (l[1] + l[2]) / 2, P.iy + P.ih - 2, 6.5, [0.55, 0.58, 0.64], 0.8); // (no label on a segment too narrow for it)
    }
    const dot = ubAdsrDot(P, t, p);
    const gate = Math.floor((t.aux || 0) / 10) > 0;
    if (dot) ubCircle(dot[0], dot[1], big ? 2.8 : 2.3, [1, 1, 1], 1, true);
    // trigger source + gate LED
    const mt = p.sync ? "THR" : "MIDI";
    ubText(mt, r[0] + r[2] - 12 - ubTextW(mt, 6.5), r[1] + 9, 6.5, p.sync ? UB_ORANGE : UB_CYAN, 0.9 * a); // top right
    ubCircle(r[0] + r[2] - 6, r[1] + 6, 2.4, gate ? c : [0.3, 0.32, 0.36], gate ? a : 1, true);
}

// ------------------------------------------------------------------ XY / Buttons painting
function ubPaintSrcTab(rect, label, value, slot, out, c, a, big) {
    const sel = ubLearnOut(slot) === out;
    const armed = MM.learn.armed && MM.learn.mod === slot && MM.learn.out === out;
    ubRR(rect[0], rect[1], rect[2], rect[3], 3, sel ? c : [0.15, 0.16, 0.19], sel ? 0.3 * a : 1);
    ubRRStroke(rect[0] + 0.5, rect[1] + 0.5, rect[2] - 1, rect[3] - 1, 3, armed ? UB_CYAN : sel ? c : [0.30, 0.32, 0.37], armed ? ubPulse() : 1, sel || armed ? 1.6 : 1);
    if (big && rect[3] >= 24) {
        ubText(label, rect[0] + 6, rect[1] + rect[3] / 2 + 3, 9, sel ? [1, 1, 1] : [0.7, 0.72, 0.78], a);
        if (value !== null) ubText(value, rect[0] + rect[2] - 6 - ubTextW(value, 8), rect[1] + rect[3] / 2 + 3, 8, UB_ORANGE, a);
    } else {
        ubTextC(label, rect[0] + rect[2] / 2, rect[1] + rect[3] / 2 + 3, 7, sel ? [1, 1, 1] : [0.6, 0.62, 0.68], a);
    }
}
function ubPaintXy(slot, mod, r, big, c, a, t) {
    const g = ubNewGeom(MOD_XY, r, big);
    const pd = g.pad;
    const p = mod.p;
    ubRR(pd[0], pd[1], pd[2], pd[3], 3, [0.045, 0.052, 0.065], 1);
    for (let k = 1; k < 4; k++) {
        ubLine(pd[0] + (pd[2] * k) / 4, pd[1] + 1, pd[0] + (pd[2] * k) / 4, pd[1] + pd[3] - 1, [0.13, 0.14, 0.17], 1, 1);
        ubLine(pd[0] + 1, pd[1] + (pd[3] * k) / 4, pd[0] + pd[2] - 1, pd[1] + (pd[3] * k) / 4, [0.13, 0.14, 0.17], 1, 1);
    }
    const x = clamp(p.x, 0, 1), y = clamp(p.y, 0, 1);
    const px = pd[0] + 2 + x * (pd[2] - 4), py = pd[1] + 2 + (1 - y) * (pd[3] - 4);
    ubLine(px, pd[1] + 1, px, pd[1] + pd[3] - 1, c, 0.45 * a, 1);
    ubLine(pd[0] + 1, py, pd[0] + pd[2] - 1, py, c, 0.45 * a, 1);
    if (p.slew > 0.02) { // the slewed output (where the engine's X / Y really are) trails the puck
        const dep = Math.max(p.depth, 0.0001);
        const ux = clamp((t.out + 1) / (2 * dep), 0, 1), uy = clamp(((t.outB === undefined ? t.out : t.outB) + 1) / (2 * dep), 0, 1);
        ubCircle(pd[0] + 2 + ux * (pd[2] - 4), pd[1] + 2 + (1 - uy) * (pd[3] - 4), 2, [1, 1, 1], 0.7 * a, true);
    }
    ubCircle(px, py, big ? 4.6 : 3.6, c, a, true);
    ubCircle(px, py, big ? 4.6 : 3.6, [0.95, 0.96, 0.98], a, false, 1.2);
    ubRRStroke(pd[0] + 0.5, pd[1] + 0.5, pd[2] - 1, pd[3] - 1, 3, [0.26, 0.28, 0.33], 1, 1);
    ubPaintSrcTab(g.src[0], "X", big ? UB_PCT(x) : null, slot, 0, c, a, big);
    ubPaintSrcTab(g.src[1], "Y", big ? UB_PCT(y) : null, slot, 1, c, a, big);
}
function ubPaintBtn(slot, mod, r, big, c, a, t) {
    const g = ubNewGeom(MOD_BTN, r, big);
    const p = mod.p;
    const dep = Math.max(p.depth, 0.0001);
    const us = [clamp((t.out + 1) / (2 * dep), 0, 1), clamp(((t.outB === undefined ? t.out : t.outB) + 1) / (2 * dep), 0, 1)];
    const on = [!!p.sync, !!p.bipolar];
    for (let b = 0; b < 2; b++) {
        const rc = g.btn[b];
        const lit = on[b] ? 0.25 + 0.6 * us[b] : 0;
        ubRR(rc[0], rc[1], rc[2], rc[3], 4, [0.07, 0.078, 0.095], 1);
        if (lit > 0) ubRR(rc[0], rc[1], rc[2], rc[3], 4, c, lit * a);
        ubRRStroke(rc[0] + 0.5, rc[1] + 0.5, rc[2] - 1, rc[3] - 1, 4, on[b] ? c : [0.30, 0.32, 0.37], a, on[b] ? 1.6 : 1);
        ubTextC(String(b + 1), rc[0] + rc[2] / 2, rc[1] + rc[3] / 2 + (big ? 5 : 6), big ? 15 : 13, on[b] ? [1, 1, 1] : [0.62, 0.65, 0.7], a);
        ubPaintSrcTab(g.src[b], big ? "Out " + outTag(MOD_BTN, b) : outTag(MOD_BTN, b), null, slot, b, c, a, false);
    }
}
function ubDrawNewViz(slot, mod, r, big) {
    const c = ubModCol(mod);
    const t = ubTel(slot);
    const a = mod.enabled ? 1 : 0.35;
    if (mod.type === MOD_ADSR) ubPaintAdsr(slot, mod, r, big, c, a, t);
    else if (mod.type === MOD_XY) ubPaintXy(slot, mod, r, big, c, a, t);
    else if (mod.type === MOD_BTN) ubPaintBtn(slot, mod, r, big, c, a, t);
}

// ------------------------------------------------------------------ ADSR "MIDI From" (LOM DeviceIO routing, see MM.midiInfo)
function ubMidiFromLabel() {
    const i = MM.midiInfo();
    if (!i.supported) return "No MIDI in";
    return ubFit("In: " + (i.name || "?"), 58, 7);
}
var ubMidiMenu = null; // {slot, rect: anchor chip, first}
const UB_MIDI_ROW = 14;
const UB_MIDI_W = 128;
const UB_MIDI_ROWS = 8;
function ubOpenMidiFrom(slot, rect) {
    ubMidiMenu = { slot, anchor: rect, first: 0 };
}
function ubMidiMenuGeom() {
    if (!ubMidiMenu) return null;
    const info = MM.midiInfo();
    const items = info.supported ? info.types : ["MIDI input is not available"];
    const rows = Math.min(UB_MIDI_ROWS, Math.max(1, items.length));
    const h = 4 + rows * UB_MIDI_ROW;
    const a = ubMidiMenu.anchor;
    const x = clamp(a[0], 2, Math.max(2, ubLayoutWidth() - UB_MIDI_W - 2));
    const y = clamp(a[1] - h - 2, 2, UB_H - h - 2);
    const first = clamp(ubMidiMenu.first, 0, Math.max(0, items.length - rows));
    return { rect: [x, y, UB_MIDI_W, h], items, rows, first, supported: info.supported, current: info.name };
}
function ubHitMidiMenu(x, y) {
    const G = ubMidiMenuGeom();
    if (!G || !ubIn(G.rect, x, y)) return { kind: "midi_out" };
    const k = Math.floor((y - G.rect[1] - 2) / UB_MIDI_ROW);
    if (k < 0 || k >= G.rows || G.first + k >= G.items.length) return { kind: "midi_pad" };
    return { kind: "midi_item", idx: G.first + k, supported: G.supported };
}
function ubMidiMenuClick(h) {
    if (h.kind === "midi_item" && h.supported) MM.midiSetType(h.idx);
    if (h.kind !== "midi_pad") ubMidiMenu = null;
}
function ubPaintMidiMenu() {
    const G = ubMidiMenuGeom();
    if (!G) return;
    const R = G.rect;
    ubRR(R[0], R[1], R[2], R[3], 4, [0.07, 0.075, 0.09], 0.98);
    ubRRStroke(R[0] + 0.5, R[1] + 0.5, R[2] - 1, R[3] - 1, 4, UB_CYAN, 1, 1);
    for (let k = 0; k < G.rows; k++) {
        const i = G.first + k;
        if (i >= G.items.length) break;
        const ry = R[1] + 2 + k * UB_MIDI_ROW;
        const hov = ubHover && ubIn([R[0], ry, R[2], UB_MIDI_ROW], ubHover.x, ubHover.y);
        const cur = G.supported && G.items[i] === G.current;
        if (hov) ubRR(R[0] + 2, ry, R[2] - 4, UB_MIDI_ROW - 1, 3, [0.2, 0.23, 0.28], 1);
        ubText(ubFit(G.items[i], R[2] - 22, 7.5), R[0] + 16, ry + 10, 7.5, G.supported ? [0.9, 0.92, 0.95] : [0.55, 0.58, 0.64], 1);
        if (cur) ubCircle(R[0] + 8, ry + 6.5, 2.5, UB_CYAN, 1, true);
    }
}

// ------------------------------------------------------------------ preview (scripts/render_preview.py): 0 = off (the committed default), 1 = the strips (ADSR and Buttons collapsed,
// XY expanded, Y selected as the learn source), 2 = ADSR / XY / Buttons all expanded, 3 = the type picker open, 4 = the LST inspector on the XY (rows tagged X / Y, depth sub-rows), 5 = the maps popover of the XY. A test guards that the committed value is 0.
const UB_PREVIEW_NEWMODS = 0;
function ubPreviewNew(mode) {
    for (const t of [MOD_ADSR, MOD_XY, MOD_BTN, MOD_LFO, MOD_ENV]) MM.addModulator(t);
    const s = MM.state;
    const names = ["Pluck", "Pad", "Gates", "Wobble", "Follow"];
    for (let i = 0; i < 5; i++) s.mods[i].name = names[i];
    const a = s.mods[0].p;
    a.attack = 40; a.decay = 220; a.sustain = 0.55; a.release = 520; a.thresh = -26; a.sync = 1;
    const x = s.mods[1].p;
    x.x = 0.68; x.y = 0.32; x.slew = 0.2;
    const b = s.mods[2].p;
    b.sync = 1; b.bipolar = 0; b.slew = 0.15;
    s.mods[1].color = 4; s.mods[2].color = 2; s.mods[0].color = 1;
    const t = MM.readTelemetry();
    t.mods[0].aux = 12; t.mods[0].phase = 0.45; t.mods[0].u = 0.78; t.mods[0].out = 2 * 0.78 - 1;
    t.mods[1].out = 2 * 0.64 - 1; t.mods[1].outB = 2 * 0.36 - 1;
    t.mods[2].out = 1; t.mods[2].outB = -1;
    const mk = (mod, track, dev, par, out, extra) => {
        const m = MM.addMapping(mod, { path: "live_set tracks " + (mod + 1) + " devices 0 parameters " + (par.length + 2), trackName: track, deviceName: dev, paramName: par }, out);
        if (m && extra) MM.updateMapping(m.id, extra);
        return m;
    };
    mk(0, "Pads", "Reverb", "Decay", 0, { range: 0.7, polarity: 1 });
    mk(1, "Bass", "Auto Filter", "Frequency", 0, { range: 0.8 });
    mk(1, "Bass", "Auto Filter", "Resonance", 1, { range: 0.5, polarity: 1 });
    mk(1, "Pads", "Chorus", "Rate", 1, { range: 0.4 });
    mk(2, "Drums", "Drum Buss", "Drive", 0, { mode: "remote", min: 0, max: 0.7 });
    mk(2, "Drums", "Drum Buss", "Crunch", 1, { mode: "remote", min: 0.2, max: 1 });
    MM.setUI({ lout: { 1: 1, 2: 1 }, sel: 1, pb: mode === 4 ? 1 : 0, opt: 0, exp: mode === 2 ? [0, 1, 2] : mode === 1 ? [1] : [], order: [0, 1, 2, 3, 4] });
    if (mode === 3) ubPopup = { mode: "add", slot: -1, x: 380, y: 22 };
    if (mode === 1) MM.armLearn(1, false, 1);
    if (mode === 5) ubMapsPop = { slot: 1, scroll: 0 };
    if (mode === 4) {
        const dr = MM.addDepthRoute(0, MM.mappingsFor(1)[0].id, 0); // an ADSR modulating the depth of the XY's X mapping
        if (dr) MM.updateMapping(dr.id, { range: 0.6 });
        MM.addDepthRoute(1, MM.mappingsFor(1)[0].id, 1); // ... and the XY's own Y
    }
}
