// Analyzer — layout, buffer map, K-weighting, loudness, 1/3-octave bands, stereo meters.
// Pure (no Max objects). The build prepends this into the v8ui; Node tests require it.
//
// buffer~ ---analyzerscope (AN_BUF_SAMPS), written by src/analyzer_core.genexpr:
//   0 frame (heartbeat, +1 every packet)   1 sample rate
//   2 scope head (next write)              3 fft head (next write)
//   4 packet head (next write)             5 samples per packet (480)
//   6 f1  7 f2  8 f3
//   packets at AN_PKT_BASE, AN_PKT_COUNT slots of AN_PKT_STRIDE:
//     0..1 K-weighted sum of squares L/R   2..3 unweighted sum of squares L/R
//     4..5 4x true-peak L/R                6..7 sample-peak L/R
//     8 sample count
//     9 + band*3: sum L^2, R^2, L*R for bands 0..3 (low, lo-mid, hi-mid, high)
//   scope L at AN_SCOPE_L (AN_SCOPE_N)     scope R at AN_SCOPE_R
//   mono FFT ring at AN_FFT_BASE (AN_FFT_N), (L+R)/2, oldest sample is at the head

var AN_VERSION = 1;
var AN_SECTIONS = [
    { id: "spec", name: "Spectrogram", w: 360 },
    { id: "scope", name: "Oscilloscope", w: 250 },
    { id: "stereo", name: "Stereo", w: 280 },
    { id: "loud", name: "Loudness", w: 200 }
];
var AN_SB_X = 3;
var AN_SB_W = 22;
var AN_SEC_X0 = 28;
var AN_SEC_GAP = 4;
var AN_WIN_PAD = 4;
var AN_H = 169;
var AN_DEFAULT_FOLD = 1;
var AN_MAX_W = 1600;
var AN_SCOPE_MS = [5, 20, 50];
var AN_XOVER_DEFAULT = [150, 1000, 6000];

var AN_HDR_FRAME = 0;
var AN_HDR_SR = 1;
var AN_HDR_SCOPE = 2;
var AN_HDR_FFT = 3;
var AN_HDR_PKT = 4;
var AN_HDR_N = 5;
var AN_HDR_F1 = 6;
var AN_HDR_F2 = 7;
var AN_HDR_F3 = 8;

var AN_PKT_STRIDE = 24;
var AN_PKT_COUNT = 64;
var AN_PKT_BASE = 32;
var AN_PKT_SAMPS = 480;
var AN_PK_KL = 0, AN_PK_KR = 1, AN_PK_RL = 2, AN_PK_RR = 3;
var AN_PK_TPL = 4, AN_PK_TPR = 5, AN_PK_PKL = 6, AN_PK_PKR = 7, AN_PK_N = 8, AN_PK_BAND = 9;

var AN_SCOPE_N = 4096;
var AN_SCOPE_L = AN_PKT_BASE + AN_PKT_COUNT * AN_PKT_STRIDE;
var AN_SCOPE_R = AN_SCOPE_L + AN_SCOPE_N;
var AN_FFT_N = 8192;
var AN_FFT_BASE = AN_SCOPE_R + AN_SCOPE_N;
var AN_BUF_SAMPS = AN_FFT_BASE + AN_FFT_N;

var AN_HEAT_COLS = 72;
var AN_HEAT_ROWS = 40;
var AN_FALL_ROWS = 24;
var AN_DB_LO = -80;
var AN_DB_HI = 0;

function anClamp(v, lo, hi) {
    var n = Number(v);
    if (n !== n) n = lo;
    return Math.max(lo, Math.min(hi, n));
}

function anInside(r, x, y) {
    return !!r && x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
}

function anDefaultOrder() {
    return [0, 1, 2, 3];
}

function anEncodeOrder(order) {
    var code = 0;
    var i;
    for (i = 0; i < AN_SECTIONS.length; i++) code = code * 10 + (order[i] | 0);
    return code;
}

