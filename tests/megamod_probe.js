// Audio probe for scripts/run_megamod_audio_tests.py (loaded through scripts/max_harness.py as `js`).
// The runner prepends `var CASE = {...};` and src/megamod_config.js to this file (temp copy).
// Messages (inlet 0): resultpath <file>, setbuffers <cfg> <mseg> <steps> <scope> <curve> <route>, configure,
// analyze <ms>. Buffer `rec` holds exactly the measured window (2 channels chosen by the runner).
// The report (`key value` lines, lists comma-joined) is written ONLY at the end of analyze().

inlets = 1;
outlets = 2;

var resultPath = "/tmp/megamod_audio.txt";
function resultpath(p) { resultPath = String(p); }
var cfgCount = 0;
var names = {};
var armed = false;

function dbg(m) { }

function setbuffers(cfg, mseg, steps, scope, curve, route, ibuf, icurve) {
    names = { cfg: "" + cfg, mseg: "" + mseg, steps: "" + steps, scope: "" + scope, curve: "" + curve, route: "" + route, ibuf: "" + ibuf, icurve: "" + icurve };
}

var dspSr = 0;

function toArr(chunk, count) {
    var out = [];
    var k;
    if (!chunk) { for (k = 0; k < count; k++) out.push(0); return out; }
    if (typeof chunk === "number") return [chunk];
    for (k = 0; k < chunk.length; k++) out.push(chunk[k]);
    return out;
}

function readChannel(buf, channel, n) {
    var out = [];
    for (var i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var a = toArr(buf.peek(channel, i, count), count);
        for (var k = 0; k < a.length; k++) out.push(a[k]);
    }
    return out;
}

function pokeAll(name, floats) {
    var b = new Buffer(name);
    for (var i = 0; i < floats.length; i += 2048) {
        b.poke(1, i, floats.slice(i, Math.min(floats.length, i + 2048)));
    }
}

// ---------------------------------------------------------------- configuration
function fullMod(d) {
    var mod = makeModSlot(d.type, d.slot);
    mod.enabled = d.enabled === undefined ? 1 : d.enabled;
    for (var key in d.p) mod.p[key] = d.p[key];
    if (d.stepVals) mod.stepVals = d.stepVals;
    if (d.points) mod.points = d.points;
    return mod;
}

function configure() {
    dbg("configure begin");
    var cfg = new Array(MAX_MODS * CFG_STRIDE);
    var i;
    for (i = 0; i < cfg.length; i++) cfg[i] = 0;
    var mseg = new Array(MSEG_FLOATS);
    for (i = 0; i < mseg.length; i++) mseg[i] = 0;
    var steps = new Array(STEPS_FLOATS);
    for (i = 0; i < steps.length; i++) steps[i] = 0;

    var mods = CASE.mods || [];
    for (var m = 0; m < mods.length; m++) {
        var d = mods[m];
        var mod = fullMod(d);
        var f = slotConfigFloats(mod);
        for (i = 0; i < CFG_STRIDE; i++) cfg[d.slot * CFG_STRIDE + i] = f[i];
        if (d.type === MOD_MSEG) {
            var t = msegTable(mod.points);
            for (i = 0; i < MSEG_TABLE; i++) mseg[d.slot * MSEG_TABLE + i] = t[i];
        }
        if (d.type === MOD_STEPS) {
            for (i = 0; i < STEPS_MAX; i++) steps[d.slot * STEPS_MAX + i] = mod.stepVals[i];
        }
    }
    pokeAll(names.cfg, cfg);
    pokeAll(names.mseg, mseg);
    pokeAll(names.steps, steps);

    if (CASE.selfmod) {
        // internal modulation matrix (self-mod): descriptors + routes + tables, exactly what MM.flushInternal / syncInternal write
        var hdr = new Array(INT_SAMPS);
        for (i = 0; i < hdr.length; i++) hdr[i] = 0;
        var desc = intDescriptorFloats();
        for (i = 0; i < desc.length; i++) hdr[INT_DESC_AT + i] = desc[i];
        var ic = new Array(ICURVE_SAMPS);
        for (i = 0; i < ic.length; i++) ic[i] = 0;
        var rts = CASE.selfmod.routes;
        for (var r = 0; r < rts.length; r++) {
            hdr[4 * r] = rts[r].src + 1;
            hdr[4 * r + 1] = rts[r].dest;
            var it = mappingTable(rts[r].map);
            for (i = 0; i < CURVE_REGION; i++) ic[r * CURVE_REGION + i] = it[i];
        }
        hdr[INT_COUNT_AT] = rts.length;
        pokeAll(names.ibuf, hdr);
        pokeAll(names.icurve, ic);
    }
    if (CASE.router) {
        // route buffer: every slot off (-1), then the case's slots -> source modulator; curve buffer: decoy 0.9
        // everywhere (a wrong table offset would read it), then each slot's mappingTable at slot * CURVE_REGION.
        var route = new Array(ROUTE_SAMPS);
        for (i = 0; i < route.length; i++) route[i] = 0;
        for (i = 0; i < MAX_MAPPINGS; i++) route[2 * i] = ROUTE_OFF;
        for (i = 0; i < ROUTER_DEPTH_SLOTS; i++) { route[2 * i + 1] = 1; route[ROUTE_DEPTH_BASE + i] = 1; route[ROUTE_DEPTH_MIN + i] = -1; }
        var curveFloats = new Array(CURVE_SAMPS);
        for (i = 0; i < curveFloats.length; i++) curveFloats[i] = 0.9;
        for (var q = 0; q < CASE.router.slots.length; q++) {
            var sd = CASE.router.slots[q];
            route[2 * sd.slot] = sd.src;
            // every pool slot (schema 10) applies the Depth in the router: the table is baked at depth 1, base depth (+ Remote min) in the route buffer
            var mp = sd.map;
            if (sd.slot < ROUTER_DEPTH_SLOTS) {
                var dp = mp.depth === undefined ? 1 : mp.depth;
                route[ROUTE_DEPTH_BASE + sd.slot] = dp;
                route[2 * sd.slot + 1] = dp;
                route[ROUTE_DEPTH_MIN + sd.slot] = mp.mode === "remote" ? mp.min : -1;
                mp = JSON.parse(JSON.stringify(mp)); mp.depth = 1;
            }
            var tb = mappingTable(mp);
            for (i = 0; i < CURVE_REGION; i++) curveFloats[sd.slot * CURVE_REGION + i] = tb[i];
        }
        pokeAll(names.route, route);
        pokeAll(names.curve, curveFloats);
    }
    cfgCount++;
    dbg("configured");
    post("MEGAMOD_CONFIGURED\n");
}

