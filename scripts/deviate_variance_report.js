"use strict";
// Deviate variance report: renders kick / snare hits through the Node sim of the gen core (tests/deviate_sim_lib.js) for
// every Arch Mode x Arch x draw (dvseed = draw index) and measures how far the output strays from the dry, how long it
// rings, how much its spectrum moves and how different the draws / Archs sound from one another.
//   node scripts/deviate_variance_report.js [--modes 0,1,2,3] [--archs 0,37,417,913] [--draws 2] [--stims kick,snare]
//        [--window 3] [--set dvv7=70,dvr7=30] [--workers N] [--quick] [--json out.json] [--table]
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

const SR = 48000;
const HIT_S = 0.1, AMP = 0.8;

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- stimuli: hit at HIT_S, silence before and after ----
function stimulus(name, len) {
    const x = new Float64Array(len);
    const rng = mulberry32(name === "kick" ? 1234 : 5678);
    const n0 = Math.round(HIT_S * SR);
    const f = name === "kick" ? 60 : 180;
    const tau = name === "kick" ? 0.090 : 0.060;
    const nz = name === "kick" ? 0.005 : 0.040;
    const nzTau = name === "kick" ? 0.005 : 0.040 / 3; // kick: 5 ms burst; snare: decaying noise over ~40 ms
    for (let i = 0; n0 + i < len; i++) {
        const t = i / SR;
        let v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau);
        if (t < nz) v += (name === "kick" ? 0.6 : 0.8) * (rng() * 2 - 1) * (name === "kick" ? 1 : Math.exp(-t / nzTau));
        else rng();
        x[n0 + i] = AMP * v / (name === "kick" ? 1.1 : 1.3);
    }
    // normalise the peak to AMP
    let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(x[i]));
    for (let i = 0; i < len; i++) x[i] *= AMP / pk;
    return x;
}

// ---- FFT ----
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k, b = i + k + len / 2;
                const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
            }
        }
    }
}
const hann = (n) => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; };
const W2048 = hann(2048), W4096 = hann(4096);
function powerSpec(y, start, N, win) { // power spectrum bins 0..N/2 of y[start..start+N) (zero beyond the end)
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (start + i < y.length ? y[start + i] : 0) * win[i];
    fft(re, im);
    const p = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    return p;
}

// ---- metrics ----
const FP_BANDS = 32, FP_LO = 40, FP_HI = 16000;
const FP_EDGES_MS = [0, 40, 100, 200, 350, 600, 1000, 1600, 2600];
const bandEdgesHz = []; for (let i = 0; i <= FP_BANDS; i++) bandEdgesHz.push(FP_LO * Math.pow(FP_HI / FP_LO, i / FP_BANDS));

