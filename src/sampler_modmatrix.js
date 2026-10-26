// Modulation matrix for Better Sampler Reactive 2.
// Sources are Amp, Env 2, Env 3, LFO 1, slot 4, the MIDI / MPE columns, and the audio-rate engines.
// A packed route is six floats: code, source, depth (-1..1), lo, hi, smooth.
// Code 0..159 adds to that prm slot. 200..247 adds to an argument slot.
// 300..323 is a global (filter, output, pre-voice spectrum, LFO rate).
// 1000+routeIndex modulates that route's depth. Depth 0 is never packed,
// so a clear matrix leaves the gen on its unmodulated path.
var MOD_ROUTE_STRIDE = 6;
var MOD_ROUTE_MAX = 48;

var MOD_SOURCES = {
    1: [
        { id: 0, name: "Amp", bipolar: false },
        { id: 1, name: "Env 2", bipolar: false },
        { id: 2, name: "Env 3", bipolar: false },
        { id: 3, name: "LFO 1", bipolar: true },
        { id: 4, name: "LFO 2", bipolar: true }
    ],
    2: [
        { id: 5, name: "Vel", bipolar: false },
        { id: 6, name: "Key", bipolar: false },
        { id: 7, name: "PB", bipolar: true },
        { id: 8, name: "Press", bipolar: false },
        { id: 9, name: "Mod", bipolar: false },
        { id: 10, name: "Rand", bipolar: true }
    ],
    3: [
        { id: 11, name: "Vel", bipolar: false },
        { id: 12, name: "Note PB", bipolar: true },
        { id: 13, name: "Slide", bipolar: false },
        { id: 14, name: "Press", bipolar: false }
    ],
    4: [
        { id: 15, name: "Osc 1", bipolar: true },
        { id: 16, name: "Osc 2", bipolar: true },
        { id: 17, name: "Sub", bipolar: true }
    ]
};

var MOD_MODES = [1, 2, 3, 4];

// Live parameters that already are a depth. Packing them again would apply twice.
var MOD_LEGACY = [
    { src: 1, key: "pitch_st", param: "menv_pitch" },
    { src: 1, key: "play_pos", param: "menv_pos" },
    { src: 1, key: "filt_cutoff", param: "filt_env_amt" },
    { src: 3, key: "pitch_st", param: "lfo_pitch" },
    { src: 3, key: "play_pos", param: "lfo_pos" },
    { src: 3, key: "filt_cutoff", param: "lfo_filt" },
    { src: 5, key: "samp_gain", param: "vel_sens" }
];

// Integers, menus, toggles, packed harmonic words, analysis-only, and the two globals.
var MOD_DENY = {
    mode: 1, sliced: 1, freeze: 1, reverse: 1, loop_mode: 1, slice_play: 1, root_dyn: 1,
    root_note: 1, osc2_root: 1, poly_voices: 1, unison_voices: 1, sub_partials: 1,
    fr_repeats: 1, fr_max_grains: 1, slice_div: 1, slice_from: 1, slice_sens: 1, slice_at: 1, slice_beat: 1,
    sub_h1_4: 1, sub_h5_8: 1, sub_h9_12: 1, sub_h13_16: 1, sub_lock_note: 1,
    mod_global_time: 1, mod_global_amt: 1, face_theme: 1, show_inspector: 1, env_page: 1,
    filt_on: 1, mono_legato: 1
};

// unitstyle 0 that are still continuous musical values
var MOD_ALLOW_INT = { fine_cents: 1, osc1_detune: 1, osc2_detune: 1, osc2_tune: 1, sub_fine: 1 };

