// theme_engine.js — Unified semantic theme engine for all Max for Live devices in this repository.
// Global script scope (no top-level module.exports, AGENTS.md 1c). Never declare or shadow Max's
// own globals (box, patcher, max, messagename, inlet, jsarguments).
//
// Features:
//  1. Semantic Token Resolution (`m4lColor(name, fallback)`): resolves `live_*` and `accent_*` tokens
//     from `Global("m4l_theme_bus")` (checking per-device overrides first, then global preset + overrides +
//     HSL/contrast/brightness macros), falling back to `max.getcolor(name)` or `M4L_DEFAULT_TOKENS`.
//  2. Automatic `mgraphics` RGBA Remapper (`m4lMapRgba(r, g, b, a)`): when a non-Default theme or override
//     is active, maps hardcoded neutral RGBs onto the active theme's surface/LCD/text ramp and maps saturated
//     RGBs by hue sector onto the active theme's semantic accents (`cyan`, `amber`, `coral`, `green`,
//     `violet`, `yellow`, `magenta`). In `"Default"` mode with neutral macros and no overrides, passes
//     colors through untouched (zero overhead, 100% bit-identical to original behavior).
//  3. Native Patcher Widget & Panel Styler (`m4lApplyPatcherTheme(targetPatcher)`): recolors `panel`,
//     `live.dial`, `live.numbox` (including 38% pre-blended `activeslidercolor`), `live.tab`, `live.menu`,
//     `live.text`, `live.comment`, `live.line`, and `live.scope~` via `setattr`, and restores exact saved
//     colors when returning to `"Default"`.
//  4. Live Bus Watcher (`m4lThemeWatch(onChange)`): observes `Global("m4l_theme_bus")` across the Live Set.

var M4L_THEME_BUS_NAME = "m4l_theme_bus";

/** @type {Object<string, number[]>} */
var M4L_DEFAULT_TOKENS = {
    live_surface_bg: [0.212, 0.212, 0.212, 1.0],
    live_desktop: [0.165, 0.165, 0.165, 1.0],
    live_surface_frame: [0.141, 0.141, 0.141, 1.0],
    live_lcd_bg: [0.094, 0.094, 0.094, 1.0],
    live_lcd_frame: [0.243, 0.243, 0.243, 1.0],
    live_lcd_title: [0.710, 0.710, 0.710, 1.0],
    live_lcd_control_fg: [1.000, 0.678, 0.337, 1.0],
    live_lcd_control_fg_alt: [0.012, 0.765, 0.835, 1.0],
    live_display_line_one: [1.000, 0.678, 0.337, 1.0],
    live_display_line_two: [0.012, 0.765, 0.835, 1.0],
    live_display_handle_one: [1.000, 0.678, 0.337, 1.0],
    live_display_handle_two: [1.000, 0.412, 0.498, 1.0],
    live_display_scale_text: [0.525, 0.525, 0.525, 1.0],
    live_control_bg: [0.118, 0.118, 0.118, 1.0],
    live_control_fg: [0.710, 0.710, 0.710, 1.0],
    live_control_selection: [1.000, 0.678, 0.337, 1.0],
    live_control_text_selection: [0.094, 0.094, 0.094, 1.0],
    live_control_zombie: [0.459, 0.459, 0.459, 1.0],
    live_alert: [0.906, 0.412, 0.259, 1.0],
    accent_green: [0.380, 0.860, 0.540, 1.0],
    accent_violet: [0.720, 0.540, 0.980, 1.0],
    accent_yellow: [0.960, 0.840, 0.280, 1.0],
    accent_magenta: [0.940, 0.420, 0.820, 1.0]
};

/** @type {Object<string, { mode: string, label: string, desc: string, tokens: Object<string, number[]> }>} */
var M4L_PRESET_THEMES = {
    "Default": {
        mode: "default",
        label: "Default",
        desc: "Each plugin's original native look",
        tokens: Object.assign({}, M4L_DEFAULT_TOKENS)
    },
    "Ableton Live": {
        mode: "live",
        label: "Ableton Live",
        desc: "Follows Ableton Live's active theme & hue dynamically",
        tokens: Object.assign({}, M4L_DEFAULT_TOKENS)
    },
    "Amber LCD": {
        mode: "custom",
        label: "Amber LCD",
        desc: "Warm hardware amber monochrome analyzer look",
        tokens: {
            live_surface_bg: [0.110, 0.090, 0.065, 1.0],
            live_desktop: [0.078, 0.064, 0.045, 1.0],
            live_surface_frame: [0.220, 0.165, 0.095, 1.0],
            live_lcd_bg: [0.045, 0.035, 0.020, 1.0],
            live_lcd_frame: [0.260, 0.190, 0.100, 1.0],
            live_lcd_title: [0.850, 0.660, 0.340, 1.0],
            live_lcd_control_fg: [1.000, 0.720, 0.160, 1.0],
            live_lcd_control_fg_alt: [1.000, 0.840, 0.360, 1.0],
            live_display_line_one: [1.000, 0.720, 0.160, 1.0],
            live_display_line_two: [0.960, 0.520, 0.140, 1.0],
            live_display_handle_one: [1.000, 0.800, 0.240, 1.0],
            live_display_handle_two: [1.000, 0.480, 0.180, 1.0],
            live_display_scale_text: [0.580, 0.440, 0.220, 1.0],
            live_control_bg: [0.065, 0.052, 0.035, 1.0],
            live_control_fg: [0.920, 0.730, 0.380, 1.0],
            live_control_selection: [1.000, 0.700, 0.120, 1.0],
            live_control_text_selection: [0.050, 0.038, 0.020, 1.0],
            live_control_zombie: [0.420, 0.330, 0.180, 1.0],
            live_alert: [1.000, 0.380, 0.120, 1.0],
            accent_green: [0.880, 0.780, 0.240, 1.0],
            accent_violet: [0.940, 0.560, 0.280, 1.0],
            accent_yellow: [1.000, 0.900, 0.420, 1.0],
            accent_magenta: [0.980, 0.460, 0.240, 1.0]
        }
    },
    "Cyber Cyan": {
        mode: "custom",
        label: "Cyber Cyan",
        desc: "Deep midnight navy with electric cyan and neon magenta accents",
        tokens: {
            live_surface_bg: [0.075, 0.102, 0.145, 1.0],
            live_desktop: [0.052, 0.072, 0.108, 1.0],
            live_surface_frame: [0.120, 0.180, 0.260, 1.0],
            live_lcd_bg: [0.032, 0.046, 0.072, 1.0],
            live_lcd_frame: [0.130, 0.220, 0.320, 1.0],
            live_lcd_title: [0.640, 0.780, 0.900, 1.0],
            live_lcd_control_fg: [0.000, 0.900, 1.000, 1.0],
            live_lcd_control_fg_alt: [1.000, 0.320, 0.780, 1.0],
            live_display_line_one: [0.000, 0.900, 1.000, 1.0],
            live_display_line_two: [1.000, 0.320, 0.780, 1.0],
            live_display_handle_one: [0.000, 0.940, 1.000, 1.0],
            live_display_handle_two: [1.000, 0.380, 0.820, 1.0],
            live_display_scale_text: [0.400, 0.540, 0.680, 1.0],
            live_control_bg: [0.045, 0.064, 0.096, 1.0],
            live_control_fg: [0.780, 0.880, 0.960, 1.0],
            live_control_selection: [0.000, 0.880, 1.000, 1.0],
            live_control_text_selection: [0.030, 0.045, 0.070, 1.0],
            live_control_zombie: [0.320, 0.420, 0.540, 1.0],
            live_alert: [1.000, 0.280, 0.440, 1.0],
            accent_green: [0.180, 0.960, 0.680, 1.0],
            accent_violet: [0.680, 0.460, 1.000, 1.0],
            accent_yellow: [0.960, 0.920, 0.320, 1.0],
            accent_magenta: [1.000, 0.320, 0.780, 1.0]
        }
    },
    "Mono Slate": {
        mode: "custom",
        label: "Mono Slate",
        desc: "Minimalist graphite monochrome with crisp ice-white highlights",
        tokens: {
            live_surface_bg: [0.180, 0.188, 0.198, 1.0],
            live_desktop: [0.135, 0.142, 0.150, 1.0],
            live_surface_frame: [0.240, 0.250, 0.265, 1.0],
            live_lcd_bg: [0.075, 0.080, 0.086, 1.0],
            live_lcd_frame: [0.220, 0.230, 0.245, 1.0],
            live_lcd_title: [0.720, 0.740, 0.765, 1.0],
            live_lcd_control_fg: [0.940, 0.960, 0.980, 1.0],
            live_lcd_control_fg_alt: [0.680, 0.760, 0.840, 1.0],
            live_display_line_one: [0.940, 0.960, 0.980, 1.0],
            live_display_line_two: [0.620, 0.700, 0.780, 1.0],
            live_display_handle_one: [0.960, 0.980, 1.000, 1.0],
            live_display_handle_two: [0.720, 0.780, 0.840, 1.0],
            live_display_scale_text: [0.480, 0.500, 0.530, 1.0],
            live_control_bg: [0.105, 0.110, 0.118, 1.0],
            live_control_fg: [0.800, 0.820, 0.850, 1.0],
            live_control_selection: [0.900, 0.930, 0.960, 1.0],
            live_control_text_selection: [0.080, 0.085, 0.090, 1.0],
            live_control_zombie: [0.400, 0.420, 0.445, 1.0],
            live_alert: [0.880, 0.520, 0.520, 1.0],
            accent_green: [0.720, 0.820, 0.760, 1.0],
            accent_violet: [0.740, 0.740, 0.840, 1.0],
            accent_yellow: [0.880, 0.860, 0.740, 1.0],
            accent_magenta: [0.820, 0.720, 0.780, 1.0]
        }
    },
    "Solarized Dark": {
        mode: "custom",
        label: "Solarized Dark",
        desc: "Precision dark teal canvas with warm ochre, cyan, and vermilion",
        tokens: {
            live_surface_bg: [0.027, 0.212, 0.259, 1.0],
            live_desktop: [0.000, 0.169, 0.212, 1.0],
            live_surface_frame: [0.055, 0.275, 0.325, 1.0],
            live_lcd_bg: [0.000, 0.135, 0.172, 1.0],
            live_lcd_frame: [0.090, 0.290, 0.340, 1.0],
            live_lcd_title: [0.576, 0.631, 0.631, 1.0],
            live_lcd_control_fg: [0.710, 0.537, 0.000, 1.0],
            live_lcd_control_fg_alt: [0.165, 0.631, 0.596, 1.0],
            live_display_line_one: [0.710, 0.537, 0.000, 1.0],
            live_display_line_two: [0.165, 0.631, 0.596, 1.0],
            live_display_handle_one: [0.796, 0.294, 0.086, 1.0],
            live_display_handle_two: [0.149, 0.545, 0.824, 1.0],
            live_display_scale_text: [0.396, 0.482, 0.514, 1.0],
            live_control_bg: [0.000, 0.145, 0.185, 1.0],
            live_control_fg: [0.514, 0.580, 0.588, 1.0],
            live_control_selection: [0.165, 0.631, 0.596, 1.0],
            live_control_text_selection: [0.000, 0.135, 0.172, 1.0],
            live_control_zombie: [0.345, 0.431, 0.459, 1.0],
            live_alert: [0.863, 0.196, 0.184, 1.0],
            accent_green: [0.522, 0.600, 0.000, 1.0],
            accent_violet: [0.424, 0.443, 0.769, 1.0],
            accent_yellow: [0.710, 0.537, 0.000, 1.0],
            accent_magenta: [0.827, 0.212, 0.510, 1.0]
        }
    },
    "High Contrast": {
        mode: "custom",
        label: "High Contrast",
        desc: "Pitch-black stage mode with ultra-crisp borders and vivid traces",
        tokens: {
            live_surface_bg: [0.055, 0.055, 0.065, 1.0],
            live_desktop: [0.020, 0.020, 0.028, 1.0],
            live_surface_frame: [0.380, 0.400, 0.440, 1.0],
            live_lcd_bg: [0.000, 0.000, 0.000, 1.0],
            live_lcd_frame: [0.420, 0.440, 0.480, 1.0],
            live_lcd_title: [0.940, 0.950, 0.970, 1.0],
            live_lcd_control_fg: [1.000, 0.780, 0.000, 1.0],
            live_lcd_control_fg_alt: [0.000, 0.950, 1.000, 1.0],
            live_display_line_one: [1.000, 0.780, 0.000, 1.0],
            live_display_line_two: [0.000, 0.950, 1.000, 1.0],
            live_display_handle_one: [1.000, 0.820, 0.000, 1.0],
            live_display_handle_two: [1.000, 0.300, 0.550, 1.0],
            live_display_scale_text: [0.720, 0.740, 0.780, 1.0],
            live_control_bg: [0.040, 0.040, 0.050, 1.0],
            live_control_fg: [0.980, 0.980, 1.000, 1.0],
            live_control_selection: [1.000, 0.780, 0.000, 1.0],
            live_control_text_selection: [0.000, 0.000, 0.000, 1.0],
            live_control_zombie: [0.520, 0.540, 0.580, 1.0],
            live_alert: [1.000, 0.220, 0.220, 1.0],
            accent_green: [0.150, 1.000, 0.450, 1.0],
            accent_violet: [0.780, 0.520, 1.000, 1.0],
            accent_yellow: [1.000, 0.940, 0.100, 1.0],
            accent_magenta: [1.000, 0.300, 0.850, 1.0]
        }
    },
    "Light Studio": {
        mode: "custom",
        label: "Light Studio",
        desc: "Daylight hardware aluminum surfaces with high-contrast dark ink",
        tokens: {
            live_surface_bg: [0.855, 0.865, 0.880, 1.0],
            live_desktop: [0.785, 0.798, 0.818, 1.0],
            live_surface_frame: [0.660, 0.675, 0.700, 1.0],
            live_lcd_bg: [0.935, 0.942, 0.952, 1.0],
            live_lcd_frame: [0.720, 0.735, 0.760, 1.0],
            live_lcd_title: [0.220, 0.240, 0.275, 1.0],
            live_lcd_control_fg: [0.820, 0.380, 0.040, 1.0],
            live_lcd_control_fg_alt: [0.020, 0.460, 0.680, 1.0],
            live_display_line_one: [0.820, 0.380, 0.040, 1.0],
            live_display_line_two: [0.020, 0.460, 0.680, 1.0],
            live_display_handle_one: [0.820, 0.380, 0.040, 1.0],
            live_display_handle_two: [0.780, 0.160, 0.340, 1.0],
            live_display_scale_text: [0.420, 0.445, 0.480, 1.0],
            live_control_bg: [0.895, 0.905, 0.920, 1.0],
            live_control_fg: [0.160, 0.180, 0.210, 1.0],
            live_control_selection: [0.860, 0.420, 0.060, 1.0],
            live_control_text_selection: [0.980, 0.980, 0.990, 1.0],
            live_control_zombie: [0.560, 0.580, 0.610, 1.0],
            live_alert: [0.800, 0.180, 0.160, 1.0],
            accent_green: [0.100, 0.580, 0.320, 1.0],
            accent_violet: [0.460, 0.260, 0.780, 1.0],
            accent_yellow: [0.740, 0.540, 0.020, 1.0],
            accent_magenta: [0.740, 0.180, 0.560, 1.0]
        }
    }
};