function metrics(x, y, onset, lat, W, y2) {
    const winN = Math.min(Math.round(W * SR), y.length - onset - lat);
    const o = onset + lat; // output index of the onset
    // (a)(b) similarity over 0..300 ms
    const sn = Math.round(0.3 * SR);
    let xy = 0, xx = 0, yy = 0, dd = 0;
    for (let i = 0; i < sn; i++) {
        const a = x[onset + i], b = y[o + i];
        xy += a * b; xx += a * a; yy += b * b; dd += (b - a) * (b - a);
    }
    const ncc = xy / Math.sqrt(xx * yy + 1e-30);
    const resid = dd / (xx + 1e-30);
    // (c) -40 dB duration: 10 ms windows
    const wl = Math.round(0.01 * SR);
    const rms = [];
    for (let s = 0; s + wl <= winN; s += wl) {
        let e = 0; for (let i = 0; i < wl; i++) e += y[o + s + i] * y[o + s + i];
        rms.push(Math.sqrt(e / wl));
    }
    let pkr = 0; rms.forEach((r) => { pkr = Math.max(pkr, r); });
    let last = -1; const thr = pkr * 0.01;
    rms.forEach((r, i) => { if (r > thr) last = i; });
    const dur40 = last < 0 ? 0 : (last + 1) * 0.01;
    // (d) centroid motion
    const cents = [], frmsArr = [];
    for (let s = 0; s + 2048 <= winN; s += 1024) {
        const p = powerSpec(y, o + s, 2048, W2048);
        let e = 0; for (let i = 0; i < 2048; i++) e += y[o + s + i] * y[o + s + i];
        let nu = 0, de = 0;
        for (let k = 1; k <= 1024; k++) { const m = Math.sqrt(p[k]); nu += k * SR / 2048 * m; de += m; }
        frmsArr.push(Math.sqrt(e / 2048)); cents.push(de > 0 ? nu / de : 0);
    }
    let fpk = 0; frmsArr.forEach((r) => { fpk = Math.max(fpk, r); });
    const lc = [];
    frmsArr.forEach((r, i) => { if (r >= fpk * 0.01 && r > 0 && cents[i] > 0) lc.push(Math.log2(cents[i])); });
    let cmove = 0;
    if (lc.length > 1) {
        const mu = lc.reduce((a, b) => a + b, 0) / lc.length;
        cmove = Math.sqrt(lc.reduce((a, b) => a + (b - mu) * (b - mu), 0) / lc.length);
    }
    // ---- absolute / dry-relative tails, wet tail, motion within the first second ----
    const rms2 = []; // L+R 10 ms RMS over the whole window
    for (let s = 0; s + wl <= winN; s += wl) {
        let e = 0; for (let i = 0; i < wl; i++) e += 0.5 * (y[o + s + i] * y[o + s + i] + y2[o + s + i] * y2[o + s + i]);
        rms2.push(Math.sqrt(e / wl));
    }
    const lastAbove = (arr, thr) => { let l = -1; arr.forEach((r, i) => { if (r > thr) l = i; }); return l < 0 ? 0 : (l + 1) * 0.01; };
    const tailAbs = lastAbove(rms2, Math.pow(10, -60 / 20));
    let dpk = 0;
    for (let s = 0; s + wl <= winN; s += wl) { let e = 0; for (let i = 0; i < wl; i++) e += x[onset + s + i] * x[onset + s + i]; dpk = Math.max(dpk, Math.sqrt(e / wl)); }
    const tailRel = lastAbove(rms2, dpk * Math.pow(10, -50 / 20));
    let dryE = 0, wetE = 0;
    for (let i = 0; i < winN; i++) {
        dryE += x[onset + i] * x[onset + i];
        if (i >= Math.round(0.3 * SR)) { const d = x[onset + i]; wetE += 0.5 * ((y[o + i] - d) * (y[o + i] - d) + (y2[o + i] - d) * (y2[o + i] - d)); }
    }
    const wetTail = 10 * Math.log10((wetE + 1e-20) / (dryE + 1e-20));
    const n1 = Math.min(winN, SR);
    const fr = []; // frames in the first second
    for (let s = 0; s + 2048 <= n1; s += 1024) {
        const p = powerSpec(y, o + s, 2048, W2048);
        let e = 0; for (let i = 0; i < 2048; i++) e += y[o + s + i] * y[o + s + i];
        const mag = new Float64Array(1024); let nu = 0, de = 0;
        for (let k = 1; k <= 1024; k++) { const m = Math.sqrt(p[k]); mag[k - 1] = m; nu += k * SR / 2048 * m; de += m; }
        fr.push({ rms: Math.sqrt(e / 2048), cent: de > 0 ? nu / de : 0, mag, sum: de });
    }
    let frpk = 0; fr.forEach((f) => { frpk = Math.max(frpk, f.rms); });
    const sel = fr.map((f) => f.rms > 0 && f.rms >= frpk * Math.pow(10, -25 / 20) && f.cent > 0);
    const lc2 = []; fr.forEach((f, i) => { if (sel[i]) lc2.push(Math.log2(f.cent)); });
    let cmove2 = 0, centRange = 0;
    if (lc2.length > 1) {
        const mu = lc2.reduce((a, b) => a + b, 0) / lc2.length;
        cmove2 = Math.sqrt(lc2.reduce((a, b) => a + (b - mu) * (b - mu), 0) / lc2.length);
        const sorted = lc2.slice().sort((a, b) => a - b);
        centRange = sorted[Math.min(sorted.length - 1, Math.floor(0.9 * (sorted.length - 1) + 0.5))] - sorted[Math.floor(0.1 * (sorted.length - 1) + 0.5)];
    }
    let fl = 0, flN = 0;
    for (let i = 1; i < fr.length; i++) {
        if (!sel[i] || !sel[i - 1]) continue;
        let pos = 0; for (let k = 0; k < 1024; k++) pos += Math.max(0, fr[i].mag[k] / (fr[i].sum + 1e-20) - fr[i - 1].mag[k] / (fr[i - 1].sum + 1e-20));
        fl += pos; flN++;
    }
    const specFlux = flN ? fl / flN : 0;
    // (e) fingerprint
    const fp = [];
    for (let t = 0; t < 8; t++) {
        const a = Math.min(Math.round(FP_EDGES_MS[t] * SR / 1000), winN), b = Math.min(Math.round(FP_EDGES_MS[t + 1] * SR / 1000), winN);
        const acc = new Float64Array(FP_BANDS);
        if (b > a) {
            let cnt = 0;
            const sum = new Float64Array(2049);
            for (let s = a; s < b || cnt === 0; s += 2048) {
                const p = powerSpec(y, o + s, 4096, W4096);
                for (let k = 0; k <= 2048; k++) sum[k] += p[k];
                cnt++;
                if (s + 2048 >= b) break;
            }
            for (let k = 1; k <= 2048; k++) {
                const f = k * SR / 4096;
                if (f < FP_LO || f >= FP_HI) continue;
                const bi = Math.min(FP_BANDS - 1, Math.floor(Math.log(f / FP_LO) / Math.log(FP_HI / FP_LO) * FP_BANDS));
                acc[bi] += sum[k] / cnt;
            }
        }
        for (let i = 0; i < FP_BANDS; i++) fp.push(10 * Math.log10(acc[i] + 1e-20));
    }
    let mx = -Infinity; fp.forEach((v) => { if (v > mx) mx = v; });
    const fpn = fp.map((v) => Math.max(-80, v - mx));
    return { ncc, resid, dur40, cmove, tailAbs, tailRel, wetTail, cmove2, centRange, specFlux, fp: fpn.map((v) => Math.round(v * 10) / 10) };
}

