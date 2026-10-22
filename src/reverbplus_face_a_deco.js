// Reverb+ face `a` ("Signal-flow sections") decoration layer: ONE non-interactive v8ui (ignoreclick) over the whole face,
// behind every live.* control. It draws what Live's stock devices draw with boxes and lines: the section titles with a
// hairline under each, the vertical separators between sections, the label of every small LCD value, the dark LCD wells
// behind the borderless numboxes, the brackets that join paired values (Low / High Cut, Rate / Depth, Late / Early, Clip
// Mode / Level), the tiny input-filter curve (Low Cut / High Cut) and the LOOP section's clip LED + MIN note.
// Everything that depends on the algorithm (Convolution swaps the MOD column for the IR column and hides the tank-only
// tone / level values) is decided here from `algo`, and the geometry lives in RAD (also loaded by the tests).
// Colours: Live theme colours through rpTheme (max.getcolor) like Delay+, fallbacks for the preview.
// Build order: config + face_common + this file.

outlets = 1;

/** Geometry (device pixels; the v8ui covers the whole 586 x 169 face). The layout module repeats these numbers. */
var RAD = {
    W: 586, H: 169,
    seps: [82.5, 304.5, 404.5],
    sections: [
        { id: "input", title: "INPUT", x: 10, w: 66 },
        { id: "space", title: "SPACE", x: 88, w: 210 },
        { id: "tone", title: "TONE", x: 310, w: 88 },
        { id: "loop", title: "LOOP", x: 410, w: 84 },
    ],
    titleBase: 15, ruleY: 21.5,
    curve: { x: 10, y: 78, w: 66, h: 40 },
    // LCD values: key, label, x (label), well rect, which pages draw it ("tank", "conv" or "both")
    wells: [
        { key: "lowcut", label: "Lo", lx: 14, r: [28, 124, 48, 15], page: "both" },
        { key: "highcut", label: "Hi", lx: 14, r: [28, 141, 48, 15], page: "both" },
        { key: "xover", label: "X-over", lx: 311, r: [358, 74, 40, 15], page: "tank" },
        { key: "latelevel", label: "Late", lx: 311, r: [354, 112, 44, 15], page: "both" },
        { key: "erlevel", label: "Early", lx: 311, r: [354, 129, 44, 15], page: "tank" },
        { key: "modrate", label: "Rate", lx: 232, r: [262, 132, 36, 14], page: "tank" },
        { key: "moddepth", label: "Depth", lx: 232, r: [262, 148, 36, 14], page: "tank" },
        { key: "loopclip", label: "Mode", lx: 410, r: [438, 92, 54, 15], page: "both", menu: true },
        { key: "looplevel", label: "Level", lx: 410, r: [438, 109, 54, 15], page: "both" },
    ],
    // brackets: x, y0, y1, page
    brackets: [
        { x: 10.5, y0: 126, y1: 154, page: "both" },
        { x: 308.5, y0: 114, y1: 142, page: "tank" },
        { x: 229.5, y0: 134, y1: 160, page: "tank" },
        { x: 408.5, y0: 94, y1: 122, page: "both" },
    ],
    // sub-title rules inside a section: text, x, baseline, rule y, x1, page
    subs: [
        { text: "LEVELS", x: 310, base: 103, ruleY: 100.5, x1: 398, page: "both" },
        { text: "LOOP CLIP", x: 410, base: 85, ruleY: 82.5, x1: 494, page: "both" },
        { text: "MOD", x: 232, base: 129, ruleY: 0, x1: 0, page: "tank" },
        { text: "IMPULSE", x: 232, base: 129, ruleY: 0, x1: 0, page: "conv" },
    ],
    // hairlines between the right column's items
    rules: [{ x0: 510, x1: 574, y: 39.5 }, { x0: 510, x1: 574, y: 95.5 }],
    link: { x: 378.5, y0: 70, y1: 74 }, // Bass Mult dial -> its Crossover value
    status: { x: 410, led: 136, min: 148 },
    colRule: { x: 226.5, y0: 122, y1: 160 }, // between the SPACE dials and the MOD / IR column
};

var RDS = { clipAt: 0, now: 0 };

rpPoll(10);

