#!/usr/bin/env node
// Compare a recorded Timbre Follower run with src/timbre_ref.js.
// usage: node tests/timbre_mirror_compare.js <rec.wav> <sr> '<params json>' [fromSec] [toSec]
// rec.wav: float32, channels 1 = dry input, 2 = gen control out (0-based). The recording does not start on a
// hop boundary of the gen, so the mirror is run with a leading offset of 0..255 samples and the best fit wins.
// Prints one JSON line: {phase, rms, max, corr, n}

"use strict";
const fs = require("fs");
const path = require("path");
const T = require(path.join(__dirname, "..", "src", "timbre_ref.js"));

function readWav(file) {
    const b = fs.readFileSync(file);
    let p = 12;
    let ch = 0;
    let fmtTag = 0;
    let bits = 0;
    let data = null;
    while (p + 8 <= b.length) {
        const id = b.toString("ascii", p, p + 4);
        const sz = b.readUInt32LE(p + 4);
        if (id === "fmt ") {
            fmtTag = b.readUInt16LE(p + 8);
            ch = b.readUInt16LE(p + 10);
            bits = b.readUInt16LE(p + 22);
        } else if (id === "data") {
            data = b.subarray(p + 8, Math.min(b.length, p + 8 + sz));
            break;
        }
        p += 8 + sz + (sz & 1);
    }
    if (!data || bits !== 32 || (fmtTag !== 3 && fmtTag !== 0xfffe)) throw new Error("expected 32-bit float WAV: " + file);
    const frames = Math.floor(data.length / 4 / ch);
    const out = [];
    for (let c = 0; c < ch; c++) out.push(new Float64Array(frames));
    for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) out[c][i] = data.readFloatLE((i * ch + c) * 4);
    return out;
}

function runMirror(dry, sr, params, pad, len) {
    const f = new T.TimbreFollower(sr, params);
    const out = new Float64Array(len);
    for (let i = 0; i < pad; i++) f.push(0);
    for (let i = 0; i < len; i++) out[i] = f.push(dry[i]);
    return out;
}

function errAgainst(mir, ctl, a, b) {
    let s = 0;
    let mx = 0;
    for (let i = a; i < b; i++) {
        const d = mir[i] - ctl[i];
        s += d * d;
        if (Math.abs(d) > mx) mx = Math.abs(d);
    }
    return { rms: Math.sqrt(s / Math.max(1, b - a)), max: mx };
}

function amax(arr, a, b) {
    let m = -Infinity;
    for (let i = a; i < b; i++) if (arr[i] > m) m = arr[i];
    return m;
}

function main() {
    const [wav, srArg, paramsArg, fromArg, toArg] = process.argv.slice(2);
    const sr = Number(srArg);
    const params = JSON.parse(paramsArg || "{}");
    const rec = readWav(wav);
    const dry = rec[1];
    const ctl = rec[2];
    let first = 0;
    while (first < dry.length && Math.abs(dry[first]) < 1e-9) first++;
    const a = first + Math.round((Number(fromArg) || 0.2) * sr);
    const bEnd = Math.min(dry.length - 2048, first + Math.round((Number(toArg) || 5.8) * sr));
    const len = bEnd + 512 - 0;
    // coarse then fine search on the hop phase of the mirror relative to the recording
    let best = { phase: 0, rms: 1e9, max: 0 };
    // runMirror feeds `ph` zeros first and returns the output for dry[i] at index i, so `ph` is the hop phase.
    const tryPhase = (ph) => errAgainst(runMirror(dry, sr, params, ph, len), ctl, a, bEnd);
    for (let ph = 0; ph < 256; ph += 16) {
        const e = tryPhase(ph);
        if (e.rms < best.rms) best = { phase: ph, rms: e.rms, max: e.max };
    }
    const centre = best.phase;
    for (let ph = centre - 14; ph <= centre + 14; ph += 2) {
        if (ph < 0 || ph === centre) continue;
        const e = tryPhase(ph);
        if (e.rms < best.rms) best = { phase: ph, rms: e.rms, max: e.max };
    }
    const mir = runMirror(dry, sr, params, best.phase, len);
    let sm = 0, sc = 0, smm = 0, scc = 0, smc = 0;
    const n = bEnd - a;
    for (let i = a; i < bEnd; i++) {
        sm += mir[i]; sc += ctl[i];
    }
    const mm = sm / n, mc = sc / n;
    for (let i = a; i < bEnd; i++) {
        smm += (mir[i] - mm) ** 2; scc += (ctl[i] - mc) ** 2; smc += (mir[i] - mm) * (ctl[i] - mc);
    }
    const corr = smc / Math.sqrt(Math.max(smm * scc, 1e-30));
    console.log(JSON.stringify({ phase: best.phase, rms: best.rms, max: best.max, corr, n, mirPeak: amax(mir, a, bEnd), ctlPeak: amax(ctl, a, bEnd) }));
}

main();
