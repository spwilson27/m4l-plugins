// Deviate Constellation face: an indigo night sky. One star per meta over its strip: y = the drawn value (glides 150 ms to a new draw), halo = Range,
// a faint home marker = the Value. Chain lines between the stars glow with the T / B / L levels, a hit is a seeded burst of sparks that fades with the
// Ring envelope, the background starfield twinkles with the output spectrum. A click on the sky is a manual hit (role "hit").

var CS_COLS = 8;
var CS_PAL = {
    bg: [0.03, 0.035, 0.10, 1], white: [0.95, 0.96, 1.0, 1], cyan: [0.40, 0.85, 1.0, 1], magenta: [0.95, 0.40, 0.80, 1],
    dim: [0.42, 0.47, 0.72, 1], lav: [0.80, 0.82, 1.0, 1], kept: [0.62, 0.55, 0.85, 1],
};
var CS_CHAIN_OF_SEG = [0, 0, 0, 1, 1, 2, 2];                       // segment j (star j -> j+1) belongs to chain T, B or L
var CS_CHAIN_COL = [CS_PAL.cyan, CS_PAL.lav, CS_PAL.magenta];
var CS_TOP = 25, CS_BOTTOM = 57;                                    // star y for value 100 / 0
var CS_GLIDE_MS = 150;

var cs = { init: false, from: [0, 0, 0, 0, 0, 0, 0, 0], tgt: [0, 0, 0, 0, 0, 0, 0, 0], t0: 0, task: null, stars: null };

var hitZones = [[0, 0, 424, 82]];

dvPoll(30);
dvNeed({ spec: true });

function csMix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

function csYOf(v) {
    return CS_BOTTOM - dvClamp(v, 0, 100) * (CS_BOTTOM - CS_TOP) / 100;
}

/** star i's displayed value at time `now` (a 150 ms ease-out glide from where it was) */
function csDisp(i, now) {
    var k = dvClamp((now - cs.t0) / CS_GLIDE_MS, 0, 1);
    var e = 1 - (1 - k) * (1 - k) * (1 - k);
    return cs.from[i] + (cs.tgt[i] - cs.from[i]) * e;
}

function csTick() {
    mgraphics.redraw();
    if (cs.task && Date.now() - cs.t0 < CS_GLIDE_MS + 60) cs.task.schedule(40);
}

function csSync(now) {
    var i, changed = false, t = [];
    for (i = 0; i < CS_COLS; i++) t.push(dvMetaValue(i));
    if (!cs.init) {
        cs.init = true;
        for (i = 0; i < CS_COLS; i++) { cs.from[i] = t[i]; cs.tgt[i] = t[i]; }
        cs.t0 = -1e9;
        return;
    }
    for (i = 0; i < CS_COLS; i++) if (Math.abs(t[i] - cs.tgt[i]) > 0.05) changed = true;
    if (!changed) return;
    for (i = 0; i < CS_COLS; i++) { cs.from[i] = csDisp(i, now); cs.tgt[i] = t[i]; }
    cs.t0 = now;
    dvAnimate(CS_GLIDE_MS + 80);
    if (typeof Task !== "undefined") {
        if (!cs.task) cs.task = new Task(csTick, this);
        cs.task.schedule(40);
    }
}

function csStars() {
    if (cs.stars) return cs.stars;
    var rng = dvRng(1234), a = [], i;
    for (i = 0; i < 36; i++) a.push({ x: 3 + rng() * 418, y: 3 + rng() * 76, ph: i * 3 });
    cs.stars = a;
    return a;
}

function onFrame() {
    csSync(Date.now());
    return true;
}

function onclick() {
    dvManualHit();
}

function preview() {
    dvPreviewBase();
    cs.init = false;
    csSync(0);
}

function csPaintTwinkle(W, H) {
    var st = csStars(), i, tier, spec = dvTel.spec, fr = dvTel.frames;
    var alphas = [0.22, 0.38, 0.6, 0.95], buckets = [[], [], [], []];
    for (i = 0; i < st.length; i++) {
        var band = Math.min(31, Math.floor(st[i].x / W * 32));
        var db = spec && spec.length > band ? Number(spec[band]) : -100;
        var lv = dvClamp((db + 85) / 60, 0, 1) * (0.8 + 0.2 * (((fr + st[i].ph) % 5) / 4));
        tier = lv < 0.12 ? 0 : lv < 0.4 ? 1 : lv < 0.7 ? 2 : 3;
        buckets[tier].push(st[i]);
    }
    for (tier = 0; tier < 4; tier++) {
        if (!buckets[tier].length) continue;
        dvColor(CS_PAL.white, alphas[tier]);
        var s = tier >= 3 ? 2.4 : tier >= 2 ? 2 : 1.6;
        for (i = 0; i < buckets[tier].length; i++) { mgraphics.rectangle(buckets[tier][i].x, buckets[tier][i].y, s, s); mgraphics.fill(); }
    }
}