// ---- one render ----
function render(lib, mode, arch, d, stim, W, set) {
    const { cfg, makeSim } = lib;
    const lat = cfg.DV_LAT_ENV;
    const len = Math.round((HIT_S + W) * SR) + lat + 64;
    const x = stimulus(stim, len);
    const sim = makeSim(Object.assign({ dvseed: d, __arch: arch, __mode: mode }, set || {}), true);
    const y = new Float64Array(len), y2 = new Float64Array(len);
    let finite = true, peak = 0;
    for (let n = 0; n < len; n++) {
        const v = sim.step(x[n]); const v2 = sim.IO.out2;
        if (!Number.isFinite(v)) { finite = false; y[n] = 0; } else { y[n] = v; y2[n] = Number.isFinite(v2) ? v2 : 0; if (Math.abs(v) > peak) peak = Math.abs(v); }
    }
    const hits = sim.sc(cfg.DV_SCOPE.HITS);
    const m = metrics(x, y, Math.round(HIT_S * SR), lat, W, y2);
    const hash = crypto.createHash("sha256").update(Buffer.from(y.buffer)).update(Buffer.from(y2.buffer)).digest("hex").slice(0, 16);
    return Object.assign({ mode, modeName: cfg.DV_MODES[mode], arch, draw: d, stim, finite, peak, hits, hash }, m);
}

function runChunk(job) {
    const lib = require("../tests/deviate_sim_lib.js");
    const out = [];
    for (const stim of job.stims) for (let d = 0; d < job.draws; d++) out.push(render(lib, job.mode, job.arch, d, stim, job.window, job.set));
    return out;
}

// ---- aggregates ----
const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((p, q) => p - q); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const fpDist = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) e += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(e / a.length); };
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

function aggregate(results, modes) {
    const agg = {};
    for (const mode of modes) {
        const rs = results.filter((r) => r.mode === mode);
        if (!rs.length) continue;
        const within = [], across = [];
        const key = (r) => r.arch + "|" + r.stim;
        const groups = {};
        rs.forEach((r) => { (groups[key(r)] = groups[key(r)] || []).push(r); });
        Object.values(groups).forEach((g) => { for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) within.push(fpDist(g[i].fp, g[j].fp)); });
        const byDS = {};
        rs.forEach((r) => { (byDS[r.draw + "|" + r.stim] = byDS[r.draw + "|" + r.stim] || []).push(r); });
        Object.values(byDS).forEach((g) => { for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (g[i].arch !== g[j].arch) across.push(fpDist(g[i].fp, g[j].fp)); });
        const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN);
        agg[rs[0].modeName] = {
            n: rs.length,
            nccMedian: r4(median(rs.map((r) => r.ncc))), nccP90: r4(pct(rs.map((r) => r.ncc), 0.9)),
            residMedian: r4(median(rs.map((r) => r.resid))),
            dur40Median: r4(median(rs.map((r) => r.dur40))),
            cmoveMedian: r4(median(rs.map((r) => r.cmove))),
            tailAbsMedian: r4(median(rs.map((r) => r.tailAbs))), tailRelMedian: r4(median(rs.map((r) => r.tailRel))),
            wetTailMedian: r4(median(rs.map((r) => r.wetTail))), cmove2Median: r4(median(rs.map((r) => r.cmove2))),
            centRangeMedian: r4(median(rs.map((r) => r.centRange))), specFluxMedian: r4(median(rs.map((r) => r.specFlux))),
            fpWithin: r4(mean(within)), fpAcross: r4(mean(across)),
            peakMax: r4(Math.max(...rs.map((r) => r.peak))),
            nonFinite: rs.filter((r) => !r.finite).length,
            noHit: rs.filter((r) => !(r.hits > 0)).length,
        };
    }
    return agg;
}

