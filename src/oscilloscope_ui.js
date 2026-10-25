mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;

var AN_PREVIEW = 0;

// Dedicated oscilloscope face (460 x 169). Same scope buffer and deferred gen~ as the analyzer tap.
// Channel 1 is live_display_line_one, channel 2 is live_display_line_two. Every colour comes from sptColor.

var anBufName = "#0-analyzerscope";

var oscInit = oscDefaultState();
var oscRoutingMode = oscInit.routingMode;
var oscEditSub = oscInit.editSub;
var oscChMode = oscInit.chMode;
var oscViewMode = oscInit.viewMode;
var oscCycleMode = oscInit.cycleMode;
var oscRateHz = oscInit.rateHz;
var oscGainDb = oscInit.gainDb;
var oscAutoGain = oscInit.autoGain;
var oscOpenMenu = "";
var oscPitchState = oscCreatePitchState();
var oscSmoothGain = 0;
var oscTrigLevel = 0;
var oscFrozen = 0;
var oscSr = 48000;
var oscDemoReady = 0;
var oscSeenFrame = -1;
var oscSeenHead = -1;
var oscHoverKind = "";
var oscHoverIndex = -1;
var oscThemeOn = 0;
var OSC_POINTS = 336;

/**
 * @typedef {{
 *   wave1: number[],
 *   wave2: number[],
 *   label1: string,
 *   label2: string,
 *   dual: boolean,
 *   show1: boolean,
 *   show2: boolean,
 *   isCycleLocked: boolean,
 *   cycles: number,
 *   spanSamples: number,
 *   windowMs: number,
 *   freq: number,
 *   note: string,
 *   confidence: number,
 *   trigLocked: boolean,
 *   stats1: { peak: number, rms: number, vpp: number, dc?: number },
 *   stats2: { peak: number, rms: number, vpp: number, dc?: number },
 *   winPeak1?: number,
 *   winPeak2?: number,
 *   maxPeak: number,
 *   corr: number
 * }} OscFrame
 */

/** @type {OscFrame | null} */
var oscFrame = null;
/** @type {number[] | null} */
var oscRawL = null;
/** @type {number[] | null} */
var oscRawR = null;
/** @type {Task | null} */
var oscPollTask = null;
/** @type {{ kind: string, y0?: number, level0?: number } | null} */
var oscDrag = null;

function oscLive() {
    return typeof Task !== "undefined" && !(AN_PREVIEW > 0);
}

function oscApplyRouting() {
    oscChMode = oscResolveRouting(oscRoutingMode, oscEditSub).chMode;
}

// 0.78 maps ±1.0 to 78% of the plot half-height, leaving 22% vertical headroom (11% top, 11% bottom)
// so a normalized 1.0 (0.0 dB) waveform sits cleanly above the ±0.5 grid lines and well inside the plot borders!
var OSC_AMP_HEADROOM = 0.78;

function oscUpdateDisplayGain() {
    var peak = oscFrame && oscFrame.maxPeak ? oscFrame.maxPeak : 0;
    var g = oscComputeEffectiveGain(peak, oscGainDb, oscAutoGain);
    if (oscAutoGain) {
        if (!(oscSmoothGain > 0) || g.totalGain <= oscSmoothGain) {
            // Instant ceiling clamp when signal peak increases so waveforms never overshoot or clip
            oscSmoothGain = g.totalGain;
        } else if (peak > 1e-3) {
            oscSmoothGain += (g.totalGain - oscSmoothGain) * 0.25;
        } else {
            oscSmoothGain = oscDbToLin(oscGainDb);
        }
    } else {
        oscSmoothGain = g.totalGain;
    }
    if (!(oscSmoothGain > 1e-4)) oscSmoothGain = g.totalGain > 1e-4 ? g.totalGain : 1;
}

