// Clip+ meter column. Momentary and integrated LUFS, RMS, peak, and crest
// for the input and the output, each with a horizontal bar. The block ring in
// #0-clipscope is drained here.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var M_W = 128;
var M_H = 122;
var M_RECT = { x: 0, y: 0, w: M_W, h: M_H };

var cpMeter = new CpMeter(48000);
var cpMeterSeen = -1;
var cpMeterBuf = "#0-clipscope";

function setbuffer(name) {
    if (name) cpMeterBuf = String(name);
}

function reset_meters() {
    cpMeter.reset();
    cpMeterSeen = -1;
    mgraphics.redraw();
}

function cpMeterNum(v) {
    var n = Number(v);
    return n === n ? n : 0;
}

function cpMeterDrain() {
    if (typeof Buffer !== "function") return;
    try {
        var b = new Buffer(cpMeterBuf);
        var head = b.peek(1, 8, 2);
        if (!head || !head.length) return;
        var frame = cpMeterNum(head[0]);
        var rate = head.length > 1 ? cpMeterNum(head[1]) : 0;
        if (rate > 1000 && Math.abs(rate - cpMeter.sr) > 1) cpMeter = new CpMeter(rate);
        if (cpMeterSeen < 0) {
            cpMeterSeen = frame;
            return;
        }
        if (frame === cpMeterSeen) return;
        var from = cpMeterSeen;
        if (frame - from > CLIP_METER_FRAMES) from = frame - CLIP_METER_FRAMES;
        var t, slot, row;
        for (t = from; t < frame; t++) {
            slot = t % CLIP_METER_FRAMES;
            row = b.peek(1, CLIP_METER_BASE + slot * 6, 6);
            if (!row || row.length < 6) continue;
            cpMeter.push(cpMeterNum(row[0]), cpMeterNum(row[1]), cpMeterNum(row[2]), cpMeterNum(row[3]), cpMeterNum(row[4]), cpMeterNum(row[5]));
        }
        cpMeterSeen = frame;
        mgraphics.redraw();
    } catch (_) {}
}

function cpMeterText(db) {
    if (!(db > -119)) return "-inf";
    var v = db;
    if (v > 99.9) v = 99.9;
    if (v < -99.9) v = -99.9;
    return v.toFixed(1);
}

function cpCrestText(pk, rms) {
    if (!(pk > -119) || !(rms > -119)) return "-";
    var c = pk - rms;
    if (!(c > 0)) c = 0;
    if (c > 99.9) c = 99.9;
    return c.toFixed(1);
}

function cpMeterBar(x, y, w, h, db, col) {
    var t = (db + 48) / 48;
    var bw;
    if (!(t > 0)) t = 0;
    if (t > 1) t = 1;
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    bw = (w - 2) * t;
    if (bw < 0.4) return;
    sptRgba(col);
    mgraphics.rectangle(x + 1, y + 1, bw, h - 2);
    mgraphics.fill();
}

function paint() {
    var mom = cpMeter.momentary();
    var ing = cpMeter.integrated();
    var rms = cpMeter.rms();
    var pk = cpMeter.peak();
    var title = sptColor("live_lcd_title");
    var value = sptColor("live_lcd_control_fg_alt");
    var inCol = sptColor("live_display_line_one");
    var outCol = sptColor("live_lcd_control_fg_alt");
    var rows = [
        ["Momentary", mom[0], mom[1]],
        ["Integrated", ing[0], ing[1]],
        ["RMS", rms[0], rms[1]],
        ["Peak", pk[0], pk[1]]
    ];
    var i, y;
    sptLcd(0, 0, M_W, M_H);
    sptTextIn("In", 84, 14, title, 8, 0, M_RECT);
    sptTextIn("Out", 106, 14, title, 8, 0, M_RECT);
    for (i = 0; i < rows.length; i++) {
        y = 32 + i * 16;
        sptTextIn(rows[i][0], 4, y, title, 8, 0, M_RECT);
        cpMeterBar(50, y - 8, 30, 3, rows[i][1], inCol);
        cpMeterBar(50, y - 4, 30, 3, rows[i][2], outCol);
        sptTextIn(cpMeterText(rows[i][1]), 82, y, value, 7, 0, M_RECT);
        sptTextIn(cpMeterText(rows[i][2]), 106, y, value, 7, 0, M_RECT);
    }
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(4, 94, 120, 1);
    mgraphics.fill();
    sptTextIn("Crest", 4, 110, title, 8, 0, M_RECT);
    sptTextIn(cpCrestText(pk[0], rms[0]), 82, 110, value, 7, 0, M_RECT);
    sptTextIn(cpCrestText(pk[1], rms[1]), 106, 110, value, 7, 0, M_RECT);
}

function preview() {
    var i, kick, kIn, kOut;
    cpMeter.reset();
    cpMeterSeen = -1;
    for (i = 0; i < 90; i++) {
        kick = (i % 12 === 0) ? 2.4 : 1;
        kIn = 0.028 * kick;
        kOut = 0.016 * (kick > 1 ? 1.35 : 1);
        cpMeter.push(kIn, kOut, kIn * 0.62, kOut * 0.62, 0.42 * (kick > 1 ? 1 : 0.55), 0.18);
    }
}

function cpMeterPoll() {
    cpMeterDrain();
}

if (typeof Task === "function") {
    var cpMeterTask = new Task(cpMeterPoll, this);
    cpMeterTask.interval = 33;
    cpMeterTask.repeat();
}
