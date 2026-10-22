// Audio probe for scripts/run_reverbplus_audio_tests.py (v8: ES6). The runner prepends src/reverbplus_config.js to
// this file (so the IR pipeline under test is the real one) and writes the result to a temp dir.
// jsarguments: case name, dump flag (1 = write the recorded channels to <result>.data).
// Messages (from the patch's loadbang): `setbuffers xfer hdr scope irs scopeE`, `buildir <kind> <lenMs> <stretch %>
// <start %> <reverse 0|1> <decay %> <bank>` (builds, processes and pokes an IR, bumps the header version), `swapir`.
// scripts/max_harness.py records the measured window (exact duration) into buffer~ rec, 4 channels:
//   ch1: out L (End when paired, Start alone otherwise)  ch2: out R  ch3: reference marker  ch4: Start out L (pre-chain)
// <result>.data: channels, each sample stored as round((v + 8) * 1e5) (a non-negative integer, so text wrapping cannot
// split a sign). The `key value` report at resultPath is created LAST.

inlets = 1;
outlets = 1;

var caseName = jsarguments.length > 1 ? jsarguments[1] : "x";
var dump = jsarguments.length > 2 ? Number(jsarguments[2]) : 0;
var names = { xfer: "", hdr: "", scope: "", irs: "", scopeE: "" };
var resultPath = "/tmp/reverbplus_audio.txt";
var armed = false;
var built = null; // {L, R, len, orig}
var SR = 48000;

function setbuffers(xfer, hdr, scope, irs, scopeE) {
    names.xfer = "" + xfer; names.hdr = "" + hdr; names.scope = "" + scope; names.irs = "" + irs; names.scopeE = "" + scopeE;
}

function resultpath(p) {
    resultPath = String(p);
}

function lcg(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s / 4294967296) * 2 - 1;
    };
}

// Synthetic impulse responses (48 kHz): dirac (1 sample), noise (stereo decaying noise, L and R different),
// mono (one channel), long (6 s stereo, for the CPU test), ramp (L: a decaying noise whose first sample is 1).
function makeIr(kind, lenMs) {
    const n = Math.max(1, Math.round(lenMs * SR / 1000));
    if (kind === "dirac") return { chans: [Float32Array.from([1])], sr: SR };
    const mk = (seed) => {
        const r = lcg(seed);
        const a = new Float32Array(n);
        const tau = n / 4.6;
        for (let i = 0; i < n; i++) a[i] = r() * Math.exp(-i / tau);
        a[0] = 3.0;
        return a;
    };
    if (kind === "mono") return { chans: [mk(11)], sr: SR };
    return { chans: [mk(11), mk(23)], sr: SR };
}

function bk(name) {
    return new Buffer(name);
}

function pokeArr(buf, off, arr) {
    for (let i = 0; i < arr.length; i += 8192) buf.poke(1, off + i, Array.prototype.slice.call(arr.subarray(i, Math.min(arr.length, i + 8192))));
}

function buildir(kind, lenMs, stretch, start, reverse, decay, bank) {
    const ir = makeIr(String(kind), Number(lenMs));
    const proc = rpIrProcess(ir, { stretch: Number(stretch), start: Number(start), reverse: Number(reverse) > 0.5, decay: Number(decay) }, SR);
    const c = rpIrCounts(proc.len);
    const sp = rpIrSpectra(proc.L, proc.R, proc.len);
    const buf = bk(names.irs);
    const base = Number(bank) * RP_CONV.BANK_FLOATS;
    pokeArr(buf, base, sp.head);
    pokeArr(buf, base + RP_CONV.HEAD_FLOATS, sp.tail);
    const h = bk(names.hdr);
    const ver = (built ? built.ver : 0) + 1;
    h.poke(1, RP_HDR.IR_BANK, Number(bank));
    h.poke(1, RP_HDR.IR_NHEAD, c.nHead);
    h.poke(1, RP_HDR.IR_NTAIL, c.nTail);
    h.poke(1, RP_HDR.IR_LEN, proc.len);
    h.poke(1, RP_HDR.IR_LOADED, 1);
    h.poke(1, RP_HDR.IR_CH, proc.channels);
    h.poke(1, RP_HDR.IR_VER, ver);
    built = { L: proc.L, R: proc.R, len: proc.len, orig: ir, ver: ver, nHead: c.nHead, nTail: c.nTail };
    post("REVERBPLUS_IR built " + kind + " len " + proc.len + " head " + c.nHead + " tail " + c.nTail + "\n");
}

function swapir() {
    buildir("noise", 900, 100, 0, 0, 100, built && built.ver % 2 === 1 ? 0 : 1);
}

// CPU % from `adstatus cpu` (audio_device mode); NonRealTime has no meaningful real-time load.
let cpuMax = 0, cpuSum = 0, cpuCount = 0;
function cpu(v) {
    cpuMax = Math.max(cpuMax, v);
    cpuSum += v;
    cpuCount++;
}

function readChannel(buf, channel, n) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 2048) {
        const count = Math.min(2048, n - i);
        const chunk = buf.peek(channel, i, count);
        if (!chunk) continue;
        if (typeof chunk === "number") { out[i] = chunk; continue; }
        for (let k = 0; k < count; k++) out[i + k] = chunk[k];
    }
    return out;
}