function anDecodeOrder(code) {
    var s = String(Math.max(0, Math.round(Number(code) || 0)));
    while (s.length < AN_SECTIONS.length) s = "0" + s;
    if (s.length !== AN_SECTIONS.length) return anDefaultOrder();
    var seen = {};
    var next = [];
    var i;
    for (i = 0; i < AN_SECTIONS.length; i++) {
        var d = s.charCodeAt(i) - 48;
        if (d < 0 || d >= AN_SECTIONS.length || seen[d]) return anDefaultOrder();
        seen[d] = 1;
        next.push(d);
    }
    return next;
}

function anSectionRects(mask, order) {
    var ord = order && order.length === AN_SECTIONS.length ? order : anDefaultOrder();
    var out = [];
    var x = AN_SEC_X0;
    var pos;
    for (pos = 0; pos < ord.length; pos++) {
        var i = ord[pos];
        if (!((mask >> i) & 1)) continue;
        out.push({ id: AN_SECTIONS[i].id, index: i, slot: pos, x: x, w: AN_SECTIONS[i].w });
        x += AN_SECTIONS[i].w + AN_SEC_GAP;
    }
    return out;
}

function anFoldWidth(mask, order) {
    var r = anSectionRects(mask, order);
    if (!r.length) return AN_SEC_X0 - AN_SEC_GAP + AN_WIN_PAD;
    var last = r[r.length - 1];
    return Math.min(AN_MAX_W, last.x + last.w + AN_WIN_PAD);
}

function anRailGeom() {
    var buttons = [];
    var i;
    for (i = 0; i < AN_SECTIONS.length; i++) buttons.push([6, 8 + i * 34, 16, 16]);
    return { rail: [AN_SB_X, 4, AN_SB_W, AN_H - 8], buttons: buttons, freeze: [6, 146, 16, 16] };
}

function anTipRect(slot) {
    var b = anRailGeom().buttons[slot];
    var name = AN_SECTIONS[slot] ? AN_SECTIONS[slot].name : "Freeze";
    var w = Math.max(72, name.length * 6 + 12);
    return [AN_SEC_X0 + 2, b[1], w, 16];
}

function anFreezeTip() {
    return [AN_SEC_X0 + 2, 146, 56, 16];
}

function anSpecGeom(panel) {
    var pills = [];
    var pw = 46, gap = 3;
    var x = panel.x + panel.w - 6 - 3 * pw - 2 * gap;
    var i;
    for (i = 0; i < 3; i++) pills.push([x + i * (pw + gap), 8, pw, 14]);
    var lcd = [panel.x + 6, 28, panel.w - 12, AN_H - 36];
    return {
        pills: pills,
        lcd: lcd,
        plot: [lcd[0] + 22, lcd[1] + 4, lcd[2] - 28, lcd[3] - 16]
    };
}

function anScopeGeom(panel) {
    var modes = [];
    var times = [];
    var x = panel.x + 6;
    var i;
    for (i = 0; i < 4; i++) modes.push([x + i * 32, 8, 30, 14]);
    var x2 = modes[3][0] + 30 + 6;
    for (i = 0; i < 3; i++) times.push([x2 + i * 22, 8, 20, 14]);
    var trig = [times[2][0] + 20 + 4, 8, 36, 14];
    var lcd = [panel.x + 6, 28, panel.w - 12, AN_H - 36];
    return { modes: modes, times: times, trig: trig, lcd: lcd };
}

function anLogX(freq, x, w) {
    var lo = Math.log(20);
    var hi = Math.log(20000);
    var f = anClamp(freq, 20, 20000);
    return x + (Math.log(f) - lo) / (hi - lo) * w;
}

function anXToFreq(px, x, w) {
    var lo = Math.log(20);
    var hi = Math.log(20000);
    var t = w > 0 ? anClamp((px - x) / w, 0, 1) : 0;
    return Math.exp(lo + t * (hi - lo));
}