// ---------------------------------------------------------------- automatable parameter (src/megamod_config.js autoValue)
// `autorate <norm 0..1>`: what the device does when the "M<n> Rate" Live parameter moves (autop -> MM._autoParamIn): the parameter's
// normalized value is mapped with autoValue("rate", n) and written to the slot's cfg float, which the engine reads every sample.
function autorate(n) {
    var slot = (CASE.mods && CASE.mods.length ? CASE.mods[0].slot : 0);
    new Buffer(names.cfg).poke(1, slot * CFG_STRIDE + CF_RATE, [autoValue("rate", Number(n))]);
}

// Per-mapping Depth: a = router slot with depth 1, b = router slot with depth CASE.dep (same source, same table otherwise).
// Mod: b must be dep * a; Remote (CASE.dmin = the mapping's min): b = min + dep * (a - min).
function analyzeDepth(rep, a, b, sr) {
    var err = 0, ma = 0, mb = 0, i, exp;
    for (i = 0; i < a.length; i++) {
        exp = CASE.remote ? CASE.dmin + CASE.dep * (a[i] - CASE.dmin) : CASE.dep * a[i];
        err = Math.max(err, Math.abs(b[i] - exp));
        ma = Math.max(ma, Math.abs(a[i]));
        mb = Math.max(mb, Math.abs(b[i]));
    }
    rep.push("depth_err " + err);
    rep.push("depth_peak_full " + ma);
    rep.push("depth_peak_scaled " + mb);
}

// ---------------------------------------------------------------- generic stats
function stats(x, sr) {
    var n = x.length;
    var s = { n: n, nan: 0, min: 1e9, max: -1e9, mean: 0 };
    var i;
    for (i = 0; i < n; i++) {
        var v = x[i];
        if (v !== v || Math.abs(v) > 1e6) { s.nan++; continue; }
        if (v < s.min) s.min = v;
        if (v > s.max) s.max = v;
        s.mean += v;
    }
    s.mean /= Math.max(1, n);
    var mid = 0.5 * (s.min + s.max);
    var cross = [];
    var wrapUp = 0, wrapDown = 0, decr = 0, incr = 0, maxStep = 0, above = 0, changes = 0;
    var levels = {};
    var nlevels = 0;
    for (i = 1; i < n; i++) {
        var dv = x[i] - x[i - 1];
        if (x[i - 1] < mid && x[i] >= mid) cross.push(i);
        if (dv > 0.5) wrapUp++;
        else if (dv < -0.5) wrapDown++;
        else {
            if (dv < -1e-7) decr++;
            if (dv > 1e-7) incr++;
            if (Math.abs(dv) > maxStep) maxStep = Math.abs(dv);
        }
        if (Math.abs(dv) > 1e-6) changes++;
        if (x[i] > mid) above++;
        var key = Math.round(x[i] * 500);
        if (!levels[key]) { levels[key] = 1; nlevels++; }
    }
    var periods = [];
    for (i = 1; i < cross.length; i++) periods.push((cross[i] - cross[i - 1]) / sr);
    s.mid = mid;
    s.cross = cross;
    s.periods = periods;
    var sum = 0;
    for (i = 0; i < periods.length; i++) sum += periods[i];
    s.period = periods.length ? sum / periods.length : 0;
    s.wrapUp = wrapUp; s.wrapDown = wrapDown; s.decr = decr; s.incr = incr;
    s.maxStep = maxStep; s.duty = above / Math.max(1, n - 1);
    s.changes = changes; s.nlevels = nlevels;
    return s;
}