// op p = prm index, a = argument, g = post-loop global, b = pre-loop global (one sample late).
// lo/hi are the units the gen adds in.
var MOD_TARGETS = {
    pitch_st: { op: "a", ix: 0, lo: -36, hi: 36 },
    fine_cents: { op: "a", ix: 1, lo: -100, hi: 100 },
    play_pos: { op: "a", ix: 2, lo: 0, hi: 1, smooth: 1 },
    samp_start: { op: "a", ix: 3, lo: 0, hi: 0.99, smooth: 1 },
    samp_end: { op: "a", ix: 4, lo: 0.01, hi: 1, smooth: 1 },
    loop_start: { op: "a", ix: 5, lo: 0, hi: 0.98, smooth: 1 },
    loop_end: { op: "a", ix: 6, lo: 0.02, hi: 1, smooth: 1 },
    loop_xfade: { op: "a", ix: 7, lo: 0, hi: 0.45, smooth: 1 },
    grain_size: { op: "a", ix: 8, lo: 5, hi: 500 },
    grain_motion: { op: "a", ix: 9, lo: 0, hi: 2 },
    grain_spray: { op: "a", ix: 10, lo: 0, hi: 1 },
    formant: { op: "a", ix: 11, lo: -24, hi: 24 },
    unison_detune: { op: "a", ix: 12, lo: 0, hi: 1 },
    unison_width: { op: "a", ix: 13, lo: 0, hi: 1 },
    sus_lvl: { op: "a", ix: 14, lo: 0, hi: 1 },
    msus_lvl: { op: "a", ix: 15, lo: 0, hi: 1 },
    vel_sens: { op: "a", ix: 16, lo: 0, hi: 1 },
    lfo_pitch: { op: "a", ix: 17, lo: -1, hi: 1 },
    lfo_pos: { op: "a", ix: 18, lo: -1, hi: 1 },
    lfo_filt: { op: "a", ix: 19, lo: -1, hi: 1 },
    menv_pitch: { op: "a", ix: 20, lo: -1, hi: 1 },
    menv_pos: { op: "a", ix: 21, lo: -1, hi: 1 },
    filt_env_amt: { op: "a", ix: 22, lo: -1, hi: 1 },
    glide_ms: { op: "a", ix: 23, lo: 0, hi: 1000 },
    atk_ms: { op: "a", ix: 24, lo: 0.2, hi: 5000 },
    dec_ms: { op: "a", ix: 25, lo: 1, hi: 10000 },
    rel_ms: { op: "a", ix: 26, lo: 1, hi: 10000 },
    matk_ms: { op: "a", ix: 27, lo: 0.2, hi: 5000 },
    mdec_ms: { op: "a", ix: 28, lo: 1, hi: 10000 },
    mrel_ms: { op: "a", ix: 29, lo: 1, hi: 10000 },
    samp_gain: { op: "a", ix: 30, lo: -48, hi: 24 },
    sp_bend: { op: "a", ix: 31, lo: -24, hi: 24 },
    env3_atk_ms: { op: "a", ix: 32, lo: 0, hi: 20000 },
    env3_dec_ms: { op: "a", ix: 33, lo: 1, hi: 60000 },
    env3_sus_lvl: { op: "a", ix: 34, lo: 0, hi: 1 },
    env3_rel_ms: { op: "a", ix: 35, lo: 1, hi: 60000 },
    env3_atk_slope: { op: "a", ix: 36, lo: -1, hi: 1 },
    env3_dec_slope: { op: "a", ix: 37, lo: -1, hi: 1 },
    env3_rel_slope: { op: "a", ix: 38, lo: -1, hi: 1 },
    env3_init: { op: "a", ix: 39, lo: 0, hi: 1 },
    env3_peak: { op: "a", ix: 40, lo: 0, hi: 1 },
    env3_final: { op: "a", ix: 41, lo: 0, hi: 1 },
    lfo1_amount: { op: "a", ix: 42, lo: 0, hi: 1 },
    lfo1_shaping: { op: "a", ix: 43, lo: -1, hi: 1 },
    lfo1_offset: { op: "a", ix: 44, lo: 0, hi: 360 },
    lfo2_amount: { op: "a", ix: 45, lo: 0, hi: 1 },
    lfo2_shaping: { op: "a", ix: 46, lo: -1, hi: 1 },
    lfo2_offset: { op: "a", ix: 47, lo: 0, hi: 360 },
    rp_dist: { op: "p", ix: 2, lo: 0, hi: 1 },
    rp_color: { op: "p", ix: 3, lo: -1, hi: 1 },
    cy_width: { op: "p", ix: 7, lo: -1, hi: 1 },
    cy_split: { op: "p", ix: 8, lo: -1, hi: 1 },
    cy_fund: { op: "p", ix: 9, lo: 0, hi: 1 },
    cy_mod: { op: "p", ix: 10, lo: 0, hi: 1 },
    cy_harm: { op: "p", ix: 11, lo: -1, hi: 1 },
    fr_env: { op: "p", ix: 20, lo: 0, hi: 1 },
    fr_density: { op: "p", ix: 22, lo: 0.1, hi: 100 },
    fr_motion: { op: "p", ix: 24, lo: 0, hi: 8 },
    sp_shift: { op: "p", ix: 41, lo: 0.01, hi: 1.22 },
    sp_quant_amt: { op: "p", ix: 46, lo: 0.01, hi: 1 },
    sp_dispersion: { op: "p", ix: 49, lo: 0, hi: 1 },
    atk_slope: { op: "p", ix: 56, lo: -1, hi: 1 },
    dec_slope: { op: "p", ix: 57, lo: -1, hi: 1 },
    rel_slope: { op: "p", ix: 58, lo: -1, hi: 1 },
    matk_slope: { op: "p", ix: 59, lo: -1, hi: 1 },
    mdec_slope: { op: "p", ix: 60, lo: -1, hi: 1 },
    mrel_slope: { op: "p", ix: 61, lo: -1, hi: 1 },
    amp_init: { op: "p", ix: 62, lo: 0, hi: 1 },
    amp_peak: { op: "p", ix: 63, lo: 0, hi: 1 },
    env2_init: { op: "p", ix: 64, lo: 0, hi: 1 },
    env2_peak: { op: "p", ix: 65, lo: 0, hi: 1 },
    env2_final: { op: "p", ix: 66, lo: 0, hi: 1 },
    wt1_fx1: { op: "p", ix: 68, lo: -1, hi: 1 },
    wt1_fx2: { op: "p", ix: 69, lo: 0, hi: 1 },
    osc2_pitch: { op: "p", ix: 72, lo: -36, hi: 36 },
    osc2_detune: { op: "p", ix: 73, lo: -100, hi: 100 },
    osc2_pos: { op: "p", ix: 74, lo: 0, hi: 1, smooth: 1 },
    osc2_gain: { op: "p", ix: 75, lo: -48, hi: 24 },
    sub_tone: { op: "p", ix: 78, lo: 0, hi: 1 },
    sub_gain: { op: "p", ix: 79, lo: -48, hi: 24 },
    wt2_fx1: { op: "p", ix: 82, lo: -1, hi: 1 },
    wt2_fx2: { op: "p", ix: 83, lo: 0, hi: 1 },
    xs_fm_21: { op: "p", ix: 86, lo: -1, hi: 1 },
    xs_fm_12: { op: "p", ix: 87, lo: -1, hi: 1 },
    xs_rm_21: { op: "p", ix: 88, lo: -1, hi: 1 },
    xs_rm_12: { op: "p", ix: 89, lo: -1, hi: 1 },
    xs_cep_21: { op: "p", ix: 90, lo: -1, hi: 1 },
    xs_cep_12: { op: "p", ix: 91, lo: -1, hi: 1 },
    xs_sync_21: { op: "p", ix: 92, lo: 0, hi: 1 },
    xs_sync_12: { op: "p", ix: 93, lo: 0, hi: 1 },
    xs_fold_21: { op: "p", ix: 94, lo: -1, hi: 1 },
    xs_fold_12: { op: "p", ix: 95, lo: -1, hi: 1 },
    xs_sub_fm: { op: "p", ix: 96, lo: -1, hi: 1 },
    xs_sub_rm: { op: "p", ix: 97, lo: -1, hi: 1 },
    xs_sub_cep: { op: "p", ix: 98, lo: -1, hi: 1 },
    xs_sub_sync: { op: "p", ix: 99, lo: 0, hi: 1 },
    xs_sub_fold: { op: "p", ix: 100, lo: -1, hi: 1 },
    xs_depth: { op: "p", ix: 101, lo: 0, hi: 1 },
    xs_quef: { op: "p", ix: 102, lo: 0, hi: 1 },
    xs_tilt: { op: "p", ix: 103, lo: -1, hi: 1 },
    sub_semi: { op: "p", ix: 104, lo: -24, hi: 24 },
    sub_fine: { op: "p", ix: 105, lo: -100, hi: 100 },
    sub_phase: { op: "p", ix: 107, lo: 0, hi: 1 },
    sub_level: { op: "p", ix: 108, lo: 0, hi: 1 },
    sub_harm_level: { op: "p", ix: 109, lo: 0, hi: 1 },
    sub_detune: { op: "p", ix: 110, lo: 0, hi: 1 },
    sub_mod: { op: "p", ix: 111, lo: 0, hi: 1 },
    sub_width: { op: "p", ix: 112, lo: 0, hi: 1 },
    sub_knock_slope: { op: "p", ix: 113, lo: -1, hi: 1 },
    sub_knock: { op: "p", ix: 114, lo: 0, hi: 96 },
    sub_disp_freq: { op: "g", ix: 24, lo: 20, hi: 2000 },
    sub_disp_amt: { op: "g", ix: 25, lo: 0, hi: 1 },
    sub_decay: { op: "p", ix: 115, lo: 1, hi: 250 },
    sub_drive: { op: "p", ix: 116, lo: 0, hi: 1 },
    osc1_ratio: { op: "p", ix: 122, lo: 0.125, hi: 16 },
    osc2_ratio: { op: "p", ix: 123, lo: 0.125, hi: 16 },
    sub_ratio: { op: "p", ix: 124, lo: 0.125, hi: 16 },
    fine_range: { op: "p", ix: 125, lo: 1, hi: 96 },
    osc1_detune: { op: "p", ix: 126, lo: -100, hi: 100 },
    osc2_tune: { op: "p", ix: 132, lo: -100, hi: 100 },
    osc1_pan: { op: "p", ix: 134, lo: -1, hi: 1 },
    osc2_pan: { op: "p", ix: 135, lo: -1, hi: 1 },
    sub_pan: { op: "p", ix: 136, lo: -1, hi: 1 },
    // Cutoff depth is a fraction of the log range (20 Hz at 0, 20 kHz at 1), not a span of hertz.
    // A linear add made −8% at 623 Hz clip to 20 Hz while +8% only opened the filter a little.
    filt_cutoff: { op: "g", ix: 0, lo: 0, hi: 1 },
    filt_res: { op: "g", ix: 1, lo: 0, hi: 0.95 },
    filt_drive: { op: "g", ix: 2, lo: 0, hi: 1 },
    out_gain: { op: "g", ix: 3, lo: -36, hi: 18 },
    filt_morph: { op: "g", ix: 4, lo: 0, hi: 1 },
    filt2_cutoff: { op: "g", ix: 5, lo: 0, hi: 1 },
    filt2_res: { op: "g", ix: 6, lo: 0, hi: 0.95 },
    filt2_drive: { op: "g", ix: 7, lo: 0, hi: 1 },
    filt2_morph: { op: "g", ix: 8, lo: 0, hi: 1 },
    lfo_rate: { op: "b", ix: 9, lo: 0.05, hi: 30 },
    lfo2_rate: { op: "b", ix: 10, lo: 0.05, hi: 30 },
    lfo1_atk_ms: { op: "b", ix: 11, lo: 0, hi: 5000 },
    lfo2_atk_ms: { op: "b", ix: 12, lo: 0, hi: 5000 },
    sub_odd: { op: "b", ix: 13, lo: -1, hi: 1 },
    sub_even: { op: "b", ix: 14, lo: -1, hi: 1 },
    sub_tilt: { op: "b", ix: 15, lo: -1, hi: 1 },
    sub_lp: { op: "b", ix: 16, lo: 0, hi: 1 }
};

