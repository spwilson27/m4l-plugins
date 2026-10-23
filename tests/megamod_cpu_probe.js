// Probe for scripts/measure_megamod_cpu.py (loaded through scripts/max_harness.py as `v8`).
// The script prepends `var CASE = {...};` and src/megamod_config.js. Messages (inlet 0): resultpath <file>,
// chainbufs <cfg> <mseg> <steps> <scope> <curve> <route> <ibuf> <icurve> (names of one chain; configures it at once, before DSP),
// analyze <ms>. Buffer `rec` holds the measured window. The report: `frames`, then (compare mode) `rec_<ch>_<i> value` is not written;
// instead `sum1`, `sum2`, ... and the full recorded channels go to <resultPath>.data (one line per channel, comma-joined).

inlets = 1;
outlets = 1;

var resultPath = "/tmp/megamod_cpu.txt";
function resultpath(p) { resultPath = String(p); }

function pokeAll(name, floats) {
    var b = new Buffer(name);
    for (var i = 0; i < floats.length; i += 2048) b.poke(1, i, floats.slice(i, Math.min(floats.length, i + 2048)));
}

function fullMod(d) {
    var mod = makeModSlot(d.type, d.slot);
    mod.enabled = d.enabled === undefined ? 1 : d.enabled;
    for (var key in d.p) mod.p[key] = d.p[key];
    if (d.stepVals) mod.stepVals = d.stepVals;
    if (d.points) mod.points = d.points;
    return mod;
}

function chainbufs(cfgN, msegN, stepsN, scopeN, curveN, routeN, ibufN, icurveN) {
    var i;
    var cfg = new Array(MAX_MODS * CFG_STRIDE);
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
    pokeAll("" + cfgN, cfg);
    pokeAll("" + msegN, mseg);
    pokeAll("" + stepsN, steps);

    var route = new Array(ROUTE_SAMPS);
    for (i = 0; i < route.length; i++) route[i] = 0;
    for (i = 0; i < MAX_MAPPINGS; i++) route[2 * i] = ROUTE_OFF;
    for (i = 0; i < ROUTER_DEPTH_SLOTS; i++) { route[2 * i + 1] = 1; route[ROUTE_DEPTH_BASE + i] = 1; route[ROUTE_DEPTH_MIN + i] = -1; }
    var curveFloats = new Array(CURVE_SAMPS);
    for (i = 0; i < curveFloats.length; i++) curveFloats[i] = 0;
    var maps = CASE.maps || [];
    for (var q = 0; q < maps.length; q++) {
        var sd = maps[q];
        route[2 * sd.slot] = srcIndex(sd.src, sd.out || 0);
        route[ROUTE_ACT_AT + Math.floor(sd.slot / ROUTER_SLOTS)] += 1; // (the per-router activity count the mapper keeps)
        var mp = JSON.parse(JSON.stringify(sd.map));
        var dp = mp.depth === undefined ? 1 : mp.depth;
        route[ROUTE_DEPTH_BASE + sd.slot] = dp;
        route[2 * sd.slot + 1] = dp;
        route[ROUTE_DEPTH_MIN + sd.slot] = mp.mode === "remote" ? remoteCentre(mp) : -1;
        mp.depth = 1;
        var tb = mappingTable(mp);
        for (i = 0; i < CURVE_REGION; i++) curveFloats[sd.slot * CURVE_REGION + i] = tb[i];
    }
    pokeAll("" + routeN, route);
    pokeAll("" + curveN, curveFloats);
    if (CASE.selfroutes) {
        var hdr = new Array(INT_SAMPS);
        for (i = 0; i < hdr.length; i++) hdr[i] = 0;
        var desc = intDescriptorFloats();
        for (i = 0; i < desc.length; i++) hdr[INT_DESC_AT + i] = desc[i];
        var ic = new Array(ICURVE_SAMPS);
        for (i = 0; i < ic.length; i++) ic[i] = 0;
        var rts = CASE.selfroutes;
        for (var r = 0; r < rts.length; r++) {
            hdr[4 * r] = srcIndex(rts[r].src, rts[r].out || 0) + 1;
            hdr[4 * r + 1] = rts[r].dest;
            var it = rts[r].dest >= DEST_DEPTH ? depthFactorTable(rts[r].map) : mappingTable(rts[r].map);
            for (i = 0; i < CURVE_REGION; i++) ic[r * CURVE_REGION + i] = it[i];
        }
        hdr[INT_COUNT_AT] = rts.length;
        pokeAll("" + ibufN, hdr);
        pokeAll("" + icurveN, ic);
    }
}

function toArr(chunk, count) {
    var out = [], k;
    if (!chunk) { for (k = 0; k < count; k++) out.push(0); return out; }
    if (typeof chunk === "number") return [chunk];
    for (k = 0; k < chunk.length; k++) out.push(chunk[k]);
    return out;
}

function analyze(durMs) {
    var rec = new Buffer("rec");
    var n = rec.framecount();
    var chans = rec.channelcount();
    var f = new File(resultPath, "write", "TEXT");
    f.eof = 0;
    f.writestring("frames " + n + "\n");
    f.writestring("channels " + chans + "\n");
    f.close();
    if (CASE.dump) {
        var d = new File(resultPath + ".data", "write", "TEXT");
        d.eof = 0;
        for (var c = 1; c <= chans; c++) {
            d.writestring("#channel " + c + "\n"); // (one value per line: Max's writestring mangles commas)
            for (var i = 0; i < n; i += 2048) {
                var a = toArr(rec.peek(c, i, Math.min(2048, n - i)), Math.min(2048, n - i));
                var txt = a.join("\n") + "\n";
                for (var q = 0; q < txt.length; q += 8192) d.writestring(txt.substring(q, q + 8192)); // (writestring drops characters at 32 KB: write in pieces)
            }
        }
        d.close();
    }
    outlet(0, "bang");
}
