"use strict";
/**
 * Shared bounds checker for the v8ui faces of the splitter devices (Loud / Transient / Harmonic / Freq / Multiband Split).
 * A recording `mgraphics` mock tracks the current path and records, per fill / stroke / text, the bounding box actually drawn.
 *
 *   const rec = makeRecorder(W, H);            // rec.mgraphics goes into the face's vm sandbox (loadFace)
 *   rec.begin(label);                          // start a scenario (clears shapes, keeps violations)
 *   face.paint();
 *   rec.end();                                 // flags a path left open at the end of paint()
 *   checkRecording(rec, { regions: [{x,y,w,h}], tol: 0.51 }) -> string[] (violations)
 *
 * Violations reported:
 *   - non-finite / absurd (|v| > 1e5) coordinate anywhere;
 *   - line_to / curve_to / show_text with no current point (a path that continues from an earlier path, or text at an unset origin);
 *   - arc joined to a pending line (the arc would be connected to the previous point by a stroked line);
 *   - any filled / stroked shape or text whose bounding box is not fully inside at least one allowed region, or leaves the canvas.
 * Text boxes use the mock measure (0.56 * size per char, ascent 0.8 size, descent 0.2 size), a bit wider than Live's font.
 * Regions describe where drawing is legitimate (plot rect, LCD rect, HUD rows ...). A shape that straddles a region edge (starts in
 * the plot and runs out below it, a label half over the axis labels' row, ...) is inside no region and is reported.
 */
const vm = require("vm");