var MOD_LABELS = {
    samp_gain: "Amp", pitch_st: "Pitch", play_pos: "Osc 1 Pos", osc2_pos: "Osc 2 Pos",
    wt1_fx1: "Osc 1 Warp", wt1_fx2: "Osc 1 Fold", wt2_fx1: "Osc 2 Warp", wt2_fx2: "Osc 2 Fold",
    xs_depth: "X-Synth", filt_cutoff: "Cutoff", filt_res: "Resonance", filt_drive: "Drive",
    filt2_cutoff: "Cutoff 2", filt2_res: "Res 2", filt2_drive: "Drive 2",
    osc1_pan: "Pan", osc2_pan: "Osc 2 Pan", sub_pan: "Sub Pan",
    grain_motion: "Speed", fine_cents: "Fine", osc1_detune: "Detune",
    osc2_gain: "Osc 2 Amp", osc2_pitch: "Osc 2 Pitch", osc2_detune: "Osc 2 Det",
    sub_gain: "Sub Amp", out_gain: "Output", atk_ms: "Attack", dec_ms: "Decay",
    rel_ms: "Release", sus_lvl: "Sustain"
};

// Tokens of a parameter key, longest first so filt2 wins over a later split.
var MOD_LABEL_WORDS = {
    filt2: "Filter 2", filt: "Filter", osc1: "Osc 1", osc2: "Osc 2", wt1: "Osc 1", wt2: "Osc 2",
    lfo1: "LFO 1", lfo2: "LFO 2", lfo: "LFO", env3: "Env 3", env2: "Env 2", menv: "Mod Env",
    samp: "Sample", sub: "Sub", xs: "X-Synth",
    atk: "Attack", dec: "Decay", rel: "Release", sus: "Sustain",
    cutoff: "Cutoff", res: "Res", drive: "Drive", morph: "Morph", gain: "Gain", pitch: "Pitch",
    pan: "Pan", pos: "Position", detune: "Detune", width: "Width", rate: "Rate", amount: "Amount",
    shaping: "Shape", offset: "Phase", slope: "Slope", init: "Start", peak: "Peak", final: "End",
    formant: "Formant", glide: "Glide", density: "Density", motion: "Motion", spray: "Spray",
    grain: "Grain", bend: "Bend", shift: "Shift", color: "Color", dist: "Dist", harm: "Harm",
    fund: "Fund", split: "Split", env: "Env", fx1: "Warp", fx2: "Fold", semi: "Semi", fine: "Fine",
    phase: "Phase", level: "Level", knock: "Knock", decay: "Decay", ratio: "Ratio", tune: "Tune",
    depth: "Depth", tilt: "Tilt", odd: "Odd", even: "Even", lp: "Lowpass", quef: "Quef",
    sync: "Sync", fold: "Fold", tone: "Tone", mod: "Mod", disp: "Disp", freq: "Freq",
    start: "Start", end: "End", xfade: "Crossfade", unison: "Unison", vel: "Velocity",
    sens: "Sens", ms: "", lvl: "", st: ""
};

