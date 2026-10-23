// harmsplit_config.js — Harmonic Split: constants, parameter table, helpers and the plain-JS reference of the analysis and
// mask maths in src/harmsplit_core.genexpr (hs_prep / hs_sal / hs_decide / hs_harm / hs_post / hs_masks, mirrored line for
// line). Node-requirable (nodeModule pattern, AGENTS.md 1c) and also prepended to the v8ui script by the build.
//
// Detection filters: Low-cut / High-cut (19.4 Hz .. 19.9 kHz) are soft 4th-order attenuations of the ANALYSIS spectrum only (they
// decide nothing about where a bin is sorted; they say where the evidence for the series is and where the root must lie); Tilt (+-12 dB per decade around 1 kHz) is analysis only too. Detection Threshold
// -120 dB (its minimum) = Automatic: effective threshold = running peak level - 40 dB (12 dB/s release), never below -100 dB.
// Maximum Harmonics 0 = Off (no limit, 404 harmonics tracked at most).
//
// Root and numbering: the tracker estimates the SERIES (the harmonic series that explains the partials inside the detection band; its
// fundamental may lie below the band, odd-only spectra are handled). The ROOT is the lowest partial of that series that is present and lies
// inside [Low-cut, High-cut]; harmonics are numbered from it, h' = h - hr + 1 (hr = root's harmonic number in the series; hr = 1 when the
// fundamental itself is inside the band and present). Series partials below the root go to Nonharmonics.
//
// Mask contract: for every bin the Nonharmonics, Harmonics A and Harmonics B masks sum to exactly 1 (there is no gain
// control in this device). Harmonic h' of the root goes to A when (h' - 1) mod P == 0, else to B, for a
// Harmonics Pattern P >= 2; Pattern 1 sends ONLY the root (h' == 1) to A and every other harmonic to B.

var HS_NCOLS = 128;          // display columns (log frequency)
var HS_FMIN = 30.0;
var HS_FMAX = 20000.0;
var HS_LATENCY = 5120;       // 4096 (largest STFT latency, padded) + 1024 margin for the host block: the rack machinery reads the leader's data that late
var HS_CH_NAMES = ["Nonharmonics", "Harmonics A", "Harmonics B"];
var HS_SIZES = [1024, 2048, 4096];
var HS_SIZE_ENUM = ["1k", "2k", "4k"];
var HS_OUT_ENUM = ["Auto", "Nonharm", "Harm A", "Harm B", "All"];