var M4L_PRESET_NAMES = [
    "Default",
    "Ableton Live",
    "Amber LCD",
    "Cyber Cyan",
    "Mono Slate",
    "Solarized Dark",
    "High Contrast",
    "Light Studio"
];

var M4L_TOKEN_KEYS = Object.keys(M4L_DEFAULT_TOKENS);

/** @type {Object<string, Object<string, number[]>>} */
var M4L_ABLETON_ASK_THEMES = {
    "Angst Robot": {
        "live_desktop": [
            0.1647,
            0.1176,
            0.3294,
            1.0
        ],
        "live_surface_bg": [
            0.2157,
            0.1725,
            0.4275,
            1.0
        ],
        "live_surface_frame": [
            0.1333,
            0.0902,
            0.2745,
            1.0
        ],
        "live_lcd_bg": [
            0.0627,
            0.0314,
            0.149,
            1.0
        ],
        "live_lcd_frame": [
            0.2471,
            0.2078,
            0.4902,
            1.0
        ],
        "live_lcd_title": [
            0.898,
            0.902,
            0.9098,
            1.0
        ],
        "live_lcd_control_fg": [
            0.7098,
            1.0,
            0.3882,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            1.0,
            0.7686,
            0.1294,
            1.0
        ],
        "live_display_line_one": [
            0.7098,
            1.0,
            0.3882,
            1.0
        ],
        "live_display_line_two": [
            1.0,
            0.7686,
            0.1294,
            1.0
        ],
        "live_display_handle_one": [
            0.7098,
            1.0,
            0.3882,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.7922,
            0.8196,
            0.8627,
            1.0
        ],
        "live_control_bg": [
            0.102,
            0.0627,
            0.2157,
            1.0
        ],
        "live_control_fg": [
            0.898,
            0.902,
            0.9098,
            1.0
        ],
        "live_control_fg_on": [
            0.0,
            0.0,
            0.0039,
            1.0
        ],
        "live_control_selection": [
            0.7098,
            1.0,
            0.3882,
            1.0
        ],
        "live_control_text_selection": [
            0.0,
            0.0,
            0.0039,
            1.0
        ],
        "live_control_zombie": [
            0.6745,
            0.7294,
            0.8275,
            1.0
        ],
        "live_alert": [
            1.0,
            0.0431,
            0.0392,
            1.0
        ],
        "live_contrast_frame": [
            0.0235,
            0.0118,
            0.0745,
            1.0
        ],
        "live_dial_fg": [
            0.0235,
            0.0118,
            0.0745,
            1.0
        ],
        "live_dial_needle": [
            0.0627,
            0.0314,
            0.149,
            1.0
        ],
        "live_value_arc": [
            1.0,
            0.7686,
            0.1294,
            1.0
        ],
        "live_value_bar": [
            0.6039,
            0.4235,
            0.0,
            1.0
        ],
        "live_macro_title": [
            0.2902,
            0.2784,
            0.5882,
            1.0
        ]
    },
    "Classic Medium Dark": {
        "live_desktop": [
            0.2235,
            0.2235,
            0.2235,
            1.0
        ],
        "live_surface_bg": [
            0.3098,
            0.3098,
            0.3098,
            1.0
        ],
        "live_surface_frame": [
            0.1647,
            0.1647,
            0.1647,
            1.0
        ],
        "live_lcd_bg": [
            0.1216,
            0.1216,
            0.1216,
            1.0
        ],
        "live_lcd_frame": [
            0.3569,
            0.3569,
            0.3569,
            1.0
        ],
        "live_lcd_title": [
            0.8784,
            0.8784,
            0.8784,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6118,
            0.2235,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6118,
            0.2235,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6118,
            0.2235,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.7373,
            0.7373,
            0.7373,
            1.0
        ],
        "live_control_bg": [
            0.2588,
            0.2588,
            0.2588,
            1.0
        ],
        "live_control_fg": [
            0.8784,
            0.8784,
            0.8784,
            1.0
        ],
        "live_control_fg_on": [
            0.0314,
            0.0314,
            0.0314,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6118,
            0.2235,
            1.0
        ],
        "live_control_text_selection": [
            0.0314,
            0.0314,
            0.0314,
            1.0
        ],
        "live_control_zombie": [
            0.6549,
            0.6549,
            0.6549,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0824,
            0.0824,
            0.0824,
            1.0
        ],
        "live_dial_fg": [
            0.0824,
            0.0824,
            0.0824,
            1.0
        ],
        "live_dial_needle": [
            0.1216,
            0.1216,
            0.1216,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.4078,
            0.4078,
            0.4078,
            1.0
        ]
    },
    "Classic Medium Light": {
        "live_desktop": [
            0.3373,
            0.3373,
            0.3373,
            1.0
        ],
        "live_surface_bg": [
            0.5725,
            0.5725,
            0.5725,
            1.0
        ],
        "live_surface_frame": [
            0.3373,
            0.3373,
            0.3373,
            1.0
        ],
        "live_lcd_bg": [
            0.1137,
            0.1137,
            0.1137,
            1.0
        ],
        "live_lcd_frame": [
            0.2196,
            0.2196,
            0.2196,
            1.0
        ],
        "live_lcd_title": [
            0.7765,
            0.7765,
            0.7765,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_handle_two": [
            0.9725,
            0.4627,
            0.502,
            1.0
        ],
        "live_display_scale_text": [
            0.7804,
            0.7804,
            0.7804,
            0.498
        ],
        "live_control_bg": [
            0.7765,
            0.7765,
            0.7765,
            1.0
        ],
        "live_control_fg": [
            0.0,
            0.0,
            0.0,
            1.0
        ],
        "live_control_fg_on": [
            0.0,
            0.0,
            0.0,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_control_text_selection": [
            0.0,
            0.0,
            0.0,
            1.0
        ],
        "live_control_zombie": [
            0.3373,
            0.3373,
            0.3373,
            1.0
        ],
        "live_alert": [
            1.0,
            0.4902,
            0.2627,
            1.0
        ],
        "live_contrast_frame": [
            0.2196,
            0.2196,
            0.2196,
            1.0
        ],
        "live_dial_fg": [
            0.1137,
            0.1137,
            0.1137,
            1.0
        ],
        "live_dial_needle": [
            0.1137,
            0.1137,
            0.1137,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.7922,
            0.8588,
            1.0
        ],
        "live_macro_title": [
            0.6863,
            0.6863,
            0.6863,
            1.0
        ]
    },
    "Default Dark Cool High": {
        "live_desktop": [
            0.1333,
            0.1412,
            0.1765,
            1.0
        ],
        "live_surface_bg": [
            0.1922,
            0.2039,
            0.2431,
            1.0
        ],
        "live_surface_frame": [
            0.1059,
            0.1137,
            0.1451,
            1.0
        ],
        "live_lcd_bg": [
            0.051,
            0.0588,
            0.0863,
            1.0
        ],
        "live_lcd_frame": [
            0.2392,
            0.2471,
            0.2941,
            1.0
        ],
        "live_lcd_title": [
            0.8431,
            0.8471,
            0.8824,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.6588,
            0.6627,
            0.7098,
            1.0
        ],
        "live_control_bg": [
            0.0784,
            0.0863,
            0.1176,
            1.0
        ],
        "live_control_fg": [
            0.8431,
            0.8471,
            0.8824,
            1.0
        ],
        "live_control_fg_on": [
            0.0078,
            0.0118,
            0.0196,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_control_text_selection": [
            0.0078,
            0.0118,
            0.0196,
            1.0
        ],
        "live_control_zombie": [
            0.5725,
            0.5804,
            0.6275,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0275,
            0.0353,
            0.0549,
            1.0
        ],
        "live_dial_fg": [
            0.0275,
            0.0353,
            0.0549,
            1.0
        ],
        "live_dial_needle": [
            0.051,
            0.0588,
            0.0863,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.2863,
            0.2941,
            0.3412,
            1.0
        ]
    },
    "Default Dark Cool Medium": {
        "live_desktop": [
            0.1529,
            0.1647,
            0.2,
            1.0
        ],
        "live_surface_bg": [
            0.2,
            0.2078,
            0.251,
            1.0
        ],
        "live_surface_frame": [
            0.1333,
            0.1412,
            0.1765,
            1.0
        ],
        "live_lcd_bg": [
            0.0863,
            0.0941,
            0.1216,
            1.0
        ],
        "live_lcd_frame": [
            0.2314,
            0.2392,
            0.2824,
            1.0
        ],
        "live_lcd_title": [
            0.702,
            0.7059,
            0.7412,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.5176,
            0.5216,
            0.5686,
            1.0
        ],
        "live_control_bg": [
            0.1098,
            0.1176,
            0.149,
            1.0
        ],
        "live_control_fg": [
            0.702,
            0.7059,
            0.7412,
            1.0
        ],
        "live_control_fg_on": [
            0.0235,
            0.0235,
            0.0392,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_control_text_selection": [
            0.0235,
            0.0235,
            0.0392,
            1.0
        ],
        "live_control_zombie": [
            0.451,
            0.4588,
            0.5059,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0588,
            0.0667,
            0.0902,
            1.0
        ],
        "live_dial_fg": [
            0.0588,
            0.0667,
            0.0902,
            1.0
        ],
        "live_dial_needle": [
            0.0863,
            0.0941,
            0.1216,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.2627,
            0.2706,
            0.3137,
            1.0
        ]
    },
    "Default Dark Neutral High": {
        "live_desktop": [
            0.1412,
            0.1412,
            0.1412,
            1.0
        ],
        "live_surface_bg": [
            0.2039,
            0.2039,
            0.2039,
            1.0
        ],
        "live_surface_frame": [
            0.1137,
            0.1137,
            0.1137,
            1.0
        ],
        "live_lcd_bg": [
            0.0588,
            0.0588,
            0.0588,
            1.0
        ],
        "live_lcd_frame": [
            0.251,
            0.251,
            0.251,
            1.0
        ],
        "live_lcd_title": [
            0.8471,
            0.8471,
            0.8471,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.6667,
            0.6667,
            0.6667,
            1.0
        ],
        "live_control_bg": [
            0.0863,
            0.0863,
            0.0863,
            1.0
        ],
        "live_control_fg": [
            0.8471,
            0.8471,
            0.8471,
            1.0
        ],
        "live_control_fg_on": [
            0.0118,
            0.0118,
            0.0118,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_control_text_selection": [
            0.0118,
            0.0118,
            0.0118,
            1.0
        ],
        "live_control_zombie": [
            0.5804,
            0.5804,
            0.5804,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0353,
            0.0353,
            0.0353,
            1.0
        ],
        "live_dial_fg": [
            0.0353,
            0.0353,
            0.0353,
            1.0
        ],
        "live_dial_needle": [
            0.0588,
            0.0588,
            0.0588,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.298,
            0.298,
            0.298,
            1.0
        ]
    },
    "Default Dark Neutral Medium": {
        "live_desktop": [
            0.1647,
            0.1647,
            0.1647,
            1.0
        ],
        "live_surface_bg": [
            0.2118,
            0.2118,
            0.2118,
            1.0
        ],
        "live_surface_frame": [
            0.1412,
            0.1412,
            0.1412,
            1.0
        ],
        "live_lcd_bg": [
            0.0941,
            0.0941,
            0.0941,
            1.0
        ],
        "live_lcd_frame": [
            0.2431,
            0.2431,
            0.2431,
            1.0
        ],
        "live_lcd_title": [
            0.7098,
            0.7098,
            0.7098,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.5255,
            0.5255,
            0.5255,
            1.0
        ],
        "live_control_bg": [
            0.1176,
            0.1176,
            0.1176,
            1.0
        ],
        "live_control_fg": [
            0.7098,
            0.7098,
            0.7098,
            1.0
        ],
        "live_control_fg_on": [
            0.0275,
            0.0275,
            0.0275,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_control_text_selection": [
            0.0275,
            0.0275,
            0.0275,
            1.0
        ],
        "live_control_zombie": [
            0.4588,
            0.4588,
            0.4588,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0667,
            0.0667,
            0.0667,
            1.0
        ],
        "live_dial_fg": [
            0.0667,
            0.0667,
            0.0667,
            1.0
        ],
        "live_dial_needle": [
            0.0941,
            0.0941,
            0.0941,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.2745,
            0.2745,
            0.2745,
            1.0
        ]
    },
    "Default Dark Warm High": {
        "live_desktop": [
            0.1647,
            0.1373,
            0.1137,
            1.0
        ],
        "live_surface_bg": [
            0.2314,
            0.2,
            0.1686,
            1.0
        ],
        "live_surface_frame": [
            0.1333,
            0.1098,
            0.0902,
            1.0
        ],
        "live_lcd_bg": [
            0.0745,
            0.0549,
            0.0431,
            1.0
        ],
        "live_lcd_frame": [
            0.2824,
            0.2431,
            0.2078,
            1.0
        ],
        "live_lcd_title": [
            0.8863,
            0.8431,
            0.7804,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.7137,
            0.6588,
            0.5882,
            1.0
        ],
        "live_control_bg": [
            0.1059,
            0.0824,
            0.0667,
            1.0
        ],
        "live_control_fg": [
            0.8863,
            0.8431,
            0.7804,
            1.0
        ],
        "live_control_fg_on": [
            0.0157,
            0.0078,
            0.0078,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_control_text_selection": [
            0.0157,
            0.0078,
            0.0078,
            1.0
        ],
        "live_control_zombie": [
            0.6275,
            0.5725,
            0.5059,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0471,
            0.0314,
            0.0235,
            1.0
        ],
        "live_dial_fg": [
            0.0471,
            0.0314,
            0.0235,
            1.0
        ],
        "live_dial_needle": [
            0.0745,
            0.0549,
            0.0431,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.3294,
            0.2902,
            0.2471,
            1.0
        ]
    },
    "Default Dark Warm Medium": {
        "live_desktop": [
            0.1843,
            0.1608,
            0.1451,
            1.0
        ],
        "live_surface_bg": [
            0.2353,
            0.2039,
            0.1843,
            1.0
        ],
        "live_surface_frame": [
            0.1608,
            0.1373,
            0.1216,
            1.0
        ],
        "live_lcd_bg": [
            0.1098,
            0.0902,
            0.0784,
            1.0
        ],
        "live_lcd_frame": [
            0.2667,
            0.2353,
            0.2118,
            1.0
        ],
        "live_lcd_title": [
            0.7451,
            0.702,
            0.6471,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.5647,
            0.5176,
            0.4706,
            1.0
        ],
        "live_control_bg": [
            0.1373,
            0.1137,
            0.102,
            1.0
        ],
        "live_control_fg": [
            0.7451,
            0.702,
            0.6471,
            1.0
        ],
        "live_control_fg_on": [
            0.0314,
            0.0235,
            0.0196,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_control_text_selection": [
            0.0314,
            0.0235,
            0.0196,
            1.0
        ],
        "live_control_zombie": [
            0.4941,
            0.4549,
            0.4118,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0784,
            0.0627,
            0.051,
            1.0
        ],
        "live_dial_fg": [
            0.0784,
            0.0627,
            0.051,
            1.0
        ],
        "live_dial_needle": [
            0.1098,
            0.0902,
            0.0784,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.298,
            0.2667,
            0.2431,
            1.0
        ]
    },
    "Default Light Cool High": {
        "live_desktop": [
            0.451,
            0.4667,
            0.5098,
            1.0
        ],
        "live_surface_bg": [
            0.6431,
            0.6588,
            0.6941,
            1.0
        ],
        "live_surface_frame": [
            0.3412,
            0.3569,
            0.4039,
            1.0
        ],
        "live_lcd_bg": [
            0.0353,
            0.0471,
            0.0863,
            1.0
        ],
        "live_lcd_frame": [
            0.2471,
            0.2627,
            0.3098,
            1.0
        ],
        "live_lcd_title": [
            0.8314,
            0.8392,
            0.8627,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_handle_two": [
            0.9725,
            0.4627,
            0.502,
            1.0
        ],
        "live_display_scale_text": [
            0.8353,
            0.8431,
            0.8667,
            0.498
        ],
        "live_control_bg": [
            0.8314,
            0.8392,
            0.8627,
            1.0
        ],
        "live_control_fg": [
            0.0078,
            0.0118,
            0.0314,
            1.0
        ],
        "live_control_fg_on": [
            0.0078,
            0.0118,
            0.0314,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_control_text_selection": [
            0.0078,
            0.0118,
            0.0314,
            1.0
        ],
        "live_control_zombie": [
            0.3412,
            0.3569,
            0.4039,
            1.0
        ],
        "live_alert": [
            1.0,
            0.4902,
            0.2627,
            1.0
        ],
        "live_contrast_frame": [
            0.1922,
            0.2078,
            0.2549,
            1.0
        ],
        "live_dial_fg": [
            0.0353,
            0.0471,
            0.0863,
            1.0
        ],
        "live_dial_needle": [
            0.0353,
            0.0471,
            0.0863,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.7922,
            0.8588,
            1.0
        ],
        "live_macro_title": [
            0.7529,
            0.7647,
            0.7961,
            1.0
        ]
    },
    "Default Light Cool Medium": {
        "live_desktop": [
            0.4902,
            0.5059,
            0.5529,
            1.0
        ],
        "live_surface_bg": [
            0.6314,
            0.6471,
            0.6824,
            1.0
        ],
        "live_surface_frame": [
            0.4118,
            0.4314,
            0.4784,
            1.0
        ],
        "live_lcd_bg": [
            0.1255,
            0.1412,
            0.1804,
            1.0
        ],
        "live_lcd_frame": [
            0.3412,
            0.3569,
            0.4039,
            1.0
        ],
        "live_lcd_title": [
            0.8039,
            0.8118,
            0.8353,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_handle_two": [
            0.9725,
            0.4627,
            0.502,
            1.0
        ],
        "live_display_scale_text": [
            0.8039,
            0.8118,
            0.8353,
            0.498
        ],
        "live_control_bg": [
            0.8039,
            0.8118,
            0.8353,
            1.0
        ],
        "live_control_fg": [
            0.0588,
            0.0706,
            0.102,
            1.0
        ],
        "live_control_fg_on": [
            0.0588,
            0.0706,
            0.102,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_control_text_selection": [
            0.0588,
            0.0706,
            0.102,
            1.0
        ],
        "live_control_zombie": [
            0.4118,
            0.4314,
            0.4784,
            1.0
        ],
        "live_alert": [
            1.0,
            0.4902,
            0.2627,
            1.0
        ],
        "live_contrast_frame": [
            0.2941,
            0.3098,
            0.3608,
            1.0
        ],
        "live_dial_fg": [
            0.1255,
            0.1412,
            0.1804,
            1.0
        ],
        "live_dial_needle": [
            0.1255,
            0.1412,
            0.1804,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.7922,
            0.8588,
            1.0
        ],
        "live_macro_title": [
            0.7255,
            0.7373,
            0.7686,
            1.0
        ]
    },
    "Default Light Neutral High": {
        "live_desktop": [
            0.4667,
            0.4667,
            0.4667,
            1.0
        ],
        "live_surface_bg": [
            0.6588,
            0.6588,
            0.6588,
            1.0
        ],
        "live_surface_frame": [
            0.3569,
            0.3569,
            0.3569,
            1.0
        ],
        "live_lcd_bg": [
            0.051,
            0.051,
            0.051,
            1.0
        ],
        "live_lcd_frame": [
            0.2627,
            0.2627,
            0.2627,
            1.0
        ],
        "live_lcd_title": [
            0.8392,
            0.8392,
            0.8392,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_handle_two": [
            0.9725,
            0.4627,
            0.502,
            1.0
        ],
        "live_display_scale_text": [
            0.8431,
            0.8431,
            0.8431,
            0.498
        ],
        "live_control_bg": [
            0.8392,
            0.8392,
            0.8392,
            1.0
        ],
        "live_control_fg": [
            0.0118,
            0.0118,
            0.0118,
            1.0
        ],
        "live_control_fg_on": [
            0.0118,
            0.0118,
            0.0118,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_control_text_selection": [
            0.0118,
            0.0118,
            0.0118,
            1.0
        ],
        "live_control_zombie": [
            0.3569,
            0.3569,
            0.3569,
            1.0
        ],
        "live_alert": [
            1.0,
            0.4902,
            0.2627,
            1.0
        ],
        "live_contrast_frame": [
            0.2078,
            0.2078,
            0.2078,
            1.0
        ],
        "live_dial_fg": [
            0.051,
            0.051,
            0.051,
            1.0
        ],
        "live_dial_needle": [
            0.051,
            0.051,
            0.051,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.7922,
            0.8588,
            1.0
        ],
        "live_macro_title": [
            0.7647,
            0.7647,
            0.7647,
            1.0
        ]
    },
    "Default Light Neutral Medium": {
        "live_desktop": [
            0.5059,
            0.5059,
            0.5059,
            1.0
        ],
        "live_surface_bg": [
            0.6471,
            0.6471,
            0.6471,
            1.0
        ],
        "live_surface_frame": [
            0.4314,
            0.4314,
            0.4314,
            1.0
        ],
        "live_lcd_bg": [
            0.1412,
            0.1412,
            0.1412,
            1.0
        ],
        "live_lcd_frame": [
            0.3569,
            0.3569,
            0.3569,
            1.0
        ],
        "live_lcd_title": [
            0.8118,
            0.8118,
            0.8118,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_handle_two": [
            0.9725,
            0.4627,
            0.502,
            1.0
        ],
        "live_display_scale_text": [
            0.8118,
            0.8118,
            0.8118,
            0.498
        ],
        "live_control_bg": [
            0.8118,
            0.8118,
            0.8118,
            1.0
        ],
        "live_control_fg": [
            0.0706,
            0.0706,
            0.0706,
            1.0
        ],
        "live_control_fg_on": [
            0.0706,
            0.0706,
            0.0706,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_control_text_selection": [
            0.0706,
            0.0706,
            0.0706,
            1.0
        ],
        "live_control_zombie": [
            0.4314,
            0.4314,
            0.4314,
            1.0
        ],
        "live_alert": [
            1.0,
            0.4902,
            0.2627,
            1.0
        ],
        "live_contrast_frame": [
            0.3098,
            0.3098,
            0.3098,
            1.0
        ],
        "live_dial_fg": [
            0.1412,
            0.1412,
            0.1412,
            1.0
        ],
        "live_dial_needle": [
            0.1412,
            0.1412,
            0.1412,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.7922,
            0.8588,
            1.0
        ],
        "live_macro_title": [
            0.7373,
            0.7373,
            0.7373,
            1.0
        ]
    },
    "Default Light Warm High": {
        "live_desktop": [
            0.502,
            0.4588,
            0.4196,
            1.0
        ],
        "live_surface_bg": [
            0.6902,
            0.651,
            0.6196,
            1.0
        ],
        "live_surface_frame": [
            0.3961,
            0.349,
            0.3098,
            1.0
        ],
        "live_lcd_bg": [
            0.0706,
            0.0392,
            0.0118,
            1.0
        ],
        "live_lcd_frame": [
            0.298,
            0.2549,
            0.2157,
            1.0
        ],
        "live_lcd_title": [
            0.8627,
            0.8353,
            0.8157,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_handle_two": [
            0.9725,
            0.4627,
            0.502,
            1.0
        ],
        "live_display_scale_text": [
            0.8667,
            0.8353,
            0.8196,
            0.498
        ],
        "live_control_bg": [
            0.8627,
            0.8353,
            0.8157,
            1.0
        ],
        "live_control_fg": [
            0.0235,
            0.0078,
            0.0,
            1.0
        ],
        "live_control_fg_on": [
            0.0235,
            0.0078,
            0.0,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_control_text_selection": [
            0.0235,
            0.0078,
            0.0,
            1.0
        ],
        "live_control_zombie": [
            0.3961,
            0.349,
            0.3098,
            1.0
        ],
        "live_alert": [
            1.0,
            0.4902,
            0.2627,
            1.0
        ],
        "live_contrast_frame": [
            0.2431,
            0.2,
            0.1569,
            1.0
        ],
        "live_dial_fg": [
            0.0706,
            0.0392,
            0.0118,
            1.0
        ],
        "live_dial_needle": [
            0.0706,
            0.0392,
            0.0118,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.7922,
            0.8588,
            1.0
        ],
        "live_macro_title": [
            0.7922,
            0.7569,
            0.7333,
            1.0
        ]
    },
    "Default Light Warm Medium": {
        "live_desktop": [
            0.5451,
            0.498,
            0.4627,
            1.0
        ],
        "live_surface_bg": [
            0.6784,
            0.6392,
            0.6078,
            1.0
        ],
        "live_surface_frame": [
            0.4667,
            0.4196,
            0.3804,
            1.0
        ],
        "live_lcd_bg": [
            0.1686,
            0.1333,
            0.098,
            1.0
        ],
        "live_lcd_frame": [
            0.3961,
            0.349,
            0.3059,
            1.0
        ],
        "live_lcd_title": [
            0.8314,
            0.8039,
            0.7882,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_display_handle_two": [
            0.9725,
            0.4627,
            0.502,
            1.0
        ],
        "live_display_scale_text": [
            0.8353,
            0.8039,
            0.7882,
            0.498
        ],
        "live_control_bg": [
            0.8314,
            0.8039,
            0.7882,
            1.0
        ],
        "live_control_fg": [
            0.0941,
            0.0667,
            0.0392,
            1.0
        ],
        "live_control_fg_on": [
            0.0941,
            0.0667,
            0.0392,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7255,
            0.0039,
            1.0
        ],
        "live_control_text_selection": [
            0.0941,
            0.0667,
            0.0392,
            1.0
        ],
        "live_control_zombie": [
            0.4667,
            0.4196,
            0.3804,
            1.0
        ],
        "live_alert": [
            1.0,
            0.4902,
            0.2627,
            1.0
        ],
        "live_contrast_frame": [
            0.349,
            0.302,
            0.2588,
            1.0
        ],
        "live_dial_fg": [
            0.1686,
            0.1333,
            0.098,
            1.0
        ],
        "live_dial_needle": [
            0.1686,
            0.1333,
            0.098,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.9333,
            1.0,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.7922,
            0.8588,
            1.0
        ],
        "live_macro_title": [
            0.7647,
            0.7294,
            0.7059,
            1.0
        ]
    },
    "Immaterial": {
        "live_desktop": [
            0.1333,
            0.1412,
            0.1647,
            1.0
        ],
        "live_surface_bg": [
            0.1843,
            0.1922,
            0.2196,
            1.0
        ],
        "live_surface_frame": [
            0.1137,
            0.1216,
            0.1373,
            1.0
        ],
        "live_lcd_bg": [
            0.0706,
            0.0784,
            0.0902,
            1.0
        ],
        "live_lcd_frame": [
            0.2157,
            0.2275,
            0.2549,
            1.0
        ],
        "live_lcd_title": [
            0.7961,
            0.7961,
            0.8039,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.5686,
            0.7647,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.2784,
            0.8863,
            0.9569,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.5686,
            0.7647,
            1.0
        ],
        "live_display_line_two": [
            0.2784,
            0.8863,
            0.9569,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.5686,
            0.7647,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            1.0,
            1.0,
            1.0
        ],
        "live_display_scale_text": [
            0.5765,
            0.5843,
            0.6118,
            1.0
        ],
        "live_control_bg": [
            0.0941,
            0.098,
            0.1176,
            1.0
        ],
        "live_control_fg": [
            0.7961,
            0.7961,
            0.8039,
            1.0
        ],
        "live_control_fg_on": [
            0.0157,
            0.0196,
            0.0235,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.5686,
            0.7647,
            1.0
        ],
        "live_control_text_selection": [
            0.0157,
            0.0196,
            0.0235,
            1.0
        ],
        "live_control_zombie": [
            0.4902,
            0.502,
            0.5333,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0471,
            0.051,
            0.0627,
            1.0
        ],
        "live_dial_fg": [
            0.0471,
            0.051,
            0.0627,
            1.0
        ],
        "live_dial_needle": [
            0.0706,
            0.0784,
            0.0902,
            1.0
        ],
        "live_value_arc": [
            0.2784,
            0.8863,
            0.9569,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.5176,
            0.5765,
            1.0
        ],
        "live_macro_title": [
            0.251,
            0.2627,
            0.2941,
            1.0
        ]
    },
    "Riparian": {
        "live_desktop": [
            0.0863,
            0.1569,
            0.1804,
            1.0
        ],
        "live_surface_bg": [
            0.149,
            0.2196,
            0.2471,
            1.0
        ],
        "live_surface_frame": [
            0.0588,
            0.1255,
            0.149,
            1.0
        ],
        "live_lcd_bg": [
            0.0118,
            0.0667,
            0.0902,
            1.0
        ],
        "live_lcd_frame": [
            0.1922,
            0.2627,
            0.2902,
            1.0
        ],
        "live_lcd_title": [
            0.8392,
            0.8039,
            0.6588,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.7765,
            0.3451,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0,
            0.8,
            0.7176,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.7765,
            0.3451,
            1.0
        ],
        "live_display_line_two": [
            0.0,
            0.8,
            0.7176,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.7765,
            0.3451,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.6275,
            0.6627,
            0.6196,
            1.0
        ],
        "live_control_bg": [
            0.0314,
            0.098,
            0.1216,
            1.0
        ],
        "live_control_fg": [
            0.8392,
            0.8039,
            0.6588,
            1.0
        ],
        "live_control_fg_on": [
            0.0,
            0.0039,
            0.0078,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.7765,
            0.3451,
            1.0
        ],
        "live_control_text_selection": [
            0.0,
            0.0039,
            0.0078,
            1.0
        ],
        "live_control_zombie": [
            0.5098,
            0.5686,
            0.5608,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.0,
            0.0392,
            0.0588,
            1.0
        ],
        "live_dial_fg": [
            0.0,
            0.0392,
            0.0588,
            1.0
        ],
        "live_dial_needle": [
            0.0118,
            0.0667,
            0.0902,
            1.0
        ],
        "live_value_arc": [
            0.0,
            0.8,
            0.7176,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.4745,
            0.4118,
            1.0
        ],
        "live_macro_title": [
            0.2392,
            0.3098,
            0.3333,
            1.0
        ]
    },
    "Twenty-Four Carat": {
        "live_desktop": [
            0.1569,
            0.1569,
            0.1569,
            1.0
        ],
        "live_surface_bg": [
            0.2039,
            0.2039,
            0.2039,
            1.0
        ],
        "live_surface_frame": [
            0.1333,
            0.1333,
            0.1333,
            1.0
        ],
        "live_lcd_bg": [
            0.0784,
            0.0784,
            0.0784,
            1.0
        ],
        "live_lcd_frame": [
            0.2392,
            0.2392,
            0.2353,
            1.0
        ],
        "live_lcd_title": [
            0.8824,
            0.7765,
            0.6118,
            1.0
        ],
        "live_lcd_control_fg": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_lcd_control_fg_alt": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_line_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_line_two": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_display_handle_one": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_display_handle_two": [
            1.0,
            0.4118,
            0.498,
            1.0
        ],
        "live_display_scale_text": [
            0.7059,
            0.6039,
            0.4471,
            1.0
        ],
        "live_control_bg": [
            0.1059,
            0.1059,
            0.1059,
            1.0
        ],
        "live_control_fg": [
            0.8824,
            0.7765,
            0.6118,
            1.0
        ],
        "live_control_fg_on": [
            0.0157,
            0.0157,
            0.0157,
            1.0
        ],
        "live_control_selection": [
            1.0,
            0.6784,
            0.3373,
            1.0
        ],
        "live_control_text_selection": [
            0.0157,
            0.0157,
            0.0157,
            1.0
        ],
        "live_control_zombie": [
            0.549,
            0.498,
            0.4235,
            1.0
        ],
        "live_alert": [
            0.9059,
            0.4118,
            0.2588,
            1.0
        ],
        "live_contrast_frame": [
            0.051,
            0.051,
            0.051,
            1.0
        ],
        "live_dial_fg": [
            0.051,
            0.051,
            0.051,
            1.0
        ],
        "live_dial_needle": [
            0.0784,
            0.0784,
            0.0784,
            1.0
        ],
        "live_value_arc": [
            0.0118,
            0.7647,
            0.8353,
            1.0
        ],
        "live_value_bar": [
            0.0,
            0.451,
            0.5137,
            1.0
        ],
        "live_macro_title": [
            0.2784,
            0.2745,
            0.2706,
            1.0
        ]
    }
};