function oscNum(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function oscBox(rect) {
    return { x: rect[0], y: rect[1], w: rect[2], h: rect[3] };
}

function oscAmpY(v, rect) {
    var mid = rect[1] + rect[3] * 0.5;
    return mid - v * (rect[3] * 0.5 * OSC_AMP_HEADROOM);
}

// The shared gen loader re-sends crossover frequencies after compile. This device has none.
function anSendXover() {}

function oscApplyWidth() {
    outlet(0, "setwidth", OSC_W);
    if (!anHost) return;
    try {
        var viz = anHost.getnamed("AnalyzerViz");
        if (viz) viz.setattr("presentation_rect", 0, 0, OSC_W, OSC_H);
        var body = anHost.getnamed("obj-panel-body");
        if (body) body.setattr("presentation_rect", 0, 0, OSC_W, OSC_H);
    } catch (err) {}
}

function oscPeek(start, count) {
    if (!anBufName || typeof Buffer !== "function") return null;
    try {
        var buf = new Buffer(anBufName);
        if (!buf || typeof buf.peek !== "function") return null;
        var chunk = buf.peek(1, start, count);
        if (typeof chunk === "number") return [chunk];
        if (!chunk || !chunk.length) return null;
        return chunk;
    } catch (err) {
        return null;
    }
}

function oscPeekN(start, count) {
    /** @type {number[]} */
    var out = [];
    var i;
    for (i = 0; i < count; i += 2048) {
        var n = Math.min(2048, count - i);
        var chunk = oscPeek(start + i, n);
        if (!chunk) return null;
        var k;
        for (k = 0; k < n; k++) out.push(Number(chunk[k]) || 0);
    }
    return out;
}

function oscReadWrapped(base, len, head, count) {
    if (count > len) count = len;
    var start = head - count;
    while (start < 0) start += len;
    if (start + count <= len) return oscPeekN(base + start, count);
    var first = len - start;
    var a = oscPeekN(base + start, first);
    var b = oscPeekN(base, count - first);
    if (!a || !b) return null;
    var out = new Array(count);
    var i;
    for (i = 0; i < first; i++) out[i] = a[i];
    for (i = 0; i < b.length; i++) out[first + i] = b[i];
    return out;
}

function oscRefreshFrame() {
    if (!oscRawL || !oscRawR) return;
    oscFrame = oscComputeFrame(oscRawL, oscRawR, oscSr, {
        chMode: oscChMode,
        cycleMode: oscCycleMode,
        trigLevel: oscTrigLevel,
        points: OSC_POINTS,
        pitchState: oscPitchState
    });
}

function oscTakeScope() {
    if (oscFrozen) return;
    var hdr = oscPeek(0, 3);
    if (!hdr || hdr.length < 3) return;
    var sr = Number(hdr[OSC_HDR_SR]) || 0;
    if (sr > 1000) oscSr = sr;
    var frame = hdr[OSC_HDR_FRAME] | 0;
    var head = hdr[OSC_HDR_SCOPE] | 0;
    if (head < 0 || head >= OSC_RING_N) return;
    if (frame === oscSeenFrame && head === oscSeenHead && oscRawL && oscRawR) return;
    var l = oscReadWrapped(OSC_SCOPE_L, OSC_RING_N, head, OSC_RING_N);
    var r = oscReadWrapped(OSC_SCOPE_R, OSC_RING_N, head, OSC_RING_N);
    if (!l || !r) return;
    oscRawL = l;
    oscRawR = r;
    oscSeenFrame = frame;
    oscSeenHead = head;
    oscRefreshFrame();
}

function oscPoll() {
    if (!anDsp.ready) mgraphics.redraw();
    if (oscFrozen) return;
    var f = oscSeenFrame;
    var h = oscSeenHead;
    oscTakeScope();
    if (oscSeenFrame !== f || oscSeenHead !== h) mgraphics.redraw();
}

function oscStartPoll() {
    if (!oscLive() || oscPollTask) return;
    oscPollTask = new Task(oscPoll, this);
    oscPollTask.interval = oscRateToMs(oscRateHz);
    oscPollTask.repeat();
}

// Preview tone: 220 Hz A3. Left carries a warm 2nd and 3rd; Right is phase-shifted,
// lightly detuned, and has a quiet 5th, so Mid and Side are both real waveforms.
function oscEnsureDemo() {
    if (oscDemoReady) return;
    oscDemoReady = 1;
    oscSr = 48000;
    var n = 4096;
    var f0 = 220;
    /** @type {number[]} */
    var l = [];
    /** @type {number[]} */
    var r = [];
    var i;
    for (i = 0; i < n; i++) {
        var t = i / oscSr;
        var w = 2 * Math.PI * f0 * t;
        var left = 0.68 * Math.sin(w) + 0.05 * Math.sin(2 * w);
        var right = 0.54 * Math.sin(w + 0.60) - 0.04 * Math.sin(2 * w + 0.60);
        l.push(left);
        r.push(right);
    }
    oscRawL = l;
    oscRawR = r;
    oscRefreshFrame();
}

function oscDb(lin) {
    if (!(lin > 1e-8)) return "-\u221E";
    var db = 20 * Math.log(lin) / Math.LN10;
    var body = Math.abs(db).toFixed(1);
    return (db >= 0 ? "+" : "\u2212") + body;
}

function oscDbPair(st) {
    if (!st || (!(st.peak > 1e-7) && !(st.rms > 1e-7))) return "\u2014";
    return oscDb(st.peak) + " / " + oscDb(st.rms);
}

function oscFmtAmp(v) {
    var a = Math.abs(v);
    var body;
    if (a < 0.0005) return "0";
    if (Math.abs(a - Math.round(a)) < 0.001) body = String(Math.round(a));
    else if (a >= 1) body = (Math.round(a * 10) / 10).toString();
    else {
        var eighths = Math.round(a * 8);
        body = Math.abs(a - eighths / 8) < 0.004 ? String(eighths / 8) : a.toFixed(2);
    }
    if (v > 0) return "+" + body;
    return "\u2212" + body;
}

function oscSigned(v, digits) {
    var n = Math.abs(v).toFixed(digits);
    if (v < -0.0005) return "\u2212" + n;
    if (v > 0.0005) return "+" + n;
    return Number(0).toFixed(digits);
}

function oscMsText(ms) {
    var a = Math.abs(Number(ms) || 0);
    var q = Math.round(a * 4) / 4;
    var body = Math.abs(a - q) < 0.02 ? String(q) : a.toFixed(2);
    return body + " ms";
}

function oscVoiced(frame) {
    return !!(frame && frame.freq >= 20 && frame.freq <= 20000 && frame.confidence >= 0.14);
}

function oscHot(kind, index) {
    return oscHoverKind === kind && oscHoverIndex === index;
}

function oscGuideOn() {
    if (oscDrag && oscDrag.kind === "trig") return true;
    return Math.abs(oscTrigLevel) > 0.0005;
}

function oscStatus() {
    if (!oscLive() || anDsp.ready) return "";
    if (anDsp.error) return "DSP failed: " + anDsp.error;
    return "DSP loading\u2026";
}

function oscOverlayWave(plot) {
    return [plot[0], plot[1], plot[2], plot[3] - 12];
}

function oscSplitGeom(plot) {
    var gap = 4;
    var usable = Math.max(40, plot[3] - 12);
    var topH = Math.floor((usable - gap) * 0.5);
    var botH = usable - gap - topH;
    return {
        top: [plot[0], plot[1], plot[2], topH],
        bot: [plot[0], plot[1] + topH + gap, plot[2], botH]
    };
}

function oscFooterRect(plot) {
    return [plot[0], plot[1] + plot[3] - 12, plot[2], 12];
}

function oscLevelRect(y) {
    var g = oscGeom();
    if (oscViewMode === 1) {
        var lanes = oscSplitGeom(g.plot);
        if (y >= lanes.bot[1]) return lanes.bot;
        return lanes.top;
    }
    return oscOverlayWave(g.plot);
}

function oscLevelFromY(y) {
    var rect = oscLevelRect(y);
    var mid = rect[1] + rect[3] * 0.5;
    var halfSpan = Math.max(1, rect[3] * 0.5 * OSC_AMP_HEADROOM);
    var display = oscClamp((mid - y) / halfSpan, -1, 1);
    var gain = oscSmoothGain > 1e-4 ? oscSmoothGain : 1;
    return oscClamp(display / gain, -0.9, 0.9);
}

function oscWavePts(sig, rect, gain) {
    /** @type {number[][]} */
    var pts = [];
    if (!sig || sig.length < 2) return pts;
    var g = gain > 0 ? gain : 1;
    var n = sig.length;
    var i;
    if (oscAutoGain) {
        // Normalize the channel's peak to 1.0 first, and then apply the user's Gain Scale dB!
        // Because OSC_AMP_HEADROOM = 0.78, an amplitude of ±1.0 sits at 78% of the half-height with 22% headroom.
        var sigPeak = 0;
        for (i = 0; i < n; i++) {
            var av = Math.abs(oscNum(sig[i]));
            if (av > sigPeak) sigPeak = av;
        }
        var framePeak = oscFrame && oscFrame.maxPeak ? oscFrame.maxPeak : sigPeak;
        var normRef = oscViewMode === 1 ? Math.max(sigPeak, 1e-4) : Math.max(framePeak, sigPeak, 1e-4);
        if (normRef > 1e-4) {
            var targetAmp = oscDbToLin(oscGainDb);
            g = Math.min(g, targetAmp / normRef);
            if (oscViewMode === 1 && sigPeak > 1e-3) {
                g = oscClamp(1.0 / sigPeak, 0.25, 64.0) * targetAmp;
            }
        }
    }
    for (i = 0; i < n; i++) {
        var amp = oscClamp(oscNum(sig[i]) * g, -8, 8);
        var x = rect[0] + (i / (n - 1)) * rect[2];
        pts.push([x, oscAmpY(amp, rect)]);
    }
    return pts;
}

// Clipped stroke with an explicit width. sptCurveIn always strokes at 1 px.
// Separate `hasPath` from `connected` so trailing clipped segments never skip `mgraphics.stroke()`!
function oscTrace(pts, col, alpha, rect, width) {
    if (!pts || pts.length < 2) return;
    sptRgba(col, alpha);
    mgraphics.set_line_width(width);
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("round");
    if (mgraphics.set_line_join) mgraphics.set_line_join("round");
    var connected = false;
    var hasPath = false;
    var lx = 0;
    var ly = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
        var s = sptClipLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], rect);
        if (!s) {
            connected = false;
            continue;
        }
        if (!connected || s[0] !== lx || s[1] !== ly) mgraphics.move_to(s[0], s[1]);
        mgraphics.line_to(s[2], s[3]);
        lx = s[2];
        ly = s[3];
        connected = true;
        hasPath = true;
    }
    if (hasPath) mgraphics.stroke();
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("butt");
    if (mgraphics.set_line_join) mgraphics.set_line_join("miter");
}