// Telemetry buffer layout (---harmsplitscope, HS_SCOPE_SAMPS floats)
var HS_SC_PRE = 0;                     // 128 input (Mid) levels, 0..1 over -100..0 dB
var HS_SC_NH = HS_NCOLS;               // 128 Nonharmonics channel (mask applied), same scale
var HS_SC_A = HS_NCOLS * 2;            // 128 Harmonics A
var HS_SC_B = HS_NCOLS * 3;            // 128 Harmonics B
// Device slots (written by the computing instance only; the face draws a follower from the leader's buffer). They sit before the rack
// scalars so that the one zeroing of the telemetry (the device fell asleep, template: ss2_zeroscope(scope, HS_SC_FRAME)) clears them too.
var HS_SC_F0 = HS_NCOLS * 4;           // ROOT in Hz (lowest present partial of the tracked series inside the band), 0 = none
var HS_SC_CONF = HS_SC_F0 + 1;         // salience of the best candidate
var HS_SC_VOICED = HS_SC_F0 + 2;       // voiced amount 0..1
var HS_SC_LVL = HS_SC_F0 + 3;          // loudest spectral peak of the tracking area, dBFS
var HS_SC_NACT = HS_SC_F0 + 4;         // harmonics with weight > 0.5
var HS_SC_THREFF = HS_SC_F0 + 5;       // effective detection threshold, dB (the automatic one when Threshold = -120)
var HS_SC_SERIES = HS_SC_F0 + 6;       // series fundamental in Hz (may lie below the band; HS_SC_F0 is the ROOT), 0 = none
var HS_SC_ROOTH = HS_SC_F0 + 7;        // series harmonic number of the root (1 = the fundamental itself)
var HS_SC_ODD = HS_SC_F0 + 8;          // 1 = the tracked series is odd-only (square, triangle, clarinet-like)
// Common scalars (written by the template src/spectral_split_rack_main.genexpr every 1024 samples, by EVERY instance)
var HS_SC_FRAME = HS_NCOLS * 4 + 16;   // frame counter (telemetry frames)
var HS_SC_SR = HS_SC_FRAME + 1;
var HS_SC_N = HS_SC_FRAME + 2;
var HS_SC_AWAKE = HS_SC_FRAME + 3;
var HS_SC_LEVEL = HS_SC_FRAME + 4;     // input peak (decaying)
var HS_SC_LATENCY = HS_SC_FRAME + 6;
var HS_SC_SEL = HS_SC_FRAME + 7;       // output selection the gen is running (0 all, 1 NH, 2 A, 3 B)
var HS_SC_CMP = HS_SC_FRAME + 8;       // 1 = this instance runs the STFT pipeline (leader or alone), 0 = it follows
var HS_SC_FOL = HS_SC_FRAME + 9;       // 1 = following a leader
var HS_SC_ALIGNED = HS_SC_FRAME + 10;  // 1 = the offset to the leader's sample counter is known (content aligned)
var HS_SC_FB = HS_SC_FRAME + 11;       // fallback: 0 none, 1 the input differs from the leader's, 2 the leader's data stopped, 3 ring underrun
var HS_SC_DOFF = HS_SC_FRAME + 12;     // counter offset to the leader (modulo 2^22)
var HS_SC_UNDER = HS_SC_FRAME + 13;    // underrun counter
var HS_SC_LAG = HS_SC_FRAME + 14;      // leader's newest fingerprint counter minus this instance's own counter (samples)
var HS_SC_SERVE = HS_SC_FRAME + 15;    // channel mask this instance computes
var HS_SC_ROLE = HS_SC_FRAME + 16;     // role the face asked for (0 self, 1 leader, 2 follower)
var HS_SC_ALIVE = HS_SC_FRAME + 17;    // counter that moves every 1024 samples while the gen runs, also in silence (DSP ready detection)
var HS_RACK_CHANNELS = 3;
var HS_SCOPE_SAMPS = HS_SC_FRAME + 32;     // 560
// gen messages for the live.* parameters, from the control values (the same conversions as the patcher's expr boxes: pattern index + 1,
// (sens - 1) / 99, Mix / 100, 1024 * 2^size); the face re-sends them until the deferred gen runs
function hsGenMessages(v) {
    return [["hpat", Math.round(v.pattern) + 1], ["hmaxp", v.maxh], ["sensamt", (v.sens - 1) / 99], ["tiltamt", v.tilt], ["thrdb", v.thr],
            ["flocut", v.lowcut], ["fhicut", v.highcut], ["mixamt", v.mix * 0.01], ["fftn", 1024 * Math.pow(2, v.size)]];
}

// Analysis constants (mirrored in the core)
var HS_NCAND = 642;
var HS_CAND_FMIN = 19.4;
var HS_CAND_PER_OCT = 64.0;
var HS_ACCEPT = 0.36;
var HS_ODD_H = 7;   // odd-only comb: harmonics 1, 3, 5, 7 (square, triangle, clarinet-like sounds)
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
    thr: ["Detection Threshold", "Threshold", -120.0, 0.0, -120.0, 0, 9],   // unitstyle 9 + "%.1f dB": style 4 shows -inf below about -70 dB
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

