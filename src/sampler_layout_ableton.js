// Better Sampler — presentation layout of the two face themes (pure function, no Max calls).
//
// Shaped like XO Sample Map's computeXoLayout (AGENTS.md section 4): abComputeLayout(theme, state) returns
// { layout key: [x, y, w, h] | null } for EVERY laid-out box (null = hidden). The main v8ui applies it
// (abApplyLayout in sampler_theme_ableton.js) with patcher.getnamed(varname) + presentation_rect / hidden whenever
// the theme or one of its inputs changes. The saved file is the Bitwig state, so theme 0 returns exactly the saved
// rects. Concatenated after sampler_theme_ableton.js; also required by tests/test_sampler_theme.js.
//
// Layout keys: a parameter key (its obj-ctrl-<key> live.* object) or one of AB_PANEL_KEYS / AB_VIZ_KEYS below.
// Device width is 600 (760 with the inspector); everything stays inside 169 px.
//
// state: { mode, sliced, rpChar, spChar, spQuant, cyChar, envPage, inspector }
//
// Ableton theme: the main v8ui shrinks to the sample panel (header, waveform, footers, its dropdown menus); every
// knob, tab, toggle, menu and value of the left column, bottom row and side column is its parameter's own live.*
// object; the ADSR and filter-curve displays are two small separate v8uis; the panels are theme-bound.

var AB_PARAM_KEYS = [
    "sliced", "mode",
    "rp_char", "rp_imaging", "rp_vsr", "rp_dist", "rp_color",
    "sp_char", "sp_onsets", "sp_formant_on", "formant", "sp_shift", "sp_bend", "sp_quant", "sp_quant_amt",
    "cy_char", "cy_xfade", "cy_width", "cy_split", "cy_fund", "cy_mod", "cy_harm",
    "grain_size", "grain_spray", "fr_repeats", "fr_sync", "fr_use_density", "fr_env", "fr_density", "fr_motion",
    "freeze", "pitch_st", "grain_motion", "play_pos",
    "filt_on", "filt_type", "filt_drive", "filt_env_amt",
    "env_page", "menv_pitch", "menv_pos", "lfo_shape", "lfo_rate", "lfo_pitch", "lfo_filt", "lfo_pos",
    "unison_voices", "unison_detune", "poly_voices",
    "show_inspector", "mono_legato", "unison_width", "glide_ms", "vel_sens", "out_gain"
];
var AB_PANEL_KEYS = ["pnl_body", "pnl_lcd", "pnl_left", "pnl_engine", "pnl_play", "pnl_filter", "pnl_env", "pnl_side", "pnl_bg"];
var AB_VIZ_KEYS = ["v_main", "v_side", "v_adsr", "v_filt"];
var AB_LAYOUT_KEYS = AB_PARAM_KEYS.concat(AB_PANEL_KEYS, AB_VIZ_KEYS);

// State inputs of the layout (a change of one of these parameters re-applies it)
var AB_LAYOUT_INPUTS = {
    face_theme: 1, mode: 1, sliced: 1, rp_char: 1, sp_char: 1, sp_quant: 1, cy_char: 1, env_page: 1, show_inspector: 1
};

// Geometry (px)
var AB_ROW_Y = 106;          // top of the bottom row
var AB_ROW_H = 60;
var AB_PANELS = {            // x, w of the four bottom panels
    engine: [59, 124], play: [186, 100], filter: [289, 96], env: [388, 137]
};
var AB_DIAL_W = 33;
var AB_DIAL_H = 42;
var AB_DIAL_Y = 123;         // dials sit under the 14 px header row (y 109)
// Fixed origins of the small canvases (their width / height vary with the state, their top left never does)
var AB_ORIGIN = { main: [59, 3], adsr: [391, 124], filt: [292, 125] };

function abRect(x, y, w, h) { return [x, y, w, h]; }

// n dials spread over [x + 3, x + w - 3]
function abDialRow(out, keys, x, w) {
    var slot = (w - 6) / keys.length;
    var dw = Math.min(AB_DIAL_W, Math.floor(slot));
    for (var i = 0; i < keys.length; i++) {
        out[keys[i]] = abRect(Math.round(x + 3 + slot * i + (slot - dw) / 2), AB_DIAL_Y, dw, AB_DIAL_H);
    }
}

function abBitwigLayout() {
    var out = {};
    for (var i = 0; i < AB_LAYOUT_KEYS.length; i++) out[AB_LAYOUT_KEYS[i]] = null;
    out.v_main = abRect(0, 0, 528, 169);
    out.v_side = abRect(531, 3, 66, 163);
    out.pnl_bg = abRect(0, 0, 760, 169);
    return out;
}