function oscChannelPts(sig, rect) {
    return oscWavePts(sig, rect, oscSmoothGain > 1e-4 ? oscSmoothGain : 1);
}

function oscPaintFill(pts, rect, col, fillAlpha) {
    if (!pts || pts.length < 2) return;
    var mid = rect[1] + rect[3] * 0.5;
    var poly = pts.slice();
    poly.push([pts[pts.length - 1][0], mid]);
    poly.push([pts[0][0], mid]);
    sptFillPolyIn(poly, col, fillAlpha, oscBox(rect));
}

function oscPaintStroke(pts, rect, col, width) {
    if (!pts || pts.length < 2) return;
    oscTrace(pts, col, 1, oscBox(rect), width);
}

function oscPill(rect, text, on, hot) {
    var x = rect[0];
    var y = rect[1];
    var w = rect[2];
    var h = rect[3];
    var sel = sptColor("live_control_selection");
    var size = h < 14 ? 7.5 : 8;
    var baseline = y + h - 3.5;
    if (on) {
        sptRgba(sel);
        mgraphics.rectangle(x, y, w, h);
        mgraphics.fill();
        sptText(text, x + w * 0.5, baseline, sptColor("live_lcd_bg"), size, 1);
        return;
    }
    sptRgba(sptColor("live_control_bg"));
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    sptRgba(hot ? sptColor("live_control_fg") : sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    mgraphics.stroke();
    sptText(text, x + w * 0.5, baseline, hot ? sptColor("live_lcd_title") : sptColor("live_control_fg"), size, 1);
}

function oscHairline(x, y, w) {
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(x, y, w, 1);
    mgraphics.fill();
}

function oscChip(text, x, y, col, alignRight) {
    var size = 7.5;
    var tw = sptTextW(text, size);
    var w = tw + 8;
    var h = 11;
    var bx = alignRight ? x - w : x;
    sptRgba(sptMix(sptColor("live_lcd_bg"), col, 0.24));
    mgraphics.rectangle(bx, y, w, h);
    mgraphics.fill();
    sptRgba(col);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(bx + 0.5, y + 0.5, Math.max(0, w - 1), h - 1);
    mgraphics.stroke();
    sptText(text, bx + w * 0.5, y + 8.5, col, size, 1);
}

function oscLaneBadge(text, x, y, col) {
    if (!text) return;
    var size = 7.5;
    var tw = sptTextW(text, size);
    var w = tw + 6;
    sptRgba(sptMix(sptColor("live_lcd_bg"), col, 0.22));
    mgraphics.rectangle(x, y, w, 10);
    mgraphics.fill();
    sptText(text, x + 3, y + 8, col, size, 0);
}

function oscPaintAmpGrid(rect, ticks) {
    var clip = oscBox(rect);
    var frame = sptColor("live_lcd_frame");
    var zero = sptMix(frame, sptColor("live_lcd_title"), 0.7);
    var y0 = oscAmpY(0, rect);
    var yp = oscAmpY(0.5, rect);
    var yn = oscAmpY(-0.5, rect);
    sptCurveIn([[rect[0], yp], [rect[0] + rect[2], yp]], frame, 1, clip);
    sptCurveIn([[rect[0], yn], [rect[0] + rect[2], yn]], frame, 1, clip);
    sptCurveIn([[rect[0], y0], [rect[0] + rect[2], y0]], zero, 1, clip);
    if (!ticks) return;
    var i;
    for (i = 0; i <= 8; i++) {
        var x = rect[0] + (i / 8) * rect[2];
        var h = (i % 4 === 0) ? 5 : 2.4;
        sptCurveIn([[x, y0 - h], [x, y0 + h]], frame, 1, clip);
    }
}

function oscPaintVGrid(rects, frac, col) {
    var i;
    for (i = 0; i < rects.length; i++) {
        var r = rects[i];
        var x = r[0] + frac * r[2];
        sptCurveIn([[x, r[1]], [x, r[1] + r[3]]], col, 1, oscBox(r));
    }
}

function oscCycleCount() {
    if (oscFrame && oscFrame.isCycleLocked && oscFrame.cycles > 0) return oscFrame.cycles;
    var n = OSC_CYCLE_COUNTS[oscCycleMode] || 0;
    return n > 0 ? n : 1;
}

function oscTimeLocked() {
    if (oscFrame) return !!oscFrame.isCycleLocked;
    return OSC_CYCLE_COUNTS[oscCycleMode] > 0;
}

function oscPaintVLines(rects) {
    var line = sptMix(sptColor("live_lcd_frame"), sptColor("live_display_scale_text"), 0.62);
    var k;
    if (oscTimeLocked()) {
        var n = oscCycleCount();
        if (n === 1) {
            oscPaintVGrid(rects, 0.25, line);
            oscPaintVGrid(rects, 0.5, line);
            oscPaintVGrid(rects, 0.75, line);
            return;
        }
        for (k = 1; k < n; k++) oscPaintVGrid(rects, k / n, line);
        return;
    }
    oscPaintVGrid(rects, 0.25, line);
    oscPaintVGrid(rects, 0.5, line);
    oscPaintVGrid(rects, 0.75, line);
}

function oscPaintScaleFooter(footer) {
    var label = sptColor("live_display_scale_text");
    var labelClip = oscBox(footer);
    var base = footer[1] + 9;
    var k;
    sptRgba(sptColor("live_lcd_bg"));
    mgraphics.rectangle(footer[0], footer[1], footer[2], footer[3]);
    mgraphics.fill();
    oscHairline(footer[0], footer[1], footer[2]);
    if (oscTimeLocked()) {
        var n = oscCycleCount();
        if (n === 1) {
            var degs = [0, 90, 180, 270, 360];
            for (k = 0; k < degs.length; k++) {
                sptTextIn(String(degs[k]) + "\u00b0", footer[0] + (k / 4) * footer[2], base, label, 7, 1, labelClip);
            }
            return;
        }
        for (k = 0; k < n; k++) {
            sptTextIn("C" + (k + 1), footer[0] + ((k + 0.5) / n) * footer[2], base, label, 7, 1, labelClip);
        }
        return;
    }
    var ms = OSC_FIXED_MS[oscCycleMode] || (oscFrame ? oscFrame.windowMs : 20);
    for (k = 0; k <= 4; k++) {
        sptTextIn(oscMsText(ms * k / 4), footer[0] + (k / 4) * footer[2], base, label, 7, 1, labelClip);
    }
}

function oscPaintAxis(lcd, wave) {
    var scaleRef = oscAutoGain ? oscDbToLin(oscGainDb) : (oscSmoothGain > 1e-4 ? oscSmoothGain : 1);
    var gutter = {
        x: lcd[0] + 1,
        y: lcd[1] + 1,
        w: Math.max(8, wave[0] - lcd[0] - 2),
        h: wave[1] + wave[3] - lcd[1] - 2
    };
    var col = sptColor("live_display_scale_text");
    var marks = [1, 0.5, 0, -0.5, -1];
    var i;
    for (i = 0; i < marks.length; i++) {
        sptTextIn(oscFmtAmp(marks[i] / scaleRef), gutter.x + gutter.w, oscAmpY(marks[i], wave) + 2.4, col, 7, 2, gutter);
    }
}

function oscGuideY(rect) {
    var y = oscAmpY(oscTrigLevel * (oscSmoothGain > 1e-4 ? oscSmoothGain : 1), rect);
    var pad = 4;
    if (y < rect[1] + pad) y = rect[1] + pad;
    if (y > rect[1] + rect[3] - pad) y = rect[1] + rect[3] - pad;
    return y;
}

function oscPaintGuide(rect, showValue) {
    if (!oscGuideOn()) return;
    var clip = oscBox(rect);
    var y = oscGuideY(rect);
    var col = sptColor("live_lcd_control_fg");
    sptCurveIn([[rect[0], y], [rect[0] + rect[2], y]], col, 0.42, clip);
    var x = rect[0] + 0.5;
    sptRgba(col, 0.95);
    mgraphics.move_to(x, y - 3.5);
    mgraphics.line_to(x + 5.5, y);
    mgraphics.line_to(x, y + 3.5);
    mgraphics.close_path();
    mgraphics.fill();
    if (showValue && oscDrag && oscDrag.kind === "trig") {
        sptTextIn(oscFmtAmp(oscTrigLevel), x + 8, y + 2.5, col, 7.5, 0, clip);
    }
}

function oscPaintHud(lcd) {
    var status = oscStatus();
    if (status) {
        var col = anDsp.error ? sptColor("live_alert") : sptColor("live_control_selection");
        oscChip(status, lcd[0] + 24, lcd[1] + 3, col, false);
    }
    if (oscFrozen) oscChip("FROZEN", lcd[0] + lcd[2] - 4, lcd[1] + 3, sptColor("live_control_selection"), true);
}

function oscPaintOverlay(lcd, plot) {
    var wave = oscOverlayWave(plot);
    var footer = oscFooterRect(plot);
    var c1 = sptColor("live_display_line_one");
    var c2 = sptColor("live_display_line_two");
    var show1 = !!(oscFrame && oscFrame.show1);
    var show2 = !!(oscFrame && oscFrame.show2);
    var p1 = show1 && oscFrame ? oscChannelPts(oscFrame.wave1, wave) : null;
    var p2 = show2 && oscFrame ? oscChannelPts(oscFrame.wave2, wave) : null;
    oscPaintAmpGrid(wave, true);
    if (p2) oscPaintFill(p2, wave, c2, 0.15);
    if (p1) oscPaintFill(p1, wave, c1, 0.16);
    oscPaintVLines([wave]);
    if (p2) oscPaintStroke(p2, wave, c2, 1.25);
    if (p1) oscPaintStroke(p1, wave, c1, 1.35);
    oscPaintScaleFooter(footer);
    oscPaintAxis(lcd, wave);
    oscPaintGuide(wave, true);
}

function oscPaintSplit(plot) {
    var lanes = oscSplitGeom(plot);
    var footer = oscFooterRect(plot);
    var c1 = sptColor("live_display_line_one");
    var c2 = sptColor("live_display_line_two");
    var show1 = !!(oscFrame && oscFrame.show1);
    var show2 = !!(oscFrame && oscFrame.show2);
    var p1 = show1 && oscFrame ? oscChannelPts(oscFrame.wave1, lanes.top) : null;
    var p2 = show2 && oscFrame ? oscChannelPts(oscFrame.wave2, lanes.bot) : null;
    oscPaintAmpGrid(lanes.top, false);
    oscPaintAmpGrid(lanes.bot, false);
    oscHairline(plot[0], lanes.top[1] + lanes.top[3] + 1, plot[2]);
    if (p1) oscPaintFill(p1, lanes.top, c1, 0.16);
    if (p2) oscPaintFill(p2, lanes.bot, c2, 0.15);
    oscPaintVLines([lanes.top, lanes.bot]);
    if (p1) oscPaintStroke(p1, lanes.top, c1, 1.35);
    if (p2) oscPaintStroke(p2, lanes.bot, c2, 1.25);
    oscPaintScaleFooter(footer);
    if (oscFrame) {
        oscLaneBadge(oscFrame.label1 || "L", lanes.top[0] + 4, lanes.top[1] + 3, show1 ? c1 : sptMuted(c1, 0.4));
        oscLaneBadge(oscFrame.label2 || "R", lanes.bot[0] + 4, lanes.bot[1] + lanes.bot[3] - 13, show2 ? c2 : sptMuted(c2, 0.4));
    }
    oscPaintGuide(lanes.top, show1);
    oscPaintGuide(lanes.bot, !show1 && show2);
}

function oscLegendRow(x, right, y, col, label, st) {
    sptRgba(col);
    mgraphics.rectangle(x, y - 7, 8, 8);
    mgraphics.fill();
    sptText(label, x + 11, y, col, 8, 0);
    sptText(oscDbPair(st), right, y, sptColor("live_lcd_control_fg_alt"), 7.5, 2);
}

function oscPaintCorr(x, y, w, h, corr) {
    sptRgba(sptColor("live_lcd_bg"));
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    mgraphics.stroke();
    var c = oscClamp(corr, -1, 1);
    var mid = x + w * 0.5;
    var tip = mid + c * (w * 0.5 - 1);
    var col = c < 0 ? sptColor("live_alert") : sptColor("live_display_line_two");
    var left = Math.min(mid, tip);
    var rw = Math.max(0.8, Math.abs(tip - mid));
    sptRgba(col);
    mgraphics.rectangle(left, y + 1, rw, Math.max(1, h - 2));
    mgraphics.fill();
    sptRgba(sptColor("live_lcd_title"));
    mgraphics.rectangle(mid, y, 1, h);
    mgraphics.fill();
    return col;
}

function oscPaintSidebar(side) {
    var x = side[0];
    var y = side[1];
    var w = side[2];
    var h = side[3];
    sptRgba(sptColor("live_desktop"));
    mgraphics.rectangle_rounded(x, y, w, h, 3, 3);
    mgraphics.fill();
    sptRgba(sptColor("live_surface_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1), 3, 3);
    mgraphics.stroke();

    var left = x + 6;
    var right = x + w - 6;
    var frame = oscFrame;
    var c1 = sptColor("live_display_line_one");
    var c2 = sptColor("live_display_line_two");
    var dim = sptColor("live_display_scale_text");
    sptText("Pk / RMS", right, 39, dim, 7, 2);
    if (frame) {
        if (frame.show1) oscLegendRow(left, right, 51, c1, frame.label1 || "L", frame.stats1);
        else oscLegendRow(left, right, 51, sptMuted(c1, 0.35), frame.label1 || "L", null);
        if (frame.show2) oscLegendRow(left, right, 63, c2, frame.label2 || "R", frame.stats2);
        else oscLegendRow(left, right, 63, sptMuted(c2, 0.35), frame.label2 || "R", null);
    } else {
        oscLegendRow(left, right, 51, c1, "L", null);
        oscLegendRow(left, right, 63, sptMuted(c2, 0.35), "R", null);
    }

    oscHairline(left, 67, w - 12);
    if (oscVoiced(frame)) {
        sptText(frame.freq.toFixed(1) + " Hz \u00b7 " + frame.note, left, 80, sptColor("live_lcd_control_fg_alt"), 8, 0);
        sptText((1000 / frame.freq).toFixed(2) + " ms", left, 92, sptColor("live_lcd_title"), 8, 0);
    } else {
        sptText("\u2014", left, 80, dim, 8, 0);
        sptText("\u2014", left, 92, dim, 8, 0);
    }
    var corr = frame ? frame.corr : 0;
    var corrText = oscSigned(corr, 2);
    var corrW = sptTextW(corrText, 8);
    var barW = Math.max(28, w - 12 - corrW - 6);
    var corrCol = oscPaintCorr(left, 96, barW, 6, corr);
    sptText(corrText, right, 102, corrCol, 8, 2);

    oscHairline(left, 105, w - 12);
    sptText("Refresh Rate", left, 111, sptColor("live_lcd_title"), 7.5, 0);
    var ui = oscGeom();
    oscPaintRateSlider(ui.rateSlider);
    sptText("Gain Scale", 352, 140, sptColor("live_lcd_title"), 7.5, 0);
    oscPill(ui.autoBtn, "Auto", oscAutoGain === 1, oscHot("auto_btn", 0));
    oscPaintGainSlider(ui.gainSlider);
}

function oscCaret(x, cy) {
    sptRgba(sptColor("live_control_fg"));
    mgraphics.move_to(x - 3.2, cy - 1.5);
    mgraphics.line_to(x + 3.2, cy - 1.5);
    mgraphics.line_to(x, cy + 2.1);
    mgraphics.close_path();
    mgraphics.fill();
}

function oscSelectBox(rect, text, open, hot) {
    var x = rect[0];
    var y = rect[1];
    var w = rect[2];
    var h = rect[3];
    sptRgba(sptColor("live_control_bg"));
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    sptRgba(open || hot ? sptColor("live_control_fg") : sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    mgraphics.stroke();
    sptText(text, x + 4, y + h - 4, sptColor("live_control_fg"), 7.5, 0);
    oscCaret(x + w - 8, y + h * 0.5);
}

function oscPaintEditBtn(rect) {
    var rt = oscResolveRouting(oscRoutingMode, oscEditSub);
    var x = rect[0];
    var y = rect[1];
    var w = rect[2];
    var h = rect[3];
    var baseline = y + h - 4;
    if (!rt.editActive) {
        sptRgba(sptColor("live_control_bg"));
        mgraphics.rectangle(x, y, w, h);
        mgraphics.fill();
        sptRgba(sptMuted(sptColor("live_control_fg"), 0.45));
        mgraphics.set_line_width(1);
        mgraphics.rectangle(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
        mgraphics.stroke();
        sptText(rt.editLabel, x + w * 0.5, baseline, sptMuted(sptColor("live_control_fg"), 0.72), 7.5, 1);
        return;
    }
    var fill = sptColor("live_control_selection");
    if (rt.editLabel === "R" || rt.editLabel === "S") fill = sptColor("live_display_line_two");
    else if (rt.editLabel === "L" || rt.editLabel === "M") fill = sptColor("live_display_line_one");
    sptRgba(fill);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    sptText(rt.editLabel, x + w * 0.5, baseline, sptColor("live_lcd_bg"), 7.5, 1);
}

function oscPaintMenu(items, labels, selected, kind) {
    if (!items || !items.length) return;
    var x = items[0][0];
    var y = items[0][1];
    var w = items[0][2];
    var h = items.length * items[0][3];
    sptRgba(sptColor("live_lcd_bg"));
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    var i;
    for (i = 0; i < items.length; i++) {
        var r = items[i];
        var on = i === selected;
        if (on) {
            sptRgba(sptColor("live_control_selection"));
            mgraphics.rectangle(r[0], r[1], r[2], r[3]);
            mgraphics.fill();
        } else if (oscHot(kind, i)) {
            sptRgba(sptMix(sptColor("live_lcd_bg"), sptColor("live_control_fg"), 0.18));
            mgraphics.rectangle(r[0], r[1], r[2], r[3]);
            mgraphics.fill();
        }
        sptText(labels[i], r[0] + 4, r[1] + r[3] - 4, on ? sptColor("live_lcd_bg") : sptColor("live_control_fg"), 7.5, 0);
    }
    sptRgba(sptColor("live_control_fg"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    mgraphics.stroke();
}

function oscPaintValueSlider(rect, t0, t1, text) {
    var x = rect[0];
    var y = rect[1];
    var w = rect[2];
    var h = rect[3];
    var bg = sptColor("live_lcd_bg");
    sptRgba(bg);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    var a = oscClamp(Math.min(t0, t1), 0, 1);
    var b = oscClamp(Math.max(t0, t1), 0, 1);
    var fw = (b - a) * w;
    if (fw > 0.4) {
        sptRgba(sptMix(bg, sptColor("live_control_selection"), 0.38));
        mgraphics.rectangle(x + a * w, y + 1, fw, Math.max(1, h - 2));
        mgraphics.fill();
    }
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    mgraphics.stroke();
    sptText(text, x + w * 0.5, y + h - 3.5, sptColor("live_lcd_control_fg_alt"), 7.5, 1);
}

function oscPaintRateSlider(rect) {
    var span = Math.max(1, OSC_RATE_MAX - OSC_RATE_MIN);
    var t = oscClamp((oscRateHz - OSC_RATE_MIN) / span, 0, 1);
    oscPaintValueSlider(rect, 0, t, String(Math.round(oscRateHz)) + " Hz");
}

function oscFmtDb(db) {
    var n = Math.round(oscNum(db) * 10) / 10;
    var body = Math.abs(n).toFixed(1);
    if (n < -0.05) return "\u2212" + body + " dB";
    return "+" + body + " dB";
}

function oscPaintGainSlider(rect) {
    var span = Math.max(1, OSC_GAIN_MAX_DB - OSC_GAIN_MIN_DB);
    var z = (0 - OSC_GAIN_MIN_DB) / span;
    var v = (oscClamp(oscGainDb, OSC_GAIN_MIN_DB, OSC_GAIN_MAX_DB) - OSC_GAIN_MIN_DB) / span;
    oscPaintValueSlider(rect, z, v, oscFmtDb(oscGainDb));
    sptRgba(sptColor("live_lcd_title"));
    mgraphics.rectangle(rect[0] + z * rect[2], rect[1] + 2, 1, Math.max(1, rect[3] - 4));
    mgraphics.fill();
}

function oscPaintChrome(g) {
    var title = sptColor("live_lcd_title");
    sptText("Mode", 8, 17, title, 7.5, 0);
    oscSelectBox(g.modeBox, OSC_MODE_NAMES[oscRoutingMode] || "Stereo", oscOpenMenu === "mode", oscHot("mode_box", 0));
    sptText("Ch", 95, 17, title, 7.5, 0);
    oscPaintEditBtn(g.editBtn);
    sptText("Layout", 160, 17, title, 7.5, 0);
    oscPill(g.splitBtn, oscViewMode === 1 ? "Split" : "Overlay", oscViewMode === 1, oscHot("split_btn", 0));
    sptText("Window", 238, 17, title, 7.5, 0);
    oscSelectBox(g.winBox, OSC_CYCLE_NAMES[oscCycleMode] || "2 Cyc", oscOpenMenu === "window", oscHot("win_box", 0));
    oscPill(g.freeze, "Freeze", oscFrozen === 1, oscHot("freeze", 0));
}

function oscPaintMenus(g) {
    if (oscOpenMenu === "mode") oscPaintMenu(g.modeMenuItems, OSC_MODE_NAMES, oscRoutingMode, "mode_item");
    else if (oscOpenMenu === "window") oscPaintMenu(g.winMenuItems, OSC_CYCLE_NAMES, oscCycleMode, "win_item");
}

function paint() {
    if (!oscLive()) oscEnsureDemo();
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("butt");
    if (mgraphics.set_line_join) mgraphics.set_line_join("miter");
    var bw = OSC_W;
    var bh = OSC_H;
    if (mgraphics.size && mgraphics.size[0] > bw) bw = mgraphics.size[0];
    if (mgraphics.size && mgraphics.size[1] > bh) bh = mgraphics.size[1];
    sptRgba(sptColor("live_surface_bg"));
    mgraphics.rectangle(0, 0, bw, bh);
    mgraphics.fill();

    oscUpdateDisplayGain();
    var g = oscGeom();
    oscPaintSidebar(g.side);
    sptLcd(g.lcd[0], g.lcd[1], g.lcd[2], g.lcd[3]);
    if (oscViewMode === 1) oscPaintSplit(g.plot);
    else oscPaintOverlay(g.lcd, g.plot);
    oscPaintHud(g.lcd);
    oscPaintChrome(g);
    oscPaintMenus(g);
}

function oscSetRateFromX(x) {
    var r = oscGeom().rateSlider;
    var t = oscClamp((x - r[0]) / Math.max(1, r[2]), 0, 1);
    oscRateHz = oscClamp(OSC_RATE_MIN + t * (OSC_RATE_MAX - OSC_RATE_MIN), OSC_RATE_MIN, OSC_RATE_MAX);
    if (oscPollTask) oscPollTask.interval = oscRateToMs(oscRateHz);
}

function oscSetGainFromX(x) {
    var r = oscGeom().gainSlider;
    var t = oscClamp((x - r[0]) / Math.max(1, r[2]), 0, 1);
    oscGainDb = oscClamp(OSC_GAIN_MIN_DB + t * (OSC_GAIN_MAX_DB - OSC_GAIN_MIN_DB), OSC_GAIN_MIN_DB, OSC_GAIN_MAX_DB);
}

function oscApplyHit(hit) {
    var refresh = false;
    var save = true;
    if (hit.kind === "mode_box") {
        oscOpenMenu = oscOpenMenu === "mode" ? "" : "mode";
        save = false;
    } else if (hit.kind === "mode_item") {
        oscRoutingMode = oscClamp(hit.index, 0, 1) | 0;
        oscEditSub = 0;
        oscOpenMenu = "";
        oscApplyRouting();
        refresh = true;
    } else if (hit.kind === "edit_btn") {
        // Tristate cycle in both Stereo (0: L/R, 1: L, 2: R) and M/S (0: M/S, 1: M, 2: S)
        oscEditSub = (oscEditSub + 1) % 3;
        oscOpenMenu = "";
        oscApplyRouting();
        refresh = true;
    } else if (hit.kind === "split_btn") {
        oscViewMode = oscViewMode ? 0 : 1;
        oscOpenMenu = "";
    } else if (hit.kind === "win_box") {
        oscOpenMenu = oscOpenMenu === "window" ? "" : "window";
        save = false;
    } else if (hit.kind === "win_item") {
        oscCycleMode = oscClamp(hit.index, 0, 6) | 0;
        oscOpenMenu = "";
        refresh = true;
    } else if (hit.kind === "freeze") {
        oscFrozen = oscFrozen ? 0 : 1;
        oscOpenMenu = "";
    } else if (hit.kind === "auto_btn") {
        oscAutoGain = oscAutoGain ? 0 : 1;
        oscOpenMenu = "";
    } else return;
    if (refresh) oscRefreshFrame();
    if (save) notifyclients();
    mgraphics.redraw();
}

function onclick(x, y) {
    var hit = oscHitAt(x, y, oscOpenMenu);
    oscDrag = null;
    if (hit && (hit.kind === "rate_slider" || hit.kind === "gain_slider")) {
        oscOpenMenu = "";
        oscDrag = { kind: hit.kind };
        if (hit.kind === "rate_slider") oscSetRateFromX(x);
        else oscSetGainFromX(x);
        mgraphics.redraw();
        return;
    }
    if (hit) {
        oscApplyHit(hit);
        return;
    }
    if (oscOpenMenu) {
        oscOpenMenu = "";
        mgraphics.redraw();
        return;
    }
    var g = oscGeom();
    if (!oscInside(g.lcd, x, y)) return;
    var rect = oscLevelRect(y);
    var onGuide = Math.abs(oscTrigLevel) > 0.0005 && Math.abs(y - oscGuideY(rect)) <= 3.5;
    var level0 = onGuide ? oscTrigLevel : oscLevelFromY(y);
    oscDrag = { kind: "trig", y0: y, level0: level0 };
    oscTrigLevel = level0;
    oscRefreshFrame();
    mgraphics.redraw();
}

function ondrag(x, y, but) {
    if (!oscDrag) return;
    if (!but) {
        oscDrag = null;
        notifyclients();
        mgraphics.redraw();
        return;
    }
    if (oscDrag.kind === "trig") {
        var base = oscDrag.level0;
        var y0 = oscDrag.y0;
        oscTrigLevel = (base == null || y0 == null)
            ? oscLevelFromY(y)
            : oscClamp(base + oscLevelFromY(y) - oscLevelFromY(y0), -0.9, 0.9);
        oscRefreshFrame();
        mgraphics.redraw();
    } else if (oscDrag.kind === "rate_slider") {
        oscSetRateFromX(x);
        mgraphics.redraw();
    } else if (oscDrag.kind === "gain_slider") {
        oscSetGainFromX(x);
        mgraphics.redraw();
    }
}

function ondblclick(x, y) {
    var hit = oscHitAt(x, y, oscOpenMenu);
    if (hit && hit.kind === "rate_slider") {
        oscRateHz = OSC_RATE_DEFAULT;
        oscDrag = null;
        if (oscPollTask) oscPollTask.interval = oscRateToMs(oscRateHz);
        notifyclients();
        mgraphics.redraw();
        return;
    }
    if (hit && hit.kind === "gain_slider") {
        oscGainDb = 0;
        oscDrag = null;
        notifyclients();
        mgraphics.redraw();
        return;
    }
    var g = oscGeom();
    if (!oscInside(g.lcd, x, y)) return;
    oscTrigLevel = 0;
    oscDrag = null;
    oscRefreshFrame();
    notifyclients();
    mgraphics.redraw();
}

function onidle(x, y) {
    var hit = oscHitAt(x, y, oscOpenMenu);
    var kind = hit ? hit.kind : "";
    var index = hit ? hit.index : -1;
    if (kind === oscHoverKind && index === oscHoverIndex) return;
    oscHoverKind = kind;
    oscHoverIndex = index;
    mgraphics.redraw();
}

function onidleout() {
    if (!oscHoverKind && oscHoverIndex < 0) return;
    oscHoverKind = "";
    oscHoverIndex = -1;
    mgraphics.redraw();
}

function getvalueof() {
    return oscBlob({
        routingMode: oscRoutingMode,
        editSub: oscEditSub,
        chMode: oscChMode,
        viewMode: oscViewMode,
        cycleMode: oscCycleMode,
        rateHz: oscRateHz,
        gainDb: oscGainDb,
        autoGain: oscAutoGain
    });
}

function setvalueof() {
    var saved = oscFromBlob(arrayfromargs(arguments));
    oscRoutingMode = saved.routingMode;
    oscEditSub = saved.editSub;
    oscChMode = saved.chMode;
    oscViewMode = saved.viewMode;
    oscCycleMode = saved.cycleMode;
    oscRateHz = saved.rateHz;
    oscGainDb = saved.gainDb;
    oscAutoGain = saved.autoGain;
    if (oscPollTask) oscPollTask.interval = oscRateToMs(oscRateHz);
    oscApplyWidth();
    oscRefreshFrame();
    mgraphics.redraw();
}

function setbuffer(name) {
    if (!name) return;
    anBufName = String(name);
    oscSeenFrame = -1;
    oscSeenHead = -1;
}

function loadbang() {
    oscApplyWidth();
    oscStartPoll();
    if (oscLive() && typeof init_dsp === "function") init_dsp();
    if (typeof sptApplyPanelTheme === "function") {
        sptApplyPanelTheme([["obj-panel-body", "live_surface_bg"]], anHost);
    }
    if (!oscThemeOn && typeof sptThemeWatch === "function") {
        oscThemeOn = 1;
        sptThemeWatch(function () {
            if (typeof sptApplyPanelTheme === "function") {
                sptApplyPanelTheme([["obj-panel-body", "live_surface_bg"]], anHost);
            }
        });
    }
}

function notifydeleted() {
    if (oscPollTask) {
        try { oscPollTask.cancel(); } catch (err) {}
        oscPollTask = null;
    }
}