var M4L_SKIN_TINTED_TOKENS = {
    live_desktop: 1,
    live_surface_bg: 1,
    live_surface_frame: 1,
    live_lcd_bg: 1,
    live_lcd_frame: 1,
    live_lcd_title: 1,
    live_display_scale_text: 1,
    live_control_bg: 1,
    live_control_fg: 1,
    live_control_fg_on: 1,
    live_control_text_selection: 1,
    live_control_zombie: 1,
    live_contrast_frame: 1,
    live_dial_fg: 1,
    live_dial_needle: 1,
    live_macro_title: 1
};

/**
 * Resolves the Ableton Live 12 `.ask` theme filename key from Live UI preferences:
 * `{ theme, appearance, tone, highContrast }`.
 * @param {any} ui
 * @returns {string}
 */
function m4lResolveAbletonAskName(ui) {
    var u = ui || {};
    var th = String(u.theme || "Default");
    if (th !== "Default") {
        if (M4L_ABLETON_ASK_THEMES[th]) return th;
        return "Default Dark Neutral Medium";
    }
    var app = String(u.appearance || "Dark");
    if (app === "Follow System") app = "Dark";
    var lightDark = app === "Light" ? "Light" : "Dark";
    var tone = String(u.tone || "Neutral");
    if (tone !== "Warm" && tone !== "Cool") tone = "Neutral";
    var hc = (u.highContrast === true || u.highContrast === "On" || Number(u.highContrast) === 1) ? "High" : "Medium";
    var key = "Default " + lightDark + " " + tone + " " + hc;
    return M4L_ABLETON_ASK_THEMES[key] ? key : "Default Dark Neutral Medium";
}

