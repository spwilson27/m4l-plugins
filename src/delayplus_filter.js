// Delay+ Filter Display: HP / LP response (12 dB/oct each) with draggable handles, like Echo's filter panel.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 1;

var hp = 50, lp = 5000, hpres = 0, lpres = 0, filton = 1, modfilt = 0;
var drag = 0, lastX = 0, lastY = 0;
var fdPal = null;
var FMIN = 20, FMAX = 20000, DBHI = 12, DBLO = -24;
var LOGR = Math.log(FMAX / FMIN);

function fdClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fdFx(f, w) { return Math.log(f / FMIN) / LOGR * w; }
function fdDbY(db, h) { return (DBHI - fdClamp(db, DBLO - 6, DBHI + 6)) / (DBHI - DBLO) * h; }

function fdMag(f) {
    var kh = 1.4142 * (1 - 0.95 * hpres), kl = 1.4142 * (1 - 0.95 * lpres);
    var wh = f / hp, wl = f / lp;
    var h2 = wh * wh, l2 = wl * wl;
    var hm = h2 / Math.sqrt((1 - h2) * (1 - h2) + kh * kh * h2);
    var lm = 1 / Math.sqrt((1 - l2) * (1 - l2) + kl * kl * l2);
    return 20 * Math.log(Math.max(1e-6, hm * lm)) / Math.LN10;
}

function fdHandle(i, w, h) {
    var f = i === 0 ? hp : lp;
    return [fdFx(f, w), fdDbY(fdMag(f), h)];
}

var fdThemeTask = dpThemeWatch();

function paint() {
    var BG = dpTheme("live_lcd_bg", [0.075, 0.075, 0.075, 1]);
    var LINE = dpTheme("live_display_line_one", [0.43, 0.78, 0.94, 1]);
    var H1 = dpTheme("live_display_handle_one", [0.96, 0.64, 0.23, 1]);
    var H2 = dpTheme("live_display_handle_two", [0.96, 0.64, 0.23, 1]);
    var SCALE = dpTheme("live_display_scale_text", [0.6, 0.6, 0.6, 1]);
    fdPal = { bg: BG, line: LINE, h1: H1, h2: H2, scale: SCALE };
    var mg = mgraphics, w = mg.size[0], h = mg.size[1], i, f, x;
    var dim = !filton;
    mg.set_source_rgba(fdPal.bg[0], fdPal.bg[1], fdPal.bg[2], 1);
    mg.rectangle(0, 0, w, h);
    mg.fill();
    // grid: decades + minor lines
    var decs = [10, 100, 1000, 10000];
    for (var d = 0; d < decs.length; d++) {
        for (var m = 1; m <= 9; m++) {
            f = decs[d] * m;
            if (f < FMIN || f > FMAX) continue;
            x = Math.round(fdFx(f, w)) + 0.5;
            mg.set_source_rgba(1, 1, 1, m === 1 ? 0.16 : 0.07);
            mg.set_line_width(1);
            mg.move_to(x, 0);
            mg.line_to(x, h);
            mg.stroke();
        }
    }
    for (var db = 0; db >= DBLO; db -= 12) {
        var gy = Math.round(fdDbY(db, h)) + 0.5;
        mg.set_source_rgba(1, 1, 1, db === 0 ? 0.12 : 0.05);
        mg.move_to(0, gy);
        mg.line_to(w, gy);
        mg.stroke();
    }
    // curve
    var pts = [], n = Math.max(2, Math.floor(w));
    for (i = 0; i <= n; i++) {
        f = FMIN * Math.exp(LOGR * i / n);
        pts.push([i / n * w, fdDbY(fdMag(f), h)]);
    }
    var cr = dim ? 0.5 : fdPal.line[0], cg = dim ? 0.5 : fdPal.line[1], cb = dim ? 0.5 : fdPal.line[2];
    mg.set_source_rgba(cr, cg, cb, 0.14);
    mg.move_to(0, h);
    for (i = 0; i < pts.length; i++) mg.line_to(pts[i][0], pts[i][1]);
    mg.line_to(w, h);
    mg.close_path();
    mg.fill();
    mg.set_source_rgba(cr, cg, cb, 1);
    mg.set_line_width(1.6);
    mg.move_to(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) mg.line_to(pts[i][0], pts[i][1]);
    mg.stroke();
    // labels
    mg.select_font_face("Arial");
    mg.set_font_size(8.5);
    mg.set_source_rgba(fdPal.scale[0], fdPal.scale[1], fdPal.scale[2], 1);
    var labs = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (i = 0; i < labs.length; i++) {
        var tw = mg.text_measure(labs[i][1])[0];
        mg.move_to(Math.round(fdFx(labs[i][0], w) - tw / 2), h - 3);
        mg.show_text(labs[i][1]);
    }
    // handles
    mg.set_font_size(9);
    for (i = 0; i < 2; i++) {
        var p = fdHandle(i, w, h), px = p[0], py = fdClamp(p[1], 7, h - 7);
        var act = drag === i + 1;
        var oc = dim ? [0.5, 0.5, 0.5] : (i === 0 ? fdPal.h1 : fdPal.h2);
        mg.ellipse(px - 6.5, py - 6.5, 13, 13);
        if (act) {
            mg.set_source_rgba(oc[0], oc[1], oc[2], 1);
            mg.fill();
            mg.set_source_rgba(fdPal.bg[0], fdPal.bg[1], fdPal.bg[2], 1);
        } else {
            mg.set_source_rgba(fdPal.bg[0], fdPal.bg[1], fdPal.bg[2], 1);
            mg.fill_preserve();
            mg.set_source_rgba(oc[0], oc[1], oc[2], 1);
            mg.set_line_width(1.5);
            mg.stroke();
        }
        var t = String(i + 1), tw2 = mg.text_measure(t)[0];
        mg.move_to(px - tw2 / 2, py + 3.2);
        mg.show_text(t);
    }
}

