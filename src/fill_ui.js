// Fill face. One picture, two pages. The v8ui paints Matter / Ring / Scar / Dust
// and the picture labels. Wings are live.numbox pairs; this script only hides
// the page that is not showing and forwards already-scaled gen messages.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var FILL_PICTURES = ["Matter", "Ring", "Scar", "Dust"];
var FILL_NORMAL_KEYS = ["tune", "tuner", "strike", "striker", "damp", "dampr", "beater", "beaterr", "metal", "metalr", "space", "spacer", "bmodel", "amodel"];
var FILL_NORMAL_LABELS = ["tune", "strike", "damp", "beater", "metal", "space"];
var FILL_EXP_KEYS = ["mass", "massr", "scatter", "scatterr", "decay", "decayr", "couple", "coupler", "bite", "biter", "air", "airr"];
var FILL_EXP_LABELS = ["mass", "scatter", "decay", "couple", "bite", "air"];

// msg, scale. Percent knobs /100. tune/tuner/space/spacer stay in native units.
// beater/metal and their ranges /100 so 100 -> 1 and 200 -> 2.
var FILL_OUT = {
    page: ["page", 1],
    rand: ["randamt", 0.01],
    mix: ["wet", 0.01],
    sens: ["sens", 0.01],
    seed: ["seed", 1],
    mode: ["mode", 1],
    play: ["play", 1],
    tune: ["tune", 1],
    tuner: ["tuner", 1],
    strike: ["strike", 0.01],
    striker: ["striker", 0.01],
    damp: ["damp", 0.01],
    dampr: ["dampr", 0.01],
    beater: ["beater", 0.01],
    beaterr: ["beaterr", 0.01],
    metal: ["metal", 0.01],
    metalr: ["metalr", 0.01],
    space: ["space", 1],
    spacer: ["spacer", 1],
    bmix: ["bmix", 0.01],
    bmixr: ["bmixr", 0.01],
    amix: ["amix", 0.01],
    amixr: ["amixr", 0.01],
    bmodel: ["bmodel", 1],
    amodel: ["amodel", 1]
};

var FILL_IR_KEYS = {
    bmodel: 1, bdecay: 1, bdecayr: 1, bsize: 1, bsizer: 1, bcolor: 1, bcolorr: 1,
    tune: 1, tuner: 1,
    amodel: 1, adecay: 1, adecayr: 1, asize: 1, asizer: 1, acolor: 1, acolorr: 1,
    seed: 1
};
var FILL_META_KEYS = {
    mass: 1, massr: 1, scatter: 1, scatterr: 1, decay: 1, decayr: 1,
    couple: 1, coupler: 1, bite: 1, biter: 1, air: 1, airr: 1,
    rand: 1, seed: 1, page: 1
};

var fillP = {
    page: 0, sens: 45, rand: 0, mix: 100, seed: 1, mode: 0, play: 0, picture: 0,
    tune: 0, tuner: 0, strike: 0, striker: 0, damp: 0, dampr: 0,
    beater: 100, beaterr: 0, metal: 100, metalr: 0, space: 0, spacer: 0,
    bmodel: 0, amodel: 0,
    bdecay: 40, bdecayr: 0, bsize: 100, bsizer: 0, bcolor: 0, bcolorr: 0, bmix: 0, bmixr: 0,
    adecay: 40, adecayr: 0, asize: 100, asizer: 0, acolor: 0, acolorr: 0, amix: 0, amixr: 0,
    mass: 35, massr: 0, scatter: 25, scatterr: 0, decay: 40, decayr: 0,
    couple: 20, coupler: 0, bite: 55, biter: 0, air: 15, airr: 0
};

var fillPaintKey = "";
var fillPoll = null;

function fillObj(name) {
    if (!fillHost || typeof fillHost.getnamed !== "function") return null;
    var o = null;
    try { o = fillHost.getnamed(name); } catch (e) { return null; }
    if (!o || o.valid === 0) return null;
    return o;
}

function fillHidden(name, hidden) {
    var o = fillObj(name);
    if (!o) return;
    try { o.message("hidden", hidden ? 1 : 0); } catch (e) {}
}

function fillHideList(keys, prefix, hidden) {
    var i;
    for (i = 0; i < keys.length; i++) fillHidden(prefix + keys[i], hidden);
}

