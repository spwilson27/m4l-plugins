// Analog engine of the Neural Amp: the circuit models (recipes), the tables the gen reads (aaBank), the
// tone-stack coefficients from the real component values (aaToneCoefs, nodal analysis with polynomial
// admittances), the cab impulse responses (aaCabIr) and the halfband oversampling filter (aaHalfband).
// The DSP is src/amp_analog_core.genexpr; the table layout below (AA_*) must match its offsets.
// Plain script, concatenated into the face v8ui after amp_config.js; Node gets it through aaNodeModule.

var AA_NW = 2048;            // table floats (one bank of ---ampa; the template copies it into Data wd)
var AA_BANK = 2048;          // bank stride in ---ampa (two banks)
var AA_SLOT = 64, AA_STRIDE = 32, AA_NSLOT = 12;
var AA_OUT = 448, AA_HB = 512, AA_IR = 1024, AA_IRMAX = 512, AA_INIT = 1536;
var AA_STATE = 352, AA_SSLOT = 24, AA_SOUT = 288, AA_SMISC = 320;
var AA_RF = 8192;            // samples the gen runs muted after a switch (filters, caps and the supply settle)
var AA_SLEEP = 96000;        // silent samples before the analog gen sleeps (slower than any sag recovery)
var AA_KIND = { NONE: 0, OPTO: 1, FET: 2, TAPE: 3, TS: 4, RAT: 5, MUFF: 6, FUZZ: 7, TRIODE: 8, TONE: 9, OPAMP: 10, XFMR: 11, PWR: 12, SSPWR: 13, GAIN: 14 };
var AA_TONE_SET = 9;         // floats per tone-stack coefficient set in ---ampcfa (two sets, then 18 = presence)

// Koren constants [mu, ex, kg1, kp, kvb] (triodes) and [mu, ex, kg1, kp, kvb, kg2] (pentodes).
var AA_TRIODES = {
    "12AX7": [100, 1.4, 1060, 600, 300],
    "12AT7": [60, 1.35, 460, 300, 300],
    "12AU7": [21.5, 1.3, 1180, 84, 300],
    "12AY7": [44, 1.4, 1060, 400, 300]
};
var AA_PENTODES = {
    "EL34": [11, 1.35, 650, 60, 24, 4200],
    "6L6": [8.7, 1.35, 1460, 48, 12, 4500],
    "6V6": [10.7, 1.31, 1672, 41, 12.7, 4500],
    "EL84": [19, 1.35, 600, 200, 40, 4500],
    "KT88": [8.8, 1.35, 730, 32, 16, 4200],
    "6550": [7.9, 1.35, 890, 60, 24, 4800]
};

// Speakers (Thiele-Small, one driver) and the cabinets they sit in (series x parallel, IR voicing).
var AA_SPEAKERS = {
    jensen: { re: 3.2, le: 0.00035, fs: 105, qms: 4.5, qes: 0.75, mms: 0.010, xmax: 0.0015, z: 4 },
    c12k: { re: 6.5, le: 0.0005, fs: 85, qms: 6, qes: 0.6, mms: 0.020, xmax: 0.0025, z: 8 },
    blue: { re: 6.0, le: 0.0004, fs: 75, qms: 5, qes: 0.9, mms: 0.012, xmax: 0.0018, z: 8 },
    greenback: { re: 13, le: 0.0009, fs: 75, qms: 5.5, qes: 0.65, mms: 0.016, xmax: 0.003, z: 16 },
    g12t75: { re: 13, le: 0.0011, fs: 80, qms: 6, qes: 0.55, mms: 0.018, xmax: 0.0035, z: 16 },
    v30: { re: 6.4, le: 0.0008, fs: 75, qms: 5.6, qes: 0.64, mms: 0.015, xmax: 0.0035, z: 8 },
    fane: { re: 13.5, le: 0.0007, fs: 70, qms: 7, qes: 0.5, mms: 0.022, xmax: 0.004, z: 16 },
    bass10: { re: 6.6, le: 0.0006, fs: 50, qms: 6, qes: 0.45, mms: 0.025, xmax: 0.005, z: 8 },
    jc: { re: 6.6, le: 0.0004, fs: 90, qms: 6, qes: 0.5, mms: 0.018, xmax: 0.003, z: 8 }
};
// Cab IRs (no LF roll-off: the speaker model has its resonance): low-pass, breakup peaks / dips,
// box reflections [ms, gain], an off-axis mic comb [ms, gain], a short diffuse tail (seeded).
var AA_CABS = {
    tweed1x12: { lp: [4800, 0.8], lp2: 0, peaks: [[1800, 2.2, 4], [3300, 3, 3], [6200, 3, -8]], refl: [[0.6, -0.25], [1.4, 0.12]], mic: [0.08, 0.25], tail: 0.05, seed: 11 },
    twin2x12: { lp: [6500, 0.75], lp2: 0, peaks: [[2600, 2, 3], [4200, 3, 2], [900, 1.2, -2]], refl: [[0.8, -0.2], [2.0, 0.08]], mic: [0.05, 0.2], tail: 0.04, seed: 23 },
    ac2x12: { lp: [5200, 0.9], lp2: 0, peaks: [[2100, 1.8, 5], [3700, 3, 3], [1100, 1.4, -3]], refl: [[0.7, -0.22], [1.7, 0.1]], mic: [0.06, 0.22], tail: 0.05, seed: 37 },
    gb4x12: { lp: [4400, 0.8], lp2: [5600, 0.6], peaks: [[1500, 1.6, 3], [2600, 2.2, 5], [700, 1.2, -2]], refl: [[0.35, 0.2], [0.9, -0.12], [2.6, 0.06]], mic: [0.12, 0.3], tail: 0.03, seed: 41 },
    t75x4: { lp: [5200, 0.9], lp2: [6500, 0.6], peaks: [[3200, 2.5, 6], [1600, 1.5, 1], [5000, 4, -4]], refl: [[0.35, 0.22], [1.0, -0.1]], mic: [0.1, 0.25], tail: 0.03, seed: 53 },
    v30x4: { lp: [5000, 0.85], lp2: [6200, 0.6], peaks: [[2500, 2, 6], [4400, 3, 4], [850, 1.5, -4], [1350, 3, -3]], refl: [[0.33, 0.22], [0.95, -0.12]], mic: [0.11, 0.28], tail: 0.03, seed: 67 },
    fane4x12: { lp: [5800, 0.75], lp2: [7200, 0.6], peaks: [[1900, 1.4, 2], [3600, 2, 2]], refl: [[0.38, 0.18], [1.1, -0.08]], mic: [0.07, 0.15], tail: 0.03, seed: 71 },
    svt8x10: { lp: [3600, 0.8], lp2: [4500, 0.6], peaks: [[1200, 1.5, 3], [2500, 2, 2], [450, 1.4, -2]], refl: [[0.3, 0.2], [0.8, 0.12], [1.8, -0.06]], mic: [0.09, 0.2], tail: 0.04, seed: 83 },
    jc2x12: { lp: [7500, 0.7], lp2: 0, peaks: [[3000, 1.8, 4], [5500, 3, 3], [1200, 1.2, -2]], refl: [[0.8, -0.18], [1.9, 0.08]], mic: [0.04, 0.15], tail: 0.04, seed: 97 }
};

// Tone stacks: component values (kOhm, nF) and the source resistance driving them (kOhm).
var AA_STACKS = {
    blackface: { net: "tmb", c1: 0.25, r1: 100, c2: 100, c3: 47, rt: 250, rb: 250, rm: 10, rs: 38 },
    bassman: { net: "tmb", c1: 0.25, r1: 56, c2: 20, c3: 20, rt: 250, rb: 1000, rm: 25, rs: 38 },
    marshall: { net: "tmb", c1: 0.47, r1: 33, c2: 22, c3: 22, rt: 220, rb: 1000, rm: 25, rs: 1.2 },
    jcm: { net: "tmb", c1: 0.47, r1: 33, c2: 22, c3: 22, rt: 220, rb: 1000, rm: 25, rs: 38 },
    vox: { net: "tmb", c1: 0.1, r1: 100, c2: 22, c3: 100, rt: 1000, rb: 1000, rm: 10, rs: 1.2, fixmid: 1 },
    hiwatt: { net: "tmb", c1: 1, r1: 47, c2: 22, c3: 22, rt: 250, rb: 250, rm: 25, rs: 38 },
    modern: { net: "tmb", c1: 0.5, r1: 47, c2: 22, c3: 22, rt: 250, rb: 1000, rm: 25, rs: 38 },
    ampeg: { net: "tmb", c1: 1, r1: 100, c2: 47, c3: 47, rt: 100, rb: 250, rm: 10, rs: 38 },
    jc: { net: "tmb", c1: 1, r1: 10, c2: 22, c3: 100, rt: 50, rb: 100, rm: 25, rs: 0.5 },
    tweed: { net: "tweed", ct: 4.7, rt: 1000, rs: 38 },
    desk: { net: "bax", r1: 10, rb: 100, cb1: 47, cb2: 470, r2: 1, ct1: 2.2, rt: 100, rt2: 10, r3: 10, rs: 0.1 }
};

