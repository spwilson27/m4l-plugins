// harmsplit_config.js — Harmonic Split: constants, parameter table, helpers and the plain-JS reference of the analysis and
// mask maths in src/harmsplit_core.genexpr (hs_prep / hs_sal / hs_decide / hs_harm / hs_post / hs_masks, mirrored line for
// line). Node-requirable (nodeModule pattern, AGENTS.md 1c) and also prepended to the v8ui script by the build.
//
// Detection filters: Low-cut / High-cut (19.4 Hz .. 19.9 kHz) are soft 4th-order attenuations of the ANALYSIS spectrum only (they
// decide nothing about where a bin is sorted); Tilt (+-12 dB per decade around 1 kHz) is analysis only too. Detection Threshold
// -120 dB (its minimum) = Automatic: effective threshold = running peak level - 40 dB (12 dB/s release), never below -100 dB.
// Maximum Harmonics 0 = Off (no limit, 404 harmonics tracked at most).
//
// Mask contract: for every bin the Nonharmonics, Harmonics A and Harmonics B masks sum to exactly 1 (there is no gain
// control in this device). Harmonic h of the tracked fundamental goes to A when (h - 1) mod P == 0, else to B, for a
// Harmonics Pattern P >= 2; Pattern 1 sends ONLY the fundamental (h == 1) to A and every other harmonic to B.

var HS_NCOLS = 128;          // display columns (log frequency)
var HS_FMIN = 30.0;
var HS_FMAX = 20000.0;
var HS_LATENCY = 4096;
var HS_CH_NAMES = ["Nonharmonics", "Harmonics A", "Harmonics B"];
var HS_SIZES = [1024, 2048, 4096];
var HS_SIZE_ENUM = ["1k", "2k", "4k"];
var HS_OUT_ENUM = ["Auto", "Nonharm", "Harm A", "Harm B", "All"];

// Telemetry buffer layout (---harmsplitscope, HS_SCOPE_SAMPS floats)
var HS_SC_PRE = 0;                     // 128 input (Mid) levels, 0..1 over -100..0 dB
var HS_SC_NH = HS_NCOLS;               // 128 Nonharmonics channel (mask applied), same scale
var HS_SC_A = HS_NCOLS * 2;            // 128 Harmonics A
var HS_SC_B = HS_NCOLS * 3;            // 128 Harmonics B
var HS_SC_FRAME = HS_NCOLS * 4;        // frame counter (telemetry frames)
var HS_SC_SR = HS_SC_FRAME + 1;
var HS_SC_N = HS_SC_FRAME + 2;
var HS_SC_AWAKE = HS_SC_FRAME + 3;
var HS_SC_LEVEL = HS_SC_FRAME + 4;     // input peak (decaying)
var HS_SC_F0 = HS_SC_FRAME + 5;        // tracked fundamental in Hz, 0 = none
var HS_SC_CONF = HS_SC_FRAME + 6;      // salience of the best candidate
var HS_SC_VOICED = HS_SC_FRAME + 7;    // voiced amount 0..1
var HS_SC_LVL = HS_SC_FRAME + 8;       // loudest spectral peak of the tracking area, dBFS
var HS_SC_LATENCY = HS_SC_FRAME + 9;
var HS_SC_SEL = HS_SC_FRAME + 10;      // output selection the gen is running (0 all, 1 NH, 2 A, 3 B)
var HS_SC_NACT = HS_SC_FRAME + 11;     // harmonics with weight > 0.5
var HS_SC_THREFF = HS_SC_FRAME + 12;   // effective detection threshold, dB (the automatic one when Threshold = -120)
var HS_SCOPE_SAMPS = HS_SC_FRAME + 32;

// Analysis constants (mirrored in the core)
var HS_NCAND = 642;
var HS_CAND_FMIN = 19.4;
var HS_CAND_PER_OCT = 64.0;
var HS_ACCEPT = 0.38;
var HS_MAXH = 404;
var HS_AUTO_OFFSET_DB = 40.0;     // Automatic threshold: running level - 40 dB
var HS_AUTO_REL_DB_S = 12.0;      // running level release, dB per second
var HS_AUTO_FLOOR_DB = -100.0;
var HS_THR_MIN = -120.0;
var HS_NPATTERN = 24;