function fillApplyPage() {
    var exp = fillP.page >= 0.5;
    fillHideList(FILL_NORMAL_KEYS, "obj-ctrl-", exp);
    fillHideList(FILL_NORMAL_LABELS, "obj-lbl-", exp);
    fillHideList(FILL_EXP_KEYS, "obj-ctrl-", !exp);
    fillHideList(FILL_EXP_LABELS, "obj-lbl-", !exp);
}

function fillPushGen(key) {
    var spec = FILL_OUT[key];
    if (!spec || typeof fillP[key] === "undefined") return;
    outlet(0, [spec[0], Number(fillP[key]) * spec[1]]);
}

function fillSendToggles() {
    var k;
    for (k in FILL_OUT) {
        if (Object.prototype.hasOwnProperty.call(FILL_OUT, k)) fillPushGen(k);
    }
}

function fillOnParam(key, value) {
    var v = Number(value);
    if (v !== v) return;
    fillP[key] = v;
    fillPushGen(key);
    if (key === "page") fillApplyPage();
    if (FILL_IR_KEYS[key] && typeof fillScheduleIr === "function") fillScheduleIr();
    if (key === "page" && fillP.page >= 0.5 && typeof fillPublishBank === "function") fillPublishBank();
    else if ((FILL_META_KEYS[key] || key === "page") && fillP.page >= 0.5 && typeof fillScheduleBank === "function") fillScheduleBank();
    if (key === "picture" || key === "page") {
        fillPaintKey = "";
        mgraphics.redraw();
    }
}

function set_page(v) { fillOnParam("page", v); }
function set_sens(v) { fillOnParam("sens", v); }
function set_rand(v) { fillOnParam("rand", v); }
function set_mix(v) { fillOnParam("mix", v); }
function set_seed(v) { fillOnParam("seed", v); }
function set_mode(v) { fillOnParam("mode", v); }
function set_play(v) { fillOnParam("play", v); }
function set_picture(v) { fillOnParam("picture", v); }
function set_tune(v) { fillOnParam("tune", v); }
function set_tuner(v) { fillOnParam("tuner", v); }
function set_strike(v) { fillOnParam("strike", v); }
function set_striker(v) { fillOnParam("striker", v); }
function set_damp(v) { fillOnParam("damp", v); }
function set_dampr(v) { fillOnParam("dampr", v); }
function set_beater(v) { fillOnParam("beater", v); }
function set_beaterr(v) { fillOnParam("beaterr", v); }
function set_metal(v) { fillOnParam("metal", v); }
function set_metalr(v) { fillOnParam("metalr", v); }
function set_space(v) { fillOnParam("space", v); }
function set_spacer(v) { fillOnParam("spacer", v); }
function set_bmodel(v) { fillOnParam("bmodel", v); }
function set_amodel(v) { fillOnParam("amodel", v); }
function set_bdecay(v) { fillOnParam("bdecay", v); }
function set_bdecayr(v) { fillOnParam("bdecayr", v); }
function set_bsize(v) { fillOnParam("bsize", v); }
function set_bsizer(v) { fillOnParam("bsizer", v); }
function set_bcolor(v) { fillOnParam("bcolor", v); }
function set_bcolorr(v) { fillOnParam("bcolorr", v); }
function set_bmix(v) { fillOnParam("bmix", v); }
function set_bmixr(v) { fillOnParam("bmixr", v); }
function set_adecay(v) { fillOnParam("adecay", v); }
function set_adecayr(v) { fillOnParam("adecayr", v); }
function set_asize(v) { fillOnParam("asize", v); }
function set_asizer(v) { fillOnParam("asizer", v); }
function set_acolor(v) { fillOnParam("acolor", v); }
function set_acolorr(v) { fillOnParam("acolorr", v); }
function set_amix(v) { fillOnParam("amix", v); }
function set_amixr(v) { fillOnParam("amixr", v); }
function set_mass(v) { fillOnParam("mass", v); }
function set_massr(v) { fillOnParam("massr", v); }
function set_scatter(v) { fillOnParam("scatter", v); }
function set_scatterr(v) { fillOnParam("scatterr", v); }
function set_decay(v) { fillOnParam("decay", v); }
function set_decayr(v) { fillOnParam("decayr", v); }
function set_couple(v) { fillOnParam("couple", v); }
function set_coupler(v) { fillOnParam("coupler", v); }
function set_bite(v) { fillOnParam("bite", v); }
function set_biter(v) { fillOnParam("biter", v); }
function set_air(v) { fillOnParam("air", v); }
function set_airr(v) { fillOnParam("airr", v); }