// ---------------------------------------------------------------------------------------------
// The 16 circuits. Each is a chain of stages in slot order (slot 0 and 11 at the base rate, 1..10 at 2x),
// the speaker / cab it drives, and what the four tone knobs do (toneRole: which knobs exist, presence =
// "nfb" (presence of the NFB loop), "cut" (Vox Cut low-pass, reversed) or "none"). outDb calibrates the
// output to about -18 dB at Gain 0 (scripts/amp_analog_vet.js --calibrate).

// A first stage is direct-coupled (the input jack -> 68k grid stopper -> grid, 1M grid leak, no coupling cap: it cannot
// block); the stages after it are capacitor-coupled (blocking). Values in kOhm / nF.
function aaT(tube, o) {
    var s = { k: "triode", tube: tube, B: 300, Rp: 100, Rk: 1.5, Ck: 25, Cc: 22, Rg: 1000, Rs: 38, out: "plate", scale: 1, rail: 0.8, vg0: 0 };
    for (var k in o) s[k] = o[k];
    return s;
}

var AMP_ANALOG = [
    { id: "tweed", label: "Tweed", blurb: "5E3: 12AY7, volume, tone, 12AX7, 2 x 6V6 cathode bias, 5Y3, no NFB, 1x12",
      toneRole: { bass: 0, mid: 0, treble: 1, presence: "none" }, stack: "tweed", spk: "jensen", s: 1, p: 1, cab: "tweed1x12", vref: 1.42, outDb: -7.6,
      chain: [null,
        aaT("12AY7", { B: 230, Rp: 100, Rk: 1.5, Ck: 25, Rs: 68, Cc: 0, direct: 1 }),
        { k: "gain", g: 0.00911, tune: 1 },
        { k: "tone", set: 0, gain: 1 },
        aaT("12AX7", { B: 220, Rp: 100, Rk: 1.5, Ck: 25, Rs: 60, rail: 0.85 }),
        { k: "pwr", tube: "6V6", pairs: 1, B: 360, Iq: 38, bias: "cathode", Rk: 0.25, Ck: 250, rect: "tube", Rsrc: 0.45, Cres: 16, hz: 60,
          Rscr: 0.47, tscr: 4, Ipre: 4, tpre: 40, gpi: 9, vsw: 55, Cc: 100, Rg: 220, RsPi: 60, Raa: 8, nfb: 0, fA: 3000, fB: 1000, pmax: 0 },
        null, null, null, null, null, null] },
    { id: "twin", label: "Twin", blurb: "Blackface: 12AX7, BF stack, volume, 12AX7, reverb mixer, 12AT7, 4 x 6L6 fixed bias, silicon, NFB, 2x12",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, stack: "blackface", spk: "c12k", s: 1, p: 2, cab: "twin2x12", vref: 0.313, outDb: 17.5,
      chain: [null,
        aaT("12AX7", { B: 270, Rp: 100, Rk: 1.5, Ck: 25, Rs: 68, Cc: 0, direct: 1 }),
        { k: "tone", set: 0, gain: 1 },
        { k: "gain", g: 0.00911, tune: 1 },
        aaT("12AX7", { B: 270, Rp: 100, Rk: 0.82, Ck: 25, Rs: 50 }),
        { k: "gain", g: 0.12, hp: 1.5 },
        aaT("12AT7", { B: 290, Rp: 100, Rk: 0.82, Ck: 25, Rs: 40 }),
        { k: "pwr", tube: "6L6", pairs: 2, B: 460, Iq: 30, bias: "fixed", rect: "ss", Rsrc: 0.035, Cres: 100, hz: 60,
          Rscr: 0.47, tscr: 3, Ipre: 6, tpre: 60, gpi: 1.2, vsw: 70, Cc: 100, Rg: 220, RsPi: 30, Raa: 2, nfb: 0.9, fA: 3500, fB: 1200, pmax: 0.8 },
        null, null, null, null] },
    { id: "ac30", label: "AC30", blurb: "Top Boost: 12AX7, cathode follower, Vox stack, volume, 12AX7, Cut, 4 x EL84 cathode bias, GZ34, no NFB, 2x12 Blue",
      toneRole: { bass: 1, mid: 0, treble: 1, presence: "cut" }, stack: "vox", spk: "blue", s: 1, p: 2, cab: "ac2x12", vref: 0.367, outDb: -19.2,
      chain: [null,
        aaT("12AX7", { B: 240, Rp: 220, Rk: 1.5, Ck: 25, Rs: 68, Cc: 0, direct: 1, rail: 0.85 }),
        aaT("12AX7", { B: 240, Rp: 0, Rk: 100, Ck: 0, Cc: 0, Rs: 220, out: "cathode", direct: 1 }),
        { k: "tone", set: 0, gain: 1 },
        { k: "gain", g: 0.381, tune: 1 },
        aaT("12AX7", { B: 240, Rp: 100, Rk: 1.5, Ck: 25, Rs: 40 }),
        { k: "gain", g: 1, lp: 0.12, cut: 1 },
        { k: "pwr", tube: "EL84", pairs: 2, B: 330, Iq: 42, bias: "cathode", Rk: 0.05, Ck: 50, rect: "tube", Rsrc: 0.18, Cres: 32, hz: 50,
          Rscr: 0.1, tscr: 3, Ipre: 6, tpre: 50, gpi: 4, vsw: 40, Cc: 47, Rg: 220, RsPi: 40, Raa: 3.5, nfb: 0, fA: 3000, fB: 1000, pmax: 0 },
        null, null, null, null] },
    { id: "plexi", label: "Plexi", blurb: "1959: 12AX7, volume, 12AX7, cathode follower, Marshall stack, LTP, 4 x EL34 fixed, GZ34, light NFB, 4x12 Greenback",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, stack: "marshall", spk: "greenback", s: 2, p: 2, cab: "gb4x12", vref: 0.348, outDb: -16.9,
      chain: [null,
        aaT("12AX7", { B: 280, Rp: 100, Rk: 0.82, Ck: 0.68, Rs: 68, Cc: 0, direct: 1 }),
        { k: "gain", g: 0.381, hp: 0.5, tune: 1 },
        aaT("12AX7", { B: 280, Rp: 100, Rk: 0.82, Ck: 0, Rs: 470 }),
        aaT("12AX7", { B: 290, Rp: 0, Rk: 100, Ck: 0, Cc: 0, Rs: 100, out: "cathode", direct: 1 }),
        { k: "tone", set: 0, gain: 1 },
        { k: "pwr", tube: "EL34", pairs: 2, B: 470, Iq: 36, bias: "fixed", rect: "tube", Rsrc: 0.15, Cres: 32, hz: 50,
          Rscr: 1, tscr: 4, Ipre: 6, tpre: 50, gpi: 22, vsw: 75, Cc: 22, Rg: 220, RsPi: 30, Raa: 1.7, nfb: 0.025, fA: 3500, fB: 1000, pmax: 1 },
        null, null, null, null, null] },
    { id: "jcm", label: "JCM800", blurb: "2203: 12AX7, preamp pot, cold clipper, 12AX7, cathode follower, stack, master, LTP, 2 x EL34, silicon, NFB, 4x12 G12T-75",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, stack: "marshall", spk: "g12t75", s: 2, p: 2, cab: "t75x4", vref: 0.5, outDb: -19.2,
      chain: [null,
        aaT("12AX7", { B: 280, Rp: 220, Rk: 2.7, Ck: 0.68, Rs: 68, Cc: 0, direct: 1 }),
        { k: "gain", g: 0.365, hp: 0.3, tuneA: 1 },
        aaT("12AX7", { B: 280, Rp: 100, Rk: 10, Ck: 0, Cc: 22, Rs: 100, gg: 2 }),
        aaT("12AX7", { B: 290, Rp: 100, Rk: 1.5, Ck: 0.68, Cc: 2.2, Rg: 470, Rs: 60 }),
        aaT("12AX7", { B: 300, Rp: 0, Rk: 100, Ck: 0, Cc: 0, Rs: 100, out: "cathode", direct: 1 }),
        { k: "tone", set: 0, gain: 1 },
        { k: "gain", g: 0.531, tune: 1 },
        { k: "pwr", tube: "EL34", pairs: 1, B: 460, Iq: 40, bias: "fixed", rect: "ss", Rsrc: 0.04, Cres: 50, hz: 50,
          Rscr: 1, tscr: 3, Ipre: 6, tpre: 50, gpi: 18, vsw: 75, Cc: 22, Rg: 220, RsPi: 30, Raa: 3.4, nfb: 0.04, fA: 3500, fB: 1000, pmax: 1 },
        null, null, null] },
    { id: "modern", label: "Modern", blurb: "5150 type: five 12AX7 stages (two cold, small caps), stack, master, LTP, 2 x 6L6, silicon, NFB, 4x12 V30",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, stack: "modern", spk: "v30", s: 2, p: 2, cab: "v30x4", vref: 0.5, outDb: -24.6,
      chain: [null,
        aaT("12AX7", { B: 300, Rp: 220, Rk: 1.5, Ck: 2.2, Rs: 68, Cc: 0, direct: 1 }),
        { k: "gain", g: 0.296, hp: 0.3, tuneA: 1 },
        aaT("12AX7", { B: 300, Rp: 100, Rk: 39, Ck: 0, Cc: 2.2, Rg: 470, Rs: 80 }),
        aaT("12AX7", { B: 300, Rp: 220, Rk: 1.5, Ck: 1, Cc: 2.2, Rg: 470, Rs: 60 }),
        aaT("12AX7", { B: 300, Rp: 100, Rk: 10, Ck: 0, Cc: 22, Rg: 470, Rs: 80 }),
        aaT("12AX7", { B: 300, Rp: 100, Rk: 1.5, Ck: 1, Cc: 22, Rg: 470, Rs: 60 }),
        { k: "tone", set: 0, gain: 1 },
        { k: "gain", g: 0.285, tune: 1 },
        { k: "pwr", tube: "6L6", pairs: 1, B: 470, Iq: 40, bias: "fixed", rect: "ss", Rsrc: 0.03, Cres: 80, hz: 60,
          Rscr: 0.47, tscr: 3, Ipre: 8, tpre: 50, gpi: 14, vsw: 75, Cc: 22, Rg: 220, RsPi: 30, Raa: 4, nfb: 0.06, fA: 3500, fB: 1000, pmax: 1 },
        null, null] },
    { id: "svt", label: "SVT", blurb: "Bass: 12AX7, stack, 12AX7, volume, 12AU7 driver, LTP, 6 x 6550, silicon, big iron, 8x10",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, stack: "ampeg", spk: "bass10", s: 2, p: 4, cab: "svt8x10", vref: 0.265, outDb: -13.5, bigIron: 1,
      chain: [null,
        aaT("12AX7", { B: 220, Rp: 100, Rk: 1.5, Ck: 25, Rs: 68, Cc: 0, direct: 1 }),
        { k: "tone", set: 0, gain: 1 },
        aaT("12AX7", { B: 220, Rp: 100, Rk: 1.5, Ck: 0, Rs: 50 }),
        { k: "gain", g: 0.0358, tune: 1 },
        aaT("12AU7", { B: 300, Rp: 47, Rk: 1, Ck: 25, Rs: 30 }),
        { k: "pwr", tube: "6550", pairs: 3, B: 650, Iq: 30, bias: "fixed", rect: "ss", Rsrc: 0.02, Cres: 300, hz: 60,
          Rscr: 0.47, tscr: 3, Ipre: 10, tpre: 50, gpi: 8, vsw: 90, Cc: 100, Rg: 100, RsPi: 15, Raa: 1.65, nfb: 0.05, fA: 3000, fB: 1000, pmax: 0.6 },
        null, null, null, null, null] },
    { id: "hiwatt", label: "Hiwatt", blurb: "DR103: 12AX7, Hiwatt stack, 12AX7, volume, 12AX7, LTP, 4 x KT88 (as 2 pairs), silicon, heavy NFB, 4x12 Fane",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, stack: "hiwatt", spk: "fane", s: 2, p: 2, cab: "fane4x12", vref: 0.1, outDb: 40.7,
      chain: [null,
        aaT("12AX7", { B: 280, Rp: 100, Rk: 1.5, Ck: 25, Rs: 68, Cc: 0, direct: 1 }),
        { k: "tone", set: 0, gain: 1 },
        aaT("12AX7", { B: 280, Rp: 100, Rk: 1.5, Ck: 0, Rs: 50 }),
        { k: "gain", g: 0.0005, tune: 1 },
        aaT("12AX7", { B: 290, Rp: 100, Rk: 1.5, Ck: 25, Rs: 40 }),
        { k: "pwr", tube: "KT88", pairs: 2, B: 520, Iq: 45, bias: "fixed", rect: "ss", Rsrc: 0.02, Cres: 150, hz: 50,
          Rscr: 0.47, tscr: 3, Ipre: 8, tpre: 60, gpi: 1.5, vsw: 90, Cc: 100, Rg: 220, RsPi: 30, Raa: 2.5, nfb: 1.0, fA: 4000, fB: 1500, pmax: 0.8 },
        null, null, null, null, null] },
    { id: "ts", label: "TS", blurb: "Tube Screamer (op-amp, 2 x 1N914 in the feedback) into the blackface Twin",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, vref: 0.5, outDb: -5.8, base: "twin", pedal: { k: "ts", zout: 10, drive: 0.5, tone: 0.5, level: 1.09, tune: "level" } },
    { id: "rat", label: "RAT", blurb: "RAT (LM308: slew-limited, gain-dependent filter, 2 x 1N914 to ground) into the Plexi",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "nfb" }, vref: 0.5, outDb: -19, base: "plexi", pedal: { k: "rat", zout: 25, dist: 0.55, filter: 0.35, level: 0.08, tune: "level" } },
    { id: "fuzz", label: "Fuzz", blurb: "Fuzz Face (germanium pair, loads the pickup, battery sag) into the AC30",
      toneRole: { bass: 1, mid: 0, treble: 1, presence: "cut" }, vref: 0.5, outDb: -20.6, base: "ac30", pedal: { k: "fuzz", zout: 120, fuzz: 0.8, level: 0.6, tune: "level" } },
    { id: "muff", label: "Muff", blurb: "Big Muff (two diode-feedback clip stages, mid-scoop tone) into the Tweed",
      toneRole: { bass: 0, mid: 0, treble: 1, presence: "none" }, vref: 0.5, outDb: -9.1, base: "tweed", pedal: { k: "muff", zout: 25, sustain: 0.7, tone: 0.5, level: 0.315, tune: "level" } },
    { id: "tape", label: "Tape", blurb: "Tape machine, 15 ips: record emphasis, Jiles-Atherton hysteresis, gap loss, head bump, wow and flutter",
      toneRole: { bass: 1, mid: 0, treble: 1, presence: "none" }, stack: "desk", spk: null, cab: null, vref: 0.095, outDb: 31.7, tune: "vref",
      chain: [null,
        { k: "tone", set: 0, gain: 6 },
        { k: "tape", drive: 1.6, ips: 15 },
        null, null, null, null, null, null, null, null, null] },
    { id: "opto", label: "Opto", blurb: "Optical leveler (T4 cell, programme-dependent release) with transformers and a 12AX7 / 12AU7 line amp",
      toneRole: { bass: 0, mid: 0, treble: 0, presence: "none" }, stack: null, spk: null, cab: null, vref: 1.71, outDb: -18.6, tune: "vref",
      chain: [{ k: "opto", peak: 0.5 },
        { k: "xfmr", lam: 0.4, rs: 0.6, lm: 20, scale: 1, out: 1 },
        aaT("12AX7", { B: 250, Rp: 100, Rk: 1.5, Ck: 25, Rs: 1, scale: 0.08 }),
        aaT("12AU7", { B: 250, Rp: 22, Rk: 1, Ck: 0, Rs: 40, scale: 0.5 }),
        { k: "xfmr", lam: 6, rs: 0.3, lm: 20, scale: 1, out: 1 },
        null, null, null, null, null, null, null] },
    { id: "desk", label: "Desk", blurb: "Console channel (input transformer, class-A discrete amp, Baxandall, output transformer) into a FET limiter",
      toneRole: { bass: 1, mid: 0, treble: 1, presence: "none" }, stack: "desk", spk: null, cab: null, vref: 0.0281, outDb: 20.8, tune: "vref",
      chain: [null,
        { k: "xfmr", lam: 0.25, rs: 0.6, lm: 10, scale: 1.2, out: 1 },
        { k: "opamp", gain: 6, gbw: 80000, sr: 8000, vr: 12, asym: 0.08, scale: 0.9 },
        { k: "tone", set: 0, gain: 6 },
        { k: "xfmr", lam: 0.35, rs: 0.3, lm: 15, scale: 1, out: 1 },
        null, null, null, null, null, null,
        { k: "fet", thr: -8, ratio: 8, knee: 6, atk: 0.4, rel: 300, dist: 0.25, makeup: 1.6 }] },
    { id: "jc120", label: "JC120", blurb: "Solid state: op-amp preamp, stack, volume, op-amp, rail-clipping power amp with crossover, voltage drive into 2x12",
      toneRole: { bass: 1, mid: 1, treble: 1, presence: "none" }, stack: "jc", spk: "jc", s: 1, p: 2, cab: "jc2x12", vref: 0.0656, outDb: 36.7, solid: 1,
      chain: [null,
        { k: "opamp", gain: 8, gbw: 1000000, sr: 500, vr: 13, asym: 0, scale: 1 },
        { k: "tone", set: 0, gain: 1 },
        { k: "gain", g: 0.0316, tune: 1 },
        { k: "opamp", gain: 12, gbw: 1000000, sr: 500, vr: 13, asym: 0.02, scale: 1 },
        { k: "ss", gain: 6, vr: 30, vx: 0.6, cxa: 0.25, rout: 0.05 },
        null, null, null, null, null, null] }
];