/**
 * Default Ableton Live 12 Theme & Customization settings (`Preferences > Theme & Colors`).
 * @returns {{ enabled: boolean, theme: string, appearance: string, tone: string, highContrast: boolean, gridLineIntensity: number, brightness: number, colorIntensity: number, colorHue: number }}
 */
function m4lDefaultAbletonUi() {
    return {
        enabled: false,
        theme: "Default",
        appearance: "Dark",
        tone: "Neutral",
        highContrast: false,
        gridLineIntensity: 100,
        brightness: 100,
        colorIntensity: 0,
        colorHue: 0
    };
}

/**
 * Computes the exact `max.getcolor(...)` token map produced by Ableton Live 12 for a given set of
 * Live `Theme & Colors` UI settings (`theme`, `appearance`, `tone`, `highContrast`, `gridLineIntensity`,
 * `brightness` 0..200%, `colorIntensity` 0..100%, `colorHue` 0..360 deg).
 * Verified against Ableton Live 12.4.7 in the macos-1 VM.
 * @param {any} ui
 * @returns {Object<string, number[]>}
 */
function m4lComputeAbletonUiTokens(ui) {
    var u = Object.assign(m4lDefaultAbletonUi(), ui || {});
    var askName = m4lResolveAbletonAskName(u);
    var baseMap = M4L_ABLETON_ASK_THEMES[askName] || M4L_ABLETON_ASK_THEMES["Default Dark Neutral Medium"];
    var brtPct = m4lClamp(Number(u.brightness === undefined ? 100 : u.brightness), 0, 200);
    var intPct = m4lClamp(Number(u.colorIntensity || 0), 0, 100);
    var hueDeg = ((Number(u.colorHue || 0) % 360) + 360) % 360;

    // Brightness curve measured in Live 12.4.7:
    // At 95%, ratio is ~0.963; at 50% (and 0..50%), ratio is ~0.43 + 0.16 * l0; at 150%, ~1.335; at 200%, ~1.465
    var brtScale = 1.0;
    if (brtPct < 100) {
        if (brtPct >= 90) {
            brtScale = 1.0 - ((100 - brtPct) / 100.0) * 0.74;
        } else {
            var effB = Math.max(50, brtPct);
            var tLo = (100 - effB) / 50.0; // 0 at 100%, 1 at 50%
            brtScale = 1.0 - tLo * 0.545;
        }
    } else if (brtPct > 100) {
        var tHi = (brtPct - 100) / 100.0;
        brtScale = 1.0 + 0.875 * tHi - 0.410 * tHi * tHi;
    }

    var sAdd = 0.25 * (intPct / 100.0);
    var hRad = (hueDeg * Math.PI) / 180.0;

    /** @type {Object<string, number[]>} */
    var out = {};
    var allKeys = Object.keys(Object.assign({}, M4L_DEFAULT_TOKENS, baseMap));
    for (var i = 0; i < allKeys.length; i++) {
        var k = allKeys[i];
        var src = baseMap[k] || M4L_DEFAULT_TOKENS[k] || [0.5, 0.5, 0.5, 1.0];
        var a = src.length > 3 ? src[3] : 1.0;
        if (!M4L_SKIN_TINTED_TOKENS[k]) {
            out[k] = [src[0], src[1], src[2], a];
            continue;
        }
        var hsl = m4lRgbToHsl(src[0], src[1], src[2]);
        var h0 = hsl[0], s0 = hsl[1], l0 = hsl[2];
        var l1 = l0;
        if (Math.abs(brtPct - 100) > 1e-4) {
            if (brtPct < 90) {
                var effB2 = Math.max(50, brtPct);
                var tLo2 = (100 - effB2) / 50.0;
                var loRatio = 0.415 + 0.195 * l0;
                l1 = m4lClamp(l0 * (1.0 - tLo2 * (1.0 - loRatio)), 0, 0.96);
            } else if (brtPct > 100 && l0 > 0.6) {
                var softScale = 1.0 + (brtScale - 1.0) * (1.0 - 0.28 * ((l0 - 0.6) / 0.11));
                l1 = m4lClamp(l0 * softScale, 0, 0.96);
            } else {
                l1 = m4lClamp(l0 * brtScale, 0, 0.96);
            }
        }
        var hFinal = h0;
        var sFinal = s0;
        if (sAdd > 1e-5) {
            if (s0 < 1e-4) {
                hFinal = hueDeg;
                sFinal = sAdd;
            } else {
                // Ableton's tone presets (Warm/Cool) apply a subtle base tint (~0.45 weight when custom Color Intensity is added)
                var a0 = (h0 * Math.PI) / 180.0;
                var w0 = 0.45;
                var vx = w0 * s0 * Math.cos(a0) + sAdd * Math.cos(hRad);
                var vy = w0 * s0 * Math.sin(a0) + sAdd * Math.sin(hRad);
                sFinal = m4lClamp(Math.sqrt(vx * vx + vy * vy), 0, 1.0);
                hFinal = ((Math.atan2(vy, vx) * 180.0) / Math.PI + 360.0) % 360.0;
            }
        }
        var rgb = m4lHslToRgb(hFinal, sFinal, l1);
        out[k] = [
            Math.round(rgb[0] * 255) / 255,
            Math.round(rgb[1] * 255) / 255,
            Math.round(rgb[2] * 255) / 255,
            a
        ];
    }
    return out;
}