function fillAmp(v) {
    var x = Number(v) || 0;
    if (x < 0) x = 0;
    if (x > 1) x = 1;
    return x;
}

function fillEnergyAt(i) {
    var e = 0;
    var raw = fillTele && fillTele.energy;
    if (raw && i >= 0 && i < raw.length) e = Number(raw[i]) || 0;
    var env = 0;
    if (fillTele && fillTele.slots) env = fillAmp(fillTele.slots[2]);
    var shaped = env * Math.exp(-i / 7);
    if (shaped > e) e = shaped;
    if (e < 0) e = 0;
    if (e > 1) e = 1;
    return e;
}

function fillPeekSpan(buf, start, count) {
    if (!buf || typeof buf.peek !== "function") return null;
    var raw = null;
    try { raw = buf.peek(1, start, count); } catch (e) { return null; }
    if (typeof raw === "number") return [raw];
    if (!raw || !raw.length) return null;
    return raw;
}

function fillScopeIdle(slots, energy) {
    if (Math.abs(slots[2] || 0) > 1e-4) return 0;
    var i;
    for (i = 0; i < energy.length; i++) {
        if (Math.abs(energy[i] || 0) > 1e-4) return 0;
    }
    return 1;
}

function fillPullScope() {
    var raw = fillPeekSpan(fillBufScope, 0, 40);
    if (!raw) return;
    var slots = [0, 0, 0, 0, 0, 0, 0, 0];
    var energy = [];
    var i;
    for (i = 0; i < 8; i++) slots[i] = Number(raw[i]) || 0;
    for (i = 0; i < 32; i++) energy[i] = Number(raw[8 + i]) || 0;
    var hit = Math.round(slots[3]);
    if (hit !== hit || hit < 0) hit = 0;
    var prevHit = fillTele.hit;
    fillTele.slots = slots;
    fillTele.energy = energy;
    fillTele.hit = hit;
    if (hit !== prevHit && fillP.page >= 0.5 && typeof fillScheduleBank === "function") fillScheduleBank();
    var key = fillP.picture + ":" + fillP.page + ":" + hit;
    if (fillScopeIdle(slots, energy) && key === fillPaintKey) return;
    fillPaintKey = key;
    mgraphics.redraw();
}

function fillStartPoll() {
    if (typeof Task !== "function") return;
    if (!fillPoll) {
        fillPoll = new Task(fillPullScope, this);
        fillPoll.interval = 40;
    }
    try { fillPoll.repeat(); } catch (e) {}
}

function fillClickPicture(x, y) {
    if (x && typeof x === "object") {
        y = x.y;
        x = x.x;
    }
    var w = (mgraphics && mgraphics.size) ? mgraphics.size[0] : 0;
    var h = (mgraphics && mgraphics.size) ? mgraphics.size[1] : 0;
    if (!(w > 1) || !(h > 1)) return -1;
    var nx = Number(x);
    var ny = Number(y);
    if (!(nx === nx) || !(ny === ny)) return -1;
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
        nx = nx * w;
        ny = ny * h;
    }
    if (ny < h - 22) return -1;
    var i = Math.floor((nx / w) * 4);
    if (i < 0) i = 0;
    if (i > 3) i = 3;
    return i;
}

function fillChoosePicture(i) {
    var n = Math.round(Number(i));
    if (n !== n || n < 0) n = 0;
    if (n > 3) n = 3;
    fillOnParam("picture", n);
    var menu = fillObj("obj-ctrl-picture");
    if (menu) {
        try { menu.message(n); } catch (e) {}
    }
    outlet(1, n);
}

function onclick(x, y) {
    var i = fillClickPicture(x, y);
    if (i < 0) return;
    fillChoosePicture(i);
}

function test_picture(v) {
    fillChoosePicture(v);
}