function emitStats(rep, pre, s) {
    rep.push(pre + "min " + s.min);
    rep.push(pre + "max " + s.max);
    rep.push(pre + "mean " + s.mean);
    rep.push(pre + "nan " + s.nan);
    rep.push(pre + "period " + s.period);
    rep.push(pre + "periods " + s.periods.map(function (p) { return p.toFixed(5); }).join(" "));
    rep.push(pre + "wrapUp " + s.wrapUp);
    rep.push(pre + "wrapDown " + s.wrapDown);
    rep.push(pre + "decr " + s.decr);
    rep.push(pre + "incr " + s.incr);
    rep.push(pre + "maxStep " + s.maxStep);
    rep.push(pre + "duty " + s.duty);
    rep.push(pre + "changes " + s.changes);
    rep.push(pre + "nlevels " + s.nlevels);
}

// ---------------------------------------------------------------- specific analyses
// Constant runs of x (value changes > tol start a new run). Returns [{start, end, v}].
function runs(x, tol) {
    var out = [];
    var st = 0;
    for (var i = 1; i <= x.length; i++) {
        if (i === x.length || Math.abs(x[i] - x[i - 1]) > tol) {
            out.push({ start: st, end: i - 1, v: x[st + ((i - 1 - st) >> 1)] });
            st = i;
        }
    }
    return out;
}

function analyzeSteps(rep, x, sr) {
    var rs = runs(x, 1e-4);
    // drop the first (partial) and last (partial) runs
    var mids = [];
    var lens = [];
    for (var i = 1; i < rs.length - 1; i++) { mids.push(rs[i].v); lens.push((rs[i].end - rs[i].start + 1) / sr); }
    rep.push("steps_runs " + rs.length);
    rep.push("steps_mids " + mids.map(function (v) { return v.toFixed(4); }).join(" "));
    rep.push("steps_lens " + lens.map(function (v) { return v.toFixed(4); }).join(" "));
    var vals = fullMod(CASE.mods[0]).stepVals;
    var n = fullMod(CASE.mods[0]).p.steps;
    var best = 1e9, bestOff = 0;
    for (var off = 0; off < n; off++) {
        var err = 0;
        for (i = 0; i < mids.length; i++) err = Math.max(err, Math.abs(mids[i] - (2 * vals[(off + i) % n] - 1)));
        if (err < best) { best = err; bestOff = off; }
    }
    rep.push("steps_maxerr " + best);
    rep.push("steps_cycle_offset " + bestOff);
}

function analyzeRandom(rep, x, sr, which) {
    var rs = runs(x, 1e-5);
    var mids = [];
    for (var i = 1; i < rs.length - 1; i++) mids.push(rs[i].v);
    rep.push(which + "_runs " + rs.length);
    if (which !== "rnd0") return;
    var p = fullMod(CASE.mods[0]).p;
    var best = 1e9, bi = 0;
    for (var base = -2; base < 40; base++) {
        var err = 0;
        for (i = 0; i < mids.length; i++) err = Math.max(err, Math.abs(mids[i] - (2 * randHash01(p.seed, base + i) - 1)));
        if (err < best) { best = err; bi = base; }
    }
    rep.push("rnd0_hash_maxerr " + best);
    rep.push("rnd0_hash_base " + bi);
}

// Fast MSEG reference using a prebuilt table.
function msegRef(tbl, p, accv) {
    var ph = ((accv + p.phase) % 1 + 1) % 1;
    var ls = p.loopOn ? p.loopStart : 0;
    var le = p.loopOn ? Math.max(p.loopEnd, ls + 0.05) : 1;
    var fi = clamp(ls + ph * (le - ls), 0, 1) * (MSEG_TABLE - 1);
    var i0 = Math.floor(fi), i1 = Math.min(MSEG_TABLE - 1, i0 + 1);
    var u = tbl[i0] + (tbl[i1] - tbl[i0]) * (fi - i0);
    return { u: u, ph: ph, out: outputFromU(u, p.bipolar, p.depth) };
}