function modHuman(key) {
    var parts = String(key).split("_");
    var out = [], i, word;
    for (i = 0; i < parts.length; i++) {
        word = Object.prototype.hasOwnProperty.call(MOD_LABEL_WORDS, parts[i]) ? MOD_LABEL_WORDS[parts[i]] : "";
        if (!word && parts[i]) word = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
        if (word) out.push(word);
    }
    return out.join(" ");
}

function modSources(mode) { return MOD_SOURCES[mode] || MOD_SOURCES[1]; }

function modLegacyParam(src, key) {
    for (var i = 0; i < MOD_LEGACY.length; i++) {
        if (MOD_LEGACY[i].src === src && MOD_LEGACY[i].key === key) return MOD_LEGACY[i].param;
    }
    return "";
}

function modDenied(key, spec) {
    if (MOD_DENY[key]) return true;
    if (spec && spec.enums) return true;
    if (spec && (spec.unit === 9 || spec.unit === 8)) return true;
    if (spec && spec.unit === 0 && !MOD_ALLOW_INT[key]) return true;
    return false;
}

function modTarget(key) { return MOD_TARGETS[key] || null; }

function modLabel(key) {
    if (MOD_LABELS[key]) return MOD_LABELS[key];
    if (String(key).indexOf("cell:") === 0) return "Amount";
    return modHuman(key) || key;
}