function makeRecorder(W, H, opts) {
    const rec = { W, H, shapes: [], bad: [], label: "", fontSize: 10, cur: null, pts: [], lastOp: "", lw: 1, ctm: [1, 0, 0, 1, 0, 0], stack: [] };
    // opts.transform: honour translate / scale / rotate / save / restore (default off: the splitter faces never use them and the
    // original recorder ignored them; the fuzz harness turns it on so faces that translate are measured in canvas coordinates).
    const useCtm = !!(opts && opts.transform);
    const tx = (x, y) => (useCtm ? [rec.ctm[0] * x + rec.ctm[2] * y + rec.ctm[4], rec.ctm[1] * x + rec.ctm[3] * y + rec.ctm[5]] : [x, y]);
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const num = (v, what) => {
        if (typeof v !== "number" || !isFinite(v) || Math.abs(v) > 1e5) rec.bad.push(`${rec.label}: non-finite / absurd coordinate ${v} in ${what}`);
        return v;
    };
    const addPt = (x, y, what) => { num(x, what); num(y, what); if (isFinite(x) && isFinite(y)) rec.pts.push(tx(x, y)); };
    const flush = (kind) => {
        if (rec.pts.length) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const p of rec.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
            const e = kind === "stroke" ? rec.lw / 2 : 0;
            rec.shapes.push({ kind, x0: x0 - e, y0: y0 - e, x1: x1 + e, y1: y1 + e, label: rec.label });
        }
        rec.pts = [];
        rec.cur = null;
        rec.lastOp = kind;
    };
    const m = {
        size: [W, H], relative_coords: 0, autofill: 0,
        init() {}, redraw() {},
        set_source_rgba() {}, set_source_rgb() {},
        set_line_width(w) { rec.lw = w; },
        select_font_face() {}, set_font_size(s) { rec.fontSize = s; },
        text_measure(t) { return [String(t).length * rec.fontSize * 0.56, rec.fontSize]; },
        move_to(x, y) { addPt(x, y, "move_to"); rec.cur = [x, y]; rec.lastOp = "move"; },
        line_to(x, y) {
            if (!rec.cur) rec.bad.push(`${rec.label}: line_to(${x}, ${y}) with no current point (continues an earlier path)`);
            addPt(x, y, "line_to"); rec.cur = [x, y]; rec.lastOp = "line";
        },
        curve_to(a, b, c, d, e, f) {
            if (!rec.cur) rec.bad.push(`${rec.label}: curve_to with no current point (continues an earlier path)`);
            addPt(a, b, "curve_to"); addPt(c, d, "curve_to"); addPt(e, f, "curve_to"); rec.cur = [e, f]; rec.lastOp = "curve";
        },
        close_path() { rec.lastOp = "close"; },
        rectangle(x, y, w, h) { addPt(x, y, "rectangle"); addPt(x + w, y + h, "rectangle"); rec.cur = [x, y]; rec.lastOp = "rect"; },
        rectangle_rounded(x, y, w, h) { addPt(x, y, "rrect"); addPt(x + w, y + h, "rrect"); rec.cur = [x, y]; rec.lastOp = "rect"; },
        arc(x, y, r, a1) {
            // a pending point exactly at the arc's own start draws no joining line (move_to(x + r, y); arc(..., 0, ..))
            const atStart = rec.cur && typeof a1 === "number" && Math.hypot(rec.cur[0] - (x + r * Math.cos(a1)), rec.cur[1] - (y + r * Math.sin(a1))) < 1e-3;
            if (!atStart && (rec.lastOp === "move" || rec.lastOp === "line" || rec.lastOp === "curve")) rec.bad.push(`${rec.label}: arc joined to a pending path`);
            num(r, "arc radius");
            addPt(x - r, y - r, "arc"); addPt(x + r, y + r, "arc"); rec.cur = [x, y]; rec.lastOp = "arc";
        },
        ellipse(x, y, w, h) { addPt(x, y, "ellipse"); addPt(x + w, y + h, "ellipse"); rec.cur = [x, y]; rec.lastOp = "arc"; },
        fill() { flush("fill"); }, fill_preserve() { flush("fill"); }, stroke() { flush("stroke"); },
        save() { rec.stack.push(rec.ctm.slice()); }, restore() { if (rec.stack.length) rec.ctm = rec.stack.pop(); },
        translate(x, y) { if (useCtm && isFinite(x) && isFinite(y)) rec.ctm = mul(rec.ctm, [1, 0, 0, 1, x, y]); },
        scale(x, y) { if (useCtm && isFinite(x) && isFinite(y)) rec.ctm = mul(rec.ctm, [x, 0, 0, y, 0, 0]); },
        rotate(a) { if (useCtm && isFinite(a)) rec.ctm = mul(rec.ctm, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
        identity_matrix() { rec.ctm = [1, 0, 0, 1, 0, 0]; },
        // additive no-ops / helpers used by the other faces (the fuzz harness drives all of them)
        clip() {}, reset_clip() {}, set_line_cap() {}, set_line_join() {}, stroke_preserve() { flush("stroke"); }, fill_with_alpha() { flush("fill"); },
        arc_negative(x, y, r, a1) { m.arc(x, y, r, a1); }, get_current_point() { return rec.cur || [0, 0]; }, set_matrix() {}, path_roundcapped() {},
        text_path() {}, set_dash() {}, set_source_surface() {}, image_surface_create() { return {}; }, set_operator() {},
        show_text(t) {
            if (!rec.cur) { rec.bad.push(`${rec.label}: show_text("${t}") with no current point`); return; }
            const w = String(t).length * rec.fontSize * 0.56;
            const [x, y] = rec.cur;
            num(x, "text x"); num(y, "text y");
            // text box corners go through the CTM (rotated vertical labels), unrotated otherwise identical to the old box
            const cs = [[x, y - rec.fontSize * 0.8], [x + w, y - rec.fontSize * 0.8], [x, y + rec.fontSize * 0.2], [x + w, y + rec.fontSize * 0.2]].map((c) => tx(c[0], c[1]));
            rec.shapes.push({ kind: "text", text: String(t), x0: Math.min(...cs.map((c) => c[0])), y0: Math.min(...cs.map((c) => c[1])), x1: Math.max(...cs.map((c) => c[0])), y1: Math.max(...cs.map((c) => c[1])), label: rec.label });
            rec.pts = []; rec.cur = null; rec.lastOp = "text";
        }
    };
    rec.mgraphics = m;
    rec.begin = (label) => { rec.label = label || ""; rec.shapes = []; rec.pts = []; rec.cur = null; rec.lastOp = ""; rec.ctm = [1, 0, 0, 1, 0, 0]; rec.stack = []; };
    rec.end = () => { if (rec.pts.length) rec.bad.push(`${rec.label}: path left open at the end of paint() (never filled / stroked)`); rec.pts = []; };
    return rec;
}

/** Evaluate source in a fresh vm sandbox (functions / vars end up on the returned sandbox). extra = more globals. */
function loadFace(code, rec, extra) {
    const sandbox = Object.assign({
        mgraphics: rec.mgraphics, console, Math, JSON, Array, Object, String, Number, isFinite, isNaN, parseInt, parseFloat,
        inlets: 1, outlets: 4, outlet() {}, post() {}, notifyclients() {}, messnamed() {},
        Task: function () { this.interval = 0; this.repeat = function () {}; this.cancel = function () {}; this.schedule = function () {}; },
        Buffer: function () { this.peek = () => []; this.poke = () => {}; this.framecount = () => 0; this.channelcount = () => 1; },
        Global: function () { return {}; },
        patcher: { getnamed() { return null; }, setattr() {} },
    }, extra || {});
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return sandbox;
}

function checkRecording(rec, opts) {
    const tol = (opts && opts.tol) || 0.51;
    const regions = (opts && opts.regions) || [];
    const out = rec.bad.slice();
    const inside = (s, r) => s.x0 >= r.x - tol && s.y0 >= r.y - tol && s.x1 <= r.x + r.w + tol && s.y1 <= r.y + r.h + tol;
    for (const s of rec.shapes) {
        const desc = `${s.label}: ${s.kind}${s.text ? ` "${s.text}"` : ""} box [${s.x0.toFixed(1)}, ${s.y0.toFixed(1)}, ${s.x1.toFixed(1)}, ${s.y1.toFixed(1)}]`;
        if (s.x0 < -tol || s.y0 < -tol || s.x1 > rec.W + tol || s.y1 > rec.H + tol) { out.push(`${desc} leaves the ${rec.W}x${rec.H} canvas`); continue; }
        if (regions.length && !regions.some((r) => inside(s, r))) out.push(`${desc} is not inside any allowed region`);
    }
    return out;
}

/** Cartesian product of option lists: grid({a:[1,2], b:[3]}) -> [{a:1,b:3},{a:2,b:3}]. */
function grid(spec) {
    let rows = [{}];
    for (const k of Object.keys(spec)) {
        const next = [];
        for (const r of rows) for (const v of spec[k]) next.push(Object.assign({}, r, { [k]: v }));
        rows = next;
    }
    return rows;
}

module.exports = { makeRecorder, loadFace, checkRecording, grid };