function anClampXover(f1, f2, f3) {
    var a = anClamp(f1, 40, 500);
    var b = anClamp(f2, 80, 8000);
    var c = anClamp(f3, 200, 16000);
    if (b < a * 1.4) b = a * 1.4;
    if (c < b * 1.4) c = Math.min(16000, b * 1.4);
    if (c > 16000) c = 16000;
    if (b > c / 1.4) b = c / 1.4;
    if (a > b / 1.4) a = b / 1.4;
    if (a < 40) a = 40;
    return [a, b, c];
}

function anStereoGeom(panel, freqs) {
    var f = anClampXover(freqs[0], freqs[1], freqs[2]);
    var axis = [panel.x + 8, 20, panel.w - 16, 12];
    var handles = [];
    var i;
    for (i = 0; i < 3; i++) {
        var hx = anLogX(f[i], axis[0], axis[2]);
        handles.push([hx - 6, axis[1] - 2, 12, 16]);
    }
    var gonio = [panel.x + panel.w - 8 - 78, 40, 78, 78];
    var rowW = gonio[0] - panel.x - 8;
    var rows = [];
    for (i = 0; i < 4; i++) {
        var y = 42 + i * 28;
        rows.push({
            y: y,
            label: [panel.x + 8, y, 36, 12],
            corr: [panel.x + 46, y + 1, 70, 10],
            width: [panel.x + 120, y + 1, 44, 10],
            bal: [panel.x + 168, y, 22, 12]
        });
    }
    return { axis: axis, handles: handles, gonio: gonio, rows: rows, rowW: rowW, freqs: f };
}

function anLoudGeom(panel) {
    var rows = [];
    var i;
    for (i = 0; i < 6; i++) rows.push([panel.x + 8, 28 + i * 16, panel.w - 16, 14]);
    return {
        rows: rows,
        spark: [panel.x + 8, 126, panel.w - 16, 28],
        reset: [panel.x + panel.w - 54, 8, 46, 14]
    };
}

function anHits(mask, order, freqs) {
    var hits = [];
    var rail = anRailGeom();
    var i;
    for (i = 0; i < rail.buttons.length; i++) hits.push({ kind: "rail", index: i, rect: rail.buttons[i] });
    hits.push({ kind: "freeze", index: 0, rect: rail.freeze });
    var panels = anSectionRects(mask, order);
    for (i = 0; i < panels.length; i++) {
        var p = panels[i];
        if (p.id === "spec") {
            var sg = anSpecGeom(p);
            var k;
            for (k = 0; k < sg.pills.length; k++) hits.push({ kind: "spec", index: k, rect: sg.pills[k] });
        } else if (p.id === "scope") {
            var og = anScopeGeom(p);
            var m;
            for (m = 0; m < og.modes.length; m++) hits.push({ kind: "mode", index: m, rect: og.modes[m] });
            for (m = 0; m < og.times.length; m++) hits.push({ kind: "time", index: m, rect: og.times[m] });
            hits.push({ kind: "trig", index: 0, rect: og.trig });
        } else if (p.id === "stereo") {
            var tg = anStereoGeom(p, freqs || AN_XOVER_DEFAULT);
            var h;
            for (h = 0; h < tg.handles.length; h++) hits.push({ kind: "xover", index: h, rect: tg.handles[h] });
        } else if (p.id === "loud") {
            hits.push({ kind: "reset", index: 0, rect: anLoudGeom(p).reset });
        }
    }
    return hits;
}

function anHitAt(x, y, mask, order, freqs) {
    var hits = anHits(mask, order, freqs);
    var i;
    for (i = hits.length - 1; i >= 0; i--) if (anInside(hits[i].rect, x, y)) return hits[i];
    return null;
}