function analyzeMseg(rep, x, sr) {
    var d = fullMod(CASE.mods[0]);
    var tbl = msegTable(d.points);
    var rate = d.p.rate;
    var skip = Math.floor(0.05 * sr);
    var bestOff = 0, bestErr = 1e9, step = Math.max(1, Math.floor(sr / 4000));
    var off;
    function errAt(o, stride) {
        var e = 0, c = 0;
        for (var i = skip; i < x.length - skip; i += stride) {
            var r = msegRef(tbl, d.p, o + i * rate / sr);
            e += Math.abs(r.out - x[i]); c++;
        }
        return e / c;
    }
    for (off = 0; off < 1; off += 0.002) {
        var e = errAt(off, step * 7);
        if (e < bestErr) { bestErr = e; bestOff = off; }
    }
    var lo = bestOff - 0.004, hi = bestOff + 0.004;
    for (off = lo; off <= hi; off += 0.00005) {
        var e2 = errAt(off, step * 7);
        if (e2 < bestErr) { bestErr = e2; bestOff = off; }
    }
    // Full compare vs evalModulator (subsampled; skip a few samples around the table wrap)
    var maxErr = 0, cnt = 0;
    for (var i = skip; i < x.length - skip; i += 16) {
        var acc = bestOff + i * rate / sr;
        var fr = acc - Math.floor(acc);
        if (fr < 0.003 || fr > 0.997) continue;
        var r = evalModulator({ type: MOD_MSEG, p: d.p, points: d.points }, acc);
        maxErr = Math.max(maxErr, Math.abs(r.out - x[i]));
        cnt++;
    }
    rep.push("mseg_maxerr " + maxErr);
    rep.push("mseg_fit_meanerr " + bestErr);
    rep.push("mseg_phase_offset " + bestOff);
    rep.push("mseg_samples " + cnt);
}

function analyzeEnv(rep, x, src, sr) {
    var p = fullMod(CASE.mods[0]).p;
    var ref = envelopeFollow(src, sr, p);
    var maxErr = 0, peakOut = -9, peakRef = -9;
    for (var i = 0; i < x.length; i++) {
        maxErr = Math.max(maxErr, Math.abs(x[i] - ref.out[i]));
        peakOut = Math.max(peakOut, x[i]);
        peakRef = Math.max(peakRef, ref.out[i]);
    }
    var srcPeak = 0, firstSig = -1, lastSig = -1;
    for (i = 0; i < src.length; i++) {
        if (Math.abs(src[i]) > 1e-4) { if (firstSig < 0) firstSig = i; lastSig = i; }
        srcPeak = Math.max(srcPeak, Math.abs(src[i]));
    }
    var pre = firstSig > 0 ? firstSig - 100 : Math.floor(0.1 * sr);
    var quietMax = -9;
    for (i = 0; i < pre; i++) quietMax = Math.max(quietMax, x[i]);
    var tail = x[x.length - 1];
    rep.push("env_maxerr " + maxErr);
    rep.push("env_peak_out " + peakOut);
    rep.push("env_peak_ref " + peakRef);
    rep.push("env_src_peak " + srcPeak);
    rep.push("env_quiet_max " + quietMax);
    rep.push("env_tail " + tail);
    rep.push("env_burst_ms " + (firstSig * 1000 / sr) + " " + (lastSig * 1000 / sr));
}

function analyzeSync(rep, x, sr) {
    var s = stats(x, sr);
    var ps = s.periods;
    rep.push("sync_first_period " + (ps.length ? ps[0] : 0));
    rep.push("sync_last_period " + (ps.length ? ps[ps.length - 1] : 0));
    rep.push("sync_periods_n " + ps.length);
}

function analyzeHost(rep, x, sr) {
    // x = sine at ppq 0 playing (hbpm, 1 beat cycle), then hppq jump to jumpTo
    var bpm = CASE.bpm, jumpTo = CASE.jumpTo;
    var f = bpm / 60;
    var head = 0, i;
    var n0 = Math.floor(0.004 * sr);
    var a0 = 0;
    for (i = 0; i < n0; i++) a0 = Math.max(a0, Math.abs(x[i]));
    rep.push("host_start_abs_max " + a0);
    rep.push("host_start_slope " + (x[Math.floor(0.02 * sr)] - x[0]));
    // locate the discontinuity
    var jj = -1, jmax = 0;
    for (i = Math.floor(0.3 * sr); i < x.length; i++) {
        var dv = Math.abs(x[i] - x[i - 1]);
        if (dv > jmax) { jmax = dv; jj = i; }
    }
    rep.push("host_jump_size " + jmax);
    rep.push("host_jump_ms " + (jj * 1000 / sr));
    var e = 0, cnt = 0, pre = 0;
    if (jj > 0) {
        // free-run before jump should be ~ sin(2 pi f t) from a start at 0
        for (i = 0; i < jj - 1; i += 4) pre = Math.max(pre, Math.abs(x[i] - Math.sin(2 * Math.PI * f * i / sr)));
        for (i = jj; i < Math.min(x.length, jj + Math.floor(0.4 * sr)); i += 4) {
            var exp = Math.sin(2 * Math.PI * (jumpTo + f * (i - jj) / sr));
            e = Math.max(e, Math.abs(x[i] - exp)); cnt++;
        }
    }
    rep.push("host_pre_maxerr " + pre);
    rep.push("host_post_maxerr " + e);
}