function csPaintParticles(xs, ys, vals, flash) {
    var age = dvTel.ageMs, env = dvTel.ringEnv;
    if (age < 0 || env < 0.02 || dvTel.hits < 1) return;
    var rng = dvRng(dvTel.hits * 131 + dvTel.serial * 7 + 3);
    var spread = 0.55 + dvTel.ring;                                 // the Ring meta throws the sparks further
    var t = age / 1000, grow = 1 - Math.exp(-t / 0.05);
    var A = Math.pow(env, 0.7) * 0.9, i, j, c, W = 424, H = 82;
    for (c = 0; c < 2; c++) {                                       // two colours: cyan and magenta sparks
        if (dvTel.gate) { dvColor(c ? CS_PAL.magenta : CS_PAL.cyan, A); } else { dvColor(CS_PAL.kept, A * 0.8); mgraphics.set_line_width(1); }
        for (i = 0; i < CS_COLS; i++) {
            for (j = 0; j < 4; j++) {
                var ang = rng() * 6.2832, sp = (14 + rng() * 40) * spread * (1 + 0.5 * flash);
                var px = dvClamp(xs[i] + Math.cos(ang) * sp * grow, 2, W - 3), py = dvClamp(ys[i] + Math.sin(ang) * sp * grow * 0.8, 2, H - 3);
                if (dvTel.gate) { mgraphics.rectangle(px - 1, py - 1, 2.6, 2.6); mgraphics.fill(); }
                else { mgraphics.ellipse(px - 2, py - 2, 4, 4); mgraphics.stroke(); }
            }
        }
    }
}