function onFrame(t) {
    if (!t.active) return;
    RDS.now = Date.now();
    if (t.s && t.s[RP_SCOPE.CLIP_DB] < -0.1) RDS.clipAt = RDS.now;
}

function radPage() {
    return rpAlgo() === RP_ALGO.CONV ? "conv" : "tank";
}

function radShown(page, cur) {
    return page === "both" || page === cur;
}

// ---- drawing primitives -------------------------------------------------------------------------------------------

function radHair(x0, y0, x1, y1, c, a) {
    rpColor(c, a);
    mgraphics.set_line_width(1);
    mgraphics.move_to(x0, y0);
    mgraphics.line_to(x1, y1);
    mgraphics.stroke();
}

function radBracket(b, c) {
    var x = b.x;
    rpColor(c, 1);
    mgraphics.set_line_width(1);
    mgraphics.move_to(x + 3, b.y0 + 0.5); mgraphics.line_to(x, b.y0 + 0.5); mgraphics.line_to(x, b.y1 + 0.5); mgraphics.line_to(x + 3, b.y1 + 0.5);
    mgraphics.stroke();
}

function radWell(r, c) {
    rpColor(c, 1);
    mgraphics.rectangle_rounded(r[0], r[1], r[2], r[3], 3, 3);
    mgraphics.fill();
}

/** Magnitude (dB) of the input filter: 2nd-order high-pass at lo, low-pass at hi (what the Low / High Cut do, shape only). */
function radFilterDb(f, lo, hi) {
    var h = 1 / (1 + Math.pow(lo / f, 4));
    var l = 1 / (1 + Math.pow(f / hi, 4));
    return 10 * Math.log(Math.max(1e-6, h * l)) / Math.LN10;
}

function radFx(f, r) {
    return r.x + 3 + (r.w - 6) * Math.log(f / 20) / Math.log(1000);
}

function radFilterY(db, r) {
    return r.y + 5 + (r.h - 10) * rpClamp(-db / 30, 0, 1);
}

function radDrawFilter(r, wellColor, lo, hi) {
    radWell([r.x, r.y, r.w, r.h], wellColor);
    var i, n = 60;
    // octave guides at 100 Hz, 1 kHz, 10 kHz
    var g = [100, 1000, 10000];
    for (i = 0; i < g.length; i++) radHair(radFx(g[i], r), r.y + 3, radFx(g[i], r), r.y + r.h - 3, RPC.dim, 0.18);
    mgraphics.move_to(r.x + 3, r.y + r.h - 5);
    for (i = 0; i <= n; i++) {
        var f = 20 * Math.pow(1000, i / n);
        mgraphics.line_to(radFx(f, r), radFilterY(radFilterDb(f, lo, hi), r));
    }
    mgraphics.line_to(r.x + r.w - 3, r.y + r.h - 5);
    mgraphics.close_path();
    rpColor(RPC.cyan, 0.16);
    mgraphics.fill();
    for (i = 0; i <= n; i++) {
        var f2 = 20 * Math.pow(1000, i / n);
        var px = radFx(f2, r), py = radFilterY(radFilterDb(f2, lo, hi), r);
        if (i === 0) mgraphics.move_to(px, py);
        else mgraphics.line_to(px, py);
    }
    rpColor(RPC.cyan, 1);
    mgraphics.set_line_width(1.4);
    mgraphics.stroke();
    // the two cutoffs (-3 dB points) as dots, orange like Reverb's Input Filter handle
    var pts = [lo, hi];
    for (i = 0; i < 2; i++) {
        rpColor(RPC.amber, 1);
        mgraphics.ellipse(radFx(pts[i], r) - 2.5, radFilterY(radFilterDb(pts[i], lo, hi), r) - 2.5, 5, 5);
        mgraphics.fill();
    }
}

// ---- paint ------------------------------------------------------------------------------------------------------