/**
 * Helper to convert an `.ask` theme name into `{ theme, appearance, tone, highContrast }`.
 * @param {string} askName
 * @param {number} brt
 * @param {number} cint
 * @param {number} chue
 */
function parseAskNameToUi(askName, brt, cint, chue) {
    var m = /^Default (Dark|Light) (Neutral|Warm|Cool) (Medium|High)$/.exec(askName);
    if (m) {
        return {
            enabled: true,
            theme: "Default",
            appearance: m[1],
            tone: m[2],
            highContrast: m[3] === "High",
            gridLineIntensity: 100,
            brightness: brt,
            colorIntensity: cint,
            colorHue: chue
        };
    }
    return {
        enabled: true,
        theme: askName,
        appearance: "Dark",
        tone: "Neutral",
        highContrast: false,
        gridLineIntensity: 100,
        brightness: brt,
        colorIntensity: cint,
        colorHue: chue
    };
}

/**
 * Estimates Ableton Live's `Theme & Colors` UI settings (`theme`, `appearance`, `tone`, `highContrast`,
 * `brightness`, `colorIntensity`, `colorHue`) from a dictionary of measured `max.getcolor(...)` values.
 * @param {Object<string, number[]>} observedColors
 * @returns {{ theme: string, appearance: string, tone: string, highContrast: boolean, brightness: number, colorIntensity: number, colorHue: number, askName: string, rmse: number }}
 */