function dropsOf(x, thr) {
    var o = [];
    for (var i = 1; i < x.length; i++) if (x[i] - x[i - 1] < -thr) o.push({ i: i, size: x[i - 1] - x[i] });
    return o;
}

function analyzeRetrig(rep, a, b, sr) {
    // A natural wrap drops by ~2 (+1 -> -1); a retrigger drops from the current level to -1 (size < 1.7).
    function partial(arr) { return arr.filter(function (d) { return d.size > 0.3 && d.size < 1.7; }); }
    var da = dropsOf(a, 0.3), db = dropsOf(b, 0.3);
    var pa = partial(da), pb = partial(db);
    rep.push("retrig_restarts_slot0 " + pa.length);
    rep.push("retrig_restarts_slot1 " + pb.length);
    rep.push("retrig_restart_ms_slot1 " + pb.map(function (d) { return (d.i * 1000 / sr).toFixed(1) + "(" + d.size.toFixed(2) + ")"; }).join(" "));
    var slope = 2 * fullMod(CASE.mods[0]).p.rate / sr;
    var worst = 0, i;
    for (i = 1; i < a.length; i++) {
        var dv = a[i] - a[i - 1];
        if (dv < -0.5) continue;
        worst = Math.max(worst, Math.abs(dv - slope));
    }
    rep.push("retrig_slot0_slope_dev " + worst);
    var pre = 0;
    for (i = 0; i < Math.min(a.length, Math.floor(0.25 * sr)); i++) {
        var d2 = Math.abs(a[i] - b[i]);
        if (d2 < 1.5) pre = Math.max(pre, d2);
    }
    rep.push("retrig_pre_diff " + pre);
    if (pb.length) {
        var te = pb[pb.length - 1].i;
        var k = Math.floor(0.2 * sr);
        var ex = -1 + 2 * (k / sr) * fullMod(CASE.mods[0]).p.rate;
        rep.push("retrig_post_err_200ms " + Math.abs(b[Math.min(b.length - 1, te + k)] - ex));
        rep.push("retrig_post_first " + b[te]);
    }
}

function analyzeTelemetry(rep, sr) {
    var sb = new Buffer(names.scope);
    var t = toArr(sb.peek(1, 0, 128), 128);
    rep.push("tele_frame " + t[64]);
    rep.push("tele_sr " + t[65]);
    rep.push("tele_beat " + t[66]);
    rep.push("tele_bpm " + t[67]);
    rep.push("tele_playing " + t[68]);
    var bad = 0;
    var outs = [];
    for (var s = 0; s < 16; s++) {
        var o = t[4 * s];
        outs.push(o.toFixed(3));
        if (!(o >= -1.0001 && o <= 1.0001)) bad++;
    }
    rep.push("tele_outs " + outs.join(" "));
    rep.push("tele_bad " + bad);
    var ph = [];
    for (s = 0; s < 16; s++) ph.push(t[4 * s + 1].toFixed(3));
    rep.push("tele_phases " + ph.join(" "));
    rep.push("tele_dsp_sr " + sr);
}

function analyzeLookup(rep, a, b, sr) {
    var m = CASE.router.slots[CASE.chk].map;
    var err = 0, decoy = 0, cnt = 0, i;
    for (i = 0; i < a.length; i += 3) {
        var x = clamp(a[i], -1, 1);
        err = Math.max(err, Math.abs(b[i] - mappingOutput(m, x)));
        decoy = Math.max(decoy, Math.abs(b[i] - 0.9));
        cnt++;
    }
    var inMin = 9, inMax = -9, oMin = 9, oMax = -9;
    for (i = 0; i < a.length; i++) {
        inMin = Math.min(inMin, a[i]); inMax = Math.max(inMax, a[i]);
        oMin = Math.min(oMin, b[i]); oMax = Math.max(oMax, b[i]);
    }
    rep.push("lookup_err " + err);
    rep.push("lookup_err_decoy " + decoy);
    rep.push("lookup_in_range " + inMin + " " + inMax);
    rep.push("lookup_out_range " + oMin + " " + oMax);
    rep.push("lookup_samples " + cnt);
}

function analyzeRouteOff(rep, off, on) {
    var mo = 0, mn = 0;
    for (var i = 0; i < off.length; i++) { mo = Math.max(mo, Math.abs(off[i])); mn = Math.max(mn, Math.abs(on[i])); }
    rep.push("off_max " + mo);
    rep.push("neighbour_max " + mn);
}