function modTargetKeys() {
    var keys = [];
    for (var k in MOD_TARGETS) if (MOD_TARGETS.hasOwnProperty(k)) keys.push(k);
    keys.sort();
    return keys;
}

// code field written into the route buffer
function modCode(t) {
    if (!t) return -1;
    if (t.op === "p") return t.ix;
    if (t.op === "a") return 200 + t.ix;
    return 300 + t.ix;
}

function modCellKey(mode, row, src) { return mode + ":" + row + ":" + src; }

// Same choice as the gen's slot_out: 0 keeps the native signal, 1 the alternate, 2 the MSEG sample.
function modSlotSignal(ty, native, alt, msegV) {
    var t = Number(ty) || 0;
    if (t > 1.5) return msegV;
    if (t > 0.5) return alt;
    return native;
}

// Rows are {1:[keys], 2:[], 3:[], 4:[]}. depth maps "mode:row:src" -> -100..100.
// polar maps the same key to 1 when alt-click forces that cell bipolar (src id + 32).
// globalAmt is the Global Amount percent (100 = unity). Legacy cells are skipped.
function modPack(rows, depth, globalAmt, polar) {
    var pct = Number(globalAmt);
    // 0% is no modulation. `|| 100` kept a full-scale matrix.
    if (isNaN(pct)) pct = 100;
    var g = Math.max(0, Math.min(2, pct / 100));
    var audio = [];
    var modes = MOD_MODES;
    var targeted = {};
    for (var mt = 0; mt < modes.length; mt++) {
        var listT = (rows && rows[modes[mt]]) || [];
        for (var rt = 0; rt < listT.length; rt++) {
            if (String(listT[rt]).indexOf("cell:") === 0) targeted[String(listT[rt]).substring(5)] = 1;
        }
    }
    for (var mi = 0; mi < modes.length; mi++) {
        var mode = modes[mi];
        var list = (rows && rows[mode]) || [];
        var srcs = modSources(mode);
        for (var r = 0; r < list.length; r++) {
            var key = list[r];
            if (key.indexOf("cell:") === 0) continue;
            var t = modTarget(key);
            if (!t) continue;
            for (var s = 0; s < srcs.length; s++) {
                // The Live depth stays the amount. Alt-click still has to reach the gen, so a
                // flipped legacy cell packs a zero-depth marker (source id + 32) and nothing else.
                if (modLegacyParam(srcs[s].id, key)) {
                    var lid = modCellKey(mode, r, srcs[s].id);
                    if (polar && polar[lid]) {
                        audio.push({ code: modCode(t), src: srcs[s].id + 32, dep: 0, lo: t.lo, hi: t.hi, smooth: 0, id: lid });
                    }
                    continue;
                }
                var raw = Number(depth[modCellKey(mode, r, srcs[s].id)]) || 0;
                var dep = (raw / 100) * g;
                var id = modCellKey(mode, r, srcs[s].id);
                if (Math.abs(dep) < 0.0005 && !targeted[id]) continue;
                var sid = srcs[s].id + ((polar && polar[id]) ? 32 : 0);
                audio.push({ code: modCode(t), src: sid, dep: dep, lo: t.lo, hi: t.hi, smooth: t.smooth ? 1 : 0, id: id });
            }
        }
    }
    // A second pass adds routes whose target is another cell's depth.
    var depthRoutes = [];
    for (var mj = 0; mj < modes.length; mj++) {
        var mode2 = modes[mj];
        var list2 = (rows && rows[mode2]) || [];
        var srcs2 = modSources(mode2);
        for (var r2 = 0; r2 < list2.length; r2++) {
            var key2 = list2[r2];
            if (key2.indexOf("cell:") !== 0) continue;
            var hit = -1;
            for (var a = 0; a < audio.length; a++) if (audio[a].id === key2.substring(5)) { hit = a; break; }
            if (hit < 0) continue;
            for (var s2 = 0; s2 < srcs2.length; s2++) {
                var raw2 = Number(depth[modCellKey(mode2, r2, srcs2[s2].id)]) || 0;
                var dep2 = (raw2 / 100) * g;
                if (Math.abs(dep2) < 0.0005) continue;
                var id2 = modCellKey(mode2, r2, srcs2[s2].id);
                var sid2 = srcs2[s2].id + ((polar && polar[id2]) ? 32 : 0);
                depthRoutes.push({ code: 1000 + hit, src: sid2, dep: dep2, lo: -1, hi: 1, smooth: 0 });
            }
        }
    }
    var all = audio.concat(depthRoutes).slice(0, MOD_ROUTE_MAX);
    var out = [all.length];
    for (var i = 0; i < all.length; i++) {
        var rt = all[i];
        out.push(rt.code, rt.src, rt.dep, rt.lo, rt.hi, rt.smooth);
    }
    return out;
}

