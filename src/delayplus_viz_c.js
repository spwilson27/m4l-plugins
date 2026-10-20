// Delay+ visualization C — "Signal Flow".
// A live block diagram of the loop: IN -> TANK (delay + feedback fill) -> the devices placed between
// Delay+ and Delay+ End (one pill each, with its latency) -> END (dry + wet) -> OUT. A feedback arrow
// runs from END back to TANK, pulsing with the return level. Extra devices collapse into a "+N" pill.

var VIZ_NAME = "Signal Flow";

function vizIdle(s) {
    return false;
}

// Shorten str with an ellipsis until it fits maxW.
function dpcFit(str, maxW, size, bold) {
    str = String(str);
    if (dpTextW(str, size, bold) <= maxW) return str;
    while (str.length > 1 && dpTextW(str + "…", size, bold) > maxW) str = str.substring(0, str.length - 1);
    return str + "…";
}

function dpcCenterText(str, cx, y, size, c, bold) {
    dpText(str, cx - dpTextW(str, size, bold) / 2, y, size, c, bold);
}

function dpcLevel(pk) {
    return Math.sqrt(dpClamp(pk || 0, 0, 1));
}

function dpcArrowHead(mg, tx, ty, dir) {
    // dir: 0 = pointing right, 1 = down, 2 = left
    mg.move_to(tx, ty);
    if (dir === 0) { mg.line_to(tx - 4, ty - 3); mg.line_to(tx - 4, ty + 3); }
    else if (dir === 1) { mg.line_to(tx - 3, ty - 4); mg.line_to(tx + 3, ty - 4); }
    else { mg.line_to(tx + 4, ty - 3); mg.line_to(tx + 4, ty + 3); }
    mg.close_path();
    mg.fill();
}

// Devices strictly between the Start and End of the pair.
function dpcDevices() {
    var names = (dpLink.chainNames || []);
    var lats = (dpLink.latencies || []);
    var out = [];
    var a = dpLink.selfIndex;
    var b = dpLink.partnerIndex;
    var lo = Math.min(a, b);
    var hi = Math.max(a, b);
    if (a < 0 || b < 0) {
        lo = names.indexOf("start");
        hi = names.lastIndexOf("end");
        if (lo < 0 || hi < 0) return out;
    }
    for (var k = lo + 1; k < hi && k < names.length; k++) {
        out.push({ name: names[k] || "?", lat: lats[k] || 0 });
    }
    return out;
}