function m4lEstimateAbletonUiSettings(observedColors) {
    var obs = observedColors || {};
    var desk = obs.live_desktop || [0.1647, 0.1647, 0.1647];
    var surf = obs.live_surface_bg || [0.2118, 0.2118, 0.2118];
    var sel = obs.live_control_selection || [1.0, 0.6784, 0.3373];

    var hslSurf = m4lRgbToHsl(surf[0], surf[1], surf[2]);
    var hslDesk = m4lRgbToHsl(desk[0], desk[1], desk[2]);
    var meanHue = hslSurf[1] >= hslDesk[1] ? hslSurf[0] : hslDesk[0];
    var meanSat = (hslSurf[1] + hslDesk[1]) * 0.5;

    var candHues = [0, Math.round(meanHue) % 360];
    for (var dh = -24; dh <= 24; dh += 2) {
        candHues.push(((Math.round(meanHue) + dh) % 360 + 360) % 360);
    }
    var candInts = [0, 25, 50, 75, 100, m4lClamp(Math.round((meanSat / 0.25) * 100), 0, 100)];
    var candBrts = [50, 75, 90, 95, 100, 125, 150, 200];

    var askNames = Object.keys(M4L_ABLETON_ASK_THEMES);
    var best = {
        askName: "Default Dark Neutral Medium",
        brightness: 100,
        colorIntensity: 0,
        colorHue: 0,
        err: 1e9
    };

    var cmpKeys = [
        "live_lcd_bg", "live_control_bg", "live_surface_frame",
        "live_desktop", "live_surface_bg", "live_lcd_frame",
        "live_control_zombie", "live_display_scale_text",
        "live_control_fg", "live_control_selection"
    ];

    for (var ai = 0; ai < askNames.length; ai++) {
        var an = askNames[ai];
        var baseSel = M4L_ABLETON_ASK_THEMES[an].live_control_selection;
        var selDiff = Math.abs(baseSel[0] - sel[0]) + Math.abs(baseSel[1] - sel[1]) + Math.abs(baseSel[2] - sel[2]);
        if (selDiff > 0.15) continue;

        for (var bi = 0; bi < candBrts.length; bi++) {
            var bVal = candBrts[bi];
            for (var ii = 0; ii < candInts.length; ii++) {
                var iVal = candInts[ii];
                var huesToTry = iVal === 0 ? [0] : candHues;
                for (var hi = 0; hi < huesToTry.length; hi++) {
                    var hVal = huesToTry[hi];
                    var uiTry = parseAskNameToUi(an, bVal, iVal, hVal);
                    var pred = m4lComputeAbletonUiTokens(uiTry);
                    var sqErr = 0;
                    var n = 0;
                    for (var ki = 0; ki < cmpKeys.length; ki++) {
                        var ck = cmpKeys[ki];
                        if (!obs[ck] || !pred[ck]) continue;
                        var dr = obs[ck][0] - pred[ck][0];
                        var dg = obs[ck][1] - pred[ck][1];
                        var db = obs[ck][2] - pred[ck][2];
                        sqErr += dr * dr + dg * dg + db * db;
                        n += 3;
                    }
                    var reg = (iVal === 0 && hVal !== 0 ? 1e-6 : 0) + (an.indexOf("Neutral") < 0 && iVal > 0 ? 1e-6 : 0);
                    var score = (n > 0 ? sqErr / n : 1e9) + reg;
                    if (score < best.err) {
                        best = { askName: an, brightness: bVal, colorIntensity: iVal, colorHue: hVal, err: score };
                    }
                }
            }
        }
    }

    var parsed = parseAskNameToUi(best.askName, best.brightness, best.colorIntensity, best.colorHue);
    return {
        theme: parsed.theme,
        appearance: parsed.appearance,
        tone: parsed.tone,
        highContrast: parsed.highContrast,
        brightness: best.brightness,
        colorIntensity: best.colorIntensity,
        colorHue: best.colorHue,
        askName: best.askName,
        rmse: Math.sqrt(Math.max(0, best.err)) * 255
    };
}


/**
 * Returns the current device's slug (injected by scripts/theme_common.py, or fallback).
 * @returns {string}
 */
function m4lDeviceSlug() {
    if (typeof M4L_DEVICE_SLUG === "string" && M4L_DEVICE_SLUG) return M4L_DEVICE_SLUG;
    return "global";
}

/**
 * Default clean state structure for `Global("m4l_theme_bus")`.
 * @returns {{ version: number, preset: string, macros: { hueShift: number, satScale: number, contrast: number, brightness: number }, tokens: Object<string, number[]>, deviceOverrides: Object<string, any>, customPresets: Object<string, any>, abletonUi?: ReturnType<typeof m4lDefaultAbletonUi> }}
 */
function m4lDefaultState() {
    return {
        version: 1,
        preset: "Default",
        macros: { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
        tokens: {},
        deviceOverrides: {},
        customPresets: {},
        abletonUi: m4lDefaultAbletonUi()
    };
}

/** @type {any} */
var _m4lLocalState = null;
var _m4lSeenBusVer = -1;
/** @type {Object<string, number[]> | null} */
var _m4lResolvedCache = null;
/** @type {Object<string, number>} */
var _m4lIssuedRgbKeys = {};
var _m4lPatcherWasThemed = false;
/** @type {any} */
var _m4lOrigSetRgba = null;
/** @type {any} */
var _m4lOrigSetRgb = null;
var _m4lHookInstalled = false;

/**
 * Clamp helper.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function m4lClamp(v, lo, hi) {
    if (!(v === v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Reads the shared theme state from `globalThis.__M4L_THEME_STATE__` (CLI / preview / tests)
 * or `Global("m4l_theme_bus")` (Max / Ableton Live runtime).
 * @returns {ReturnType<typeof m4lDefaultState>}
 */
function m4lGetThemeState() {
    if (typeof __M4L_THEME_STATE__ !== "undefined" && __M4L_THEME_STATE__) {
        return __M4L_THEME_STATE__;
    }
    try {
        if (typeof Global === "function") {
            var bus = new Global(M4L_THEME_BUS_NAME);
            if (bus && typeof bus.stateJson === "string" && bus.stateJson.length > 2) {
                var bver = Number(bus.version) || 1;
                if (!_m4lLocalState || bver !== _m4lSeenBusVer) {
                    var parsed = JSON.parse(bus.stateJson);
                    if (typeof max !== "undefined" && max && typeof max.getcolor === "function" && (!parsed.preset || parsed.preset === "Default" || parsed.preset === "Ableton Live")) {
                        if (parsed.abletonUi) parsed.abletonUi.enabled = false;
                        if (parsed.macros && parsed.preset === "Default") {
                            parsed.macros = { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 };
                        }
                    }
                    _m4lLocalState = parsed;
                    _m4lSeenBusVer = bver;
                    _m4lResolvedCache = null;
                    _m4lIssuedRgbKeys = {};
                }
                return _m4lLocalState;
            }
            if (bus && bus.state && typeof bus.state === "object") {
                return /** @type {any} */ (bus.state);
            }
        }
    } catch (e) {}
    if (!_m4lLocalState) _m4lLocalState = m4lDefaultState();
    return _m4lLocalState;
}

/**
 * Publishes a new theme state into `Global("m4l_theme_bus")` and invalidates local caches.
 * @param {any} nextState
 * @returns {ReturnType<typeof m4lDefaultState>}
 */
function m4lSetThemeState(nextState) {
    var base = m4lDefaultState();
    if (nextState && typeof nextState === "object") {
        if (typeof nextState.preset === "string") base.preset = nextState.preset;
        if (nextState.macros && typeof nextState.macros === "object") {
            base.macros = {
                hueShift: Number(nextState.macros.hueShift) || 0,
                satScale: nextState.macros.satScale === undefined ? 1.0 : Number(nextState.macros.satScale),
                contrast: nextState.macros.contrast === undefined ? 1.0 : Number(nextState.macros.contrast),
                brightness: Number(nextState.macros.brightness) || 0
            };
        }
        if (nextState.tokens && typeof nextState.tokens === "object") {
            base.tokens = Object.assign({}, nextState.tokens);
        }
        if (nextState.deviceOverrides && typeof nextState.deviceOverrides === "object") {
            base.deviceOverrides = Object.assign({}, nextState.deviceOverrides);
        }
        if (nextState.customPresets && typeof nextState.customPresets === "object") {
            base.customPresets = Object.assign({}, nextState.customPresets);
        }
        if (nextState.abletonUi && typeof nextState.abletonUi === "object") {
            base.abletonUi = Object.assign(m4lDefaultAbletonUi(), nextState.abletonUi);
        }
        base.version = (Number(nextState.version) || _m4lSeenBusVer || 0) + 1;
    }
    _m4lLocalState = base;
    _m4lSeenBusVer = base.version;
    _m4lResolvedCache = null;
    _m4lIssuedRgbKeys = {};
    try {
        if (typeof Global === "function") {
            var bus = new Global(M4L_THEME_BUS_NAME);
            bus.version = base.version;
            bus.stateJson = JSON.stringify(base);
            bus.state = base;
        }
    } catch (e) {}
    return base;
}

/**
 * Returns the effective `{ preset, macros, tokens }` for a given device slug.
 * @param {string} [slug]
 * @returns {{ preset: string, macros: { hueShift: number, satScale: number, contrast: number, brightness: number }, tokens: Object<string, number[]> }}
 */
function m4lEffectiveConfig(slug) {
    var st = m4lGetThemeState();
    var devSlug = slug || m4lDeviceSlug();
    var ov = (st.deviceOverrides && st.deviceOverrides[devSlug]) ? st.deviceOverrides[devSlug] : null;
    var preset = (ov && typeof ov.preset === "string" && ov.preset !== "") ? ov.preset : (st.preset || "Default");
    var macros = Object.assign(
        { hueShift: 0, satScale: 1.0, contrast: 1.0, brightness: 0.0 },
        st.macros || {},
        (ov && ov.macros) ? ov.macros : {}
    );
    var tokens = Object.assign({}, st.tokens || {}, (ov && ov.tokens) ? ov.tokens : {});
    return { preset: preset, macros: macros, tokens: tokens };
}

/**
 * True when theming is active for `slug` (i.e. preset is not `"Default"`, or token overrides / macros are set).
 * @param {string} [slug]
 * @returns {boolean}
 */
function m4lIsActive(slug) {
    var cfg = m4lEffectiveConfig(slug);
    if (cfg.preset && cfg.preset !== "Default") return true;
    if (cfg.tokens && Object.keys(cfg.tokens).length > 0) return true;
    var m = cfg.macros;
    if (Math.abs(m.hueShift || 0) > 1e-4) return true;
    if (Math.abs((m.satScale === undefined ? 1 : m.satScale) - 1) > 1e-4) return true;
    if (Math.abs((m.contrast === undefined ? 1 : m.contrast) - 1) > 1e-4) return true;
    if (Math.abs(m.brightness || 0) > 1e-4) return true;
    return false;
}

/**
 * RGB (0..1) -> HSL (h in 0..360, s in 0..1, l in 0..1).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number[]}
 */
function m4lRgbToHsl(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) * 0.5;
    if (mx === mn) return [0, 0, l];
    var d = mx - mn;
    var s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    var h = 0;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (mx === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return [h, s, l];
}

/**
 * HSL (h in 0..360, s in 0..1, l in 0..1) -> RGB (0..1).
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {number[]}
 */
function m4lHslToRgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c * 0.5;
    return [m4lClamp(r + m, 0, 1), m4lClamp(g + m, 0, 1), m4lClamp(b + m, 0, 1)];
}