// key: [long name, short name, min, max, initial, ptype (0 float, 1 int), unitstyle]
// (Max Harmonics goes past 255, which Live's native Int cannot hold: float with an integer unit style.)
var HS_PARAMS = {
    maxh: ["Maximum Harmonics", "Max Harm", 0.0, 404.0, 0.0, 0, 0],
    sens: ["Nonharmonic Sensitivity", "NH Sens", 1.0, 100.0, 50.0, 0, 5],
    tilt: ["Tilt", "Tilt", -12.0, 12.0, 0.0, 0, 4],
    thr: ["Detection Threshold", "Threshold", -120.0, 0.0, -120.0, 0, 4],
    lowcut: ["Detection Low-cut Frequency", "Low Cut", 19.4, 19900.0, 80.0, 0, 3],
    highcut: ["Detection High-cut Frequency", "High Cut", 19.4, 19900.0, 1500.0, 0, 3],
    mix: ["Mix", "Mix", 0.0, 100.0, 100.0, 0, 5]
};
// Harmonics Pattern 1..24 is an enum (index 0..23 = pattern 1..24) so Live shows "Every 2nd"
var HS_PATTERN_ENUM = [];
(function () {
    for (var i = 1; i <= 24; i++) {
        var t = i % 100;
        var suf = (t >= 11 && t <= 13) ? "th" : (i % 10 === 1 ? "st" : (i % 10 === 2 ? "nd" : (i % 10 === 3 ? "rd" : "th")));
        HS_PATTERN_ENUM.push(i === 1 ? "1st only" : "Every " + i + suf);
    }
})();
// enumerated: key: [long name, short name, values, initial]
var HS_ENUMS = {
    pattern: ["Harmonics Pattern", "Pattern", HS_PATTERN_ENUM, 1],
    size: ["Size", "Size", HS_SIZE_ENUM, 1],
    output: ["Output", "Output", HS_OUT_ENUM, 0]
};
// keys shared between all instances in a rack (everything except Output and the display toggle)
var HS_LINKED_KEYS = ["pattern", "maxh", "sens", "tilt", "thr", "lowcut", "highcut", "mix", "size"];

// Output of one instance: Mix crossfades this chain's channel (wet) with its share of the dry input (dry / K, K = chains in the
// rack), so the rack sum is mix * wet_sum + (1 - mix) * dry. K = 1 for Output = All.
function hsMixOut(wetOwn, dry, mix, k) {
    return mix * wetOwn + (1 - mix) * dry / k;
}

// Ordinal label of a Harmonics Pattern (1..24): "Every 2nd", "1st only".
function hsPatternLabel(p) {
    var i = Math.round(p);
    return HS_PATTERN_ENUM[Math.max(1, Math.min(24, i)) - 1];
}

// Bitwig-style value strings of the display
function hsFmtFreq(f) {
    if (f < 1000) return f.toFixed(1) + " Hz";
    if (f < 10000) return (f / 1000).toFixed(2) + " kHz";
    return (f / 1000).toFixed(1) + " kHz";
}

function hsFmtThr(t) {
    return t <= HS_THR_MIN + 0.5 ? "Automatic" : t.toFixed(1) + " dB";
}

