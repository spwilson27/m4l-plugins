"use strict";
// Node twin of the Neural Amp's analog engine: runs the exact GenExpr of src/amp_analog_core.genexpr
// (transpiled by tests/genexpr_functions.js) on the table aaBank builds, the way the template drives it
// (float32 table / coefficient buffers copied into Data, a muted settle after a switch, DC block).
// Used by tests/test_amp_analog.js, scripts/amp_analog_vet.js and tests/amp_fixtures.js (Max parity refs).

const fs = require("fs");
const path = require("path");
const G = require("./genexpr_functions");
const A = require("../src/amp_config.js");
global.ampBiquad = A.ampBiquad;
const AA = require("../src/amp_analog.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "amp_analog_core.genexpr"), "utf8");

// Fast Data (same API as DataSim, no range checks) for long runs.
class FastData {
    constructor(size, chans) { this.size = size; this.chans = chans || 1; this.a = new Float64Array(size * this.chans); }
    peek(i, ch) { return this.a[(ch || 0) * this.size + Math.floor(i)]; }
    poke(v, i, ch) { this.a[(ch || 0) * this.size + Math.floor(i)] = v; return v; }
}

let FN = null;
function fns() { if (!FN) FN = G.load(SRC); return FN; }

/**
 * @param {number} idx circuit index
 * @param {{sr?:number, speaker?:number, knobs?:object, stereo?:number, checked?:boolean, settle?:boolean, gainDb?:number}} [o]
 */
function create(idx, o) {
    o = o || {};
    const sr = o.sr || 48000, nch = o.stereo ? 2 : 1;
    const D = o.checked ? G.DataSim : FastData;
    const f = fns();
    const spk = o.speaker === undefined ? 1 : o.speaker;
    const tbl = o.recipe ? AA.aaBankOf(o.recipe, sr, spk) : AA.aaBank(idx, sr, spk);
    const knobs = Object.assign({ bass: 5, mid: 5, treble: 5, presence: 5 }, o.knobs || {});
    const cfv = AA.aaToneTable(o.recipe || idx, knobs, sr);
    const tb = new D(AA.AA_NW), cq = new D(50), sv = new D(704), rq = new D(32), hq = new D(384), cr = new D(2048), tq = new D(4096), ft = new D(12008), la = new D(48);
    const xi = new D(2), xo = new D(2);
    for (let i = 0; i < AA.AA_NW; i++) tb.poke(Math.fround(tbl[i]), i);
    for (let i = 0; i < cfv.length; i++) cq.poke(Math.fround(cfv[i]), i);
    const g = Math.pow(10, (o.gainDb || 0) / 20);
    let first = 1, dcx = [0, 0], dcy = [0, 0];
    function step(l, r) {
        xi.poke(l * g, 0);
        xi.poke((r === undefined ? l : r) * g, 1);
        f.ac_sample(xi, xo, nch, first, tb, cq, sv, rq, hq, cr, tq, ft, la, sr);
        first = 0;
    }
    if (o.settle !== false) for (let i = 0; i < AA.AA_RF + 512; i++) step(0, 0);
    const api = {
        sr, table: tbl, tb, cq, sv, la,
        /** raw model output (what the gen's tapraw 1 shows) for one sample, both channels */
        raw(l, r) { step(l, r); return [xo.peek(0), nch > 1 ? xo.peek(1) : xo.peek(0)]; },
        /** process a mono buffer: raw model output, then the template's DC block */
        run(x, dc) {
            const y = new Float64Array(x.length);
            for (let i = 0; i < x.length; i++) {
                step(x[i]);
                const v = xo.peek(0);
                if (dc === false) { y[i] = v; continue; }
                dcy[0] = v - dcx[0] + 0.9995 * dcy[0]; dcx[0] = v; y[i] = dcy[0];
            }
            return y;
        },
        setKnobs(k) { const c = AA.aaToneTable(o.recipe || idx, Object.assign(knobs, k), sr); for (let i = 0; i < c.length; i++) cq.poke(Math.fround(c[i]), i); },
        meters() { return { sag: la.peek(40), gr: la.peek(41), exc: la.peek(42), bias: la.peek(43), act: Array.from({ length: 12 }, (_, i) => la.peek(i)) }; },
        state(i) { return sv.peek(i); }
    };
    return api;
}

module.exports = { create, fns, FastData, AA, SRC };