// Series-estimation constants (mirrored in the core)
var HS_REG0 = 0.8;          // comb score regulariser: sum(w term) / (sum(w) + HS_REG0 + HS_REGX * clip((3 - sum(w)) / 2, 0, 1)):
var HS_REGX = 0.6;          // ... a candidate with fewer than about 3 weighted in-band positions is weak evidence (noise gets its maximum there)
var HS_JPOS = 10;           // comb positions per candidate (PV regime)
var HS_PWIDE = 4.5;         // effective partial spacing (bins) from which the peak/valley comb is used; below it the spectral-ripple correlation
var HS_PMIN = 2.2;          // lowest effective spacing (bins) that is scored at all (below it a ripple aliases onto longer spacings)
var HS_COS_K = 0.056;       // ripple-correlation score = K * r * sqrt(sum of band weights)
var HS_COS_BINS = 192;      // bins from the lowest in-band bin that the ripple correlation uses
var HS_COS_SUBOFF = 0.0038; // coarse-grid sub-offsets (relative spacing)
var HS_DETREND = 8;         // ripple detrend: hc minus its mean over +-8 bins
var HS_PRES_WIDE = 10.0;    // partial present (root test): prominence in dB, resolved series
var HS_PRES_NARROW = 4.0;   // ... unresolved series (spacing under HS_PWIDE bins)

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
        yd: new Float64Array(half + 1),      // hc minus its local mean (spectral ripple)
        bw: new Float64Array(half + 1),      // band weight of the bin (cut-filter softening)
        sal: new Float64Array(710),
        salFlag: new Float64Array(710),      // 1 = the odd-only series won at this candidate
        rcP: new Float64Array(710),          // ripple correlation by spacing index, peaks at multiples of S
        rcN: new Float64Array(710),          // ... peaks half way (odd-only series of S/2)
        cen: new Float64Array(406),
        prom: new Float64Array(406),
        pres: new Float64Array(406),
        hw: new Float64Array(406),
        hwA: new Float64Array(406),
        hst: new Float64Array(32),
        age: 0
    };
}

// Ripple correlation of the detrended compressed spectrum with cos(2 pi f / S) over bins kst..kend (weights bw): returns r in -1..1.
function hsCosR(st, kst, kend, df, sy, S) {
    var da = 2 * Math.PI * df / S;
    var ang = 2 * Math.PI * kst * df / S;
    var c = Math.cos(ang), sn = Math.sin(ang), cd = Math.cos(da), sd = Math.sin(da);
    var sxy = 0, sxx = 0;
    for (var k = kst; k <= kend; k++) {
        var wgt = st.bw[k];
        sxy += wgt * st.yd[k] * c;
        sxx += wgt * c * c;
        var cn = c * cd - sn * sd;
        sn = sn * cd + c * sd;
        c = cn;
    }
    return sxy / Math.sqrt(sxx * sy + 1e-12);
}

function hsCosScale(r, sq) {
    return Math.max(HS_COS_K * r * sq, 0);
}