function fdHit(x, y) {
    var w = mgraphics.size[0], h = mgraphics.size[1], best = 0, bd = 10;
    for (var i = 0; i < 2; i++) {
        var p = fdHandle(i, w, h);
        var dx = x - p[0], dy = y - fdClamp(p[1], 7, h - 7), dd = Math.sqrt(dx * dx + dy * dy);
        if (dd <= bd) { bd = dd; best = i + 1; }
    }
    return best;
}

function onclick(x, y) {
    drag = fdHit(x, y);
    lastX = x;
    lastY = y;
    mgraphics.redraw();
}

function ondblclick(x, y) {
    var i = fdHit(x, y);
    if (i === 1) { hp = 50; hpres = 0; outlet(0, "hp", hp); outlet(0, "hpres", hpres); }
    else if (i === 2) { lp = 5000; lpres = 0; outlet(0, "lp", lp); outlet(0, "lpres", lpres); }
    else return;
    drag = 0;
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift) {
    if (!drag) return;
    var w = mgraphics.size[0], dx = x - lastX, dy = y - lastY;
    lastX = x;
    lastY = y;
    var fine = shift ? 0.1 : 1;
    var fac = Math.exp(dx / w * LOGR * fine);
    if (drag === 1) {
        hp = fdClamp(hp * fac, FMIN, Math.min(FMAX, lp * 0.99));
        hpres = fdClamp(hpres - dy / 60 * fine, 0, 1);
        outlet(0, "hp", hp);
        outlet(0, "hpres", hpres);
    } else {
        lp = fdClamp(lp * fac, Math.max(FMIN, hp * 1.01), FMAX);
        lpres = fdClamp(lpres - dy / 60 * fine, 0, 1);
        outlet(0, "lp", lp);
        outlet(0, "lpres", lpres);
    }
    mgraphics.redraw();
}

function onidle() {}
function onidleout() {}

function anything() {
    var m = messagename;
    if (m.indexOf("set_") !== 0) return;
    var v = Number(arguments[0]);
    var k = m.substring(4);
    if (k === "hp") hp = fdClamp(v, FMIN, FMAX);
    else if (k === "lp") lp = fdClamp(v, FMIN, FMAX);
    else if (k === "hpres") hpres = fdClamp(v, 0, 1);
    else if (k === "lpres") lpres = fdClamp(v, 0, 1);
    else if (k === "filton") filton = v ? 1 : 0;
    else if (k === "modfilt") modfilt = v;
    mgraphics.redraw();
}

function preview() { hp = 120; lp = 6000; hpres = 0.2; lpres = 0.35; }