// BS.1770 K-weighting. Coefficients are the bilinear high-shelf + RLB high-pass, a0-normalized
// (at 48 kHz the shelf matches the published table; the RLB numerator is divided by a0 so the
// passband gain is 1, where the printed table leaves b = [1, -2, 1]).
function anKWeightCoeffs(sr) {
    var rate = sr > 1000 ? sr : 48000;
    var f0 = 1681.974450955533;
    var gainDb = 3.999843853973347;
    var q = 0.7071752369554196;
    var kk = Math.tan(Math.PI * f0 / rate);
    var vh = Math.pow(10, gainDb / 20);
    var vb = Math.pow(vh, 0.4996667741545416);
    var a0 = 1 + kk / q + kk * kk;
    var pre = {
        b0: (vh + vb * kk / q + kk * kk) / a0,
        b1: 2 * (kk * kk - vh) / a0,
        b2: (vh - vb * kk / q + kk * kk) / a0,
        a1: 2 * (kk * kk - 1) / a0,
        a2: (1 - kk / q + kk * kk) / a0
    };
    f0 = 38.13547087602444;
    q = 0.5003270373238773;
    kk = Math.tan(Math.PI * f0 / rate);
    a0 = 1 + kk / q + kk * kk;
    var rlb = {
        b0: 1 / a0,
        b1: -2 / a0,
        b2: 1 / a0,
        a1: 2 * (kk * kk - 1) / a0,
        a2: (1 - kk / q + kk * kk) / a0
    };
    return { pre: pre, rlb: rlb };
}

function anBiquadStep(x, c, z1, z2) {
    var y = c.b0 * x + z1;
    return { y: y, z1: c.b1 * x - c.a1 * y + z2, z2: c.b2 * x - c.a2 * y };
}

function anBiquadGain(c, freq, sr) {
    var w = 2 * Math.PI * freq / sr;
    var zr = Math.cos(w);
    var zi = -Math.sin(w);
    var z2r = zr * zr - zi * zi;
    var z2i = 2 * zr * zi;
    var nr = c.b0 + c.b1 * zr + c.b2 * z2r;
    var ni = c.b1 * zi + c.b2 * z2i;
    var dr = 1 + c.a1 * zr + c.a2 * z2r;
    var di = c.a1 * zi + c.a2 * z2i;
    var d = dr * dr + di * di;
    var rr = (nr * dr + ni * di) / d;
    var ri = (ni * dr - nr * di) / d;
    return Math.sqrt(rr * rr + ri * ri);
}

function anLufsFromZ(z) {
    if (!(z > 1e-20)) return -200;
    return -0.691 + 10 * Math.log10(z);
}

function anDbFromPow(p) {
    if (!(p > 1e-20)) return -200;
    return 10 * Math.log10(p);
}

function anDbtp(lin) {
    if (!(lin > 1e-20)) return -200;
    return 20 * Math.log10(lin);
}

function anWindowZ(pkts, count) {
    var n0 = Math.max(0, pkts.length - count);
    var k = 0;
    var n = 0;
    var i;
    for (i = n0; i < pkts.length; i++) {
        k += pkts[i].kL + pkts[i].kR;
        n += pkts[i].n;
    }
    return n > 0 ? k / n : 0;
}

function anWindowRms(pkts, count) {
    var n0 = Math.max(0, pkts.length - count);
    var r = 0;
    var n = 0;
    var i;
    for (i = n0; i < pkts.length; i++) {
        r += pkts[i].rL + pkts[i].rR;
        n += pkts[i].n;
    }
    return n > 0 ? anDbFromPow(r / (2 * n)) : -200;
}

function anPercentile(values, p) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var x = (s.length - 1) * p;
    var i = Math.floor(x);
    var f = x - i;
    var j = Math.min(s.length - 1, i + 1);
    return s[i] * (1 - f) + s[j] * f;
}