/** The recipe with a pedal resolved: the base amp's chain with the pedal in front (slot 1, the rest shifted). @param {number} idx */
function aaRecipe(idx) {
    var r = AMP_ANALOG[Math.max(0, Math.min(AMP_ANALOG.length - 1, Math.round(idx)))];
    if (!r.base) return r;
    var b = null;
    for (var i = 0; i < AMP_ANALOG.length; i++) if (AMP_ANALOG[i].id === r.base) b = AMP_ANALOG[i];
    var out = {};
    for (var k in b) out[k] = b[k];
    for (k in r) if (k !== "base" && k !== "pedal") out[k] = r[k];
    var ch = b.chain.slice();
    ch.splice(1, 0, r.pedal);
    // the amp's first stage is driven by the pedal's output (its volume pot), not by the pickup: that source
    // impedance limits the grid current, so how hard the pedal can block the input tube
    for (i = 2; i < ch.length; i++) {
        if (ch[i] && ch[i].k === "triode") {
            var t1 = {};
            for (var kk in ch[i]) t1[kk] = ch[i][kk];
            t1.Rs = 68 + (r.pedal.zout || 0);
            ch[i] = t1;
            break;
        }
    }
    while (ch.length > AA_NSLOT) {
        var last = -1;
        for (i = AA_NSLOT - 2; i >= 1; i--) if (ch[i] === null) { last = i; break; }
        if (last < 0) break;
        ch.splice(last, 1);
    }
    if (ch.length > AA_NSLOT) ch.length = AA_NSLOT;
    out.chain = ch;
    return out;
}