// Cutoff on the same axis the filter graph uses: 0 is 20 Hz, 1 is 20 kHz. `amount` is depth
// (−1..1) times the source. Negative amount moves the curve left, positive moves it right,
// by the same fraction of the graph.
function modCutoffHz(baseHz, amount) {
    var hz = Math.max(20, Math.min(20000, Number(baseHz) || 20));
    var pos = Math.log(hz / 20) / Math.log(1000);
    var next = pos + (Number(amount) || 0);
    if (next < 0) next = 0;
    if (next > 1) next = 1;
    return 20 * Math.pow(1000, next);
}

// Reference adder used by the tests. Depth 0 leaves base untouched, including -0.
function modOffset(base, lo, hi, depth, source) {
    if (!depth) return base;
    var span = hi - lo;
    var v = base + depth * source * span;
    var mn = lo < hi ? lo : hi;
    var mx = lo < hi ? hi : lo;
    if (v < mn) return mn;
    if (v > mx) return mx;
    return v;
}

// One-pole. A zero target and a zero state stay exactly zero (no denormal drip).
function modSmooth(prev, off, coef) {
    if (off === 0 && prev === 0) return 0;
    return prev * coef + off * (1 - coef);
}

function modAudit(faceParams) {
    var missing = [];
    var deniedHit = [];
    for (var key in faceParams) {
        if (!faceParams.hasOwnProperty(key)) continue;
        var spec = faceParams[key];
        var denied = modDenied(key, spec);
        var tgt = modTarget(key);
        if (denied && tgt) deniedHit.push(key);
        if (!denied && !tgt) missing.push(key);
    }
    return { missing: missing, deniedHit: deniedHit };
}