function anLra(values) {
    if (!values || values.length < 2) return null;
    return anPercentile(values, 0.95) - anPercentile(values, 0.1);
}

var AN_BIN_N = 1001;
function anBin(lufs) {
    var b = Math.round((lufs + 80) / 0.1);
    if (b < 0) return 0;
    if (b > 1000) return 1000;
    return b;
}

function anLoudCreate() {
    return {
        pkts: [],
        zSum: new Float64Array(AN_BIN_N),
        blocks: new Float64Array(AN_BIN_N),
        ungatedZ: 0,
        ungatedN: 0,
        st: [],
        spark: [],
        tp: 0,
        pk: 0,
        hop: 0,
        mom: -200,
        short: -200,
        integ: -200,
        lra: null,
        rms: -200
    };
}

function anInteg(state) {
    if (state.ungatedN < 1) return -200;
    var ung = anLufsFromZ(state.ungatedZ / state.ungatedN);
    var gate = ung - 10;
    var z = 0;
    var n = 0;
    var b;
    for (b = 0; b <= 1000; b++) {
        if (!state.blocks[b]) continue;
        if (-80 + b * 0.1 >= gate) {
            z += state.zSum[b];
            n += state.blocks[b];
        }
    }
    if (!n) return ung;
    return anLufsFromZ(z / n);
}

function anLoudPush(state, pkt) {
    state.pkts.push(pkt);
    if (state.pkts.length > 320) state.pkts.shift();
    var tp = Math.max(pkt.tpL || 0, pkt.tpR || 0);
    var pk = Math.max(pkt.pkL || 0, pkt.pkR || 0);
    if (tp > state.tp) state.tp = tp;
    if (pk > state.pk) state.pk = pk;
    state.mom = anLufsFromZ(anWindowZ(state.pkts, 40));
    state.short = anLufsFromZ(anWindowZ(state.pkts, 300));
    state.rms = anWindowRms(state.pkts, 40);
    state.hop++;
    if (state.hop >= 10 && state.pkts.length >= 40) {
        state.hop = 0;
        var z = anWindowZ(state.pkts, 40);
        var lu = anLufsFromZ(z);
        if (lu > -70) {
            var b = anBin(lu);
            state.zSum[b] += z;
            state.blocks[b] += 1;
            state.ungatedZ += z;
            state.ungatedN += 1;
        }
        state.integ = anInteg(state);
        if (state.pkts.length >= 300) {
            state.spark.push(state.short);
            if (state.spark.length > 80) state.spark.shift();
            if (state.short > -70 && state.short >= state.integ - 20) {
                state.st.push(state.short);
                if (state.st.length > 6000) state.st.shift();
            }
            state.lra = state.st.length >= 20 ? anLra(state.st) : null;
        }
    }
}

function anLoudReset(state) {
    state.pkts = [];
    state.zSum = new Float64Array(AN_BIN_N);
    state.blocks = new Float64Array(AN_BIN_N);
    state.ungatedZ = 0;
    state.ungatedN = 0;
    state.st = [];
    state.spark = [];
    state.tp = 0;
    state.pk = 0;
    state.hop = 0;
    state.mom = -200;
    state.short = -200;
    state.integ = -200;
    state.lra = null;
    state.rms = -200;
}

function anCorrelation(ll, rr, lr) {
    var d = Math.sqrt(Math.max(ll, 0) * Math.max(rr, 0));
    if (d < 1e-12) return 0;
    return anClamp(lr / d, -1, 1);
}

function anWidth(ll, rr, lr) {
    var mid = Math.max(0, ll + rr + 2 * lr);
    var side = Math.max(0, ll + rr - 2 * lr);
    var s = mid + side;
    if (s < 1e-12) return 0;
    return side / s;
}

function anBalance(ll, rr) {
    var s = ll + rr;
    if (s < 1e-12) return 0;
    return anClamp((rr - ll) / s, -1, 1);
}

