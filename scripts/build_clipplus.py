#!/usr/bin/env python3
"""Build devices/Clip+.amxd (418 x 169 closed at default 240px Mid Size, +120 px with left Filter, +140 px with right Meters).

Architecture:
  - Optional Left `Filter` popout panel (`x = 4..120`, hidden until `Filter` is toggled on):
    `Filter On` toggle, `lowshelf.svg` (fork) | `lowcut.svg` (low-cut) SVG icon tab, interactive Pre/Inverse
    response curve + 64-bin live spectrogram canvas (`obj-filt-viz`), and `Freq` (`20..12000 Hz`),
    `Q` (`0.10..10.00`), and `Emphasis` (`0..24 dB`) controls.
  - Left VU column: Input dB control (`y = 6`) above tall dual-channel L/R (or M/S) IN VU meters (`y = 24..163`).
  - Center: Compact Better-Sampler-style inline hValueBars (`Drive`, `Detail`, `Ceil`, `Shape`, `Sym`)
    above the central bipolar Gain Curve / Waveform display (`obj-viz`, `y = 6..163`), whose width
    (`160..360 px`, default `240 px`) is tunable via the `Mid Size` control in Options.
  - Right VU column: Output dB / `AUTO` text-only `live.menu` selector (`y = 6`) above tall GR +
    dual-channel L/R OUT VU meters (`y = 24..163`).
  - `Options` panel: `Curve / Wave` text-only `live.menu` selection box, `Mid Size` width control,
    `L/R | M/S` + `All | L/M | R/S` channel selectors, `Filter` popout toggle, `Delta`, `DC`, `4x`, `Peak`, `Meters`.
  - `Meters` panel (hidden until `Meters` is on): LUFS/RMS/Peak meters.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "devices", "Clip+.amxd")

FILT_W = 120.0
MID_W = 240.0
CLOSED_W = MID_W + 178.0                  # 418.0
OPEN_W = CLOSED_W + 140.0                 # 558.0
MAX_W = 360.0 + 178.0 + 140.0 + FILT_W    # 798.0
LATENCY = 1047

# (key, long, short, lo, hi, init, type, unit, gen message, ui message, help)
NUMS = [
    ("in", "Input", "Input", -24, 24, 0, 0, 4, "ingain", "set_ingain", "Input trim before the clipper."),
    ("drive", "Drive", "Drive", 0, 24, 0, 0, 4, "drive", "set_drive", "The first 12 dB is the curve's gain. Above that the curve is overdriven."),
    ("detail", "Detail", "Detail", 0, 100, 100, 0, 5, "detail", "set_detail", "0% is the waveshaper. 100% keeps quiet partials while loud ones clip."),
    ("shape", "Shape", "Shape", 0, 100, 0, 0, 5, "shape", "set_shape", "Soft knee to hard clip. At Drive 0 every shape is the same ceiling clamp."),
    ("sym", "Symmetry", "Sym", -100, 100, 0, 0, 5, "sym", "set_sym", "Hardens one polarity and softens the other."),
    ("ceiling", "Ceiling", "Ceil", -12, 0, 0, 0, 4, "ceiling", "set_ceiling", "Clip ceiling."),
    ("out", "Output", "Output", -24, 12, 0, 0, 4, "outgain", "set_outgain", "Output trim when Output Mode is Manual."),
]


def gen_source():
    return sc.gen_code(os.path.join(SRC, "cepstrum_lib.genexpr"), os.path.join(SRC, "clipplus_core.genexpr"))


def face_source(header, role):
    role_hdr = f'var FACE_ROLE = "{role}";\n'
    parts = [role_hdr]
    if role == "viz":
        parts.append(header)
    parts.extend([
        sc.read(os.path.join(SRC, "spectral_theme.js")),
        sc.read(os.path.join(SRC, "clipplus_curve.js")),
    ])
    if role == "viz":
        parts.append(sc.read(os.path.join(SRC, "clipplus_dsp.js")))
    else:
        parts.append('var cpHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null; var cpDsp = { ready: 1, error: "", createdAt: 0 }; var cpBufName = "#0-clipscope";\n')
    parts.append(sc.read(os.path.join(SRC, "clipplus_ui.js")))
    return "\n".join(p.rstrip() + "\n" for p in parts)


def meter_source():
    parts = [
        sc.read(os.path.join(SRC, "spectral_theme.js")),
        sc.read(os.path.join(SRC, "clipplus_curve.js")),
        sc.read(os.path.join(SRC, "clipplus_meters.js")),
    ]
    return "\n".join(p.rstrip() + "\n" for p in parts)


def make_toggle(key, long_name, short, text, x, y, w, h, initial, help_text, stored_only):
    valueof = {
        "parameter_enum": ["Off", "On"],
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": 1,
        "parameter_shortname": short,
        "parameter_type": 2,
    }
    if stored_only:
        valueof["parameter_invisible"] = 1
    box = {
        "box": {
            "annotation": help_text,
            "annotation_name": long_name,
            "fontface": 0,
            "fontname": sc.THEME_FONT,
            "fontsize": 8.5,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.text",
            "mode": 1,
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [float(x) + 700.0, float(y) + 300.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof},
            "text": text,
            "texton": text,
            "varname": long_name,
        }
    }
    return sc.theme(
        box,
        bgcolor="live_control_bg",
        activebgcolor="live_control_bg",
        bgoncolor="live_control_selection",
        activebgoncolor="live_control_selection",
        textcolor="live_control_fg",
        activetextcolor="live_control_fg",
        textoncolor="live_lcd_bg",
        activetextoncolor="live_lcd_bg",
        bordercolor="live_lcd_frame",
    )


def make_text_menu(key, spec, help_text, x, y, w, h, fontsize=8.0, stored_only=False):
    """Popup selection box (`live.menu`) that opens a menu when clicked, with the dropdown triangle hidden (`tricolor` alpha 0)."""
    b = sc.make_theme_menu(key, spec, help_text, x, y, w, h, fontsize=fontsize)
    bx = b["box"]
    bx["tricolor"] = [0.0, 0.0, 0.0, 0.0]
    bx["bordercolor"] = list(sc.LIVE_THEME["live_lcd_frame"])
    bx["saved_attribute_attributes"]["bordercolor"] = {"expression": "themecolor.live_lcd_frame"}
    if stored_only:
        bx["saved_attribute_attributes"]["valueof"]["parameter_invisible"] = 1
    return b


def value_bar(key, spec, help_text, x, y, w, h, appearance, color_name):
    b = sc.make_numbox(
        key, spec, help_text, x, y, w, h,
        sc.LIVE_THEME[color_name], appearance=appearance, fontsize=8,
    )
    b["box"]["fontname"] = sc.THEME_FONT
    b["box"]["fontface"] = 0
    return sc.theme(b, textcolor=color_name, bordercolor="live_lcd_frame")


def hide(box):
    box["box"]["hidden"] = 1
    return box


def with_name(box, varname):
    box["box"]["varname"] = varname
    return box


def place(box, rect):
    box["box"]["presentation_rect"] = [float(v) for v in rect]
    return box


def add_filter_popout_and_routing(boxes, lines, filt_viz_code, ms_x, ms_y, ch_x, ch_y, y_wire, extra_targets=()):
    """Adds the left-hand Filter popout panel controls + M/S & single-channel routing selectors."""
    boxes.append(hide(sc.v8ui("obj-filt-viz", filt_viz_code, [8, 40, 112, 66], (20, 20), 1, varname="obj-filt-viz")))

    filt_on = hide(with_name(make_toggle(
        "filton", "Filter On", "Filt On", "On", 8, 20, 28, 15, 0,
        "Enable the gain-compensated pre-emphasis filter and inverse post-emphasis filter.", False,
    ), "obj-ctrl-filton"))
    boxes.append(filt_on)
    boxes.append(sc.newobj("obj-prep-filton", "prepend filton", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-filton", "prepend set_filton", 360, y_wire, 130))
    y_wire += 18

    filt_type = sc.make_theme_tab(
        "filttype",
        ("Filter Type", "Filt Type", ["Shelf", "Low Cut"], 0),
        "Low Shelf (fork icon) applies a low-cut / high-boost shelf before clipping and inverts it after. Low Cut (low-cut icon) applies a resonant highpass before clipping and restores the lows after.",
        40, 20, 80, 15,
    )
    filt_type["box"]["pictures"] = ["lowshelf.svg", "lowcut.svg"]
    filt_type["box"]["usepicture"] = 1
    filt_type["box"]["remapsvgcolors"] = 1
    filt_type["box"]["usesvgviewbox"] = 1
    filt_type["box"]["spacing_x"] = 2.0
    boxes.append(hide(with_name(filt_type, "obj-ctrl-filttype")))
    boxes.append(sc.newobj("obj-prep-filttype", "prepend filttype", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-filttype", "prepend set_filttype", 360, y_wire, 130))
    y_wire += 18

    lbl_ff = hide(with_name(sc.make_theme_comment("obj-lbl-filtfreq", "Freq", 8, 110, 52, 11, size=8.0, name="live_control_fg"), "obj-lbl-filtfreq"))
    ctrl_ff = hide(with_name(sc.make_lcd_numbox(
        "filtfreq", ("Filter Freq", "Freq", 20.0, 12000.0, 250.0, 0, 3),
        "Cutoff / corner frequency of the pre-emphasis and post-inversion filter.",
        8, 121, 52, 14,
    ), "obj-ctrl-filtfreq"))
    ctrl_ff["box"]["saved_attribute_attributes"]["valueof"]["parameter_exponent"] = 3.0
    boxes.extend([lbl_ff, ctrl_ff])
    boxes.append(sc.newobj("obj-prep-filtfreq", "prepend filtfreq", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-filtfreq", "prepend set_filtfreq", 360, y_wire, 130))
    y_wire += 18

    lbl_fq = hide(with_name(sc.make_theme_comment("obj-lbl-filtq", "Q", 66, 110, 54, 11, size=8.0, name="live_control_fg"), "obj-lbl-filtq"))
    ctrl_fq = hide(with_name(sc.make_lcd_numbox(
        "filtq", ("Filter Q", "Q", 0.1, 10.0, 0.71, 0, 1),
        "Resonance / Q of the pre-emphasis filter (0.10..10.00). Dragging up/down in the XY panel in Low Cut mode adjusts Q.",
        66, 121, 54, 14, unit_text="%.2f",
    ), "obj-ctrl-filtq"))
    ctrl_fq["box"]["saved_attribute_attributes"]["valueof"]["parameter_exponent"] = 2.0
    boxes.extend([lbl_fq, ctrl_fq])
    boxes.append(sc.newobj("obj-prep-filtq", "prepend filtq", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-filtq", "prepend set_filtq", 360, y_wire, 130))
    y_wire += 18

    lbl_fg = hide(with_name(sc.make_theme_comment("obj-lbl-filtgain", "Emphasis", 8, 138, 56, 11, size=8.0, name="live_control_fg"), "obj-lbl-filtgain"))
    ctrl_fg = hide(with_name(sc.make_lcd_numbox(
        "filtgain", ("Filter Gain", "Emphasis", 0.0, 24.0, 6.0, 0, 4),
        "Pre-emphasis amount (0..24 dB): attenuates lows and boosts highs before clipping, then inverts after clipping.",
        66, 137, 54, 14,
    ), "obj-ctrl-filtgain"))
    boxes.extend([lbl_fg, ctrl_fg])
    boxes.append(sc.newobj("obj-prep-filtgain", "prepend filtgain", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-filtgain", "prepend set_filtgain", 360, y_wire, 130))
    y_wire += 18

    ms_menu = make_text_menu(
        "msmode",
        ("Stereo Mode", "Stereo", ["L/R", "M/S"], 0),
        "Clip in Left/Right stereo or Mid/Side.",
        ms_x, ms_y, 23, 14, fontsize=7.5,
    )
    boxes.append(ms_menu)
    boxes.append(sc.newobj("obj-prep-msmode", "prepend msmode", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-msmode", "prepend set_msmode", 360, y_wire, 130))
    y_wire += 18

    ch_menu = make_text_menu(
        "chmode",
        ("Channel Mode", "Chan", ["All", "L/M", "R/S"], 0),
        "Clip both channels (All), only channel 1 (L or Mid), or only channel 2 (R or Side).",
        ch_x, ch_y, 23, 14, fontsize=7.5,
    )
    boxes.append(ch_menu)
    boxes.append(sc.newobj("obj-prep-chmode", "prepend chmode", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-chmode", "prepend set_chmode", 360, y_wire, 130))
    y_wire += 18

    for key in ("filton", "filttype", "filtfreq", "filtq", "filtgain", "msmode", "chmode"):
        lines.append(sc.line(f"obj-ctrl-{key}", 0, f"obj-prep-{key}"))
        lines.append(sc.line(f"obj-prep-{key}", 0, "obj-gen-in", 1))
        lines.append(sc.line(f"obj-ctrl-{key}", 0, f"obj-ui-{key}"))
        lines.append(sc.line(f"obj-ui-{key}", 0, "obj-viz"))
        lines.append(sc.line(f"obj-ui-{key}", 0, "obj-filt-viz"))
        for tgt in extra_targets:
            lines.append(sc.line(f"obj-ui-{key}", 0, tgt))

    return y_wire


def build():
    code = gen_source()
    header, _hash = sc.deferred_header("clipplus", code)
    ui_viz = face_source(header, "viz")
    ui_in = face_source(header, "in_meter")
    ui_out = face_source(header, "out_meter")
    ui_filt = face_source(header, "filt_viz")
    meters = meter_source()

    out_x = 58.0 + MID_W             # 298.0
    clip_panel_w = out_x + 54.0      # 352.0
    opts_x = clip_panel_w + 6.0      # 358.0
    opt_btn_x = opts_x + 4.0         # 362.0
    met_x = opts_x + 60.0            # 418.0

    boxes = [
        sc.v8ui("obj-in-meter", ui_in, [6, 24, 46, 139], (20, 40), 1, varname="cp_in_meter"),
        sc.v8ui("obj-viz", ui_viz, [56, 6, MID_W, 157], (20, 80), 2, varname="cp_face"),
        sc.v8ui("obj-out-meter", ui_out, [out_x, 24, 54, 139], (20, 120), 1, varname="cp_out_meter"),
        hide(sc.v8ui("obj-meters", meters, [met_x + 4, 20, 128, 122], (700, 80), 1, varname="obj-meters")),
    ]
    lines = []

    toggles = [
        ("showfilt", "Show Filter", "Filter", "Filter", opt_btn_x, 62, 48, 0, None, "set_showfilt", True, "Open the pre/post emphasis filter popout panel on the left."),
        ("dlt", "Delta", "Delta", "Delta", opt_btn_x, 77, 48, 0, "dlt", "set_dlt", False, "Delayed input minus the processed output."),
        ("dc", "DC", "DC", "DC", opt_btn_x, 92, 48, 0, "dcon", "set_dcon", False, "15 Hz highpass in front of the drive."),
        ("os", "Oversample", "4x", "4x", opt_btn_x, 107, 48, 0, "oson", "set_oson", False, "4x oversampling on the waveshaper."),
        ("hlim", "Hard Limit", "Peak", "Peak", opt_btn_x, 122, 48, 1, "hlim", "set_hlim", False, "Brickwall sample clip at the ceiling, after the detail crossfade."),
        ("meters", "Show Meters", "Meters", "Meters", opt_btn_x, 145, 48, 0, None, "set_meters", True, "Open the LUFS, RMS and peak meters."),
    ]

    y_wire = 40.0
    for key, long_name, short, text, x, y, w, initial, gen_msg, ui_msg, stored, help_text in toggles:
        h = 13 if key != "meters" else 14
        boxes.append(make_toggle(key, long_name, short, text, x, y, w, h, initial, help_text, stored))
        if gen_msg:
            boxes.append(sc.newobj(f"obj-prep-{key}", f"prepend {gen_msg}", 200, y_wire, 110))
        boxes.append(sc.newobj(f"obj-ui-{key}", f"prepend {ui_msg}", 360, y_wire, 130))
        y_wire += 18

    # Text-only popup Output Mode selector (`live.menu` with hidden triangle) next to Output above the right OUT VU column
    auto_menu = make_text_menu(
        "auto",
        ("Auto", "Out Mode", ["Manual", "Auto"], 1),
        "Manual sets Output dB directly. Auto trims by -Input gain so Drive is an independent increase.",
        out_x + 26, 6, 28, 15,
        fontsize=8.0,
    )
    boxes.append(auto_menu)
    boxes.append(sc.newobj("obj-prep-auto", "prepend autog", 200, y_wire, 110))
    boxes.append(sc.newobj("obj-ui-auto", "prepend set_autog", 360, y_wire, 130))
    y_wire += 18

    # Text-only popup Meter Type selection box (`live.menu` with hidden triangle) in the right-hand Options panel
    view = make_text_menu(
        "view",
        ("View", "View", ["Curve", "Wave"], 0),
        "Curve shows the bipolar transfer curve and where the signal hits it. Wave shows the waveform and shaved overs.",
        opt_btn_x, 17, 48, 13,
        fontsize=8.0,
        stored_only=True,
    )
    boxes.append(view)
    boxes.append(sc.newobj("obj-ui-view", "prepend set_view", 520, y_wire, 120))
    y_wire += 18

    # Mid Size control (`obj-ctrl-midw`, 160..360 px, default 240 px) in the Options panel to tune the middle section width
    midw_box = value_bar(
        "midw",
        ("Mid Size", "Width", 160.0, 360.0, MID_W, 0, 0),
        "Adjusts the width in pixels (160..360) of the middle section (Drive..Ceil controls and main display).",
        opt_btn_x, 32, 48, 13, 2, "live_lcd_control_fg_alt",
    )
    midw_box["box"]["saved_attribute_attributes"]["valueof"]["parameter_invisible"] = 1
    boxes.append(midw_box)
    boxes.append(sc.newobj("obj-ui-midw", "prepend set_midw", 520, y_wire, 120))
    y_wire += 18

    y_wire = add_filter_popout_and_routing(
        boxes, lines, ui_filt, opt_btn_x, 47, opt_btn_x + 25, 47, y_wire,
        extra_targets=("obj-in-meter", "obj-out-meter"),
    )

    by_key = {spec[0]: spec for spec in NUMS}

    # Left column: Input value box directly above obj-in-meter (no top label)
    in_spec = by_key["in"]
    boxes.append(value_bar("in", in_spec[1:8], in_spec[10], 6, 6, 46, 15, 3, "live_lcd_control_fg_alt"))
    boxes.append(sc.newobj("obj-prep-in", "prepend ingain", 200, 380, 120))
    boxes.append(sc.newobj("obj-ui-in", "prepend set_ingain", 360, 380, 130))

    # Right column: Output value box / AUTO pill + text-only selector directly above obj-out-meter (no top label)
    out_spec = by_key["out"]
    out_box = hide(value_bar("out", out_spec[1:8], out_spec[10], out_x, 6, 26, 15, 3, "live_lcd_control_fg_alt"))
    boxes.append(out_box)
    auto_lbl = with_name(
        sc.make_theme_comment("obj-lbl-out-auto", "AUTO", out_x, 7, 26, 14, size=8.0, name="live_lcd_control_fg_alt", align=1),
        "obj-lbl-out-auto",
    )
    boxes.append(auto_lbl)
    boxes.append(sc.newobj("obj-prep-out", "prepend outgain", 200, 398, 120))
    boxes.append(sc.newobj("obj-ui-out", "prepend set_outgain", 360, 398, 130))

    # Drive, Detail, Shape, Sym, Ceiling are drawn as compact Better-Sampler-style inline hValueBars
    # inside obj-viz (top 33 px); their real automatable live.numbox objects are kept off the face (presentation 0).
    for idx, key in enumerate(["drive", "detail", "shape", "sym", "ceiling"]):
        spec = by_key[key]
        _key, long_name, short, lo, hi, init, ptype, unit, gen_msg, ui_msg, help_text = spec
        nb = sc.make_lcd_numbox(key, (long_name, short, lo, hi, init, ptype, unit), help_text, 20 + idx * 70, 320, 56, 15)
        nb["box"]["presentation"] = 0
        nb["box"].pop("presentation_rect", None)
        boxes.append(nb)
        boxes.append(sc.newobj(f"obj-prep-{key}", f"prepend {gen_msg}", 200, 416 + idx * 18, 120))
        boxes.append(sc.newobj(f"obj-ui-{key}", f"prepend {ui_msg}", 360, 416 + idx * 18, 130))

    reset = sc.make_theme_text("obj-reset", "Reset", met_x + 4, 146, 56, 15, toggle=False)
    boxes.append(hide(reset))
    boxes.append(sc.newobj("obj-prep-reset", "prepend reset_meters", 520, 460, 140))

    boxes.extend([
        with_name(sc.newobj("obj-plugin", "plugin~", 20, 240, 60, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "cp_plugin"),
        with_name(sc.newobj("obj-plugout", "plugout~", 20, 520, 70, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "cp_plugout"),
        with_name(sc.newobj("obj-gen-in", "gate 1 1", 120, 280, 70, numinlets=2, numoutlets=1, outlettype=[""]), "cp_genin"),
        sc.newobj("obj-thisdevice", "live.thisdevice", 560, 140, 110, numoutlets=2, outlettype=["bang", "int"]),
        sc.message("obj-msg-init", "init_dsp", 700, 140, 70),
        sc.newobj("obj-scope", "buffer~ #0-clipscope 1280 1", 560, 240, 200, numoutlets=2, outlettype=["float", "bang"]),
        sc.newobj("obj-loadbang", "loadbang", 560, 180, 70, numoutlets=1, outlettype=["bang"]),
        with_name(sc.message("obj-msg-bind", "scope #0-clipscope", 700, 180, 160), "cp_bind"),
        with_name(sc.message("obj-msg-setbuf", "setbuffer #0-clipscope", 700, 210, 170), "cp_setbuf"),
        sc.newobj("obj-prep-width", "prepend setwidth", 700, 250, 110),
    ])

    filt_panel, filt_parts = sc.make_section("filt", 4, 4, 116, 161, "Filter", title_w=34)
    with_name(place(filt_parts[0], [8, 4, 36, 12]), "obj-title-filt")
    with_name(place(filt_parts[1], [46, 9, 68, 2]), "obj-rule-filt")
    clip_panel = sc.make_theme_panel("obj-panel-clip", 4, 4, clip_panel_w - 2, 161, "live_desktop")
    opts_panel, opts_parts = sc.make_section("opts", opts_x, 4, 56, 161, "Options", title_w=42)
    with_name(place(opts_parts[0], [opt_btn_x, 4, 44, 12]), "obj-title-opts")
    with_name(place(opts_parts[1], [opt_btn_x + 44, 9, 4, 2]), "obj-rule-opts")
    meter_panel, meter_parts = sc.make_section("meters", met_x, 4, 136, 161, "Meters", title_w=42)
    with_name(meter_parts[0], "obj-title-meters")
    with_name(meter_parts[1], "obj-rule-meters")

    boxes.extend(hide(p) for p in filt_parts)
    boxes.extend(opts_parts)
    boxes.extend(hide(p) for p in meter_parts)
    boxes.append(hide(filt_panel))
    boxes.append(clip_panel)
    boxes.append(opts_panel)
    boxes.append(hide(meter_panel))
    boxes.append(sc.make_body_panel(MAX_W))

    lines.extend([
        sc.line("obj-loadbang", 0, "obj-msg-bind"),
        sc.line("obj-loadbang", 0, "obj-msg-setbuf"),
        sc.line("obj-msg-bind", 0, "obj-gen-in", 1),
        sc.line("obj-msg-setbuf", 0, "obj-viz"),
        sc.line("obj-msg-setbuf", 0, "obj-filt-viz"),
        sc.line("obj-msg-setbuf", 0, "obj-in-meter"),
        sc.line("obj-msg-setbuf", 0, "obj-out-meter"),
        sc.line("obj-msg-setbuf", 0, "obj-meters"),
        sc.line("obj-thisdevice", 0, "obj-msg-init"),
        sc.line("obj-msg-init", 0, "obj-viz"),
        sc.line("obj-viz", 0, "obj-prep-width"),
        sc.line("obj-prep-width", 0, "obj-thisdevice"),
        sc.line("obj-viz", 1, "obj-gen-in", 1),
        sc.line("obj-ctrl-view", 0, "obj-ui-view"),
        sc.line("obj-ui-view", 0, "obj-viz"),
        sc.line("obj-ctrl-midw", 0, "obj-ui-midw"),
        sc.line("obj-ui-midw", 0, "obj-viz"),
        sc.line("obj-ctrl-auto", 0, "obj-prep-auto"),
        sc.line("obj-prep-auto", 0, "obj-gen-in", 1),
        sc.line("obj-ctrl-auto", 0, "obj-ui-auto"),
        sc.line("obj-ui-auto", 0, "obj-viz"),
        sc.line("obj-ui-auto", 0, "obj-out-meter"),
        sc.line("obj-reset", 0, "obj-prep-reset"),
        sc.line("obj-prep-reset", 0, "obj-meters"),
    ])

    for key, _long, _short, _text, _x, _y, _w, _initial, gen_msg, _ui, _stored, _help in toggles:
        ui_id = f"obj-ui-{key}"
        lines.append(sc.line(f"obj-ctrl-{key}", 0, ui_id))
        lines.append(sc.line(ui_id, 0, "obj-viz"))
        lines.append(sc.line(ui_id, 0, "obj-in-meter"))
        lines.append(sc.line(ui_id, 0, "obj-out-meter"))
        if gen_msg:
            lines.append(sc.line(f"obj-ctrl-{key}", 0, f"obj-prep-{key}"))
            lines.append(sc.line(f"obj-prep-{key}", 0, "obj-gen-in", 1))

    for spec in NUMS:
        key = spec[0]
        lines.append(sc.line(f"obj-ctrl-{key}", 0, f"obj-prep-{key}"))
        lines.append(sc.line(f"obj-prep-{key}", 0, "obj-gen-in", 1))
        lines.append(sc.line(f"obj-ctrl-{key}", 0, f"obj-ui-{key}"))
        lines.append(sc.line(f"obj-ui-{key}", 0, "obj-viz"))
        lines.append(sc.line(f"obj-ui-{key}", 0, "obj-in-meter"))
        lines.append(sc.line(f"obj-ui-{key}", 0, "obj-out-meter"))

    doc = sc.patcher(
        boxes,
        lines,
        CLOSED_W,
        "Spectral clipper. Flanking dual-channel L/R (or M/S) VU columns, compact parameter bars, adjustable-width bipolar gain curve / waveform display, and left Filter popout.",
        "Spectral clipper with dual-channel L/R & M/S VU columns, pre/post emphasis filter popout, and adjustable-width central display.",
        "audio, clipper, spectral",
        LATENCY,
    )
    sc.write_amxd(doc, OUT)


if __name__ == "__main__":
    build()