// ---------------------------------------------------------------------------------------------
// Circuit maths in JS (the same equations as the gen) for operating points.

/** Koren triode plate current in mA. */
function aaKorenT(c, vgk, vpk) {
    var vp = Math.max(vpk, 0.001), sq = Math.sqrt(c[4] + vp * vp), u = c[3] * (1 / c[0] + vgk / sq);
    var sp = u < 30 ? Math.log(1 + Math.exp(u)) : u;
    var ee = vp / c[3] * sp;
    return ee > 1e-7 ? 2000 * Math.exp(c[1] * Math.log(ee)) / c[2] : 0;
}
/** Koren pentode plate current in mA (and the base current for the screen). */
function aaKorenP(c, vgk, vak, vs2) {
    var vq = Math.max(vs2, 1), u = c[3] * (1 / c[0] + vgk / vq);
    var sp = u < 30 ? Math.log(1 + Math.exp(u)) : u;
    var ee = vq / c[3] * sp;
    var bs = ee > 1e-7 ? 2000 * Math.exp(c[1] * Math.log(ee)) / c[2] : 0;
    return { ip: bs * Math.atan2(Math.max(vak, 0), c[4]), bs: bs };
}
/** Bisection on a monotone function f (f(lo) > 0 > f(hi) or the reverse). */
function aaBisect(f, lo, hi) {
    var flo = f(lo);
    for (var i = 0; i < 80; i++) {
        var m = 0.5 * (lo + hi), fm = f(m);
        if ((fm > 0) === (flo > 0)) { lo = m; flo = fm; } else hi = m;
    }
    return 0.5 * (lo + hi);
}
/** DC operating point of a triode stage: grid at vgdc. */
function aaTriodeOP(c, B, Rp, Rk, vgdc) {
    var ip = aaBisect(function (i) { return i - aaKorenT(c, vgdc - Rk * i, B - (Rp + Rk) * i); }, 0, B / (Rp + Rk + 0.001));
    return { ip: ip, vk: Rk * ip, vp: B - Rp * ip };
}

// ---------------------------------------------------------------------------------------------
// Tone stacks: nodal analysis with polynomial admittances (s domain), exact transfer function, factored
// into a second- and a first-order section, bilinear transform at the 2x rate.

function aaPolyAdd(a, b) { var n = Math.max(a.length, b.length), o = []; for (var i = 0; i < n; i++) o.push((a[i] || 0) + (b[i] || 0)); return o; }
function aaPolyMul(a, b) { var o = []; for (var i = 0; i < a.length + b.length - 1; i++) o.push(0); for (i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) o[i + j] += a[i] * b[j]; return o; }
function aaPolyScale(a, k) { return a.map(function (v) { return v * k; }); }
function aaDet(M) {
    var n = M.length;
    if (n === 1) return M[0][0];
    var d = [0];
    for (var c = 0; c < n; c++) {
        var sub = [];
        for (var r = 1; r < n; r++) sub.push(M[r].filter(function (_, k) { return k !== c; }));
        d = aaPolyAdd(d, aaPolyScale(aaPolyMul(M[0][c], aaDet(sub)), c % 2 ? -1 : 1));
    }
    return d;
}

/** Netlist of a stack at knob positions (0..1). Nodes: "in" (ideal source), "g" (ground), "out". R in Ohm, C in F. */
function aaStackNet(st, bass, mid, treble) {
    var E = [], k = 1000, n = 1e-9, lo = 10;
    var logT = function (x) { return (Math.pow(10, 2 * x) - 1) / 99; };
    E.push(["R", "in", "a", Math.max(lo, st.rs * k)]);
    if (st.net === "tmb") {
        var t = treble, l = logT(bass), m = st.fixmid ? 0.5 : mid;
        E.push(["C", "a", "t", st.c1 * n], ["R", "a", "b", st.r1 * k], ["C", "b", "c", st.c2 * n], ["C", "b", "d", st.c3 * n]);
        E.push(["R", "t", "out", Math.max(lo, (1 - t) * st.rt * k)], ["R", "out", "c", Math.max(lo, t * st.rt * k)]);
        E.push(["R", "c", "d", Math.max(lo, l * st.rb * k)], ["R", "d", "g", Math.max(lo, m * st.rm * k)]);
        E.push(["R", "out", "g", 1e6]);
    } else if (st.net === "tweed") {
        E.push(["R", "a", "out", lo], ["R", "out", "g", 1e6], ["C", "out", "w", st.ct * n], ["R", "w", "g", Math.max(lo, (1 - treble) * st.rt * k + 1000)]);
    } else {
        var bb = bass, tt = treble;
        E.push(["R", "a", "b1", st.r1 * k], ["R", "b1", "bw", Math.max(lo, (1 - bb) * st.rb * k)], ["R", "bw", "b2", Math.max(lo, bb * st.rb * k)],
            ["C", "b1", "bw", st.cb1 * n], ["C", "bw", "b2", st.cb2 * n], ["R", "b2", "g", st.r2 * k],
            ["C", "a", "t1", st.ct1 * n], ["R", "t1", "out", Math.max(lo, (1 - tt) * st.rt * k)], ["R", "out", "t2", Math.max(lo, tt * st.rt * k)],
            ["R", "t2", "g", st.rt2 * k], ["R", "bw", "out", st.r3 * k], ["R", "out", "g", 1e6]);
    }
    return E;
}