function anBandsOf(pkt) {
    var out = [];
    var b;
    for (b = 0; b < 4; b++) {
        var bd = pkt.bands[b];
        out.push({ corr: anCorrelation(bd.ll, bd.rr, bd.lr), width: anWidth(bd.ll, bd.rr, bd.lr), bal: anBalance(bd.ll, bd.rr) });
    }
    return out;
}

function anBandsAvg(pkts, count) {
    var n0 = Math.max(0, pkts.length - count);
    var acc = [];
    var b;
    for (b = 0; b < 4; b++) acc.push({ ll: 0, rr: 0, lr: 0 });
    var i;
    for (i = n0; i < pkts.length; i++) {
        for (b = 0; b < 4; b++) {
            acc[b].ll += pkts[i].bands[b].ll;
            acc[b].rr += pkts[i].bands[b].rr;
            acc[b].lr += pkts[i].bands[b].lr;
        }
    }
    return anBandsOf({ bands: acc });
}

// ISO preferred 1/3-octave centres, 1000 * 2^(k/3), k = -17..13 (about 20 Hz .. 20 kHz).
function anThirdCenters() {
    var out = [];
    var k;
    for (k = -17; k <= 13; k++) out.push(1000 * Math.pow(2, k / 3));
    return out;
}

function anThirdBand(freq) {
    if (!(freq > 0)) return -1;
    var k = Math.round(3 * Math.log(freq / 1000) / Math.LN2);
    var idx = k + 17;
    if (idx < 0 || idx > 30) return -1;
    return idx;
}

function anBandEnergies(power, nfft, sr) {
    var bands = [];
    var i;
    for (i = 0; i < 31; i++) bands.push(0);
    var half = (nfft / 2) | 0;
    var bin;
    for (bin = 1; bin < half; bin++) {
        var idx = anThirdBand(bin * sr / nfft);
        if (idx >= 0) bands[idx] += power[bin] || 0;
    }
    // Divide out the Hann window power/peak ratio (1.5): a bin-centred tone
    // spreads its power over neighbouring bins, so the raw band sum over-reads
    // by 10*log10(1.5) = +1.76 dB versus the (exact) peak-bin Heat scale.
    for (i = 0; i < 31; i++) bands[i] /= 1.5;
    return bands;
}

function anBlob(state) {
    var f = anClampXover(state.f1, state.f2, state.f3);
    return [
        AN_VERSION,
        anClamp(state.mask, 0, 15) | 0,
        anEncodeOrder(state.order),
        anClamp(state.specType, 0, 2) | 0,
        anClamp(state.scopeMode, 0, 3) | 0,
        anClamp(state.scopeTime, 0, 2) | 0,
        state.trigger ? 1 : 0,
        f[0], f[1], f[2]
    ];
}

function anFromBlob(arr) {
    var a = arr || [];
    var ver = Number(a[0]);
    var base = {
        mask: AN_DEFAULT_FOLD,
        order: anDefaultOrder(),
        specType: 0,
        scopeMode: 0,
        scopeTime: 1,
        trigger: 0,
        f1: AN_XOVER_DEFAULT[0],
        f2: AN_XOVER_DEFAULT[1],
        f3: AN_XOVER_DEFAULT[2]
    };
    if (ver !== 1 || a.length < 10) return base;
    var f = anClampXover(a[7], a[8], a[9]);
    base.mask = anClamp(a[1], 0, 15) | 0;
    base.order = anDecodeOrder(a[2]);
    base.specType = anClamp(a[3], 0, 2) | 0;
    base.scopeMode = anClamp(a[4], 0, 3) | 0;
    base.scopeTime = anClamp(a[5], 0, 2) | 0;
    base.trigger = a[6] ? 1 : 0;
    base.f1 = f[0];
    base.f2 = f[1];
    base.f3 = f[2];
    return base;
}