function paint() {
    var W = mgraphics.size[0], H = mgraphics.size[1], i, now = Date.now();
    var gate = dvTel.gate, age = dvTel.ageMs, flash = age >= 0 ? Math.max(0, 1 - age / 180) : 0;
    csSync(now);
    // night sky, with the afterglow of the Ring tail
    dvColor(CS_PAL.bg);
    mgraphics.rectangle_rounded(0, 0, W, H, 5, 5);
    mgraphics.fill();
    var glow = dvTel.ringEnv * (0.35 + 0.65 * dvTel.ring);
    if (glow > 0.01) {
        dvColor(gate ? CS_PAL.magenta : CS_PAL.kept, 0.12 * glow);
        mgraphics.rectangle_rounded(1, 1, W - 2, H - 2, 4, 4);
        mgraphics.fill();
    }
    csPaintTwinkle(W, H);
    // faint value lines at 0 / 50 / 100
    dvColor(CS_PAL.dim, 0.14);
    for (i = 0; i < 3; i++) mgraphics.rectangle(2, csYOf(i * 50), W - 4, 1);
    mgraphics.fill();

    var xs = [], ys = [], vals = [];
    for (i = 0; i < CS_COLS; i++) { xs.push((i + 0.5) * W / CS_COLS); vals.push(csDisp(i, now)); ys.push(csYOf(vals[i])); }

    // chain lines glow with the T / B / L levels
    var pk = [dvTel.pk.t, dvTel.pk.b, dvTel.pk.l], j;
    for (j = 0; j < CS_COLS - 1; j++) {
        var ch = CS_CHAIN_OF_SEG[j], p = dvClamp(pk[ch], 0, 1), col = CS_CHAIN_COL[ch];
        mgraphics.set_line_width(5);
        dvColor(col, 0.04 + 0.30 * p);
        mgraphics.move_to(xs[j], ys[j]); mgraphics.line_to(xs[j + 1], ys[j + 1]); mgraphics.stroke();
        mgraphics.set_line_width(1);
        dvColor(col, 0.22 + 0.7 * p);
        mgraphics.move_to(xs[j], ys[j]); mgraphics.line_to(xs[j + 1], ys[j + 1]); mgraphics.stroke();
    }

    // stars: home marker (the Value), halo (the Range), spikes and core
    var tweening = now - cs.t0 < CS_GLIDE_MS;
    for (i = 0; i < CS_COLS; i++) {
        var k = DV_META_KEYS[i], x = xs[i], y = ys[i], v = vals[i];
        var home = csYOf(dvParam("v_" + k)), rg = dvClamp(dvParam("r_" + k), 0, 100) / 100;
        var R = 3 + 11 * rg, sc = csMix(CS_PAL.cyan, CS_PAL.magenta, i / 7);
        if (Math.abs(home - y) > 1.5) {
            dvColor(CS_PAL.dim, 0.35);
            mgraphics.rectangle(x, Math.min(home, y), 1, Math.abs(home - y));
            mgraphics.fill();
            mgraphics.set_line_width(1);
            dvCircle(x, home, 2);
            mgraphics.stroke();
        }
        if (tweening) { dvColor(CS_PAL.white, 0.4); mgraphics.rectangle(x - 5, csYOf(cs.tgt[i]), 10, 1); mgraphics.fill(); }
        dvColor(gate ? sc : CS_PAL.kept, 0.05 + 0.04 * flash);
        dvCircle(x, y, R); mgraphics.fill();
        dvColor(gate ? sc : CS_PAL.kept, 0.09 + 0.08 * flash);
        dvCircle(x, y, R * 0.55); mgraphics.fill();
        mgraphics.set_line_width(1);
        dvColor(sc, gate ? 0.45 : 0.25);
        dvCircle(x, y, R); mgraphics.stroke();
        var sz = (2.2 + v / 100 * 1.6) * (1 + 0.7 * flash), sp = sz * 2.4;
        dvColor(gate ? CS_PAL.white : CS_PAL.kept, 0.5 + 0.4 * flash);
        mgraphics.move_to(x - sp, y); mgraphics.line_to(x + sp, y);
        mgraphics.move_to(x, y - sp); mgraphics.line_to(x, y + sp);
        mgraphics.stroke();
        dvColor(gate ? CS_PAL.white : CS_PAL.kept, 1);
        dvCircle(x, y, sz); mgraphics.fill();
        if (dvParam("l_" + k) > 0.5) {                               // locked: a small diamond under the star
            dvColor(CS_PAL.white, 0.9);
            dvPoly([[x, 66], [x + 3, 69], [x, 72], [x - 3, 69]], true);
            mgraphics.fill();
        }
        var lab = DV_METAS[i].toUpperCase() + " " + Math.round(dvMetaValue(i));
        dvText(lab, x - dvTextW(lab, 7.5, false) / 2, 80, 7.5, CS_PAL.dim, false);
    }
    csPaintParticles(xs, ys, vals, flash);

    // the onset flash: a white wash for an accepted hit, a violet frame when Chance rejected it
    if (flash > 0.01) {
        if (gate) { dvColor(CS_PAL.white, 0.12 * flash); mgraphics.rectangle_rounded(0, 0, W, H, 5, 5); mgraphics.fill(); }
        else { mgraphics.set_line_width(2); dvColor(CS_PAL.kept, 0.9 * flash); mgraphics.rectangle_rounded(1, 1, W - 2, H - 2, 4, 4); mgraphics.stroke(); }
    }
    // chain legend (T / B / L levels), mode, status
    var lx = 6, names = ["T", "B", "L"];
    for (i = 0; i < 3; i++) {
        dvText(names[i], lx + i * 19, 11, 7, CS_PAL.dim, true);
        var bh = Math.max(1, Math.min(1, pk[i]) * 9);
        dvColor(CS_CHAIN_COL[i], 0.9);
        mgraphics.rectangle(lx + i * 19 + 7, 11 - bh, 4, bh);
        mgraphics.fill();
    }
    var right = W - 6;
    var pw = dvDrawDspPill(right, 4, 8, DVC);
    if (pw) right -= pw + 4;
    var mode = dvParam("split") > 0.5 ? "SPEC" : "ENV";
    dvText(mode, right - dvTextW(mode, 7.5, true), 11, 7.5, CS_PAL.dim, true);
    if (!gate && dvTel.hits > 0 && age >= 0) {
        var kw = dvTextW("KEPT", 8, true) + 10;
        dvPill(W / 2 - kw / 2, 4, kw, 13, CS_PAL.kept, 0.85);
        dvText("KEPT", W / 2 - kw / 2 + 5, 14, 8, [0.05, 0.05, 0.12, 1], true);
    }
}