// Router smoothing (Options panel): a = engine square (source), b = router output through the identity mapping.
// For every rising source edge with >= 400 ms of data after it: the time for b to reach 63.2% of the -1 -> +1 step (the one-pole
// time constant), the level 1 ms after the edge, and the settled level just before the next edge.
function analyzeSmooth(rep, a, b, sr) {
    var target = -1 + 2 * 0.6321205588;
    var taus = [], instants = [], finals = [], maxdiff = 0, i, j;
    for (i = 0; i < a.length; i++) maxdiff = Math.max(maxdiff, Math.abs(a[i] - b[i]));
    for (i = 2; i < a.length; i++) {
        if (!(a[i - 1] < 0 && a[i] >= 0)) continue;
        if (i + Math.floor(0.45 * sr) >= a.length) break;
        j = i;
        while (j < a.length && b[j] < target) j++;
        taus.push((j - i) * 1000 / sr);
        instants.push(b[i + Math.floor(0.001 * sr)]);
        finals.push(b[i + Math.floor(0.45 * sr)]);
    }
    function avg(v) { var s = 0, k; for (k = 0; k < v.length; k++) s += v[k]; return v.length ? s / v.length : 0; }
    rep.push("smooth_edges " + taus.length);
    rep.push("smooth_tau_ms " + avg(taus));
    rep.push("smooth_instant " + avg(instants));
    rep.push("smooth_final " + avg(finals));
    rep.push("smooth_maxdiff " + maxdiff);
}