/**
 * Applies macro adjustments (`hueShift`, `satScale`, `contrast`, `brightness`) to an RGBA color.
 * @param {number[]} col
 * @param {{ hueShift: number, satScale: number, contrast: number, brightness: number }} macros
 * @returns {number[]}
 */
function m4lApplyMacros(col, macros) {
    var r = m4lClamp(Number(col[0]) || 0, 0, 1);
    var g = m4lClamp(Number(col[1]) || 0, 0, 1);
    var b = m4lClamp(Number(col[2]) || 0, 0, 1);
    var a = col.length > 3 ? m4lClamp(Number(col[3]), 0, 1) : 1.0;
    if (!macros) return [r, g, b, a];
    var hs = Number(macros.hueShift) || 0;
    var ss = macros.satScale === undefined ? 1.0 : Number(macros.satScale);
    var ct = macros.contrast === undefined ? 1.0 : Number(macros.contrast);
    var br = Number(macros.brightness) || 0;
    if (Math.abs(hs) > 1e-4 || Math.abs(ss - 1.0) > 1e-4) {
        var hsl = m4lRgbToHsl(r, g, b);
        var nh = (hsl[0] + hs) % 360;
        if (nh < 0) nh += 360;
        var ns = m4lClamp(hsl[1] * ss, 0, 1);
        var rgb = m4lHslToRgb(nh, ns, hsl[2]);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
    }
    if (Math.abs(ct - 1.0) > 1e-4 || Math.abs(br) > 1e-4) {
        r = m4lClamp((r - 0.5) * ct + 0.5 + br, 0, 1);
        g = m4lClamp((g - 0.5) * ct + 0.5 + br, 0, 1);
        b = m4lClamp((b - 0.5) * ct + 0.5 + br, 0, 1);
    }
    return [r, g, b, a];
}

/**
 * Reads a Live theme color from `max.getcolor(name)` when available, else returns null.
 * In Ableton Live / Max runtime, `max.getcolor(name)` is ALWAYS authoritative so the device
 * matches Live's real native colors; the simulated `st.abletonUi` model is only used in offline
 * preview / WebUI environments where `max.getcolor` does not exist.
 * @param {string} name
 * @returns {number[] | null}
 */
function m4lHostLiveColor(name) {
    try {
        if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
            var c = max.getcolor(name);
            if (c && c.length >= 3 && !(c.length > 3 && c[3] === 0 && c[0] === 0 && c[1] === 0 && c[2] === 0)) {
                return [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1.0];
            }
        }
    } catch (e) {}
    try {
        var st = m4lGetThemeState();
        if (st && st.abletonUi && st.abletonUi.enabled) {
            var sim = m4lComputeAbletonUiTokens(st.abletonUi);
            if (sim[name]) return sim[name];
        }
    } catch (e) {}
    return null;
}

/**
 * Quantized key for an RGB triplet so `m4lMapRgba` never double-maps colors already resolved by `m4lColor`.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
function m4lRgbKey(r, g, b) {
    return ((r * 1000) | 0) + "," + ((g * 1000) | 0) + "," + ((b * 1000) | 0);
}

/**
 * Builds and caches the active resolved token dictionary for this device.
 * @param {string} [slug]
 * @returns {Object<string, number[]>}
 */
function m4lResolvedTokens(slug) {
    if (_m4lResolvedCache && !slug) return _m4lResolvedCache;
    var st = m4lGetThemeState();
    var cfg = m4lEffectiveConfig(slug);
    var presetObj = M4L_PRESET_THEMES[cfg.preset] || (st.customPresets && st.customPresets[cfg.preset]) || M4L_PRESET_THEMES["Default"];
    var baseTokens = (presetObj && presetObj.tokens) ? presetObj.tokens : M4L_DEFAULT_TOKENS;
    var isLiveMode = (cfg.preset === "Ableton Live" || cfg.preset === "Default");
    /** @type {Object<string, number[]>} */
    var out = {};
    /** @type {Object<string, number>} */
    var issued = {};
    for (var i = 0; i < M4L_TOKEN_KEYS.length; i++) {
        var k = M4L_TOKEN_KEYS[i];
        var raw = null;
        if (cfg.tokens && Array.isArray(cfg.tokens[k])) {
            raw = cfg.tokens[k];
        } else if (isLiveMode) {
            raw = m4lHostLiveColor(k) || baseTokens[k] || M4L_DEFAULT_TOKENS[k];
        } else {
            raw = baseTokens[k] || M4L_DEFAULT_TOKENS[k];
        }
        var c = m4lApplyMacros(raw, cfg.macros);
        out[k] = c;
        issued[m4lRgbKey(c[0], c[1], c[2])] = 1;
    }
    if (!slug) {
        _m4lResolvedCache = out;
        _m4lIssuedRgbKeys = issued;
    }
    return out;
}

/**
 * Resolves a semantic theme token (`live_lcd_bg`, `live_control_selection`, `accent_green`, etc.).
 * When in `"Default"` mode with no overrides/macros, behaves identically to `max.getcolor(name)` + `fallback`.
 * @param {string} name
 * @param {number[]} [fallback]
 * @returns {number[]}
 */
function m4lColor(name, fallback) {
    if (!m4lIsActive()) {
        var hc = m4lHostLiveColor(name);
        if (hc) return hc;
        var fb = fallback || M4L_DEFAULT_TOKENS[name] || [0.5, 0.5, 0.5, 1.0];
        return [fb[0], fb[1], fb[2], fb.length > 3 ? fb[3] : 1.0];
    }
    var map = m4lResolvedTokens();
    if (map[name]) {
        var tc = map[name];
        return [tc[0], tc[1], tc[2], tc.length > 3 ? tc[3] : 1.0];
    }
    var rawFb = fallback || M4L_DEFAULT_TOKENS[name] || [0.5, 0.5, 0.5, 1.0];
    var cfg = m4lEffectiveConfig();
    var res = m4lApplyMacros(rawFb, cfg.macros);
    _m4lIssuedRgbKeys[m4lRgbKey(res[0], res[1], res[2])] = 1;
    return res;
}

/**
 * Linear interpolation between two RGB/RGBA arrays.
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} t
 * @param {number} [alpha]
 * @returns {number[]}
 */
function m4lMixColor(a, b, t, alpha) {
    var u = m4lClamp(t, 0, 1);
    return [
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
        alpha === undefined ? (a.length > 3 ? a[3] : 1.0) : alpha
    ];
}

/**
 * Maps an arbitrary hardcoded `[r, g, b, a]` color onto the active theme's semantic palette.
 * - Colors already issued by `m4lColor()` pass through untouched (no double-mapping).
 * - Low-saturation neutrals map piecewise-linearly onto `[live_lcd_bg -> live_desktop -> live_surface_bg -> live_display_scale_text -> live_control_fg -> textHi]`.
 * - Saturated colors map by hue sector onto the active theme's semantic accents (`live_alert`, `live_lcd_control_fg`, `accent_yellow`, `accent_green`, `live_lcd_control_fg_alt`, `accent_violet`, `accent_magenta`), preserving dark-tint vs bright-stroke luminance.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} [a]
 * @returns {number[]}
 */