/** Exact H(s) = N(s) / D(s) of a netlist (coefficients in rising powers of s). */
function aaNetTF(E) {
    var names = {}, list = [];
    E.forEach(function (e) { [e[1], e[2]].forEach(function (nm) { if (nm !== "in" && nm !== "g" && !(nm in names)) { names[nm] = list.length; list.push(nm); } }); });
    var N = list.length, Y = [], bIn = [];
    for (var i = 0; i < N; i++) { Y.push([]); bIn.push([0]); for (var j = 0; j < N; j++) Y[i].push([0]); }
    E.forEach(function (e) {
        var y = e[0] === "R" ? [1 / e[3]] : [0, e[3]];
        var a = e[1], b = e[2];
        var ia = a in names ? names[a] : -1, ib = b in names ? names[b] : -1;
        if (ia >= 0) Y[ia][ia] = aaPolyAdd(Y[ia][ia], y);
        if (ib >= 0) Y[ib][ib] = aaPolyAdd(Y[ib][ib], y);
        if (ia >= 0 && ib >= 0) { Y[ia][ib] = aaPolyAdd(Y[ia][ib], aaPolyScale(y, -1)); Y[ib][ia] = aaPolyAdd(Y[ib][ia], aaPolyScale(y, -1)); }
        if (a === "in" && ib >= 0) bIn[ib] = aaPolyAdd(bIn[ib], y);
        if (b === "in" && ia >= 0) bIn[ia] = aaPolyAdd(bIn[ia], y);
    });
    var o = names.out, Yo = Y.map(function (row, r) { return row.map(function (c, k) { return k === o ? bIn[r] : c; }); });
    var num = aaDet(Yo), den = aaDet(Y);
    var sc = 1 / den[0];
    num = aaPolyScale(num, sc); den = aaPolyScale(den, sc);
    var trim = function (p) { var mx = 0, i; for (i = 0; i < p.length; i++) mx = Math.max(mx, Math.abs(p[i]) * Math.pow(1e4, i)); while (p.length > 1 && Math.abs(p[p.length - 1]) * Math.pow(1e4, p.length - 1) < mx * 1e-12) p.pop(); return p; };
    return { num: trim(num), den: trim(den) };
}

/** Roots of a real polynomial (rising powers), Durand-Kerner. */
function aaRoots(p) {
    var n = p.length - 1, out = [];
    if (n < 1) return out;
    var a = p.map(function (v) { return v / p[n]; });
    var z = [];
    for (var i = 0; i < n; i++) z.push([0.4 * Math.cos(2 * Math.PI * i / n + 0.4), 0.9 * Math.sin(2 * Math.PI * i / n + 0.4)]);
    var sc = Math.pow(Math.abs(a[0]) || 1, 1 / n);
    z = z.map(function (c) { return [c[0] * sc, c[1] * sc]; });
    for (var it = 0; it < 500; it++) {
        for (i = 0; i < n; i++) {
            var pr = 1, pi = 0, vr = 1, vi = 0;
            for (var k = n - 1; k >= 0; k--) { var t = vr * z[i][0] - vi * z[i][1] + a[k]; vi = vr * z[i][1] + vi * z[i][0]; vr = t; }
            for (var j = 0; j < n; j++) {
                if (j === i) continue;
                var dr = z[i][0] - z[j][0], di = z[i][1] - z[j][1], q = pr * dr - pi * di; pi = pr * di + pi * dr; pr = q;
            }
            var m2 = pr * pr + pi * pi || 1e-300;
            z[i] = [z[i][0] - (vr * pr + vi * pi) / m2, z[i][1] - (vi * pr - vr * pi) / m2];
        }
    }
    return z;
}

/** Evaluate H(s) at jw (complex). */
function aaEvalS(p, w) { var r = 0, i = 0, pr = 1, pi = 0; for (var k = 0; k < p.length; k++) { r += p[k] * pr; i += p[k] * pi; var t = -pi * w; pi = pr * w; pr = t; } return [r, i]; }
function aaCdiv(a, b) { var m = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / m, (a[1] * b[0] - a[0] * b[1]) / m]; }

/** Bilinear of an analog section given by its zeros / poles (complex, s domain), K = 2 fs. Returns [b..], [1, a..]. */
function aaBilinear(zeros, poles, order, K) {
    var nb = [1], na = [1];
    var fac = function (r) {   // (s - r) -> K (1 - z^-1) - r (1 + z^-1) = (K - r) - (K + r) z^-1 ; complex r
        return [[K - r[0], -r[1]], [-K - r[0], -r[1]]];
    };
    var cmul = function (A, B) { var o = []; for (var i = 0; i < A.length + B.length - 1; i++) o.push([0, 0]); for (i = 0; i < A.length; i++) for (var j = 0; j < B.length; j++) { o[i + j][0] += A[i][0] * B[j][0] - A[i][1] * B[j][1]; o[i + j][1] += A[i][0] * B[j][1] + A[i][1] * B[j][0]; } return o; };
    var N = [[1, 0]], D = [[1, 0]];
    for (var i = 0; i < order; i++) {
        N = cmul(N, i < zeros.length ? fac(zeros[i]) : [[1, 0], [1, 0]]);   // zero at infinity -> z = -1
        D = cmul(D, i < poles.length ? fac(poles[i]) : [[1, 0], [1, 0]]);
    }
    var d0 = D[0][0];
    return { b: N.map(function (c) { return c[0] / d0; }), a: D.map(function (c) { return c[0] / d0; }) };
}

/** Tone-stack coefficients for a recipe at the knob values (0..10) and the gen's 2x rate:
 *  [b0, b1, b2, a1, a2, c0, c1, d1, 0] (biquad then first-order section, gain matched at 1 kHz). */
function aaToneCoefs(stackName, bass, mid, treble, sr) {
    var st = AA_STACKS[stackName];
    if (!st) return [1, 0, 0, 0, 0, 1, 0, 0, 0];
    var tf = aaNetTF(aaStackNet(st, clamp01(bass / 10), clamp01(mid / 10), clamp01(treble / 10)));
    var fs = 2 * sr, K = 2 * fs;
    var zr = aaRoots(tf.num), pr = aaRoots(tf.den);
    var realIdx = function (rs) { var best = -1, bi = Infinity; for (var i = 0; i < rs.length; i++) if (Math.abs(rs[i][1]) < bi) { bi = Math.abs(rs[i][1]); best = i; } return best; };
    pr = pr.map(function (r) { return [r[0], Math.abs(r[1]) < 1e-6 * Math.abs(r[0]) ? 0 : r[1]]; });
    zr = zr.map(function (r) { return [r[0], Math.abs(r[1]) < 1e-6 * (Math.abs(r[0]) + 1) ? 0 : r[1]]; });
    var p1 = [], p2 = pr.slice(), z1 = [], z2 = zr.slice();
    if (pr.length === 3 || pr.length === 1) { var ip = realIdx(p2); p1 = p2.splice(ip, 1); }
    if (zr.length === 3 || (zr.length === 1 && p1.length)) { var iz = realIdx(z2); z1 = z2.splice(iz, 1); }
    if (z2.length > 2) z2 = z2.slice(0, 2);
    var s2 = aaBilinear(z2, p2, 2, K), s1 = aaBilinear(z1, p1, 1, K);
    // overall gain: match H at 1 kHz (bilinear-warped point)
    var wa = 2 * Math.PI * 1000, wd = 2 * Math.atan(wa / K);
    var ha = aaCdiv(aaEvalS(tf.num, wa), aaEvalS(tf.den, wa));
    var hz = function (b, a) { var nr = 0, ni = 0, dr = 0, di = 0; for (var k = 0; k < b.length; k++) { nr += b[k] * Math.cos(-k * wd); ni += b[k] * Math.sin(-k * wd); } for (k = 0; k < a.length; k++) { dr += a[k] * Math.cos(-k * wd); di += a[k] * Math.sin(-k * wd); } return aaCdiv([nr, ni], [dr, di]); };
    var h2 = hz(s2.b, s2.a), h1 = hz(s1.b, s1.a);
    var hd = [h2[0] * h1[0] - h2[1] * h1[1], h2[0] * h1[1] + h2[1] * h1[0]];
    var g = Math.hypot(ha[0], ha[1]) / Math.max(1e-30, Math.hypot(hd[0], hd[1]));
    var b = s2.b.map(function (v) { return v * g; });
    return [b[0], b[1] || 0, b[2] || 0, s2.a[1] || 0, s2.a[2] || 0, s1.b[0], s1.b[1] || 0, s1.a[1] || 0, 0];
}
function clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)); }