function abComputeLayout(theme, s) {
    var out = abBitwigLayout();
    if (theme !== 1 && theme !== "Ableton") return out;
    out.v_main = abRect(59, 3, 466, 100);
    out.v_side = null;
    out.pnl_bg = null;

    // panels (theme-bound backgrounds)
    out.pnl_body = abRect(0, 0, s.inspector ? 760 : 600, 169);
    out.pnl_lcd = abRect(59, 3, 466, 100);
    out.pnl_left = abRect(3, 3, 53, 163);
    out.pnl_side = abRect(531, 3, 66, 163);
    out.pnl_engine = abRect(AB_PANELS.engine[0], AB_ROW_Y, AB_PANELS.engine[1], AB_ROW_H);
    out.pnl_play = abRect(AB_PANELS.play[0], AB_ROW_Y, AB_PANELS.play[1], AB_ROW_H);
    out.pnl_filter = abRect(AB_PANELS.filter[0], AB_ROW_Y, AB_PANELS.filter[1], AB_ROW_H);
    out.pnl_env = abRect(AB_PANELS.env[0], AB_ROW_Y, AB_PANELS.env[1], AB_ROW_H);

    // left column: Single / Sliced and the engine list as vertical live.tabs
    out.sliced = abRect(3, 3, 53, 40);
    out.mode = abRect(3, 46, 53, 117);

    // side column
    out.show_inspector = abRect(531, 3, 66, 17);
    out.mono_legato = abRect(531, 23, 66, 17);
    out.unison_width = abRect(531, 44, 33, 48);
    out.glide_ms = abRect(564, 44, 33, 48);
    out.vel_sens = abRect(531, 94, 33, 48);
    out.out_gain = abRect(564, 94, 33, 48);

    // engine panel
    var ex = AB_PANELS.engine[0], ew = AB_PANELS.engine[1], hy = 109;
    var mode = s.mode;
    if (mode === 0) {
        var dig = s.rpChar === 2;
        out.rp_char = abRect(ex + 3, hy, dig ? 70 : ew - 6, 14);
        if (dig) {
            out.rp_imaging = abRect(ex + 75, hy, 22, 14);
            out.rp_vsr = abRect(ex + 99, hy, 22, 14);
        }
        abDialRow(out, ["rp_dist", "rp_color"], ex, ew);
    } else if (mode === 3) {
        out.sp_char = abRect(ex + 3, hy, 50, 14);
        out.sp_onsets = abRect(ex + 55, hy, 33 + 1, 14);
        out.sp_formant_on = abRect(ex + 91, hy, 30, 14);
        if (s.spChar === 0) {
            abDialRow(out, ["formant", "sp_shift"], ex, ew);
        } else {
            abDialRow(out, ["sp_bend", "sp_quant", "sp_quant_amt"], ex, ew);
            var slot = (ew - 6) / 3;
            out.sp_quant = abRect(Math.round(ex + 3 + slot + 1), 134, Math.floor(slot - 2), 15);
        }
    } else if (mode === 1) {
        out.cy_char = abRect(ex + 3, hy, 84, 14);
        out.cy_xfade = abRect(ex + 89, hy, 32, 14);
        if (s.cyChar === 0) abDialRow(out, ["formant", "cy_width"], ex, ew);
        else if (s.cyChar === 1) abDialRow(out, ["formant", "cy_split", "cy_fund"], ex, ew);
        else abDialRow(out, ["formant", "cy_mod", "cy_harm"], ex, ew);
    } else if (mode === 2) {
        abDialRow(out, ["grain_size", "grain_spray"], ex, ew);
    } else {
        out.fr_repeats = abRect(ex + 3, hy - 1, 30, 15);
        out.fr_sync = abRect(ex + 36, hy, 40, 14);
        out.fr_use_density = abRect(ex + 78, hy, 43, 14);
        abDialRow(out, ["fr_env", "grain_size", "fr_density", "fr_motion"], ex, ew);
    }

    // play panel
    var px = AB_PANELS.play[0], pw = AB_PANELS.play[1];
    out.freeze = abRect(px + 3, hy, 50, 14);
    abDialRow(out, ["pitch_st", "grain_motion", "play_pos"], px, pw);

    // filter panel: on, type, drive, response curve (own v8ui), env amount
    var fx = AB_PANELS.filter[0];
    out.filt_on = abRect(fx + 3, hy, 16, 14);
    out.filt_type = abRect(fx + 21, hy, 45, 14);
    out.filt_drive = abRect(fx + 68, hy - 1, 26, 15);
    out.v_filt = abRect(AB_ORIGIN.filt[0], AB_ORIGIN.filt[1], 90, 22);
    out.filt_env_amt = abRect(fx + 3, 149, 90, 15);

    // envelope panel: page tabs, then ADSR display (+ MOD amounts) or dials
    var vx = AB_PANELS.env[0];
    out.env_page = abRect(vx + 3, hy, 90, 14);
    var page = s.envPage;
    if (page === 0) {
        out.v_adsr = abRect(AB_ORIGIN.adsr[0], AB_ORIGIN.adsr[1], 131, 38);
    } else if (page === 1) {
        out.v_adsr = abRect(AB_ORIGIN.adsr[0], AB_ORIGIN.adsr[1], 88, 38);
        out.menv_pitch = abRect(vx + 94, 124, 40, 15);
        out.menv_pos = abRect(vx + 94, 142, 40, 15);
    } else if (page === 2) {
        out.lfo_shape = abRect(vx + 96, hy, 38, 14);
        for (var i = 0; i < 4; i++) {
            out[["lfo_rate", "lfo_pitch", "lfo_filt", "lfo_pos"][i]] = abRect(vx + 3 + AB_DIAL_W * i, AB_DIAL_Y, AB_DIAL_W, AB_DIAL_H);
        }
    } else {
        abDialRow(out, ["unison_voices", "unison_detune", "poly_voices"], vx, AB_PANELS.env[1]);
    }
    return out;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        abComputeLayout: abComputeLayout, AB_LAYOUT_KEYS: AB_LAYOUT_KEYS, AB_PARAM_KEYS: AB_PARAM_KEYS,
        AB_PANEL_KEYS: AB_PANEL_KEYS, AB_VIZ_KEYS: AB_VIZ_KEYS, AB_ORIGIN: AB_ORIGIN, AB_LAYOUT_INPUTS: AB_LAYOUT_INPUTS
    };
}