function m4lMapRgba(r, g, b, a) {
    var alpha = a === undefined ? 1.0 : Number(a);
    var rr = m4lClamp(Number(r) || 0, 0, 1);
    var gg = m4lClamp(Number(g) || 0, 0, 1);
    var bb = m4lClamp(Number(b) || 0, 0, 1);
    if (!m4lIsActive()) return [rr, gg, bb, alpha];

    var map = m4lResolvedTokens();
    if (_m4lIssuedRgbKeys[m4lRgbKey(rr, gg, bb)]) {
        return [rr, gg, bb, alpha];
    }

    var mx = Math.max(rr, gg, bb);
    var mn = Math.min(rr, gg, bb);
    var d = mx - mn;
    var sat = mx > 1e-4 ? d / mx : 0;
    var lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;

    var lcdBg = map.live_lcd_bg;
    var desk = map.live_desktop;
    var surf = map.live_surface_bg;
    var scaleTxt = map.live_display_scale_text;
    var ctlFg = map.live_control_fg;
    var lcdLum = 0.299 * lcdBg[0] + 0.587 * lcdBg[1] + 0.114 * lcdBg[2];
    var isLightTheme = lcdLum > 0.5;
    var hiEnd = isLightTheme ? [0.06, 0.07, 0.09, 1.0] : [0.98, 0.99, 1.0, 1.0];

    if (sat > 0.22 && d > 0.045) {
        var h = 0;
        if (mx === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60;
        else if (mx === gg) h = ((bb - rr) / d + 2) * 60;
        else h = ((rr - gg) / d + 4) * 60;

        var acc = map.live_lcd_control_fg_alt;
        if (h >= 335 || h < 18) acc = map.live_alert;
        else if (h < 48) acc = map.live_lcd_control_fg;
        else if (h < 75) acc = map.accent_yellow;
        else if (h < 168) acc = map.accent_green;
        else if (h < 235) acc = map.live_lcd_control_fg_alt;
        else if (h < 290) acc = map.accent_violet;
        else acc = map.accent_magenta;

        // Preserve relative value: dark tinted backgrounds blend from lcdBg -> acc; bright strokes use acc -> hiEnd
        if (mx < 0.55) {
            return m4lMixColor(lcdBg, acc, m4lClamp(mx / 0.65, 0.08, 0.85), alpha);
        }
        if (mn > 0.55) {
            return m4lMixColor(acc, hiEnd, m4lClamp((mn - 0.55) / 0.45, 0, 0.65), alpha);
        }
        var scaleV = m4lClamp(0.75 + 0.25 * ((mx - 0.55) / 0.45), 0.75, 1.05);
        return [
            m4lClamp(acc[0] * scaleV, 0, 1),
            m4lClamp(acc[1] * scaleV, 0, 1),
            m4lClamp(acc[2] * scaleV, 0, 1),
            alpha
        ];
    }

    // Neutral ramp mapping by original luminance (calibrated to standard dark M4L surfaces)
    if (lum <= 0.095) {
        return m4lMixColor(lcdBg, desk, lum / 0.095, alpha);
    }
    if (lum <= 0.165) {
        return m4lMixColor(desk, surf, (lum - 0.095) / 0.070, alpha);
    }
    if (lum <= 0.480) {
        return m4lMixColor(surf, scaleTxt, (lum - 0.165) / 0.315, alpha);
    }
    if (lum <= 0.780) {
        return m4lMixColor(scaleTxt, ctlFg, (lum - 0.480) / 0.300, alpha);
    }
    return m4lMixColor(ctlFg, hiEnd, (lum - 0.780) / 0.220, alpha);
}

/**
 * Installs or updates the `mgraphics` color hook when a theme is active, and unhooks when returning to `"Default"`
 * so `"Default"` mode is 100% zero-overhead pass-through.
 */
function m4lSyncMgraphicsHook() {
    if (typeof mgraphics === "undefined" || !mgraphics) return;
    var active = m4lIsActive();
    if (active && !_m4lHookInstalled) {
        _m4lOrigSetRgba = mgraphics.set_source_rgba;
        _m4lOrigSetRgb = mgraphics.set_source_rgb;
        if (typeof _m4lOrigSetRgba === "function") {
            mgraphics.set_source_rgba = /** @type {any} */ (function (/** @type {any} */ a0, /** @type {any} */ a1, /** @type {any} */ a2, /** @type {any} */ a3) {
                var r = 0, g = 0, b = 0, a = 1.0;
                if (Array.isArray(a0)) {
                    r = Number(a0[0]) || 0;
                    g = Number(a0[1]) || 0;
                    b = Number(a0[2]) || 0;
                    a = a1 !== undefined ? Number(a1) : (a0.length > 3 ? Number(a0[3]) : 1.0);
                } else {
                    r = Number(a0) || 0;
                    g = Number(a1) || 0;
                    b = Number(a2) || 0;
                    a = a3 !== undefined ? Number(a3) : 1.0;
                }
                var c = m4lMapRgba(r, g, b, a);
                _m4lOrigSetRgba.call(mgraphics, c[0], c[1], c[2], c[3]);
            });
        }
        if (typeof _m4lOrigSetRgb === "function") {
            mgraphics.set_source_rgb = /** @type {any} */ (function (/** @type {any} */ a0, /** @type {any} */ a1, /** @type {any} */ a2) {
                var r = 0, g = 0, b = 0;
                if (Array.isArray(a0)) {
                    r = Number(a0[0]) || 0;
                    g = Number(a0[1]) || 0;
                    b = Number(a0[2]) || 0;
                } else {
                    r = Number(a0) || 0;
                    g = Number(a1) || 0;
                    b = Number(a2) || 0;
                }
                var c = m4lMapRgba(r, g, b, 1.0);
                if (typeof _m4lOrigSetRgba === "function") {
                    _m4lOrigSetRgba.call(mgraphics, c[0], c[1], c[2], 1.0);
                } else {
                    _m4lOrigSetRgb.call(mgraphics, c[0], c[1], c[2]);
                }
            });
        }
        _m4lHookInstalled = true;
    } else if (!active && _m4lHookInstalled) {
        if (_m4lOrigSetRgba) mgraphics.set_source_rgba = _m4lOrigSetRgba;
        if (_m4lOrigSetRgb) mgraphics.set_source_rgb = _m4lOrigSetRgb;
        _m4lHookInstalled = false;
    }
}

/**
 * Recolors native presentation boxes (`panel`, `live.dial`, `live.numbox`, `live.tab`, `live.menu`,
 * `live.text`, `live.comment`, `live.line`, `live.scope~`) using `M4L_PATCHER_THEME_MAP` when a theme is active,
 * and restores their original saved colors when returning to `"Default"`.
 * @param {any} [targetPatcher]
 * @returns {number} count of updated objects
 */
function m4lApplyPatcherTheme(targetPatcher) {
    if (typeof M4L_PATCHER_THEME_MAP === "undefined" || !M4L_PATCHER_THEME_MAP) return 0;
    var p = targetPatcher || ((typeof this !== "undefined" && this && this.patcher) ? this.patcher : null);
    if (!p || typeof p.getnamed !== "function") return 0;

    var active = m4lIsActive();
    if (!active && !_m4lPatcherWasThemed) return 0;

    var count = 0;
    var vnames = Object.keys(M4L_PATCHER_THEME_MAP);
    for (var i = 0; i < vnames.length; i++) {
        var vn = vnames[i];
        var entry = M4L_PATCHER_THEME_MAP[vn];
        if (!entry || !entry.attrs) continue;
        var obj = null;
        try { obj = p.getnamed(vn); } catch (e) { obj = null; }
        if (!obj || typeof obj.setattr !== "function") continue;

        var attrNames = Object.keys(entry.attrs);
        for (var j = 0; j < attrNames.length; j++) {
            var attr = attrNames[j];
            var orig = entry.attrs[attr];
            if (!Array.isArray(orig) || orig.length < 3) continue;
            var col = active
                ? m4lMapRgba(orig[0], orig[1], orig[2], orig.length > 3 ? orig[3] : 1.0)
                : orig;
            // Pre-blend `activeslidercolor` (38% accent + 62% activebgcolor) per AGENTS.md Rule 8
            if (active && attr === "activeslidercolor" && entry.attrs.activebgcolor) {
                var bgOrig = entry.attrs.activebgcolor;
                var bgMapped = m4lMapRgba(bgOrig[0], bgOrig[1], bgOrig[2], 1.0);
                col = [
                    col[0] * 0.38 + bgMapped[0] * 0.62,
                    col[1] * 0.38 + bgMapped[1] * 0.62,
                    col[2] * 0.38 + bgMapped[2] * 0.62,
                    1.0
                ];
            }
            try {
                obj.setattr(attr, col[0], col[1], col[2], col.length > 3 ? col[3] : 1.0);
                count++;
            } catch (e) {}
        }
    }
    _m4lPatcherWasThemed = active;
    return count;
}

/**
 * Fingerprint of the current theme state + Live host colors (when in Live mode).
 * @returns {string}
 */
function m4lThemeFingerprint() {
    var st = m4lGetThemeState();
    var cfg = m4lEffectiveConfig();
    var key = String(st.version || 0) + "|" + cfg.preset + "|" + JSON.stringify(cfg.macros) + "|" + JSON.stringify(cfg.tokens);
    if (cfg.preset === "Ableton Live" || cfg.preset === "Default") {
        var c1 = m4lHostLiveColor("live_lcd_bg");
        var c2 = m4lHostLiveColor("live_control_selection");
        var c3 = m4lHostLiveColor("live_surface_bg");
        if (c1) key += "|" + c1.join(",");
        if (c2) key += "|" + c2.join(",");
        if (c3) key += "|" + c3.join(",");
    }
    return key;
}

var _m4lWatchTask = null;
var _m4lLastFingerprint = "";

/**
 * Forces an immediate theme refresh (rebuilds token cache, syncs `mgraphics` hook, updates patcher widgets, and redraws).
 * @param {Function} [onChange]
 * @param {any} [targetPatcher]
 */
function m4lRefreshTheme(onChange, targetPatcher) {
    if (typeof Global === "function") {
        _m4lLocalState = null;
    }
    _m4lResolvedCache = null;
    _m4lIssuedRgbKeys = {};
    m4lSyncMgraphicsHook();
    m4lApplyPatcherTheme(targetPatcher);
    if (typeof onChange === "function") {
        try { onChange(); } catch (e) {}
    }
    if (typeof mgraphics !== "undefined" && mgraphics && typeof mgraphics.redraw === "function") {
        try { mgraphics.redraw(); } catch (e) {}
    }
}

/**
 * Starts a periodic watcher (500 ms) that detects changes on `Global("m4l_theme_bus")` or Ableton Live's
 * host theme and refreshes the device UI automatically.
 * @param {Function} [onChange]
 * @returns {any}
 */
function m4lThemeWatch(onChange) {
    m4lSyncMgraphicsHook();
    if (m4lIsActive()) {
        m4lApplyPatcherTheme();
    }
    if (_m4lWatchTask || typeof Task === "undefined") return _m4lWatchTask;
    _m4lLastFingerprint = m4lThemeFingerprint();
    var selfPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
    _m4lWatchTask = new Task(function () {
        var fp = m4lThemeFingerprint();
        if (fp !== _m4lLastFingerprint) {
            _m4lLastFingerprint = fp;
            m4lRefreshTheme(onChange, selfPatcher);
        }
    });
    try {
        _m4lWatchTask.interval = 500;
        _m4lWatchTask.repeat();
    } catch (e) {
        _m4lWatchTask = null;
    }
    return _m4lWatchTask;
}

/**
 * Wraps a v8ui `paint` function so the theme watcher starts on the first paint and the `mgraphics`
 * hook is synced whenever theming is active. In `"Default"` mode with neutral macros and no overrides,
 * touches zero `mgraphics` methods before calling `origPaint`.
 * @param {Function} origPaint
 * @returns {Function}
 */
function m4lWrapPaint(origPaint) {
    var watchStarted = false;
    return function (/** @type {any[]} */ ...args) {
        if (!watchStarted) {
            watchStarted = true;
            m4lThemeWatch();
        } else if (m4lIsActive() || _m4lHookInstalled) {
            m4lSyncMgraphicsHook();
        }
        return origPaint.apply(this, args);
    };
}

// Initialize hook if a theme state is already pre-populated (e.g. in render_preview.py or tests)
m4lSyncMgraphicsHook();

var _m4lNodeModule = (typeof module !== "undefined") ? module : undefined;
if (_m4lNodeModule && _m4lNodeModule.exports) {
    _m4lNodeModule.exports = {
        M4L_THEME_BUS_NAME: M4L_THEME_BUS_NAME,
        M4L_DEFAULT_TOKENS: M4L_DEFAULT_TOKENS,
        M4L_PRESET_THEMES: M4L_PRESET_THEMES,
        M4L_PRESET_NAMES: M4L_PRESET_NAMES,
        M4L_TOKEN_KEYS: M4L_TOKEN_KEYS,
        M4L_ABLETON_ASK_THEMES: M4L_ABLETON_ASK_THEMES,
        m4lDefaultState: m4lDefaultState,
        m4lDefaultAbletonUi: m4lDefaultAbletonUi,
        m4lResolveAbletonAskName: m4lResolveAbletonAskName,
        m4lComputeAbletonUiTokens: m4lComputeAbletonUiTokens,
        m4lEstimateAbletonUiSettings: m4lEstimateAbletonUiSettings,
        m4lGetThemeState: m4lGetThemeState,
        m4lSetThemeState: m4lSetThemeState,
        m4lEffectiveConfig: m4lEffectiveConfig,
        m4lIsActive: m4lIsActive,
        m4lColor: m4lColor,
        m4lMapRgba: m4lMapRgba,
        m4lApplyMacros: m4lApplyMacros,
        m4lRgbToHsl: m4lRgbToHsl,
        m4lHslToRgb: m4lHslToRgb,
        m4lSyncMgraphicsHook: m4lSyncMgraphicsHook,
        m4lApplyPatcherTheme: m4lApplyPatcherTheme,
        m4lRefreshTheme: m4lRefreshTheme,
        m4lThemeWatch: m4lThemeWatch,
        m4lWrapPaint: m4lWrapPaint
    };
}