/** Analog magnitude of a stack in dB at f (the test oracle). */
function aaStackDb(stackName, bass, mid, treble, f) {
    var tf = aaNetTF(aaStackNet(AA_STACKS[stackName], clamp01(bass / 10), clamp01(mid / 10), clamp01(treble / 10)));
    var h = aaCdiv(aaEvalS(tf.num, 2 * Math.PI * f), aaEvalS(tf.den, 2 * Math.PI * f));
    return 20 * Math.log10(Math.hypot(h[0], h[1]));
}
/** Digital magnitude of a coefficient set in dB at f (rate fs). */
function aaToneDb(c, f, fs) {
    var w = 2 * Math.PI * f / fs;
    var resp = function (b, a) { var nr = 0, ni = 0, dr = 0, di = 0; for (var k = 0; k < b.length; k++) { nr += b[k] * Math.cos(-k * w); ni += b[k] * Math.sin(-k * w); } for (k = 0; k < a.length; k++) { dr += a[k] * Math.cos(-k * w); di += a[k] * Math.sin(-k * w); } return Math.hypot(nr, ni) / Math.hypot(dr, di); };
    return 20 * Math.log10(resp([c[0], c[1], c[2]], [1, c[3], c[4]]) * resp([c[5], c[6]], [1, c[7]]));
}

// ---------------------------------------------------------------------------------------------
// Halfband (2x) and cab IR.