function printTable(agg) {
    const cols = ["n", "nccMedian", "nccP90", "residMedian", "dur40Median", "cmoveMedian", "tailAbsMedian", "tailRelMedian", "wetTailMedian", "cmove2Median", "centRangeMedian", "specFluxMedian", "fpWithin", "fpAcross", "peakMax", "nonFinite", "noHit"];
    const head = ["mode"].concat(cols).map((c) => c.padEnd(15)).join("");
    console.log(head);
    for (const [m, a] of Object.entries(agg)) console.log([m].concat(cols.map((c) => String(a[c]))).map((c) => c.padEnd(15)).join(""));
}

// ---- CLI ----
function parseArgs(argv) {
    const o = { modes: [0, 1, 2, 3], archs: [0, 37, 417, 913], draws: 2, stims: ["kick", "snare"], window: 3, workers: 1, json: null, table: false, quick: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i], nx = () => argv[++i];
        if (a === "--modes") o.modes = nx().split(",").map(Number);
        else if (a === "--archs") o.archs = nx().split(",").map(Number);
        else if (a === "--draws") o.draws = Number(nx());
        else if (a === "--stims") o.stims = nx().split(",");
        else if (a === "--window") o.window = Number(nx());
        else if (a === "--workers") o.workers = Number(nx());
        else if (a === "--set") { o.set = o.set || {}; nx().split(",").forEach((kv) => { const q = kv.split("="); o.set[q[0]] = Number(q[1]); }); }
        else if (a === "--json") o.json = nx();
        else if (a === "--table") o.table = true;
        else if (a === "--quick") o.quick = true;
    }
    if (o.quick) { o.archs = [37, 417]; o.draws = 2; o.stims = ["kick"]; }
    return o;
}

async function main() {
    const opt = parseArgs(process.argv.slice(2));
    const t0 = Date.now();
    const jobs = [];
    for (const mode of opt.modes) for (const arch of opt.archs) jobs.push({ mode, arch, draws: opt.draws, stims: opt.stims, window: opt.window, set: opt.set });
    let results = [];
    if (opt.workers <= 1) {
        jobs.forEach((j, i) => { results = results.concat(runChunk(j)); process.stderr.write(`chunk ${i + 1}/${jobs.length}\r`); });
    } else {
        let next = 0, done = 0;
        await new Promise((resolve, reject) => {
            const spawn = () => {
                const ch = cp.fork(__filename, ["--worker"]);
                const feed = () => { if (next < jobs.length) ch.send(jobs[next++]); else ch.kill(); };
                ch.on("message", (m) => { results = results.concat(m); done++; process.stderr.write(`chunk ${done}/${jobs.length}\r`); if (done === jobs.length) resolve(); feed(); });
                ch.on("error", reject);
                feed();
            };
            for (let w = 0; w < Math.min(opt.workers, jobs.length); w++) spawn();
        });
    }
    results.sort((a, b) => a.mode - b.mode || a.arch - b.arch || (a.stim < b.stim ? -1 : a.stim > b.stim ? 1 : 0) || a.draw - b.draw);
    const agg = aggregate(results, opt.modes);
    const elapsed = (Date.now() - t0) / 1000;
    if (opt.json) {
        const fs = require("fs");
        fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true });
        fs.writeFileSync(opt.json, JSON.stringify({ options: Object.assign({ modes: opt.modes, archs: opt.archs, draws: opt.draws, stims: opt.stims, window: opt.window }, opt.set ? { set: opt.set } : {}), aggregates: agg, results }, null, 0) + "\n");
    }
    if (opt.table || !opt.json) printTable(agg);
    console.log(`${results.length} renders in ${elapsed.toFixed(1)} s (${(elapsed / Math.max(1, results.length)).toFixed(1)} s/render wall)`);
}

if (process.argv.includes("--worker")) {
    process.on("message", (job) => { process.send(runChunk(job)); });
} else {
    main().catch((e) => { console.error(e); process.exit(1); });
}