function vizDraw(mg, x, y, w, h, s) {
    var sr = s.sr || 44100;
    var paired = !!dpLink.paired;
    var devs = paired ? dpcDevices() : [{ name: "FX", lat: 0 }, { name: "FX", lat: 0 }];
    var frozen = s.freezeOn > 0.5;
    var fbCol = frozen ? DP_COL.violet : DP_COL.cyan;
    var cg = dpClamp(s.chainGain || 1, 0.01, 4);
    var fb = frozen ? 1 : s.fb;
    var ret = Math.max(s.retL || 0, s.retR || 0);
    var dim = paired ? 1 : 0.4;

    // ---- row A: IN, TANK, END, OUT ----
    var ry = y + 22, rh = 38;
    var inX = x + 2, inW = 26;
    var tkX = x + 34, tkW = 72;
    var outW = 28, outX = x + w - 2 - outW;
    var enW = 62, enX = outX - 8 - enW;
    var tkCx = tkX + tkW / 2;
    var enCx = enX + enW / 2;

    // feedback path (behind blocks)
    var fy = y + 9;
    var pulse = dpClamp(ret * 3, 0, 1);
    var fa = (frozen ? 0.55 : 0.30) + 0.65 * pulse;
    fa *= dim;
    dpColor(fbCol, fa);
    mg.set_line_width(frozen ? 1.8 : 1.4);
    mg.move_to(enCx, ry);
    mg.line_to(enCx, fy);
    mg.line_to(tkCx, fy);
    mg.line_to(tkCx, ry - 5);
    mg.stroke();
    dpcArrowHead(mg, tkCx, ry, 1);
    var flabel = (frozen ? "FREEZE  " : "FB " + Math.round(fb * 100) + "%  ") + (20 * Math.log10(cg)).toFixed(1) + " dB";
    var flw = dpTextW(flabel, 8.5, true) + 8;
    var flx = (tkCx + enCx) / 2 - flw / 2;
    dpColor(DP_COL.bg, 1);
    mg.rectangle(flx, fy - 6, flw, 12);
    mg.fill();
    dpText(flabel, flx + 4, fy + 3, 8.5, fbCol, true);

    // main-line connectors
    dpColor(DP_COL.dim, 0.7 * dim);
    mg.set_line_width(1.2);
    mg.move_to(inX + inW, ry + rh / 2);
    mg.line_to(tkX - 3, ry + rh / 2);
    mg.stroke();
    dpcArrowHead(mg, tkX, ry + rh / 2, 0);
    mg.move_to(enX + enW, ry + rh / 2);
    mg.line_to(outX - 3, ry + rh / 2);
    mg.stroke();
    dpcArrowHead(mg, outX, ry + rh / 2, 0);

    // IN block
    dpColor(DP_COL.frame, 1);
    mg.rectangle_rounded(inX, ry, inW, rh, 4, 4);
    mg.fill();
    dpcCenterText("IN", inX + inW / 2, ry + 10, 8.5, DP_COL.dim, true);
    var mh = rh - 18;
    var il = dpcLevel(s.inPk);
    dpColor(DP_COL.bg, 1);
    mg.rectangle(inX + inW / 2 - 3, ry + 14, 6, mh);
    mg.fill();
    dpColor(il > 0.9 ? DP_COL.coral : DP_COL.green, 0.95);
    mg.rectangle(inX + inW / 2 - 3, ry + 14 + mh * (1 - il), 6, mh * il);
    mg.fill();

    // TANK block
    dpColor(DP_COL.frame, 1);
    mg.rectangle_rounded(tkX, ry, tkW, rh, 4, 4);
    mg.fill();
    dpColor(fbCol, 0.7);
    mg.set_line_width(1);
    mg.rectangle_rounded(tkX + 0.5, ry + 0.5, tkW - 1, rh - 1, 4, 4);
    mg.stroke();
    dpcCenterText("DELAY", tkCx, ry + 11, 8, DP_COL.dim, true);
    var tl = dpcFit(dpTimeLabel(), tkW - 8, 9, true);
    dpcCenterText(tl, tkCx, ry + 24, 9, DP_COL.text, true);
    // feedback fill
    var bx = tkX + 6, bw = tkW - 12, by = ry + rh - 8;
    dpColor(DP_COL.bg, 1);
    mg.rectangle(bx, by, bw, 4);
    mg.fill();
    dpColor(fbCol, 0.9);
    mg.rectangle(bx, by, bw * dpClamp(fb, 0, 1), 4);
    mg.fill();

    // END block
    dpColor(DP_COL.frame, 1);
    mg.rectangle_rounded(enX, ry, enW, rh, 4, 4);
    mg.fill();
    dpcCenterText("END", enCx, ry + 11, 8.5, paired ? DP_COL.text : DP_COL.dim, true);
    dpcCenterText("DRY+WET", enCx, ry + 22, 8, DP_COL.dim, false);
    dpcCenterText("WET " + Math.round(s.wet * 100) + "%", enCx, ry + 33, 8, DP_COL.amber, false);

    // OUT block: meter + gain-reduction bar when ducking
    dpColor(DP_COL.frame, 1);
    mg.rectangle_rounded(outX, ry, outW, rh, 4, 4);
    mg.fill();
    dpcCenterText("OUT", outX + outW / 2, ry + 10, 8, DP_COL.dim, true);
    var ol = dpcLevel(s.wetPk);
    var mx = outX + 6;
    dpColor(DP_COL.bg, 1);
    mg.rectangle(mx, ry + 14, 6, mh);
    mg.fill();
    dpColor(ol > 0.9 ? DP_COL.coral : DP_COL.green, 0.95);
    mg.rectangle(mx, ry + 14 + mh * (1 - ol), 6, mh * ol);
    mg.fill();
    if (s.duck > 0) {
        var gx = outX + outW - 11;
        var gr = dpClamp(1 - (s.duckGain === undefined ? 1 : s.duckGain), 0, 1);
        dpColor(DP_COL.bg, 1);
        mg.rectangle(gx, ry + 14, 5, mh);
        mg.fill();
        dpColor(DP_COL.coral, 0.95);
        mg.rectangle(gx, ry + 14, 5, mh * gr);
        mg.fill();
    }

    // ---- chain row ----
    var py = y + 74, ph = 26;
    var shown = devs.length > 3 ? 3 : devs.length;
    var extra = devs.length - shown;
    var gap = 10;
    var pw = devs.length > 3 ? 48 : Math.min(66, (w - 8 - (shown - 1) * gap) / Math.max(shown, 1));
    var plusW = 24;
    var total = shown * pw + (shown - 1) * gap + (extra > 0 ? gap + plusW : 0);
    if (devs.length === 0) { shown = 0; total = 70; }
    var px0 = x + (w - total) / 2;
    var cx0 = devs.length === 0 ? px0 + 35 : px0 + pw / 2;
    var lastCx = devs.length === 0 ? cx0 : (extra > 0 ? px0 + total - plusW / 2 : px0 + total - pw / 2);

    // bus from TANK down to the first pill and from the last pill up to END
    var bus = y + 67;
    dpColor(DP_COL.dim, 0.7 * dim);
    mg.set_line_width(1.2);
    mg.move_to(tkCx, ry + rh);
    mg.line_to(tkCx, bus);
    mg.line_to(cx0, bus);
    mg.line_to(cx0, py - 4);
    mg.stroke();
    dpcArrowHead(mg, cx0, py, 1);
    mg.move_to(lastCx, py);
    mg.line_to(lastCx, bus);
    mg.line_to(enCx, bus);
    mg.line_to(enCx, ry + rh + 4);
    mg.stroke();
    dpcArrowHead(mg, enCx, ry + rh, 1);
    // tiny label
    dpText("FX", x + 8, py + ph * 0.5 + 3, 8, DP_COL.dim, true);

    if (devs.length === 0) {
        dpPill(px0, py, 70, ph, DP_COL.frame, 0.6);
        dpcCenterText("no devices", px0 + 35, py + 16, 8, DP_COL.dim, false);
    }
    var cur = px0;
    for (var i = 0; i < shown; i++) {
        var d = devs[i];
        var hot = d.lat > 0;
        var accent = hot ? DP_COL.amber : DP_COL.frame;
        dpColor(accent, (hot ? 0.20 : 0.6) * dim);
        mg.rectangle_rounded(cur, py, pw, ph, 5, 5);
        mg.fill();
        dpColor(hot ? DP_COL.amber : DP_COL.dim, (hot ? 0.85 : 0.6) * dim);
        mg.set_line_width(1);
        mg.rectangle_rounded(cur + 0.5, py + 0.5, pw - 1, ph - 1, 5, 5);
        mg.stroke();
        var nm = dpcFit(d.name, pw - 6, 8, false);
        dpcCenterText(nm, cur + pw / 2, py + 11, 8, paired ? DP_COL.text : DP_COL.dim, false);
        var lt = hot ? Math.round(d.lat) + " smp" : "0";
        dpcCenterText(lt, cur + pw / 2, py + 21, 8, hot ? DP_COL.amber : DP_COL.dim, hot);
        cur += pw;
        if (i < shown - 1 || extra > 0) {
            dpColor(DP_COL.dim, 0.7 * dim);
            mg.set_line_width(1);
            mg.move_to(cur + 1, py + ph / 2);
            mg.line_to(cur + gap - 4, py + ph / 2);
            mg.stroke();
            dpcArrowHead(mg, cur + gap - 1, py + ph / 2, 0);
            cur += gap;
        }
    }
    if (extra > 0) {
        dpPill(cur, py, plusW, ph, DP_COL.frame, 0.9 * dim);
        dpcCenterText("+" + extra, cur + plusW / 2, py + 16, 8.5, DP_COL.text, true);
    }

    // ---- footer ----
    var f1 = y + h - 21;
    var f2 = y + h - 6;
    if (!paired) {
        dpcCenterText(dpcFit("Add Delay+ End after your FX", w - 8, 9, true), x + w / 2, f1 + 4, 9, DP_COL.coral, true);
    } else {
        var lat = Math.round(dpLink.latency);
        var ltxt = "CHAIN LATENCY  " + lat + " smp · " + (lat * 1000 / sr).toFixed(1) + " ms";
        dpText(dpcFit(ltxt, w - 8, 8.5, false), x + 4, f1, 8.5, lat > 0 ? DP_COL.text : DP_COL.dim, false);
    }
    if (s.clamped > 0.5) {
        dpText(dpcFit("MIN CLAMP  time held at " + (s.tmin * 1000 / sr).toFixed(1) + " ms", w - 8, 8.5, true), x + 4, f2, 8.5, DP_COL.amber, true);
    }
}
