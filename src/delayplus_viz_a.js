// Delay+ visualization A — "Echo Taps".
// Time runs left to right over a window sized to fit ~6 echoes. Each echo is a stem per channel
// (L up, R down) at n * T, with height = fb^(n-1) * chainGain^n (chain gain measured from the
// return/tap levels), ping-pong alternating sides. The chain-latency zone (0..L+B) is shaded:
// echoes cannot land inside it, and the clamp line marks the shortest possible time.

var VIZ_NAME = "Echo Taps";

function vizIdle(s) {
    return false;
}

function vizDraw(mg, x, y, w, h, s) {
    var sr = s.sr || 44100;
    var TL = s.TL > 0 ? s.TL : s.tms * sr / 1000;
    var TR = s.TR > 0 ? s.TR : s.tms * sr / 1000;
    var T = Math.max(TL, TR, 1);
    var fb = s.freeze > 0.5 ? 1 : s.fb;
    var cg = dpClamp(s.chainGain, 0.05, 2);
    var span = T * 6.3;
    var mid = y + h * 0.5 - 6;
    var amp = h * 0.5 - 14;
    var px = function (samps) { return x + 6 + (w - 12) * samps / span; };

    // grid
    dpColor(DP_COL.frame, 0.5);
    mg.set_line_width(1);
    mg.move_to(x + 4, mid + 0.5);
    mg.line_to(x + w - 4, mid + 0.5);
    mg.stroke();

    // latency zone
    var lz = px(s.tmin || (s.B + s.L));
    dpColor(DP_COL.violet, 0.10);
    mg.rectangle(x + 6, y + 2, Math.max(lz - x - 6, 0), h - 22);
    mg.fill();
    dpColor(DP_COL.violet, 0.55);
    mg.move_to(lz + 0.5, y + 2);
    mg.line_to(lz + 0.5, y + h - 20);
    mg.stroke();

    // dry hit
    dpColor(DP_COL.text, 0.8);
    mg.set_line_width(2);
    mg.move_to(px(0), mid - amp);
    mg.line_to(px(0), mid + amp);
    mg.stroke();

    var live = Math.max(s.tapL, s.tapR) > 0.001;
    for (var ch = 0; ch < 2; ch++) {
        var Tc = ch === 0 ? TL : TR;
        var g = cg;
        for (var n = 1; n <= 24; n++) {
            var t = n * Tc;
            if (t > span) break;
            var side = ch;
            if (s.pp > 0.5) side = (n % 2 === 1) ? 0 : 1;
            var hgt = dpClamp(g, 0, 1.2) * amp;
            var xx = px(t) + (ch === 0 ? -1.5 : 1.5);
            dpColor(ch === 0 ? DP_COL.cyan : DP_COL.amber, live ? 0.95 : 0.7);
            mg.set_line_width(2.5);
            mg.move_to(xx, mid);
            mg.line_to(xx, side === 0 ? mid - hgt : mid + hgt);
            mg.stroke();
            mg.arc(xx, side === 0 ? mid - hgt : mid + hgt, 2.5, 0, Math.PI * 2);
            mg.fill();
            g *= fb * cg;
            if (g < 0.003) break;
        }
    }

    // footer: time + feedback + chain gain
    var foot = y + h - 5;
    dpText(dpTimeLabel(), x + 4, foot, 10, DP_COL.text, true);
    var info = "FB " + Math.round(fb * 100) + "%   CHAIN " + (20 * Math.log10(cg)).toFixed(1) + " dB" + (s.pp > 0.5 ? "   PING-PONG" : "");
    dpText(info, x + w - 4 - dpTextW(info, 8.5, false), foot, 8.5, DP_COL.dim, false);
    if (s.freezeOn > 0.5) dpText("FREEZE", x + w * 0.5 - 16, y + 12, 9, DP_COL.violet, true);
}