function test_report() {
    if (typeof File !== "function") return;
    var f = new File("/tmp/fill_face_report.txt", "write", "TEXT");
    if (!f || !f.isopen) return;
    var slots = (fillTele && fillTele.slots) ? fillTele.slots : [];
    var energy = (fillTele && fillTele.energy) ? fillTele.energy : [];
    f.writestring("picture " + fillP.picture + "\n");
    f.writestring("page " + fillP.page + "\n");
    f.writestring("strike " + fillP.strike + "\n");
    f.writestring("tune " + fillP.tune + "\n");
    f.writestring("damp " + fillP.damp + "\n");
    f.writestring("beater " + fillP.beater + "\n");
    f.writestring("metal " + fillP.metal + "\n");
    f.writestring("space " + fillP.space + "\n");
    f.writestring("bmodel " + fillP.bmodel + "\n");
    f.writestring("amodel " + fillP.amodel + "\n");
    f.writestring("mass " + fillP.mass + "\n");
    f.writestring("decay " + fillP.decay + "\n");
    f.writestring("in " + (slots[0] || 0) + "\n");
    f.writestring("outpk " + (slots[1] || 0) + "\n");
    f.writestring("env " + (slots[2] || 0) + "\n");
    var cords = (typeof fillDspCords === "function") ? fillDspCords(fillObj("fill_gen")) : { inn: -1, outn: -1 };
    f.writestring("cords " + cords.inn + " " + cords.outn + "\n");
    f.writestring("hit " + (fillTele ? fillTele.hit : 0) + "\n");
    f.writestring("frame " + (slots[7] || 0) + "\n");
    f.writestring("e0 " + (energy[0] || 0) + "\n");
    f.writestring("ready " + ((typeof fillDsp !== "undefined" && fillDsp.ready) ? 1 : 0) + "\n");
    f.writestring("bankgen " + ((typeof fillBankGen !== "undefined") ? fillBankGen : 0) + "\n");
    var fund = 0;
    if (fillBufBank && typeof fillBufBank.peek === "function") {
        try {
            var phaseRaw = fillBufBank.peek(1, 16, 1);
            var phase = typeof phaseRaw === "number" ? phaseRaw : (phaseRaw && phaseRaw.length ? phaseRaw[0] : 0);
            fund = (Number(phase) || 0) * fillSr() / (2 * Math.PI);
        } catch (eFund) {}
    }
    f.writestring("fund " + fund + "\n");
    f.writestring("error " + ((typeof fillDsp !== "undefined" && fillDsp.error) ? fillDsp.error : "") + "\n");
    f.close();
}

function fillPaintLabels(w, h) {
    var strip = h - 16;
    var pic = fillClamp(Math.round(fillP.picture) || 0, 0, 3);
    var i;
    for (i = 0; i < 4; i++) {
        var x0 = Math.round(i * w / 4);
        var x1 = Math.round((i + 1) * w / 4);
        var on = i === pic;
        sptRgba(sptColor(on ? "live_control_selection" : "live_control_bg"));
        mgraphics.rectangle(x0 + 1, strip + 1, Math.max(1, x1 - x0 - 2), 14);
        mgraphics.fill();
        sptText(FILL_PICTURES[i], (x0 + x1) * 0.5, h - 5, sptColor(on ? "live_lcd_bg" : "live_control_fg"), 8, 1);
    }
}