function anPktFromFloats(samples) {
    var bands = [];
    var b;
    for (b = 0; b < 4; b++) {
        var o = AN_PK_BAND + b * 3;
        bands.push({ ll: samples[o] || 0, rr: samples[o + 1] || 0, lr: samples[o + 2] || 0 });
    }
    return {
        kL: samples[AN_PK_KL] || 0,
        kR: samples[AN_PK_KR] || 0,
        rL: samples[AN_PK_RL] || 0,
        rR: samples[AN_PK_RR] || 0,
        tpL: samples[AN_PK_TPL] || 0,
        tpR: samples[AN_PK_TPR] || 0,
        pkL: samples[AN_PK_PKL] || 0,
        pkR: samples[AN_PK_PKR] || 0,
        n: samples[AN_PK_N] || AN_PKT_SAMPS,
        bands: bands
    };
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        AN_VERSION: AN_VERSION,
        AN_SECTIONS: AN_SECTIONS,
        AN_SB_X: AN_SB_X,
        AN_SB_W: AN_SB_W,
        AN_SEC_X0: AN_SEC_X0,
        AN_SEC_GAP: AN_SEC_GAP,
        AN_WIN_PAD: AN_WIN_PAD,
        AN_H: AN_H,
        AN_DEFAULT_FOLD: AN_DEFAULT_FOLD,
        AN_MAX_W: AN_MAX_W,
        AN_SCOPE_MS: AN_SCOPE_MS,
        AN_XOVER_DEFAULT: AN_XOVER_DEFAULT,
        AN_HDR_FRAME: AN_HDR_FRAME,
        AN_PKT_STRIDE: AN_PKT_STRIDE,
        AN_PKT_COUNT: AN_PKT_COUNT,
        AN_PKT_BASE: AN_PKT_BASE,
        AN_PKT_SAMPS: AN_PKT_SAMPS,
        AN_SCOPE_N: AN_SCOPE_N,
        AN_SCOPE_L: AN_SCOPE_L,
        AN_SCOPE_R: AN_SCOPE_R,
        AN_FFT_N: AN_FFT_N,
        AN_FFT_BASE: AN_FFT_BASE,
        AN_BUF_SAMPS: AN_BUF_SAMPS,
        AN_HEAT_COLS: AN_HEAT_COLS,
        AN_HEAT_ROWS: AN_HEAT_ROWS,
        anClamp: anClamp,
        anInside: anInside,
        anEncodeOrder: anEncodeOrder,
        anDecodeOrder: anDecodeOrder,
        anSectionRects: anSectionRects,
        anFoldWidth: anFoldWidth,
        anRailGeom: anRailGeom,
        anTipRect: anTipRect,
        anFreezeTip: anFreezeTip,
        anSpecGeom: anSpecGeom,
        anScopeGeom: anScopeGeom,
        anStereoGeom: anStereoGeom,
        anLoudGeom: anLoudGeom,
        anHits: anHits,
        anHitAt: anHitAt,
        anClampXover: anClampXover,
        anKWeightCoeffs: anKWeightCoeffs,
        anBiquadStep: anBiquadStep,
        anBiquadGain: anBiquadGain,
        anLufsFromZ: anLufsFromZ,
        anDbFromPow: anDbFromPow,
        anDbtp: anDbtp,
        anPercentile: anPercentile,
        anLra: anLra,
        anLoudCreate: anLoudCreate,
        anLoudPush: anLoudPush,
        anLoudReset: anLoudReset,
        anCorrelation: anCorrelation,
        anWidth: anWidth,
        anBalance: anBalance,
        anBandsAvg: anBandsAvg,
        anThirdCenters: anThirdCenters,
        anThirdBand: anThirdBand,
        anBandEnergies: anBandEnergies,
        anBlob: anBlob,
        anFromBlob: anFromBlob,
        anPktFromFloats: anPktFromFloats,
        anLogX: anLogX,
        anXToFreq: anXToFreq
    };
}
