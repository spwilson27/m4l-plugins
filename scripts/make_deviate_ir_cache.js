"use strict";
// Writes the Deviate IR bank (src/deviate_ir.js, exactly what the engine builds at run time) as a mono 32-bit float WAV, the whole
// ---deviateir buffer (DV_IR.SAMPS floats: header with VER = 1 and READY = 1, then the partition spectra). The audio tests load it into
// buffer~ with `replace` because the VM has no node.   node scripts/make_deviate_ir_cache.js [sr] [out.wav]
const fs = require("fs");
const path = require("path");
const cfg = require("../src/deviate_config.js");
const ir = require("../src/deviate_ir.js");

const sr = Number(process.argv[2] || 48000);
const out = process.argv[3] || path.join(__dirname, "..", "build_cache", `deviate_ir_${sr}.wav`);
const b = ir.dvIrBuilder(sr);
while (!b.done()) b.step(8);
const buf = new Float32Array(cfg.DV_IR.SAMPS);
for (const c of b.chunks()) {
    if (c.offset === 0) {
        const h = Float32Array.from(c.data);
        h[cfg.DV_IR.VER] = 1;
        h[cfg.DV_IR.READY] = 1;
        buf.set(h, 0);
    } else {
        buf.set(c.data, c.offset);
    }
}
const n = buf.length;
const head = Buffer.alloc(44);
head.write("RIFF", 0); head.writeUInt32LE(36 + n * 4, 4); head.write("WAVE", 8); head.write("fmt ", 12);
head.writeUInt32LE(16, 16); head.writeUInt16LE(3, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24);
head.writeUInt32LE(sr * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(32, 34); head.write("data", 36); head.writeUInt32LE(n * 4, 40);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, Buffer.from(buf.buffer)]));
console.log(`wrote ${out} (${n} floats, ${b.plan.irs.length} IRs, scale ${b.plan.scale.toFixed(3)})`);