function hsClip(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

function hsSm(x) {
    var c = hsClip(x, 0, 1);
    return c * c * (3 - 2 * c);
}

// Output selector for the gen from the Output menu and the resolved Auto channel (0-based, -1 = no rack).
// Returns 0 = All (masks sum to 1), 1 = Nonharmonics, 2 = Harmonics A, 3 = Harmonics B.
function hsResolveSel(outputIdx, autoChannel) {
    var o = Math.round(outputIdx);
    if (o === 1) return 1;
    if (o === 2) return 2;
    if (o === 3) return 3;
    if (o === 4) return 0;
    if (autoChannel < 0) return 0;
    return Math.min(autoChannel, 2) + 1;
}

function hsSelName(sel) {
    return sel >= 1 && sel <= 3 ? HS_CH_NAMES[sel - 1] : "All";
}

// Does harmonic h (1-based) go to A for pattern P? Pattern 1: only the fundamental.
function hsIsA(h, pat) {
    var p = Math.max(pat, 1);
    if (p < 1.5) return h < 1.5 ? 1 : 0;
    return ((h - 1) - p * Math.floor((h - 1) / p)) < 0.5 ? 1 : 0;
}

// Bin of a display column edge (c = 0..ncols), log spaced.
function hsColBin(c, ncols, n, sr, fmin, fmax) {
    return fmin * Math.pow(fmax / fmin, c / ncols) * n / sr;
}

function hsFormatHz(f) {
    return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + "k" : String(Math.round(f));
}

var HS_ODD_H = 15;
var HS_B = parseFloat(process.env.BIAS || '0');
var HS_OH = 0;
function hsNewState(n) {
    var half = n / 2;
    return {
        n: n,
        half: half,
        mN: new Float64Array(half + 1),
        mA: new Float64Array(half + 1),
        mB: new Float64Array(half + 1),
        dbt: new Float64Array(half + 1),     // tilted dB
        dbr: new Float64Array(half + 1),     // raw dB
        att: new Float64Array(half + 1),     // cut-filter attenuation dB
        hc: new Float64Array(half + 1),      // compressed salience spectrum
        sal: new Float64Array(646),
        cen: new Float64Array(406),
        prom: new Float64Array(406),
        hw: new Float64Array(406),
        hwA: new Float64Array(406),
        hst: new Float64Array(32),
        age: 0
    };
}

// One analysis frame. mag: Mid amplitude per bin (0..n/2). p = {hpat, hmaxp, sens (0..1), tilt (-1..1), thr (dB), flo, fhi (Hz)}.
// Fills st.mN / st.mA / st.mB (the gen applies mask[k] to bins k and n-k) and the tracker state in st.hst.
// st.age is advanced here (the gen core does the same with its History `age`).
function hsFrame(st, mag, p, sr) {
    var n = st.n;
    var half = n * 0.5;
    var df = sr / n;
    var hst = st.hst;
    var i, k, h;
    if (st.age < 0.5) {
        hst.fill(0);
        st.cen.fill(0);
        st.prom.fill(0);
        st.hw.fill(0);
        st.hwA.fill(0);
    }
    var flo = p.flo, fhi = p.fhi, thr = p.thr, sens = p.sens;
    var hmx = p.hmaxp < 0.5 ? HS_MAXH : p.hmaxp;
    var dec = 3 * n / sr;

    // ---- hs_prep ----
    var dbmx = -200, lvl = -200;
    for (k = 0; k <= half; k++) {
        var a = mag[k];
        var d = 8.685889638065035 * Math.log(Math.max(a, 1e-9));
        var f = Math.max(k, 0.5) * df;
        var twt = p.tilt * Math.log(f * 0.001) * 0.4342944819032518;
        var ar = flo / f, lr = f / fhi;
        var att = -4.342944819032518 * (Math.log(1 + ar * ar * ar * ar) + Math.log(1 + lr * lr * lr * lr));
        st.dbr[k] = d;
        st.dbt[k] = d + twt + att;
        st.att[k] = att;
        if (k >= 1 && k <= half - 1) {
            dbmx = Math.max(dbmx, d + twt + att);
            lvl = Math.max(lvl, d + att);
        }
    }
    for (k = 0; k <= half; k++) st.hc[k] = hsClip((st.dbt[k] - (dbmx - 45)) / 45, 0, 1);
    st.hc[0] = 0;
    st.hc[half] = 0;
    hst[8] = dbmx;
    hst[9] = lvl;

    // ---- hs_sal ----
    var ftop = sr * 0.45;
    var sal = st.sal;
    sal.fill(0);
    var smax = 0;
    for (i = 0; i < HS_NCAND; i++) {
        var g = HS_CAND_FMIN * Math.pow(2, i / 64);
        var ssum = 0, wt = 0, cn = 0;
        var sv = 0;
        var act = (flo < fhi && g >= flo * 0.7071 && g <= fhi * 1.4142 && g <= ftop) ? 1 : 0;
        if (act > 0.5) {
            var ga = flo / g, gb = g / fhi;
            var gatt = -4.342944819032518 * (Math.log(1 + ga * ga * ga * ga) + Math.log(1 + gb * gb * gb * gb));
            for (h = 1; h <= 10; h++) {
                var fp = h * g;
                var kc = hsClip(Math.floor(fp / df + 0.5), 1, half - 1);
                if (fp >= 20 && fp <= ftop && st.att[kc] > -30) {
                    var pk = Math.max(st.hc[kc - 1], Math.max(st.hc[kc], st.hc[kc + 1]));
                    var kv = hsClip(Math.floor((h - 0.5) * g / df + 0.5), 1, half - 1);
                    var vl = st.hc[kv];
                    if (process.env.VMAX) vl = Math.max(vl, st.hc[hsClip(Math.floor((h + 0.5) * g / df + 0.5), 1, half - 1)]);
                    var w = 1 / (1 + 0.12 * (h - 1));
                    ssum += w * Math.max(pk - vl - HS_B, 0);
                    wt += w;
                    cn += 1;
                }
            }
            var sfull = cn > 0.5 ? ssum / (wt + 0.8) : 0;
            var sodd = 0;
            if (cn > 0.5) {
                var osum = 0, owt = 0, ocn = 0;
                for (h = 1; h <= parseInt(process.env.OH||'15'); h += 2) {
                    var fq = h * g;
                    var kq = hsClip(Math.floor(fq / df + 0.5), 1, half - 1);
                    if (fq >= 20 && fq <= ftop && st.att[kq] > -30) {
                        var pq = Math.max(st.hc[kq - 1], Math.max(st.hc[kq], st.hc[kq + 1]));
                        var kw = hsClip(Math.floor((h - 0.5) * g / df + 0.5), 1, half - 1);
                        var wq = 1 / (1 + 0.12 * (h - 1));
                        var vq = st.hc[kw];
                        if (process.env.VMAX) vq = Math.max(vq, st.hc[hsClip(Math.floor((h + 0.5) * g / df + 0.5), 1, half - 1)]);
                        osum += wq * Math.max(pq - vq - HS_B, 0);
                        owt += wq;
                        ocn += 1;
                    }
                }
                sodd = ocn > 0.5 ? osum / (owt + 0.8) : 0;
            }
            sv = hsClip((gatt + 12) / 9, 0, 1) * (process.env.NOODD ? sfull : Math.max(sfull, sodd));
        }
        sal[i + 1] = sv;
        smax = Math.max(smax, sv);
    }
    var bi = 0, fnd = 0;
    for (i = 1; i <= HS_NCAND; i++) {
        var sv2 = sal[i];
        var cnd = (fnd < 0.5 && smax > 0 && sv2 >= 0.85 * smax && sv2 >= sal[i - 1] && sv2 >= sal[i + 1]) ? 1 : 0;
        bi = cnd > 0.5 ? i : bi;
        fnd = cnd > 0.5 ? 1 : fnd;
    }
    var sa = sal[Math.max(bi - 1, 0)], sb = sal[bi], sc = sal[bi + 1];
    var dd = sa - 2 * sb + sc;
    var dl = dd < -1e-12 ? hsClip(0.5 * (sa - sc) / dd, -0.5, 0.5) : 0;
    hst[10] = fnd > 0.5 ? HS_CAND_FMIN * Math.pow(2, (bi - 1 + dl) / 64) : 0;
    hst[11] = fnd > 0.5 ? sb : 0;

    // ---- hs_decide ----
    var f0c = hst[0], pend = hst[1], pcn = hst[2], hold = hst[3];
    var g0 = hst[10], conf = hst[11];
    var lm = hst[19] > 0.5 ? Math.max(lvl, hst[17] - dec) : lvl;
    var te = thr < -119.5 ? Math.max(lm - HS_AUTO_OFFSET_DB, HS_AUTO_FLOOR_DB) : thr;
    hst[17] = lm;
    hst[18] = te;
    hst[19] = 1;
    var c0e = f0c > 0 ? HS_ACCEPT * 0.55 : HS_ACCEPT;
    var okf = (conf >= c0e && lvl >= te && g0 > 0) ? 1 : 0;
    var gs = f0c;
    var rj = f0c > 0 ? Math.abs(Math.log(Math.max(g0, 1) / f0c)) * 1.4426950408889634 : 0;
    var rp = pend > 0 ? Math.abs(Math.log(Math.max(g0, 1) / pend)) * 1.4426950408889634 : 9;
    if (okf > 0.5) {
        hold = 0;
        if (f0c <= 0) {
            pcn = rp < 0.05 ? pcn + 1 : 1;
            pend = g0;
            if (pcn >= 2) {
                f0c = g0;
                gs = g0;
                pcn = 0;
            }
        } else if (rj < 0.05) {
            gs = g0;
            pcn = 0;
        } else {
            pcn = rp < 0.05 ? pcn + 1 : 1;
            pend = g0;
            if (pcn >= 2) {
                f0c = g0;
                gs = g0;
                pcn = 0;
            }
        }
    } else {
        hold += 1;
        if (f0c <= 0) {
            pcn = 0;
            pend = 0;
        }
        if (hold > 8) {
            f0c = 0;
            gs = 0;
            pcn = 0;
        }
    }
    hst[0] = f0c;
    hst[1] = pend;
    hst[2] = pcn;
    hst[3] = hold;
    hst[13] = gs;
    hst[14] = okf;

    // ---- hs_harm ----
    var gest = gs;
    var num = 0.5 * gs, den = 0.5, nfd = 0;
    for (h = 1; h <= 404; h++) {
        var fp2 = h * gest;
        var cen = fp2, prom = 0;
        if (gs > 0 && fp2 < (half - 3) * df) {
            var wn = Math.max(2 * df, 0.15 * gest);
            var k0 = Math.max(Math.floor((fp2 - wn) / df), 2);
            var k1 = Math.min(Math.floor((fp2 + wn) / df) + 1, half - 2);
            var kp = k0;
            var bv = st.dbr[k0];
            for (k = k0 + 1; k <= k1; k++) {
                var v = st.dbr[k];
                if (v > bv) {
                    bv = v;
                    kp = k;
                }
            }
            var pa = st.dbr[kp - 1], pc = st.dbr[kp + 1];
            var okp = (bv >= pa && bv >= pc && kp > k0 && kp < k1) ? 1 : 0;
            var dd2 = pa - 2 * bv + pc;
            var dl2 = dd2 < -1e-9 ? hsClip(0.5 * (pa - pc) / dd2, -0.5, 0.5) : 0;
            var vl2 = st.dbr[hsClip(Math.floor((fp2 - 0.5 * gest) / df + 0.5), 1, half - 1)];
            var vr2 = st.dbr[hsClip(Math.floor((fp2 + 0.5 * gest) / df + 0.5), 1, half - 1)];
            prom = okp > 0.5 ? bv - 0.5 * (vl2 + vr2) : 0;
            cen = okp > 0.5 ? (kp + dl2) * df : fp2;
            if (okp > 0.5 && prom >= 10) {
                num += h * cen;
                den += h * h;
                gest = num / den;
                nfd += 1;
            }
        }
        st.cen[h] = cen;
        st.prom[h] = prom;
    }
    hst[12] = gest;
    hst[15] = nfd;

    // ---- hs_post ----
    var gr = gest;
    if (gs > 0 && f0c > 0 && (okf > 0.5 || nfd >= 3)) {
        var rr = Math.abs(Math.log(gr / f0c)) * 1.4426950408889634;
        f0c = rr < 0.05 ? f0c + (gr - f0c) * 0.6 : gr;
    }
    var gl = hsSm((lvl - hst[18]) / 4);
    var vt = f0c > 0 ? gl : 0;
    var vv = hst[4];
    vv = vv + (vt - vv) * (vt > vv ? 0.6 : 0.35);
    hst[0] = f0c;
    hst[4] = vv;
    if (gs > 0) hst[5] = gr;

    // ---- hs_masks ----
    var gu = gs > 0 ? hst[12] : hst[5];
    var pmin = 14 - 12 * sens;
    var pat = Math.max(p.hpat, 1);
    var nact = 0;
    for (h = 1; h <= 404; h++) {
        var cn2 = st.cen[h], pr2 = st.prom[h];
        var tw = (gs > 0 && h <= hmx && cn2 > 0) ? hsSm((pr2 - pmin) / 6) * vv : 0;
        var prev = st.hw[h];
        var cur = prev + (tw - prev) * (tw > prev ? 0.7 : 0.4);
        var isA = hsIsA(h, pat);
        st.hw[h] = cur;
        st.hwA[h] = isA > 0.5 ? cur : 0;
        nact += cur > 0.5 ? 1 : 0;
    }
    var sp = Math.max(gu / df, 0.001);
    var w1c = Math.max(0.35 * sp, 0.6);
    var w1 = Math.min(0.7 + 1.3 * sens + 0.7 + 0.5 * sens, w1c);
    var w0 = Math.min(0.7 + 1.3 * sens, w1 - 0.3);
    for (k = 0; k <= half; k++) {
        var hh = gu > 0 ? hsClip(Math.floor(k / sp + 0.5), 0, 404) : 0;
        var wa = 0, wb = 0, cb = 0;
        if (hh >= 1) {
            cb = st.cen[hh] / df;
            wa = st.hwA[hh];
            wb = st.hw[hh] - wa;
        }
        var dist = Math.abs(k - cb);
        var m = hh >= 1 ? (dist <= w0 ? 1 : (dist >= w1 ? 0 : 0.5 * (1 + Math.cos(3.141592653589793 * (dist - w0) / (w1 - w0))))) : 0;
        var ma = m * wa, mb = m * wb;
        st.mN[k] = 1 - ma - mb;
        st.mA[k] = ma;
        st.mB[k] = mb;
    }
    hst[16] = nact;
    st.age = Math.min(st.age + 1, 3);
    return st;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        HS_NCOLS: HS_NCOLS, HS_FMIN: HS_FMIN, HS_FMAX: HS_FMAX, HS_LATENCY: HS_LATENCY, HS_CH_NAMES: HS_CH_NAMES,
        HS_SIZES: HS_SIZES, HS_SIZE_ENUM: HS_SIZE_ENUM, HS_OUT_ENUM: HS_OUT_ENUM, HS_PARAMS: HS_PARAMS, HS_ENUMS: HS_ENUMS, HS_PATTERN_ENUM: HS_PATTERN_ENUM, hsMixOut: hsMixOut, hsPatternLabel: hsPatternLabel,
        hsFmtFreq: hsFmtFreq, hsFmtThr: hsFmtThr, HS_AUTO_OFFSET_DB: HS_AUTO_OFFSET_DB, HS_AUTO_REL_DB_S: HS_AUTO_REL_DB_S, HS_AUTO_FLOOR_DB: HS_AUTO_FLOOR_DB, HS_THR_MIN: HS_THR_MIN, HS_SC_THREFF: HS_SC_THREFF,
        HS_LINKED_KEYS: HS_LINKED_KEYS,
        HS_SC_PRE: HS_SC_PRE, HS_SC_NH: HS_SC_NH, HS_SC_A: HS_SC_A, HS_SC_B: HS_SC_B, HS_SC_FRAME: HS_SC_FRAME,
        HS_SC_SR: HS_SC_SR, HS_SC_N: HS_SC_N, HS_SC_AWAKE: HS_SC_AWAKE, HS_SC_LEVEL: HS_SC_LEVEL, HS_SC_F0: HS_SC_F0,
        HS_SC_CONF: HS_SC_CONF, HS_SC_VOICED: HS_SC_VOICED, HS_SC_LVL: HS_SC_LVL, HS_SC_LATENCY: HS_SC_LATENCY,
        HS_SC_SEL: HS_SC_SEL, HS_SC_NACT: HS_SC_NACT, HS_SCOPE_SAMPS: HS_SCOPE_SAMPS,
        HS_NCAND: HS_NCAND, HS_ACCEPT: HS_ACCEPT, HS_MAXH: HS_MAXH,
        hsClip: hsClip, hsSm: hsSm, hsResolveSel: hsResolveSel, hsSelName: hsSelName, hsIsA: hsIsA,
        hsColBin: hsColBin, hsFormatHz: hsFormatHz, hsNewState: hsNewState, hsFrame: hsFrame
    };
}