// One analysis frame. mag: Mid amplitude per bin (0..n/2). p = {hpat, hmaxp, sens (0..1), tilt (-1..1), thr (dB), flo, fhi (Hz)}.
// Fills st.mN / st.mA / st.mB (the gen applies mask[k] to bins k and n-k) and the tracker state in st.hst.
// st.age is advanced here (the gen core does the same with its History `age`).
// hst: 0 series f0 (tracked), 20 ROOT frequency (Hz, lowest present in-band partial of the series), 21 root harmonic number hr,
//      22 odd-only flag of the candidate, 23 odd-only flag of the tracked series, 24 effective spacing (bins), 25 series f0 refined.
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
        st.pres.fill(0);
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
    var acc = 0;
    for (k = 0; k <= half; k++) {
        acc += st.hc[k];
        st.bw[k] = acc;                                  // prefix sums (replaced by the band weights below)
    }
    for (k = 0; k <= half; k++) {
        var a0 = Math.max(k - HS_DETREND, 0), a1 = Math.min(k + HS_DETREND, half);
        st.yd[k] = st.hc[k] - (st.bw[a1] - (a0 > 0 ? st.bw[a0 - 1] : 0)) / (a1 - a0 + 1);
    }
    for (k = 0; k <= half; k++) st.bw[k] = hsClip((st.att[k] + 12) / 9, 0, 1);
    hst[8] = dbmx;
    hst[9] = lvl;

    // ---- hs_sal ----
    var ftop = sr * 0.45;
    var sal = st.sal;
    sal.fill(0);
    st.salFlag.fill(0);
    st.rcP.fill(0);
    st.rcN.fill(0);
    var gmin = Math.max(HS_CAND_FMIN, flo / 32);
    var kst = -1, kend = -1;
    for (k = 2; k <= half - 3; k++) {
        kst = (kst < 0 && st.bw[k] > 0) ? k : kst;
        kend = st.bw[k] > 0 ? k : kend;
    }
    kend = Math.min(kend, kst + HS_COS_BINS - 1);
    var sw = 0, sy = 0;
    if (kst >= 0) {
        for (k = kst; k <= kend; k++) {
            sw += st.bw[k];
            sy += st.bw[k] * st.yd[k] * st.yd[k];
        }
    }
    var cosOk = (flo < fhi && kst >= 0 && sw >= 8) ? 1 : 0;
    var sq = Math.sqrt(sw);
    if (cosOk > 0.5) {
        for (i = 0; i < 706; i++) {
            var sS = HS_CAND_FMIN * Math.pow(2, i / 64);
            var perS = sS / df;
            if (perS >= HS_PMIN && perS < HS_PWIDE) {
                var r0 = hsCosR(st, kst, kend, df, sy, sS * (1 - HS_COS_SUBOFF));
                var r1 = hsCosR(st, kst, kend, df, sy, sS);
                var r2 = hsCosR(st, kst, kend, df, sy, sS * (1 + HS_COS_SUBOFF));
                st.rcP[i] = Math.max(r0, Math.max(r1, r2));
                st.rcN[i] = Math.max(-r0, Math.max(-r1, -r2));
            }
        }
    }
    var smax = 0;
    for (i = 0; i < HS_NCAND; i++) {
        var g = HS_CAND_FMIN * Math.pow(2, i / 64);
        var act = (flo < fhi && g >= gmin && g <= fhi * 1.4142 && g <= ftop) ? 1 : 0;
        var perF = g / df, perO = 2 * g / df;
        var svF = 0, svO = 0;
        if (act > 0.5) {
            if (perO >= HS_PWIDE) {
                var h0 = Math.max(1, Math.ceil(0.51 * flo / g));
                var vOdd = Math.min(g, Math.max(0.5 * g, 2.5 * df));      // odd-only comb: valley offset (an empty even position, at least 2.5 bins from the peak)
                var ssum = 0, wt = 0, cn = 0, osum = 0, owt = 0;
                for (var j = 0; j < HS_JPOS; j++) {
                    h = h0 + j;
                    var fp = h * g;
                    var kc = hsClip(Math.floor(fp / df + 0.5), 1, half - 1);
                    var bwp = fp <= ftop ? st.bw[kc] : 0;
                    if (bwp > 0) {
                        var pk = Math.max(st.hc[kc - 1], Math.max(st.hc[kc], st.hc[kc + 1]));
                        var kv = hsClip(Math.floor((h - 0.5) * g / df + 0.5), 1, half - 1);
                        var ku = hsClip(Math.floor((h + 0.5) * g / df + 0.5), 1, half - 1);
                        var term = Math.max(pk - Math.max(st.hc[kv], st.hc[ku]), 0);
                        var w = bwp / (1 + 0.12 * j);
                        ssum += w * term;
                        wt += w;
                        cn += 1;
                        if (j <= 6 && (h % 2) === 1) {
                            var kv2 = hsClip(Math.floor((fp - vOdd) / df + 0.5), 1, half - 1);
                            var ku2 = hsClip(Math.floor((fp + vOdd) / df + 0.5), 1, half - 1);
                            var term2 = Math.max(pk - Math.max(st.hc[kv2], st.hc[ku2]), 0);
                            osum += w * term2;
                            owt += w;
                        }
                    }
                }
                var sfull = cn > 0.5 ? ssum / (wt + HS_REG0 + HS_REGX * hsClip((3 - wt) / 2, 0, 1)) : 0;
                var sodd = owt > 0 ? osum / (owt + HS_REG0 + HS_REGX * hsClip((3 - owt) / 2, 0, 1)) : 0;
                svO = sodd;
                svF = perF >= HS_PWIDE ? sfull : 0;
            }
            if (perF >= HS_PMIN && perF < HS_PWIDE && cosOk > 0.5) svF = hsCosScale(st.rcP[i], sq);
            if (perO >= HS_PMIN && perO < HS_PWIDE && cosOk > 0.5) svO = hsCosScale(st.rcN[i + 64], sq);
        }
        var sv = Math.max(svF, svO);
        sal[i + 1] = sv;
        st.salFlag[i + 1] = svO > svF ? 1 : 0;
        smax = Math.max(smax, sv);
    }
    var bi = 0, fnd = 0;
    for (i = 1; i <= HS_NCAND; i++) {
        var sv2 = sal[i];
        var cnd = (fnd < 0.5 && smax > 0 && sv2 >= 0.78 * smax && sv2 >= sal[i - 1] && sv2 >= sal[i + 1]) ? 1 : 0;
        bi = cnd > 0.5 ? i : bi;
        fnd = cnd > 0.5 ? 1 : fnd;
    }
    var sa = sal[Math.max(bi - 1, 0)], sb = sal[bi], sc = sal[bi + 1];
    var dd = sa - 2 * sb + sc;
    var dl = dd < -1e-12 ? hsClip(0.5 * (sa - sc) / dd, -0.5, 0.5) : 0;
    var g0 = fnd > 0.5 ? HS_CAND_FMIN * Math.pow(2, (bi - 1 + dl) / 64) : 0;
    var conf0 = fnd > 0.5 ? sb : 0;
    var flag0 = fnd > 0.5 ? st.salFlag[bi] : 0;
    // fine spacing search for an unresolved (ripple) winner: 11 steps of 0.2 %, then a parabola
    var perW = g0 * (flag0 > 0.5 ? 2 : 1) / df;
    var dofine = (fnd > 0.5 && cosOk > 0.5 && perW >= HS_PMIN && perW < HS_PWIDE) ? 1 : 0;
    if (dofine > 0.5) {
        var s0 = g0 * (flag0 > 0.5 ? 2 : 1);
        var sgn = flag0 > 0.5 ? -1 : 1;
        var rfine = new Float64Array(11);
        var bm = 0, bvr = -9;
        for (var m = 0; m < 11; m++) {
            rfine[m] = sgn * hsCosR(st, kst, kend, df, sy, s0 * (1 + (m - 5) * 0.002));
            bm = rfine[m] > bvr ? m : bm;
            bvr = Math.max(bvr, rfine[m]);
        }
        var ra = rfine[Math.max(bm - 1, 0)], rc2 = rfine[Math.min(bm + 1, 10)];
        var dd3 = ra - 2 * bvr + rc2;
        var dl3 = (bm > 0 && bm < 10 && dd3 < -1e-12) ? hsClip(0.5 * (ra - rc2) / dd3, -0.5, 0.5) : 0;
        g0 = s0 * (1 + (bm - 5 + dl3) * 0.002) / (flag0 > 0.5 ? 2 : 1);
        conf0 = Math.max(conf0, hsCosScale(bvr, sq));
    }
    // the odd-only flag only matters for the harmonic search / lobes while the series fundamental itself is unresolved (< 4.5 bins);
    // a resolved square / pulse is searched at every harmonic (absent ones simply stay Nonharmonics), as before
    flag0 = (flag0 > 0.5 && g0 / df < HS_PWIDE) ? 1 : 0;
    hst[10] = g0;
    hst[11] = conf0;
    hst[22] = flag0;

    // ---- hs_decide ----
    var f0c = hst[0], pend = hst[1], pcn = hst[2], hold = hst[3];
    var conf = hst[11];
    g0 = hst[10];
    var hodd = hst[23], hrk = hst[21];
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
                hodd = flag0;
                hrk = 0;
            }
        } else if (rj < 0.05) {
            gs = g0;
            pcn = 0;
            hodd = flag0;
        } else {
            pcn = rp < 0.05 ? pcn + 1 : 1;
            pend = g0;
            if (pcn >= 2) {
                f0c = g0;
                gs = g0;
                pcn = 0;
                hodd = flag0;
                hrk = 0;
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
            hrk = 0;
        }
    }
    hst[0] = f0c;
    hst[1] = pend;
    hst[2] = pcn;
    hst[3] = hold;
    hst[13] = gs;
    hst[14] = okf;
    hst[23] = hodd;
    hst[21] = hrk;

    // ---- hs_harm ----
    var sEff = gs * (hodd > 0.5 ? 2 : 1) / df;
    var narrow = (gs > 0 && sEff < HS_PWIDE) ? 1 : 0;
    hst[24] = sEff;
    var gest = gs;
    var num = 0.5 * gs, den = 0.5, nfd = 0;
    for (h = 1; h <= 404; h++) {
        var fp2 = h * gest;
        var cen = fp2, prom = 0, prs = 0;
        var skip = (hodd > 0.5 && (h % 2) === 0) ? 1 : 0;
        if (gs > 0 && fp2 < (half - 3) * df && skip < 0.5) {
            var hs2 = 0.5 * sEff * df;
            if (narrow > 0.5) {
                var kk = hsClip(Math.floor(fp2 / df), 1, half - 2);
                var pkd = Math.max(st.dbr[kk], st.dbr[kk + 1]);
                var vl3 = st.dbr[hsClip(Math.floor((fp2 - hs2) / df + 0.5), 1, half - 1)];
                var vr3 = st.dbr[hsClip(Math.floor((fp2 + hs2) / df + 0.5), 1, half - 1)];
                prom = pkd - 0.5 * (vl3 + vr3);
                prs = prom >= HS_PRES_NARROW ? 1 : 0;
            } else {
                var wn = Math.max(2 * df, 0.15 * gest);
                wn = Math.max(df, Math.min(wn, 0.45 * sEff * df));
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
                var vl2 = st.dbr[hsClip(Math.floor((fp2 - hs2) / df + 0.5), 1, half - 1)];
                var vr2 = st.dbr[hsClip(Math.floor((fp2 + hs2) / df + 0.5), 1, half - 1)];
                prom = okp > 0.5 ? bv - 0.5 * (vl2 + vr2) : 0;
                cen = okp > 0.5 ? (kp + dl2) * df : fp2;
                prs = (okp > 0.5 && prom >= HS_PRES_WIDE) ? 1 : 0;
                if (okp > 0.5 && prom >= 10) {
                    num += h * cen;
                    den += h * h;
                    gest = num / den;
                    nfd += 1;
                }
            }
        }
        st.cen[h] = cen;
        st.prom[h] = prom;
        st.pres[h] = prs;
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

    // ---- hs_masks: root, weights, lobes ----
    var gu = gs > 0 ? hst[12] : hst[5];
    var pmin = 14 - 12 * sens;
    var rf = hsClip((sEff - 2) / 4, 0, 1);
    var pmE = narrow > 0.5 ? pmin * rf : pmin;
    var wd = narrow > 0.5 ? 1 + 5 * rf : 6;
    var pat = Math.max(p.hpat, 1);
    // root = lowest present partial of the series inside [Low, High]; held while present (3 dB lower bar), a lower one replaces it
    var hnew = 0, hhold = 0;
    for (h = 404; h >= 1; h--) {
        var inb = (gs > 0 && flo < fhi && st.cen[h] >= flo && st.cen[h] <= fhi) ? 1 : 0;
        var pp = st.pres[h] > 0.5 ? 1 : 0;
        var okn = (inb > 0.5 && pp > 0.5) ? 1 : 0;
        hnew = okn > 0.5 ? h : hnew;
        var pr3 = narrow > 0.5 ? HS_PRES_NARROW - 1.5 : HS_PRES_WIDE - 3;
        var okh = (inb > 0.5 && h === hrk && st.prom[h] >= pr3 && st.cen[h] > 0) ? 1 : 0;
        hhold = okh > 0.5 ? h : hhold;
    }
    var hr = hhold > 0 ? (hnew > 0 ? Math.min(hnew, hhold) : hhold) : hnew;
    hst[21] = hr;
    hst[20] = hr > 0 ? hr * gu : 0;
    var nact = 0;
    for (h = 1; h <= 404; h++) {
        var cn2 = st.cen[h], pr2 = st.prom[h];
        var hp2 = h - hr + 1;
        var tw = (gs > 0 && hr > 0 && h >= hr && hp2 <= hmx && cn2 > 0) ? hsSm((pr2 - pmE) / wd) * vv : 0;
        var prev = st.hw[h];
        var cur = prev + (tw - prev) * (tw > prev ? 0.7 : 0.4);
        var isA = hsIsA(hp2, pat);
        st.hw[h] = cur;
        st.hwA[h] = isA > 0.5 ? cur : 0;
        nact += cur > 0.5 ? 1 : 0;
    }
    var spE = Math.max(gu * (hodd > 0.5 ? 2 : 1) / df, 0.001);
    var fr = 0.35 + 0.15 * hsClip((5 - spE) / 2.2, 0, 1);
    var w1c = Math.max(fr * spE, 0.6);
    var w1 = Math.min(0.7 + 1.3 * sens + 0.7 + 0.5 * sens, w1c);
    var w0 = Math.min(0.7 + 1.3 * sens, w1 - 0.3);
    var mA = st.mA, mB = st.mB;
    mA.fill(0);
    mB.fill(0);
    for (h = 1; h <= 404; h++) {
        var cur2 = st.hw[h];
        var cb = st.cen[h] / df;
        if (cur2 > 0 && cb > 0 && gu > 0) {
            var wa = st.hwA[h], wb = cur2 - wa;
            var kl = Math.max(Math.floor(cb - w1), 0), kh = Math.min(Math.ceil(cb + w1), half);
            for (k = kl; k <= kh; k++) {
                var dist = Math.abs(k - cb);
                var m2 = dist <= w0 ? 1 : (dist >= w1 ? 0 : 0.5 * (1 + Math.cos(3.141592653589793 * (dist - w0) / (w1 - w0))));
                mA[k] = Math.max(mA[k], m2 * wa);
                mB[k] = Math.max(mB[k], m2 * wb);
            }
        }
    }
    for (k = 0; k <= half; k++) {
        mB[k] = Math.min(mB[k], 1 - mA[k]);
        st.mN[k] = 1 - mA[k] - mB[k];
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
        hsFmtFreq: hsFmtFreq, hsFmtThr: hsFmtThr, HS_AUTO_OFFSET_DB: HS_AUTO_OFFSET_DB, HS_AUTO_REL_DB_S: HS_AUTO_REL_DB_S, HS_AUTO_FLOOR_DB: HS_AUTO_FLOOR_DB, HS_THR_MIN: HS_THR_MIN, HS_SC_THREFF: HS_SC_THREFF, HS_SC_SERIES: HS_SC_SERIES, HS_SC_ROOTH: HS_SC_ROOTH, HS_SC_ODD: HS_SC_ODD,
        HS_LINKED_KEYS: HS_LINKED_KEYS,
        HS_SC_PRE: HS_SC_PRE, HS_SC_NH: HS_SC_NH, HS_SC_A: HS_SC_A, HS_SC_B: HS_SC_B, HS_SC_FRAME: HS_SC_FRAME,
        HS_SC_SR: HS_SC_SR, HS_SC_N: HS_SC_N, HS_SC_AWAKE: HS_SC_AWAKE, HS_SC_LEVEL: HS_SC_LEVEL, HS_SC_F0: HS_SC_F0,
        HS_SC_CONF: HS_SC_CONF, HS_SC_VOICED: HS_SC_VOICED, HS_SC_LVL: HS_SC_LVL, HS_SC_LATENCY: HS_SC_LATENCY,
        HS_SC_SEL: HS_SC_SEL, HS_SC_NACT: HS_SC_NACT, HS_SCOPE_SAMPS: HS_SCOPE_SAMPS,
        HS_SC_CMP: HS_SC_CMP, HS_SC_FOL: HS_SC_FOL, HS_SC_ALIGNED: HS_SC_ALIGNED, HS_SC_FB: HS_SC_FB, HS_SC_DOFF: HS_SC_DOFF, HS_SC_UNDER: HS_SC_UNDER, HS_SC_LAG: HS_SC_LAG,
        HS_SC_SERVE: HS_SC_SERVE, HS_SC_ROLE: HS_SC_ROLE, HS_SC_ALIVE: HS_SC_ALIVE, HS_RACK_CHANNELS: HS_RACK_CHANNELS, hsGenMessages: hsGenMessages,
        HS_NCAND: HS_NCAND, HS_ACCEPT: HS_ACCEPT, HS_MAXH: HS_MAXH,
        HS_REG0: HS_REG0, HS_REGX: HS_REGX, HS_JPOS: HS_JPOS, HS_PWIDE: HS_PWIDE, HS_PMIN: HS_PMIN, HS_COS_K: HS_COS_K, HS_COS_BINS: HS_COS_BINS,
        HS_COS_SUBOFF: HS_COS_SUBOFF, HS_DETREND: HS_DETREND, HS_PRES_WIDE: HS_PRES_WIDE, HS_PRES_NARROW: HS_PRES_NARROW,
        hsClip: hsClip, hsSm: hsSm, hsResolveSel: hsResolveSel, hsSelName: hsSelName, hsIsA: hsIsA,
        hsColBin: hsColBin, hsFormatHz: hsFormatHz, hsNewState: hsNewState, hsFrame: hsFrame
    };
}