function aaBesselI0(x) { var s = 1, t = 1; for (var k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; }
/** The 24 even taps h[0], h[2], .. h[46] of a 47-tap Kaiser (beta 7.5) halfband; h[23] = 0.5 is implicit. */
function aaHalfband() {
    var N = 47, M = 23, beta = 7.5, h = [];
    for (var n = 0; n < N; n++) {
        var k = n - M, s = k === 0 ? 0.5 : Math.sin(Math.PI * k / 2) / (Math.PI * k);
        var w = aaBesselI0(beta * Math.sqrt(1 - Math.pow((n - M) / M, 2))) / aaBesselI0(beta);
        h.push(s * w);
    }
    var sum = 0;
    for (n = 0; n < N; n++) sum += h[n];
    var even = [];
    for (n = 0; n < N; n += 2) even.push(h[n] / sum);
    return even;
}

function aaRng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Cab impulse response at sr (<= 512 taps, unit gain at 1 kHz). */
function aaCabIr(name, sr) {
    var c = AA_CABS[name];
    var L = Math.min(AA_IRMAX, Math.round(sr * 0.0107));
    var x = new Float64Array(L);
    x[0] = 1;
    var bq = [ampBiquad("lp", c.lp[0], c.lp[1], 0, sr)];
    if (c.lp2) bq.push(ampBiquad("lp", c.lp2[0], c.lp2[1], 0, sr));
    for (var i = 0; i < c.peaks.length; i++) bq.push(ampBiquad("pk", c.peaks[i][0], c.peaks[i][1], c.peaks[i][2], sr));
    var run = function (sig) {
        var y = Float64Array.from(sig);
        for (var q = 0; q < bq.length; q++) {
            var b = bq[q], z1 = 0, z2 = 0;
            for (var n = 0; n < y.length; n++) { var o = b[0] * y[n] + z1; z1 = b[1] * y[n] - b[3] * o + z2; z2 = b[2] * y[n] - b[4] * o; y[n] = o; }
        }
        return y;
    };
    var base = run(x), ir = Float64Array.from(base);
    var add = function (ms, g) { var d = Math.round(ms * sr / 1000), lp = 0, k = 1 - Math.exp(-2 * Math.PI * 3000 / sr); for (var n = 0; n + d < L; n++) { lp += k * (base[n] - lp); ir[n + d] += g * lp; } };
    for (i = 0; i < c.refl.length; i++) add(c.refl[i][0], c.refl[i][1]);
    if (c.mic) { var dm = Math.round(c.mic[0] * sr / 1000); for (var n = 0; n + dm < L; n++) ir[n + dm] -= c.mic[1] * base[n]; }
    var rnd = aaRng(c.seed), nz = new Float64Array(L);
    for (n = 0; n < L; n++) nz[n] = (rnd() * 2 - 1) * Math.exp(-n / (0.0015 * sr));
    nz = run(nz);
    for (n = 0; n < L; n++) ir[n] += c.tail * nz[n];
    for (n = Math.floor(L * 0.7); n < L; n++) ir[n] *= 0.5 + 0.5 * Math.cos(Math.PI * (n - L * 0.7) / (L * 0.3));
    var w = 2 * Math.PI * 1000 / sr, re = 0, im = 0;
    for (n = 0; n < L; n++) { re += ir[n] * Math.cos(w * n); im -= ir[n] * Math.sin(w * n); }
    var g = 1 / Math.max(1e-9, Math.hypot(re, im));
    return Array.from(ir, function (v) { return v * g; });
}

// ---------------------------------------------------------------------------------------------
// The bank: one table per (recipe, sample rate, speaker on/off).

function aaPutTriode(t, cb, s, prevDc) {
    var c = AA_TRIODES[s.tube];
    var vgdc = s.direct ? prevDc : (s.vg0 || 0);
    var op = aaTriodeOP(c, s.B, s.Rp, s.Rk, vgdc);
    var rsr = s.direct ? s.Rs : (s.Rs * s.Rg / (s.Rs + s.Rg));
    var f = [AA_KIND.TRIODE, c[0], c[1], c[2], c[3], c[4], s.B, s.Rp, s.Rk, s.Ck || 0, s.direct ? 0 : s.Cc / 1000, s.Rg, s.Rs, vgdc,
        s.out === "cathode" ? 1 : 0, s.out === "cathode" ? op.vk : op.vp, 0.0000016, 0.0000017, s.scale, s.rail, rsr, s.gg || 1, op.ip];
    for (var i = 0; i < f.length; i++) t[cb + i] = f[i];
    // small-signal stage gain at the operating point (the Miller estimate the gen starts from)
    var dv = 0.001, vgk0 = vgdc - op.vk, vpk0 = op.vp - op.vk;
    var gm = (aaKorenT(c, vgk0 + dv, vpk0) - aaKorenT(c, vgk0 - dv, vpk0)) / (2 * dv);
    var gp = (aaKorenT(c, vgk0, vpk0 + dv) - aaKorenT(c, vgk0, vpk0 - dv)) / (2 * dv);
    var rke = s.Ck ? 0 : s.Rk;
    return { ip: op.ip, vk: op.vk, vg: vgdc, vc: s.direct ? 0 : -vgdc, gain: Math.abs(gm * s.Rp / (1 + gp * s.Rp + gm * rke)) || 1, dc: s.out === "cathode" ? op.vk : op.vp };
}

/** DC operating point of the Fuzz Face (the same equations as ac_fuzz with the caps open). f = the slot fields. */
function aaFuzzOP(f) {
    var rf = f[4], is1 = f[5], a = f[6], bt1 = f[7], rc1 = f[8], is2 = f[9], rc2 = f[11], re2 = f[12], rpot = f[14], vnom = f[15], rbat = f[16], icbo = f[17];
    var soft = function (v) { var z = v / 0.05; return z > 30 ? v : 0.05 * Math.log(1 + Math.exp(Math.max(z, -40))); };
    var sol = function (vb1, vcc) {
        var ib1 = is1 * (Math.exp(Math.min(vb1, 0.7) / a) - 1), ic1 = bt1 * ib1 + icbo, vc1 = soft(vcc - rc1 * ic1);
        var vbe = aaBisect(function (v) { return v - vc1 + (re2 + rpot) * is2 * (Math.exp(Math.min(v, 0.7) / a) - 1); }, -1, 0.7);
        var ic2 = is2 * (Math.exp(Math.min(vbe, 0.7) / a) - 1), ve2 = ic2 * (re2 + rpot);
        var vc2 = vcc - rc2 * ic2, zq = (vc2 - ve2) / 0.05;
        vc2 = zq > 30 ? vc2 : ve2 + 0.05 * Math.log(1 + Math.exp(Math.max(zq, -40)));
        return { vb1: vb1, ib1: ib1, ic1: ic1, vbe: vbe, ic2: ic2, vc2: vc2, vcc: vcc };
    };
    var vcc = vnom, r = null;
    for (var it = 0; it < 20; it++) {
        var vb1 = aaBisect(function (v) { var q = sol(v, vcc); return (q.ic2 * (re2 + rpot) - v) / rf - q.ib1; }, -1, 0.6);
        r = sol(vb1, vcc);
        vcc = vnom - rbat * (r.ic1 + r.ic2);
    }
    return r;
}

/** Rail of a power stage settled at idle: returns the mains peak that makes it settle at B, and the settled value. */
function aaRailSolve(s, Iidle, sr) {
    var hh = 500 / sr, vd = s.rect === "tube" ? 20 + 60 * s.Rsrc : 1.4;
    var settle = function (vpk) {
        var vb = s.B, ph = 0, acc = 0, n = Math.round(0.4 * 2 * sr), cnt = 0;
        for (var i = 0; i < n; i++) {
            ph += s.hz * hh * 0.001; if (ph >= 1) ph -= 1;
            var vr = vpk * Math.abs(Math.sin(2 * Math.PI * ph));
            vb += hh * (Math.max(0, vr - vd - vb) / s.Rsrc - Iidle) / s.Cres;
            if (i > n / 2) { acc += vb; cnt++; }
        }
        return { avg: acc / cnt, vb: vb, ph: ph };
    };
    var vpk = aaBisect(function (v) { return settle(v).avg - s.B; }, s.B, s.B * 1.6 + 100);
    var r = settle(vpk);
    return { vpk: vpk, vd: vd, vb: r.vb, ph: r.ph };
}

function aaPutPwr(t, cb, s, init, so, sr) {
    var c = AA_PENTODES[s.tube];
    var np = s.pairs;
    var vbias = 0, vk0 = 0, iq = s.Iq;
    if (s.bias === "fixed") {
        vbias = aaBisect(function (v) { return aaKorenP(c, v, s.B, s.B).ip - s.Iq; }, -150, 0);
    } else {
        vk0 = aaBisect(function (v) { return 2 * np * aaKorenP(c, -v, s.B - v, s.B - v).ip * s.Rk - v; }, 0, 100);
        iq = aaKorenP(c, -vk0, s.B - vk0, s.B - vk0).ip;
    }
    var bsq = aaKorenP(c, s.bias === "fixed" ? vbias : -vk0, s.B - vk0, s.B - vk0).bs;
    var ig2 = 2 * bsq * c[2] / c[5];
    var Iidle = 2 * np * iq + np * ig2 + s.Ipre;
    var rail = aaRailSolve(s, Iidle, sr);
    var tA = 1000 / (2 * Math.PI * s.fA), tB = 1000 / (2 * Math.PI * s.fB);
    var f = [AA_KIND.PWR, c[0], c[1], c[2], c[3], c[4], c[2] / c[5], np, rail.vpk, rail.vd, s.Rsrc, s.Cres, s.hz, s.Rscr, s.tscr,
        s.bias === "fixed" ? 0 : 1, s.bias === "fixed" ? vbias : s.Rk, s.Ck || 0, s.gpi, s.vsw, s.Cc / 1000, s.Rg, s.RsPi, vk0,
        s.gpi * s.nfb, tA, tB, s.pmax, s.Ipre, s.tpre, s.B, 1];
    for (var i = 0; i < f.length; i++) t[cb + i] = f[i];
    var gref = s.bias === "fixed" ? vbias : 0;
    init.set(0, -gref); init.set(1, gref); init.set(2, -gref); init.set(3, gref);
    init.set(4, iq); init.set(5, iq); init.set(6, vk0); init.set(7, ig2);
    init.misc(320, rail.vb); init.misc(321, s.B); init.misc(339, s.B); init.misc(340, s.B); init.misc(322, rail.ph); init.misc(323, s.B); init.misc(326, 1);
    return { raa: s.Raa };
}

/** Pedal / studio stages (all in the 2x region except the compressors). */
function aaPutOther(t, cb, s, init, so, sr) {
    var K = AA_KIND, f;
    var tau = function (hz) { return 1000 / (2 * Math.PI * hz); };
    if (s.k === "ts") {
        var rf = 51 + 500 * s.drive;
        f = [K.TS, 4.7, 0.047, rf, 0.000051, 2.5e-6, 0.045, tau(1e6 / (1 + rf / 4.7)), tau(700 + 4000 * s.tone), s.level, 4.3];
    } else if (s.k === "rat") {
        var rd = 0.1 + 100 * s.dist;
        f = [K.RAT, rd, 0.047, 2.2, 0.56, 4.7, tau(1e6 / (1 + rd / 0.047) + 1500), 300, 4.3, 2.5e-6, 0.045, tau(1 / (2 * Math.PI * (1.5 + 100 * s.filter) * 3.3e-6)), s.level];
    } else if (s.k === "muff") {
        f = [K.MUFF, 8, 3, 20 + 80 * s.sustain, tau(150), tau(3000), 2.5e-6, 0.045, tau(450), tau(1100), s.tone, s.level];
    } else if (s.k === "fuzz") {
        f = [K.FUZZ, 2.5, 8, 2.2, 100, 0.012 / 70, 0.03, 70, 33, 0.012, 110, 8.67, 1.01 - s.fuzz, 20, Math.max(0.01, s.fuzz), 9, 0.12, 0.0005, s.level, 0, 200];
        var op = aaFuzzOP(f);
        init.set(1, -op.vb1); init.set(2, op.vb1); init.set(3, op.vbe); init.set(4, op.vc2); init.set(5, op.vcc);
        init.set(6, op.ic2 * f[14]); init.set(7, op.vc2); init.set(9, op.ic2 * (f[12] + f[14])); init.set(10, op.ic2);
    } else if (s.k === "tape") {
        var ips = s.ips, bump = ips >= 30 ? [42, 2] : ips >= 15 ? [65, 3] : [90, 4];
        var bb = ampBiquad("pk", bump[0], 1.1, bump[1], 2 * sr);
        f = [K.TAPE, s.drive, tau(2500), 1.2, 0.25, 0.32, 0.18, 0.04, tau(ips >= 30 ? 24000 : ips >= 15 ? 18000 : 12000), bb[0], bb[1], bb[2], bb[3], bb[4], 1.4,
            1.5, ips >= 30 ? 0.03 : ips >= 15 ? 0.05 : 0.09, ips >= 30 ? 0.006 : ips >= 15 ? 0.01 : 0.02];
        init.set(7, 12345);
        init.set(12, 350);
        init.set(13, 45);
    } else if (s.k === "opto") {
        f = [K.OPTO, 6 * s.peak + 1, 5, 50, 10, 60, 500, 6000, 0.45, 4, 0.67, 1.8, tau(120)];
    } else if (s.k === "fet") {
        f = [K.FET, s.thr, s.ratio, s.knee, s.atk, s.rel, s.makeup, s.dist, tau(80), 1];
    } else if (s.k === "opamp") {
        f = [K.OPAMP, s.gain, tau(s.gbw / s.gain), s.sr, s.vr, s.asym, s.scale, tau(10)];
    } else if (s.k === "xfmr") {
        f = [K.XFMR, s.rs, s.lm, s.lam, s.lam * 0.01, 0.2 / s.lm, s.scale, s.out, tau(40000)];
    } else if (s.k === "ss") {
        f = [K.SSPWR, s.gain, s.vr, s.vx, s.cxa, s.rout];
    } else if (s.k === "gain") {
        f = [K.GAIN, s.g, s.hp || 0, s.lp || 0, s.cut || 0];
    } else if (s.k === "tone") {
        f = [K.TONE, s.set, s.gain];
    } else {
        f = [0];
    }
    for (var i = 0; i < f.length; i++) t[cb + i] = f[i];
}

/** The table for recipe idx at sample rate sr, speaker on / off. Returns a Float64Array of AA_NW. */
function aaBank(idx, sr, speaker) { return aaBankOf(aaRecipe(idx), sr, speaker); }

/** The table of a recipe object (tests build single stages with it). */
function aaBankOf(r, sr, speaker) {
    var t = new Float64Array(AA_NW);
    var st0 = new Float64Array(AA_STATE);
    t[0] = 1; t[1] = r.vref; t[2] = Math.pow(10, (r.outDb || 0) / 20);
    var spk = r.spk && speaker ? 1 : 0;
    t[4] = spk;
    var prevDc = 0, raa = 8, outKind = 0;
    for (var k = 0; k < AA_NSLOT; k++) {
        var s = r.chain[k], cb = AA_SLOT + k * AA_STRIDE, so = k * AA_SSLOT;
        var init = { set: function (o, v) { st0[o] = v; }, misc: function (o, v) { st0[o] = v; } };
        if (!s) continue;
        if (s.k === "triode") {
            var tr = aaPutTriode(t, cb, s, prevDc);
            st0[so] = tr.vc; st0[so + 1] = tr.vk; st0[so + 2] = tr.ip; st0[so + 6] = tr.ip; st0[so + 4] = tr.vg; st0[so + 5] = tr.gain;
            prevDc = tr.dc;
        } else if (s.k === "pwr") {
            raa = aaPutPwr(t, cb, s, { set: function (o, v) { st0[so + o] = v; }, misc: function (o, v) { st0[o] = v; } }, so, sr).raa;
            outKind = 1;
        } else {
            aaPutOther(t, cb, s, { set: function (o, v) { st0[so + o] = v; } }, so, sr);
            if (s.k === "ss") outKind = 2;
        }
    }
    st0[326] = st0[326] || 1;
    t[5] = outKind;
    // output network
    var hs = 1 / (2 * sr);
    if (outKind) {
        var d = AA_SPEAKERS[r.spk] || AA_SPEAKERS.c12k, ns = r.s || 1, npar = r.p || 1;
        var w0 = 2 * Math.PI * d.fs, kms = d.mms * w0 * w0, rms = w0 * d.mms / d.qms, bl = Math.sqrt(w0 * d.mms * d.re / d.qes);
        var re = d.re * ns / npar, le = d.le * ns / npar, zl = d.z * ns / npar;
        var nturn = Math.sqrt(raa * 1000 / zl);
        var lams = r.bigIron ? 0.9 : 0.25, lm = (r.bigIron ? 60 : 25) / (nturn * nturn);
        var o = [nturn, lm, lams, lams * 0.004, 0.3 / lm, zl, re, le, bl * ns, d.mms * ns * npar, rms * ns * npar, kms * ns * npar,
            1 / (d.xmax * d.xmax) * 0.8, 0.4 / (d.xmax * d.xmax), 0.08 / d.xmax, 1 / (bl * ns / (d.mms * ns * npar)) * 0.25, 0.05, 1 / (4 * Math.sqrt(zl)), 0.3];
        if (outKind === 2) { o[0] = 1; }
        for (var i = 0; i < o.length; i++) t[AA_OUT + i] = o[i];
        st0[AA_SOUT + 0] = 0;
        st0[333] = spk ? re + 0.3 + le / hs : zl;
        st0[334] = 0;
    }
    // halfband taps
    var hb = aaHalfband();
    for (i = 0; i < hb.length; i++) t[AA_HB + i] = hb[i];
    // cab IR
    if (spk && r.cab) {
        var ir = aaCabIr(r.cab, sr);
        t[3] = ir.length;
        for (i = 0; i < ir.length; i++) t[AA_IR + i] = ir[i];
    }
    for (i = 0; i < AA_STATE; i++) t[AA_INIT + i] = st0[i];
    return t;
}

/** The engine's ---ampcfa content for the knobs: tone-stack set 0 at 0..8, presence (0..1) at 18. */
function aaToneTable(idx, p, sr) {
    var r = typeof idx === "object" ? idx : aaRecipe(idx);
    var out = [];
    var c = aaToneCoefs(r.stack, r.toneRole.bass ? p.bass : 5, r.toneRole.mid ? p.mid : 5, r.toneRole.treble ? p.treble : 5, sr);
    for (var i = 0; i < 9; i++) out.push(c[i]);
    for (i = 0; i < 9; i++) out.push(i === 0 || i === 5 ? 1 : 0);
    out.push(clamp01(Number(p.presence) / 10));
    out.push(0);
    return out;
}

/** Face info: label, blurb, the blocks of the chain (name, kind, slots) for the signal-flow display. */
function aaInfo(idx) {
    var r = aaRecipe(idx), blocks = [], names = { triode: "TUBE", tone: "TONE", gain: "", pwr: "POWER", ss: "POWER", ts: "TS", rat: "RAT", muff: "MUFF", fuzz: "FUZZ", tape: "TAPE", opto: "OPTO", fet: "FET", opamp: "AMP", xfmr: "XFMR" };
    for (var k = 0; k < AA_NSLOT; k++) {
        var s = r.chain[k];
        if (!s || s.k === "gain") continue;
        var nm = names[s.k];
        var last = blocks[blocks.length - 1];
        if (last && last.kind === s.k && s.k === "triode") { last.slots.push(k); last.n++; continue; }
        blocks.push({ name: nm, kind: s.k, slots: [k], n: 1 });
    }
    if (r.spk) blocks.push({ name: "SPEAKER", kind: "spk", slots: [], n: 1 });
    return { id: r.id, label: r.label, blurb: r.blurb, blocks: blocks, toneRole: r.toneRole, hasSpeaker: !!r.spk };
}

// ---------------------------------------------------------------------------------------------
// Gen code: the circuit functions (src/amp_analog_core.genexpr) in front of the shared template
// (src/amp_core.genexpr, both without comments), with the template's hooks filled for the analog engine.
// The table is copied from buffer `w` (---ampa) into Data wd; the post biquads start at 4 (the tone stack
// runs inside the chain); the dry path waits for the oversampler's 23-sample delay.
var AA_GEN_DECL = "Data wd(" + AA_NW + ");\nData anSt(" + 2 * AA_STATE + ");\nData anRq(32);\nData anHq(384);\nData anCr(2048);\nData anTq(4096);\nData anFt(12008);\nData lact(48);\nDelay anDl(64);\nDelay anDr(64);";
var AA_GEN_BODY = "ac_sample(nib, nob, nch, ninit, wd, cfd, anSt, anRq, anHq, anCr, anTq, anFt, lact, samplerate);\nnsat = peek(lact, 41);";
var AA_GEN_DRY = "anDl.write(in1);\nanDr.write(in2);\ndry1 = anDl.read(23);\ndry2 = anDr.read(23);";

/** @param {string} template the template without comments @param {string} src the circuit functions without comments */
function aaGenCode(template, src) {
    return src + "\n" + ampFillHooks(template, { DECL: AA_GEN_DECL, LOCALS: "", BODY: AA_GEN_BODY, DRY: AA_GEN_DRY, Q0: "q0 = 4;" })
        .split("@@SLEEP@@").join(String(AA_SLEEP)).split("@@NLAYERS@@").join("48").split("@@RF@@").join(String(AA_RF))
        .split("@@NW@@").join(String(AA_NW));
}

var aaNodeModule = (typeof module !== "undefined") ? module : undefined;
if (aaNodeModule && aaNodeModule.exports) aaNodeModule.exports = {
    AA_NW: AA_NW, AA_BANK: AA_BANK, AA_SLOT: AA_SLOT, AA_STRIDE: AA_STRIDE, AA_NSLOT: AA_NSLOT, AA_OUT: AA_OUT, AA_HB: AA_HB, AA_IR: AA_IR,
    AA_IRMAX: AA_IRMAX, AA_INIT: AA_INIT, AA_STATE: AA_STATE, AA_SSLOT: AA_SSLOT, AA_SOUT: AA_SOUT, AA_SMISC: AA_SMISC, AA_RF: AA_RF,
    AA_SLEEP: AA_SLEEP, AA_KIND: AA_KIND, AA_TONE_SET: AA_TONE_SET, AA_TRIODES: AA_TRIODES, AA_PENTODES: AA_PENTODES, AA_SPEAKERS: AA_SPEAKERS,
    AA_CABS: AA_CABS, AA_STACKS: AA_STACKS, AMP_ANALOG: AMP_ANALOG,
    aaRecipe: aaRecipe, aaKorenT: aaKorenT, aaKorenP: aaKorenP, aaTriodeOP: aaTriodeOP, aaNetTF: aaNetTF, aaStackNet: aaStackNet, aaRoots: aaRoots,
    aaToneCoefs: aaToneCoefs, aaStackDb: aaStackDb, aaToneDb: aaToneDb, aaHalfband: aaHalfband, aaCabIr: aaCabIr, aaBank: aaBank, aaBankOf: aaBankOf,
    aaToneTable: aaToneTable, aaInfo: aaInfo, aaGenCode: aaGenCode
};