function readHead(name, n) {
    if (!name) return [];
    const v = bk(name).peek(1, 0, n);
    if (typeof v === "number") return [v];
    const out = [];
    for (let i = 0; v && i < v.length; i++) out.push(v[i]);
    return out;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    const rec = bk("rec");
    const n = rec.framecount();
    const ch = [1, 2, 3, 4].map((c) => readChannel(rec, c, n));
    let nan = 0;
    const maxabs = [0, 0, 0];
    let sum1 = 0;
    for (let c = 0; c < 4; c++) {
        for (let i = 0; i < n; i++) {
            const v = ch[c][i];
            if (v !== v || v === Infinity || v === -Infinity) nan++;
            else if (c < 2 || c === 3) {
                const a = Math.abs(v);
                const m = c === 3 ? 2 : c;
                if (a > maxabs[m]) maxabs[m] = a;
                if (c === 0) sum1 += v;
            }
        }
    }
    if (dump) {
        const data = new File(resultPath + ".data", "write", "TEXT");
        data.eof = 0;
        for (let c = 0; c < 4; c++) {
            data.writestring("ch" + (c + 1));
            for (let i = 0; i < n; i += 4096) {
                const parts = [];
                for (let k = i; k < Math.min(n, i + 4096); k++) parts.push(Math.round((ch[c][k] + 8) * 100000));
                data.writestring(" " + parts.join(" "));
            }
            data.writestring("\n");
        }
        data.close();
    }
    let out = "n " + n + "\nnan " + nan + "\nmaxabs1 " + maxabs[0] + "\nmaxabs2 " + maxabs[1] + "\nmaxabs4 " + maxabs[2] + "\nmean1 " + (sum1 / n) + "\n";
    // convolution: the output against the processed IR, delayed by the engine latency from the reference marker
    if (built && caseName.indexOf("conv") === 0) {
        let r0 = -1;
        for (let i = 0; i < n; i++) if (ch[2][i] > 0.5) { r0 = i; break; }
        if (r0 >= 0) {
            const lat = RP_CONV.LAT;
            const cmp = (rec1, ir) => {
                let e = 0, s = 0, pk = 0;
                for (let k = 0; k < built.len && r0 + lat + k < n; k++) {
                    const d = rec1[r0 + lat + k] - ir[k];
                    e += d * d;
                    s += ir[k] * ir[k];
                }
                return 10 * Math.log10(Math.max(e, 1e-30) / Math.max(s, 1e-30));
            };
            out += "null_l " + cmp(ch[0], built.L) + "\nnull_r " + cmp(ch[1], built.R) + "\nir_len " + built.len + "\n";
            // measured length: last sample above 1e-3 of the peak
            let pk = 0;
            for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(ch[0][i]));
            let last = r0;
            for (let i = n - 1; i > r0; i--) if (Math.abs(ch[0][i]) > pk * 1e-3) { last = i; break; }
            out += "len_meas " + (last - r0 - lat) + "\nr0 " + r0 + "\n";
        }
    }
    // open-loop transfer of the wet (egl_* / ege_* cases): rms and peak of |H| over 2^19 samples from the impulse
    if (caseName.indexOf("eg") === 0) {
        let r0 = -1;
        for (let i = 0; i < n; i++) if (ch[2][i] > 0.5) { r0 = i; break; }
        if (r0 >= 0) {
            const N = 1 << 19;
            const re = new Float64Array(N), im = new Float64Array(N);
            for (let i = 0; i < N && r0 + i < n; i++) re[i] = ch[0][r0 + i];
            rpFft(re, im, N, false);
            let mx = 0, ms = 0;
            for (let k = 1; k < N / 2; k++) {
                const m2 = re[k] * re[k] + im[k] * im[k];
                ms += m2;
                if (m2 > mx) mx = m2;
            }
            out += "hpk2 " + mx + "\nhrms2 " + ms / (N / 2 - 1) + "\n";
        }
    }
    out += "cpuAvg " + (cpuCount ? cpuSum / cpuCount : 0) + "\ncpuMax " + cpuMax + "\ncpuCount " + cpuCount + "\n";
    const hdr = readHead(names.hdr, 48);
    const sc = readHead(names.scope, RP_SCOPE_SAMPS);
    for (let i = 0; i < hdr.length; i++) out += "h" + i + " " + hdr[i] + "\n";
    out += "lgain " + sc[RP_SCOPE.LOOP_GAIN] + "\ntankrt " + sc[RP_SCOPE.TANK_RT] + "\nloopms " + sc[RP_SCOPE.LOOP_MS] + "\n"
        + "mutes " + sc[RP_SCOPE.MUTE_N] + "\nmutel " + sc[RP_SCOPE.MUTE_L] + "\nmuteb " + sc[RP_SCOPE.MUTE_B] + "\nmutek " + sc[RP_SCOPE.MUTE_K] + "\n"
        + "asleep " + sc[RP_SCOPE.ASLEEP] + "\nastate " + sc[RP_SCOPE.ALGO_STATE] + "\n";
    for (let i = 0; i < 32; i++) out += "s" + i + " " + (sc[i] === undefined ? 0 : sc[i]) + "\n";
    const report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(out);
    report.close();
    post("REVERBPLUS_SHUTDOWN\n");
    outlet(0, "bang");
}