function fillPaintMatter(w, plotH) {
    var cx = w * 0.5;
    var cy = plotH * 0.5;
    var n = 32;
    var i;
    sptRgba(sptColor("live_control_selection"));
    mgraphics.ellipse(cx - 4, cy - 4, 8, 8);
    mgraphics.fill();
    for (i = 0; i < n; i++) {
        var e = fillAmp(fillEnergyAt(i));
        var ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        var rest = 5 + (1 - i / n) * 8;
        var len = rest + e * 36 * (1 - i / n * 0.55);
        sptRgba(sptColor("live_control_selection"), 0.35 + 0.65 * e);
        mgraphics.set_line_width(1.25);
        mgraphics.move_to(cx, cy);
        mgraphics.line_to(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        mgraphics.stroke();
    }
}

function fillPaintRing(w, plotH) {
    var cx = w * 0.5;
    var cy = plotH * 0.5;
    var ring = 26;
    var n = 32;
    var i;
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.arc(cx, cy, ring, 0, Math.PI * 2);
    mgraphics.stroke();
    for (i = 0; i < n; i++) {
        var e = fillAmp(fillEnergyAt(i));
        var ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        var r = ring + e * 22;
        var x = cx + Math.cos(ang) * r;
        var y = cy + Math.sin(ang) * r;
        sptRgba(sptColor("live_control_selection"), 0.4 + 0.6 * e);
        mgraphics.ellipse(x - 2, y - 2, 4, 4);
        mgraphics.fill();
    }
}

function fillPaintScar(w, plotH) {
    var n = 32;
    var bw = (w - 16) / n;
    var base = plotH - 6;
    var maxH = plotH - 22;
    var i;
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.move_to(8, base);
    mgraphics.line_to(w - 8, base);
    mgraphics.stroke();
    for (i = 0; i < n; i++) {
        var eh = Math.max(2, fillAmp(fillEnergyAt(i)) * maxH);
        sptRgba(sptColor("live_control_selection"), 0.9);
        mgraphics.rectangle(8 + i * bw, base - eh, Math.max(1, bw - 1.5), eh);
        mgraphics.fill();
    }
    if (fillP.page < 0.5) {
        var env = fillAmp(fillTele.slots[2]);
        sptRgba(sptColor("live_display_line_two"), 0.55);
        mgraphics.set_line_width(1.25);
        mgraphics.move_to(8, base);
        for (i = 0; i < n; i++) {
            var eh2 = env * (0.35 + 0.65 * fillAmp(fillEnergyAt(i))) * (maxH * 0.85);
            mgraphics.line_to(8 + i * bw + bw * 0.5, base - eh2);
        }
        mgraphics.line_to(w - 8, base);
        mgraphics.stroke();
    }
}

function fillPaintDust(w, plotH) {
    var n = 32;
    var i;
    for (i = 0; i < n; i++) {
        var e = fillAmp(fillEnergyAt(i));
        var u = ((i * 1103515245 + 12345) % 1000) / 1000;
        if (u < 0) u += 1;
        var s = 2 + e * 4;
        var x = 8 + u * (w - 20);
        var y = (plotH - 10) - e * (plotH - 22);
        sptRgba(sptColor("live_control_selection"), 0.35 + 0.65 * Math.max(e, 0.15));
        mgraphics.ellipse(x, y, s, s);
        mgraphics.fill();
    }
}

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    var plotH = h - 16;
    sptRgba(sptColor("live_lcd_bg"));
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    var pic = fillClamp(Math.round(fillP.picture) || 0, 0, 3);
    if (pic === 1) fillPaintRing(w, plotH);
    else if (pic === 2) fillPaintScar(w, plotH);
    else if (pic === 3) fillPaintDust(w, plotH);
    else fillPaintMatter(w, plotH);

    var hit = 0;
    if (fillTele && fillTele.slots) {
        hit = Math.round(fillTele.slots[3]);
        if (hit !== hit || hit < 0) hit = 0;
    }
    sptText(String(hit), w - 8, 13, sptColor("live_control_selection"), 9, 2);
    if (fillP.page >= 0.5) {
        sptText("408 coeffs  <= 0.50 s", 6, 13, sptColor("live_lcd_title"), 8, 0);
    }

    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.move_to(1, plotH);
    mgraphics.line_to(w - 1, plotH);
    mgraphics.stroke();
    fillPaintLabels(w, h);

    if (typeof fillDsp !== "undefined" && !fillDsp.ready) {
        var pill = fillDsp.error ? ("DSP failed: " + fillDsp.error) : "DSP loading…";
        sptText(pill, 6, plotH - 4, sptColor("live_alert"), 8, 0);
    }
}

function fillDemoEnergy() {
    var e = [];
    var i;
    for (i = 0; i < 32; i++) {
        var t = i / 31;
        e[i] = Math.exp(-i / 7) * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(i * 1.3))) * (1 - t * 0.35);
    }
    return e;
}

function previewState(name) {
    fillP.page = 0;
    fillP.picture = 0;
    fillP.sens = 45;
    fillP.rand = 40;
    fillP.mix = 100;
    fillTele.slots = [0.2, 0.5, 0.62, 4, 0, 1, 1, 8];
    fillTele.energy = fillDemoEnergy();
    fillTele.hit = 4;
    if (name === "exp" || name === "exp-matter" || name === "experimental") {
        fillP.page = 1;
        fillTele.slots[4] = 1;
    } else if (name === "ring") {
        fillP.picture = 1;
    } else if (name === "scar") {
        fillP.picture = 2;
    } else if (name === "dust") {
        fillP.picture = 3;
    }
    fillPaintKey = "";
    if (typeof fillDsp !== "undefined") {
        fillDsp.ready = 1;
        fillDsp.error = "";
    }
}

function preview() {
    previewState("normal-matter");
}

function loadbang() {
    fillApplyPage();
    fillStartPoll();
    if (typeof fillScheduleIr === "function") fillScheduleIr();
    mgraphics.redraw();
}