function paint() {
    rpRefreshTheme();
    var page = radPage();
    var title = rpTheme("live_control_fg", [0.86, 0.88, 0.92, 1]);
    var rule = rpTheme("live_surface_frame", [0.40, 0.42, 0.46, 1]);
    var well = rpTheme("live_lcd_bg", [0.075, 0.075, 0.075, 1]);
    var dim = RPC.dim;
    var i;
    // vertical separators between the sections
    for (i = 0; i < RAD.seps.length; i++) radHair(RAD.seps[i], 12, RAD.seps[i], RAD.H - 12, rule, 0.9);
    // titles + hairlines
    for (i = 0; i < RAD.sections.length; i++) {
        var s = RAD.sections[i];
        rpText(s.title, s.x, RAD.titleBase, 8, title, true);
        radHair(s.x, RAD.ruleY, s.x + s.w, RAD.ruleY, rule, 0.9);
    }
    // sub-titles (a hairline under a small caption inside a section)
    for (i = 0; i < RAD.subs.length; i++) {
        var sb = RAD.subs[i];
        if (!radShown(sb.page, page)) continue;
        rpText(sb.text, sb.x, sb.base, 7, dim, true);
        if (sb.ruleY) radHair(sb.x + rpTextW(sb.text, 7, true) + 4, sb.ruleY, sb.x1, sb.ruleY, rule, 0.7);
    }
    // the rules between a column's dials
    for (i = 0; i < RAD.rules.length; i++) radHair(RAD.rules[i].x0, RAD.rules[i].y, RAD.rules[i].x1, RAD.rules[i].y, rule, 0.9);
    // the SPACE dials | MOD / IR column rule, and the Bass Mult -> Crossover link
    radHair(RAD.colRule.x, RAD.colRule.y0, RAD.colRule.x, RAD.colRule.y1, rule, 0.9);
    if (page === "tank") radHair(RAD.link.x, RAD.link.y0, RAD.link.x, RAD.link.y1, rule, 1);
    // input filter curve
    radDrawFilter(RAD.curve, well, rpNum("lowcut", 60), rpNum("highcut", 16000));
    // LCD wells + labels + brackets
    for (i = 0; i < RAD.wells.length; i++) {
        var w = RAD.wells[i];
        if (!radShown(w.page, page)) continue;
        if (!w.menu) radWell(w.r, well);
        rpText(w.label, w.lx, w.r[1] + 10.5, 7.5, dim, true);
    }
    for (i = 0; i < RAD.brackets.length; i++) {
        if (radShown(RAD.brackets[i].page, page)) radBracket(RAD.brackets[i], rule);
    }
    radDrawStatus(page);
}

/** LOOP section footer: clip LED (lit for about a second when the loop clip engages) and the MIN note. */
function radDrawStatus(page) {
    var st = RAD.status;
    var loop = rpNum("loop", 0);
    var s = rpT.s;
    if (!RDS.now) RDS.now = Date.now();
    if (!(loop > 0)) {
        rpText("loop off", st.x, st.led + 3, 7.5, RPC.dim, true);
        return;
    }
    var age = RDS.now - RDS.clipAt;
    var lit = RDS.clipAt > 0 && age < 1500 ? (age < 1000 ? 1 : 1 - (age - 1000) / 500) : 0;
    rpColor(RPC.coral, 0.25 + 0.75 * lit);
    mgraphics.ellipse(st.x, st.led - 3, 7, 7);
    mgraphics.fill();
    rpText("CLIP", st.x + 11, st.led + 3, 7.5, lit > 0 ? RPC.coral : RPC.dim, true);
    if (s && s[RP_SCOPE.CLAMPED] > 0.5) {
        var label = "MIN " + rpFormatMs(s[RP_SCOPE.MIN_MS]);
        var pw = rpTextW(label, 7.5, true) + 10;
        rpPill(st.x, st.min - 8, pw, 12, RPC.amber, 0.18);
        rpText(label, st.x + 5, st.min + 1, 7.5, RPC.amber, true);
    }
}

// ---- scripts/render_preview.py ---------------------------------------------------------------------------------------

function preview() {
    rpPreviewBase(1, 2.5);
    rpP.algo = 1; rpP.lowcut = 60; rpP.highcut = 16000; rpP.loop = 40;
    RDS.now = 1;
    var g = /** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : {});
    var mode = g.process && g.process.env ? g.process.env.RC_PREVIEW : "";
    if (mode === "conv") {
        rpP.algo = 5;
        rpT.s = rpFakeScope(5, 2.2);
    }
    rpT.s[RP_SCOPE.CLAMPED] = 1;
}
