// Deviate IR bank tests (plain node script). node tests/test_deviate_ir.js
const path = require("path");
const cfg = require(path.join(__dirname, "../src/deviate_config.js"));
const ir = require(path.join(__dirname, "../src/deviate_ir.js"));
const rp = require(path.join(__dirname, "../src/reverbplus_config.js"));
const { DV_IR, DV_CONV, dvRng } = cfg;

let fails = 0;
function check(name, ok, info) {
    console.log((ok ? "PASS " : "FAIL ") + name + (info !== undefined ? "  " + info : ""));
    if (!ok) fails++;
}

const SR = 48000;
const names = ["Tight Room", "Booth", "Gated Burst", "Small Plate", "Spring", "Reverse", "Big Plate", "Tuned", "Metal", "Hall"];
const secs = [0.25, 0.4, 0.35, 0.8, 1.2, 1.0, 1.8, 1.5, 1.6, 2.0];

check("names", JSON.stringify(ir.dvIrNames()) === JSON.stringify(names));
const t0 = Date.now();
const bank = ir.dvIrBank(SR);
console.log("bank generated in " + (Date.now() - t0) + " ms");
check("10 irs", bank.length === 10);
let allOk = true, msgs = [];
bank.forEach((b, i) => {
    const okLen = b.len === Math.round(secs[i] * SR) && b.L.length === b.len && b.R.length === b.len;
    let fin = true, e = 0, sL = 0, sR = 0;
    for (let k = 0; k < b.len; k++) {
        if (!Number.isFinite(b.L[k]) || !Number.isFinite(b.R[k])) fin = false;
        e += b.L[k] * b.L[k] + b.R[k] * b.R[k]; sL += b.L[k]; sR += b.R[k];
    }
    e *= 0.5;
    const ok = okLen && fin && Math.abs(e - 1) < 1e-3 && b.len <= 2.0 * SR && b.name === names[i]
        && Math.abs(sL) < 0.15 && Math.abs(sR) < 0.15 && b.L[b.len - 1] === 0 && b.R[b.len - 1] === 0;
    if (!ok) { allOk = false; msgs.push(`${b.name}: len ${b.len} fin ${fin} e ${e} sum ${sL},${sR} last ${b.L[b.len - 1]}`); }
});
check("lengths/finite/energy/DC/end fade", allOk, msgs.join(" | "));
check("Hall exactly 96000", bank[9].len === 96000);

const bank2 = ir.dvIrBank(SR);
let same = true;
bank.forEach((b, i) => { for (let k = 0; k < b.len; k++) if (b.L[k] !== bank2[i].L[k] || b.R[k] !== bank2[i].R[k]) { same = false; break; } });
check("deterministic", same);

// Gated Burst
{
    const g = bank[2]; const gate = Math.round(0.25 * SR);
    let pre = 0, post = 0;
    for (let k = 0; k < g.len; k++) { const v = g.L[k] ** 2 + g.R[k] ** 2; if (k < gate) pre += v; else post += v; }
    check("gated burst abrupt gate", post < 1e-12 * pre && pre > 1, `post/pre ${post / pre}`);
    // character: energy present right up to the gate
    let near = 0; for (let k = gate - 480; k < gate; k++) near += g.L[k] ** 2;
    check("gated burst loud at gate", near > 1e-3 * pre / 100);
}
for (const i of [4, 7, 9]) {
    let d = 0; for (let k = 0; k < bank[i].len; k++) d = Math.max(d, Math.abs(bank[i].L[k] - bank[i].R[k]));
    check("stereo " + names[i], d > 1e-6);
}