// ---------------------------------------------------------------- self-modulation (internal matrix)
// rising zero crossings of x with linear interpolation -> times in seconds from the window start
function risingCrossings(x, sr) {
    var out = [];
    for (var i = 1; i < x.length; i++) {
        if (x[i - 1] < 0 && x[i] >= 0) out.push((i - 1 + (0 - x[i - 1]) / (x[i] - x[i - 1])) / sr);
    }
    return out;
}
// LFO 1 (slot 0, f1 Hz sine) modulates the Rate of LFO 2 (slot 1, f2 Hz base) by +-`oct` octaves through the internal matrix.
// c1 = LFO 2 output, c2 = LFO 1 output. The reference integrates f(t) = f2 * 2^(oct * sin(2 pi f1 t)) and predicts every rising zero crossing of LFO 2.
function analyzeSelfRate(rep, x, lfo1, sr) {
    var sp = CASE.sp, t0 = sp.settle_ms / 1000;
    var cr = risingCrossings(x, sr);
    var dt = 1 / 48000, ph = 0, t = 0, k = 1, pred = [];
    var tEnd = t0 + x.length / sr + 0.01;
    while (t < tEnd) {
        var f = sp.f2 * Math.pow(2, sp.oct * Math.sin(2 * Math.PI * sp.f1 * t));
        var nph = ph + f * dt;
        while (nph >= k) { pred.push(t + dt * (k - ph) / (nph - ph) - t0); k++; }
        ph = nph; t += dt;
    }
    var n = Math.min(cr.length, pred.length), maxErr = 0, i, best = 1e9;
    // the first crossing in the window may be crossing k0 of the run: align on the nearest predicted one
    var shift = 0;
    for (var sh = -3; sh <= 3; sh++) {
        var e = 0, c = 0;
        for (i = 0; i < cr.length; i++) { var pi = i + sh; if (pi >= 0 && pi < pred.length) { e += Math.abs(cr[i] - pred[pi]); c++; } }
        if (c && e / c < best) { best = e / c; shift = sh; }
    }
    for (i = 0; i < cr.length; i++) { var q = i + shift; if (q >= 0 && q < pred.length) maxErr = Math.max(maxErr, Math.abs(cr[i] - pred[q])); }
    var fmin = 1e9, fmax = 0, tmax = 0;
    for (i = 1; i < cr.length; i++) {
        var fi = 1 / (cr[i] - cr[i - 1]);
        if (fi > fmax) { fmax = fi; tmax = 0.5 * (cr[i] + cr[i - 1]) + t0; }
        if (fi < fmin) fmin = fi;
    }
    rep.push("self_crossings " + cr.length);
    rep.push("self_cross_err_ms " + (maxErr * 1000));
    rep.push("self_cross_shift " + shift);
    rep.push("self_fmin " + fmin);
    rep.push("self_fmax " + fmax);
    rep.push("self_tfmax " + tmax);
    // phase relation: LFO 2's fastest period sits where LFO 1 is at its positive peak (sin = 1)
    var pk = 0, pkv = -9;
    for (i = 0; i < lfo1.length; i++) if (lfo1[i] > pkv) { pkv = lfo1[i]; pk = i; }
    rep.push("self_lfo1_peak_t " + (pk / sr + t0));
}
// mapping X (router slot 0, source = LFO 2 slot 1) with its Depth modulated by LFO 1 (slot 0, f1 Hz) through the internal matrix.
// c1 = router output, c2 = LFO 2 output: where |c2| is large, c1 / c2 is the effective depth = clip(base + range * sin(2 pi f1 t), 0, 1).
function analyzeSelfDepth(rep, out, src, sr) {
    var sp = CASE.sp, t0 = sp.settle_ms / 1000, err = 0, cnt = 0, dmin = 9, dmax = -9, i;
    for (i = 0; i < out.length; i++) {
        if (Math.abs(src[i]) < 0.6) continue;
        var d = out[i] / src[i];
        var exp = Math.max(0, Math.min(1, sp.dbase + sp.range * Math.sin(2 * Math.PI * sp.f1 * (t0 + i / sr))));
        err = Math.max(err, Math.abs(d - exp));
        dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
        cnt++;
    }
    rep.push("sdepth_err " + err);
    rep.push("sdepth_min " + dmin);
    rep.push("sdepth_max " + dmax);
    rep.push("sdepth_n " + cnt);
    // amplitude modulation really happens: the per-LFO2-cycle peak of |out| varies
    var pks = [], cur = 0;
    for (i = 1; i < out.length; i++) {
        cur = Math.max(cur, Math.abs(out[i]));
        if (src[i - 1] < 0 && src[i] >= 0) { pks.push(cur); cur = 0; }
    }
    var pmin = 9, pmax = -9;
    for (i = 1; i < pks.length; i++) { pmin = Math.min(pmin, pks[i]); pmax = Math.max(pmax, pks[i]); }
    rep.push("sdepth_peak_min " + pmin);
    rep.push("sdepth_peak_max " + pmax);
}
// Depth-modulation routes (schema 10) onto a mapping in a pool slot >= 64 (router 3): c1 = the router output, c2 = the mapping's source (a
// bipolar sine). The effective depth = clip(base + sum of each route's range * sin(2 pi f t), 0, 1) (the routes' sources are free-running sines
// from phase 0). dr_err = max |out / src - expected| where |src| is large; dr_peak_* = the per-cycle peak of |out| against the expected depth
// at that peak (the amplitude of every cycle of the mapping's signal must follow the modulators), dr_corr = their correlation.
function analyzeDepthRoutes(rep, out, src, sr) {
    var sp = CASE.sp, t0 = sp.settle_ms / 1000, err = 0, cnt = 0, dmin = 9, dmax = -9, i, k;
    var expAt = function (t) {
        var d = sp.base;
        for (k = 0; k < sp.routes.length; k++) d += sp.routes[k].range * Math.sin(2 * Math.PI * sp.routes[k].f * t);
        return Math.max(0, Math.min(1, d));
    };
    for (i = 0; i < out.length; i++) {
        if (Math.abs(src[i]) < 0.6) continue;
        var d1 = out[i] / src[i];
        err = Math.max(err, Math.abs(d1 - expAt(t0 + i / sr)));
        dmin = Math.min(dmin, d1); dmax = Math.max(dmax, d1);
        cnt++;
    }
    var peaks = [], exps = [], cur = 0, curI = 0;
    for (i = 1; i < out.length; i++) {
        if (Math.abs(out[i]) > cur) { cur = Math.abs(out[i]); curI = i; }
        if (src[i - 1] < 0 && src[i] >= 0) {
            if (cur > 0 || peaks.length) { peaks.push(cur / Math.max(0.2, Math.abs(src[curI]))); exps.push(expAt(t0 + curI / sr)); }
            cur = 0;
        }
    }
    var pe = 0, pmin = 9, pmax = -9, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (i = 1; i < peaks.length; i++) {  // (the first cycle is partial)
        pe = Math.max(pe, Math.abs(peaks[i] - exps[i]));
        pmin = Math.min(pmin, peaks[i]); pmax = Math.max(pmax, peaks[i]);
        n++; sx += peaks[i]; sy += exps[i]; sxx += peaks[i] * peaks[i]; syy += exps[i] * exps[i]; sxy += peaks[i] * exps[i];
    }
    var corr = (n * sxy - sx * sy) / Math.sqrt(Math.max(1e-12, (n * sxx - sx * sx) * (n * syy - sy * sy)));
    rep.push("dr_err " + err);
    rep.push("dr_min " + dmin);
    rep.push("dr_max " + dmax);
    rep.push("dr_n " + cnt);
    rep.push("dr_cycles " + n);
    rep.push("dr_peak_err " + pe);
    rep.push("dr_peak_min " + pmin);
    rep.push("dr_peak_max " + pmax);
    rep.push("dr_corr " + corr);
}
// LFO 1 (slot 0, f1 Hz sine) modulates the BIPOLAR switch of slot 1 (a `fast` Hz sine with depth 0.5): bipolar on = -0.5..0.5, off (unipolar) = -1..0.
// Base bipolar 0, range 1, +-: the toggle is on while the LFO 1 value is above 0.5. c1 = slot 1, c2 = LFO 1. Per window of one LFO 2 period.
function analyzeSelfToggle(rep, x, lfo1, sr) {
    var sp = CASE.sp, w = Math.round(sr / sp.fast), mism = 0, tot = 0, nOn = 0, nOff = 0, i, j;
    for (i = 0; i + w <= x.length; i += w) {
        var mx = -9, mn = 9, l1min = 9, l1max = -9;
        for (j = i; j < i + w; j++) { mx = Math.max(mx, x[j]); mn = Math.min(mn, x[j]); l1min = Math.min(l1min, lfo1[j]); l1max = Math.max(l1max, lfo1[j]); }
        if (l1min < 0.5 && l1max > 0.5) continue; // the threshold is crossed inside this window
        var wantOn = l1min >= 0.5;
        var isOn = mx > 0.25; // bipolar: max +0.5, unipolar: max 0
        if (!(mx > 0.25 || mx < 0.1)) continue;
        tot++;
        if (isOn) nOn++; else nOff++;
        if (isOn !== wantOn) mism++;
    }
    rep.push("stoggle_windows " + tot);
    rep.push("stoggle_mismatch " + mism);
    rep.push("stoggle_on " + nOn);
    rep.push("stoggle_off " + nOff);
}
// feedback: LFO 1 and LFO 2 modulate each other's Rate. Everything stays finite and in range; the oscillators keep running.
function analyzeSelfFeedback(rep, x, y, sr) {
    var a = risingCrossings(x, sr), b = risingCrossings(y, sr), i, fmax = 0, fmin = 1e9;
    for (i = 1; i < a.length; i++) { var f = 1 / (a[i] - a[i - 1]); fmax = Math.max(fmax, f); fmin = Math.min(fmin, f); }
    rep.push("sfb_cross1 " + a.length);
    rep.push("sfb_cross2 " + b.length);
    rep.push("sfb_fmax " + fmax);
    rep.push("sfb_fmin " + (fmin > 1e8 ? 0 : fmin));
}