var MOD_DEFAULT_ROWS = {
    1: ["samp_gain", "pitch_st", "filt_cutoff"],
    2: ["samp_gain", "pitch_st", "filt_cutoff", "osc1_pan"],
    3: ["pitch_st", "samp_gain", "filt_cutoff", "osc1_pan"],
    4: ["pitch_st", "filt_cutoff", "samp_gain"]
};

function modDefaultRows() {
    return {
        1: MOD_DEFAULT_ROWS[1].slice(), 2: MOD_DEFAULT_ROWS[2].slice(),
        3: MOD_DEFAULT_ROWS[3].slice(), 4: MOD_DEFAULT_ROWS[4].slice()
    };
}

function modEncode(rows, depth, polar) {
    var parts = [];
    var modes = MOD_MODES;
    var keys = modTargetKeys();
    for (var mi = 0; mi < modes.length; mi++) {
        var mode = modes[mi];
        var list = rows[mode] || [];
        var srcs = modSources(mode);
        for (var r = 0; r < list.length; r++) {
            var ix = keys.indexOf(list[r]);
            var cells = [];
            var any = ix < 0;
            for (var s = 0; s < srcs.length; s++) {
                var ck = modCellKey(mode, r, srcs[s].id);
                var v = Number(depth[ck]) || 0;
                var pol = polar && polar[ck] ? 1 : 0;
                cells.push((pol ? "u" : "") + (Math.round(v * 10) / 10));
                if (v || pol) any = true;
            }
            var same = MOD_DEFAULT_ROWS[mode] && MOD_DEFAULT_ROWS[mode][r] === list[r];
            if (!any && same && list.length === MOD_DEFAULT_ROWS[mode].length) continue;
            if (!any && same) continue;
            parts.push(mode + ":" + r + ":" + (ix < 0 ? list[r] : ix) + ":" + cells.join(","));
        }
    }
    return parts.join("|");
}

function modDecode(text, rows, depth, polar) {
    if (!text || text === "-") return;
    var bits = String(text).split("|");
    for (var i = 0; i < bits.length; i++) {
        var f = bits[i].split(":");
        if (f.length < 4) continue;
        var mode = Number(f[0]), row = Number(f[1]);
        if (!rows[mode]) continue;
        var key = f[2];
        if (/^\d+$/.test(key)) {
            var keys = modTargetKeys();
            key = keys[Number(key)] || rows[mode][row] || "pitch_st";
        }
        while (rows[mode].length <= row) rows[mode].push("pitch_st");
        rows[mode][row] = key;
        var cells = f[3].split(",");
        var srcs = modSources(mode);
        for (var s = 0; s < srcs.length && s < cells.length; s++) {
            var rawc = String(cells[s]);
            var pol = rawc.charAt(0) === "u";
            var v = Number(pol ? rawc.substring(1) : rawc) || 0;
            var ck = modCellKey(mode, row, srcs[s].id);
            if (v) depth[ck] = v;
            if (pol && polar) polar[ck] = 1;
        }
    }
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        MOD_TARGETS: MOD_TARGETS, MOD_DENY: MOD_DENY, MOD_LEGACY: MOD_LEGACY, MOD_SOURCES: MOD_SOURCES,
        modSources: modSources, modLegacyParam: modLegacyParam, modDenied: modDenied, modTarget: modTarget,
        modPack: modPack, modOffset: modOffset, modCutoffHz: modCutoffHz, modSmooth: modSmooth, modAudit: modAudit,
        modDefaultRows: modDefaultRows, modEncode: modEncode, modDecode: modDecode, modTargetKeys: modTargetKeys,
        modLabel: modLabel, modHuman: modHuman, modCode: modCode, modCellKey: modCellKey, modSlotSignal: modSlotSignal
    };
}