// plan
const budget = DV_IR.SAMPS - DV_IR.HDR;
for (const sr of [44100, 48000, 88200, 96000, 192000]) {
    const p = ir.dvIrPlan(sr);
    let ok = p.irs.length === 10 && p.total <= budget, expect = DV_IR.HDR, why = "";
    p.irs.forEach((e, i) => {
        if (e.offset !== expect) { ok = false; why += " offset" + i; }
        const c = ir.dvIrCounts(e.len);
        if (c.nHead !== e.nHead || c.nTail !== e.nTail) { ok = false; why += " counts" + i; }
        if (e.len > 98304 || e.nTail > DV_CONV.TAIL_MAX || e.nHead > DV_CONV.HEAD_PARTS) { ok = false; why += " cap" + i; }
        expect += e.nHead * DV_CONV.NB1 * 4 + e.nTail * DV_CONV.NB2 * 4;
    });
    if (expect - DV_IR.HDR !== p.total) { ok = false; why += " total"; }
    check(`plan ${sr}`, ok, `total ${p.total} (budget ${budget}) scale ${p.scale.toFixed(3)}${why}`);
    if (sr === 48000) {
        check("48k no scaling beyond cap", p.scale === 1 && p.irs.every((e, i) => e.len === Math.min(Math.round(secs[i] * sr), 98304)));
    }
}

// partition spectrum vs reverbplus
{
    const rng = dvRng(77);
    let worst = 0;
    const L = new Float64Array(5000), R = new Float64Array(5000);
    for (let i = 0; i < 5000; i++) { L[i] = rng() - 0.5; R[i] = rng() - 0.5; }
    for (let t = 0; t < 3; t++) {
        const size = t === 0 ? 128 : 2048;
        const off = Math.floor(rng() * 2500);
        const a = new Float32Array((size + 1) * 4), b = new Float32Array((size + 1) * 4);
        ir.dvPartitionSpectrum(L, R, off, size, a, 0);
        rp.rpPartitionSpectrum(L, R, off, size, b, 0);
        for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i])));
    }
    check("partition spectrum equals rpPartitionSpectrum", worst < 1e-6, worst);
}

// convolution via head+tail spectra with uniform-partitioned overlap-add vs direct
{
    const len = 700 + 4096 + 3000; // head full + 2 tail partitions
    const src = bank[6];
    const L = src.L.slice(0, len), R = src.R.slice(0, len);
    const c = ir.dvIrCounts(len);
    const sp = ir.dvIrSpectra({ L, R }, { nHead: c.nHead, nTail: c.nTail });
    const rng = dvRng(5);
    const nx = 9000;
    const x = new Float64Array(nx); for (let i = 0; i < nx; i++) x[i] = rng() * 2 - 1;
    const yL = new Float64Array(nx + len), yR = new Float64Array(nx + len);
    // stage: partitions of size P at ir offset o, fft 2P; output into y
    function stage(spec, nb, P, o0, parts) {
        for (let p = 0; p < parts; p++) {
            const off = o0 + p * P;
            for (let b0 = 0; b0 < nx; b0 += P) {
                const n = 2 * P;
                const re = new Float64Array(n), im = new Float64Array(n);
                for (let i = 0; i < P && b0 + i < nx; i++) re[i] = x[b0 + i];
                ir.dvFft(re, im, n, false);
                const ore = new Float64Array(n), oim = new Float64Array(n), pre = new Float64Array(n), pim = new Float64Array(n);
                for (let k = 0; k <= n / 2; k++) {
                    const o = p * nb * 4 + k * 4;
                    const xr = re[k], xi = im[k];
                    const lr = spec[o], li = spec[o + 1], rr = spec[o + 2], ri = spec[o + 3];
                    ore[k] = xr * lr - xi * li; oim[k] = xr * li + xi * lr;
                    pre[k] = xr * rr - xi * ri; pim[k] = xr * ri + xi * rr;
                    if (k > 0 && k < n / 2) { ore[n - k] = ore[k]; oim[n - k] = -oim[k]; pre[n - k] = pre[k]; pim[n - k] = -pim[k]; }
                }
                ir.dvFft(ore, oim, n, true); ir.dvFft(pre, pim, n, true);
                for (let i = 0; i < n; i++) {
                    const t = b0 + off + i;
                    if (t < yL.length) { yL[t] += ore[i] / n; yR[t] += pre[i] / n; }
                }
            }
        }
    }
    stage(sp.head, DV_CONV.NB1, DV_CONV.P1, 0, c.nHead);
    stage(sp.tail, DV_CONV.NB2, DV_CONV.P2, DV_CONV.H, c.nTail);
    let err = 0;
    for (let n = 0; n < nx + len; n += 1) {
        let dl = 0, dr = 0;
        for (let k = Math.max(0, n - len + 1); k <= Math.min(n, nx - 1); k++) { dl += x[k] * L[n - k]; dr += x[k] * R[n - k]; }
        err = Math.max(err, Math.abs(dl - yL[n]), Math.abs(dr - yR[n]));
    }
    check("partitioned convolution vs direct", err < 1e-4, err + " (nHead " + c.nHead + " nTail " + c.nTail + ")");
}