// ---------------------------------------------------------------- entry
function analyze(durMs) {
    if (armed) return;
    armed = true;
    try {
        analyzeInner(durMs);
    } catch (ex) {
        var bad = new File(resultPath, "write", "TEXT");
        bad.eof = 0;
        bad.writestring("probe_error " + String(ex).replace(/\s+/g, "_") + "\n");
        bad.close();
        post("MEGAMOD_PROBE_ERROR " + String(ex) + "\n");
        outlet(0, "bang");
    }
}

function analyzeInner(durMs) {
    dbg("analyze " + durMs);
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = dspSr > 0 ? dspSr : (lengthMs > 0 ? frames / (lengthMs / 1000) : 44100);
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var c1 = readChannel(rec, 1, n);
    var c2 = readChannel(rec, 2, n);
    var rep = [];
    rep.push("configured " + cfgCount);
    rep.push("sr " + sr);
    rep.push("frames " + n);
    var s1 = stats(c1, sr);
    var s2 = stats(c2, sr);
    emitStats(rep, "c1_", s1);
    emitStats(rep, "c2_", s2);
    var an = CASE.an;
    if (an === "steps") analyzeSteps(rep, c1, sr);
    else if (an === "random") { analyzeRandom(rep, c1, sr, "rnd0"); analyzeRandom(rep, c2, sr, "rnd1"); }
    else if (an === "mseg") analyzeMseg(rep, c1, sr);
    else if (an === "env") analyzeEnv(rep, c1, c2, sr);
    else if (an === "sync") analyzeSync(rep, c1, sr);
    else if (an === "host") analyzeHost(rep, c1, sr);
    else if (an === "retrig") analyzeRetrig(rep, c1, c2, sr);
    else if (an === "lookup") analyzeLookup(rep, c1, c2, sr);
    else if (an === "routeoff") analyzeRouteOff(rep, c1, c2);
    else if (an === "smooth") analyzeSmooth(rep, c1, c2, sr);
    else if (an === "depth") analyzeDepth(rep, c1, c2, sr);
    else if (an === "selfrate") analyzeSelfRate(rep, c1, c2, sr);
    else if (an === "selfdepth") analyzeSelfDepth(rep, c1, c2, sr);
    else if (an === "depthroutes") analyzeDepthRoutes(rep, c1, c2, sr);
    else if (an === "selftoggle") analyzeSelfToggle(rep, c1, c2, sr);
    else if (an === "selffb") analyzeSelfFeedback(rep, c1, c2, sr);

    if (CASE.tele) analyzeTelemetry(rep, sr);
    for (var q = 0; q < rep.length; q++) {
        var sp = rep[q].indexOf(" ");
        var key = sp < 0 ? rep[q] : rep[q].slice(0, sp);
        var val = sp < 0 ? "" : rep[q].slice(sp + 1).replace(/\(/g, ":").replace(/\)/g, "").replace(/ +/g, ",");
        rep[q] = key + " " + (val.length ? val : "none");
    }
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(rep.join("\n") + "\n");
    report.close();
    outlet(0, "bang");
}