// builder
for (const sr of [48000, 96000]) {
    const b = ir.dvIrBuilder(sr);
    let worstMs = 0, units = 0;
    while (!b.done()) {
        const s = process.hrtime.bigint();
        b.step(1);
        worstMs = Math.max(worstMs, Number(process.hrtime.bigint() - s) / 1e6);
        units++;
    }
    check(`builder ${sr} unit time`, worstMs < 15, `worst ${worstMs.toFixed(2)} ms over ${units} units`);
    const ch = b.chunks();
    const body = ch.slice(0, -1), hdr = ch[ch.length - 1];
    let pos = DV_IR.HDR, tiled = true;
    body.forEach(c => { if (c.offset !== pos || c.data.length > 8192 || c.data.length === 0) tiled = false; pos += c.data.length; });
    check(`builder ${sr} chunks tile`, tiled && pos === DV_IR.HDR + b.plan.total && hdr.offset === 0 && hdr.data.length === DV_IR.HDR);
    const h = ir.dvIrHeader(b.plan);
    let heq = true; for (let i = 0; i < h.length; i++) if (h[i] !== hdr.data[i]) heq = false;
    check(`builder ${sr} header`, heq && h[DV_IR.COUNT] === 10 && h[DV_IR.SR] === sr && h[DV_IR.VER] === 0 && h[DV_IR.READY] === 0);
    // content equals dvIrSpectra over the plan
    const flat = new Float32Array(b.plan.total);
    body.forEach(c => flat.set(c.data, c.offset - DV_IR.HDR));
    let eq = true;
    b.irs.forEach((fit, i) => {
        const e = b.plan.irs[i];
        const sp = ir.dvIrSpectra(fit, b.plan);
        const o = e.offset - DV_IR.HDR;
        for (let k = 0; k < sp.head.length && eq; k++) if (flat[o + k] !== sp.head[k]) eq = false;
        for (let k = 0; k < sp.tail.length && eq; k++) if (flat[o + sp.head.length + k] !== sp.tail[k]) eq = false;
        if (fit.len !== e.len) eq = false;
    });
    check(`builder ${sr} equals dvIrSpectra`, eq);
    if (sr === 48000) {
        let beq = true;
        b.irs.forEach((f, i) => { for (let k = 0; k < f.len; k++) if (f.L[k] !== bank[i].L[k] || f.R[k] !== bank[i].R[k]) { beq = false; break; } });
        check("builder IRs equal dvIrBank at 48k", beq);
    } else {
        let en = true;
        b.irs.forEach(f => { let e = 0; for (let k = 0; k < f.len; k++) e += f.L[k] ** 2 + f.R[k] ** 2; if (Math.abs(e / 2 - 1) > 1e-3 || f.L[f.len - 1] !== 0) en = false; });
        check("96k fitted IRs normalised, end 0", en);
    }
}

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
