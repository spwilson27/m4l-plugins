#!/usr/bin/env python3
"""
Build devices/Multiband Split.amxd (268 x 169 px — UI 2 Edge-to-Edge 8192-Block Spectrogram).

Architecture:
  - Top Edge-to-Edge Canvas (`obj-viz`, `v8ui`, `x = 6, y = 6, w = 256, h = 136`):
    - Top Strip (`y = 2..17`): `[AUTO]` button + `1..4` Band Solo/Multi-Band pills (created automatically
      per detected instance from 1 up to 4) + Top-Right Volume Slider (`-inf` to `+18.0 dB`).
    - Main Viewport (`y = 20..133`): Block-size 8192 Hann-windowed FFT harmonic spectrogram +
      Linkwitz-Riley (`12 / 24 / 48 dB/oct`) Bode curves + draggable `F1 / F2 / F3` crossover handles +
      Bottom-Right clickable Link info string (`LINK: RACK #1 CH2 (4x)` / `LNK` toggle).
  - Bottom Control Strip (`y = 146..161`):
    - `Slope` (`12 dB` / `24 dB` / `48 dB`) selector tab + `F1`, `F2`, `F3` horizontal value sliders.
"""

import hashlib
import json
import os
import struct
import sys

from minify_embed import minify_patcher
from minify_gen import minify_gen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "mbsplit_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "mbsplit_ui.js")
THEME_PATH = os.path.join(ROOT_DIR, "src", "spectral_theme.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "mbsplit_core.genexpr")
DSP_PATH = os.path.join(ROOT_DIR, "src", "mbsplit_dsp.js")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Multiband Split.amxd")

DEVICE_W = 268.0
DEVICE_H = 169.0
BG_DARK = (0.06, 0.075, 0.095)


def blend_slider_color(accent_rgb, alpha=0.38):
    return [
        round(accent_rgb[0] * alpha + BG_DARK[0] * (1.0 - alpha), 4),
        round(accent_rgb[1] * alpha + BG_DARK[1] * (1.0 - alpha), 4),
        round(accent_rgb[2] * alpha + BG_DARK[2] * (1.0 - alpha), 4),
        1.0,
    ]


PARAM_SPECS = {
    "f1": (
        "Crossover 1", "F1 Low", 20.0, 20000.0, 120.0, 3, 3.0,
        "Low / Low-Mid crossover frequency (20 Hz to 20 kHz). Linked across instances in the same Rack.",
    ),
    "f2": (
        "Crossover 2", "F2 Mid", 20.0, 20000.0, 800.0, 3, 3.0,
        "Low-Mid / High-Mid crossover frequency (20 Hz to 20 kHz). Linked across instances in the same Rack.",
    ),
    "f3": (
        "Crossover 3", "F3 High", 20.0, 20000.0, 4500.0, 3, 3.0,
        "High-Mid / High crossover frequency (20 Hz to 20 kHz). Linked across instances in the same Rack.",
    ),
    "gain": (
        "Chain Gain", "Gain", -70.0, 18.0, 0.0, 4, 1.0,
        "Output volume for this Rack chain (-inf dB at -70 dB up to +18 dB).",
    ),
}


def valueof_dict(key):
    long_name, short_name, lo, hi, initial, unit, exponent, _help = PARAM_SPECS[key]
    v = {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short_name,
        "parameter_type": 0,
        "parameter_unitstyle": unit,
    }
    if exponent != 1.0:
        v["parameter_exponent"] = exponent
    return v


def make_xover_numbox(key, x, y, w, h):
    """Crossover frequency as a borderless LCD value (Live theme colours); the face greys missing splits with `active 0`."""
    long_name, short, lo, hi, initial, unit, exponent, help_text = PARAM_SPECS[key]
    b = sc.make_lcd_numbox(key, (long_name, short, lo, hi, initial, 0, unit), help_text, x, y, w, h)
    bx = b["box"]
    bx["saved_attribute_attributes"]["valueof"]["parameter_exponent"] = exponent
    return b


def make_gain_numbox(x, y, w, h):
    """Hidden automatable Chain Gain (the volume slider in the v8ui drives it)."""
    long_name, short, lo, hi, initial, unit, exponent, help_text = PARAM_SPECS["gain"]
    b = sc.make_lcd_numbox("gain", (long_name, short, lo, hi, initial, 0, unit), help_text, x, y, w, h)
    bx = b["box"]
    bx["saved_attribute_attributes"]["valueof"].pop("parameter_exponent", None)
    bx["presentation"] = 0
    bx["hidden"] = 1
    bx["patching_rect"] = [float(x), 240.0, float(w), float(h)]
    return b


def make_slope_tab(x, y, w=54.0, h=15.0):
    spec = ("Slope", "Slope", ["12", "24", "48"], 1)
    help_text = ("Linkwitz-Riley phase-compensated filter slope (12, 24, or 48 dB/oct). In Dynamic Phase mode it sets the F1 "
                 "slope only. Linked across instances in the same Rack.")
    return sc.make_theme_tab("slope", spec, help_text, x, y, w, h)


def make_phase_button(x, y, w=26.0, h=15.0):
    b = sc.make_theme_text("obj-ctrl-phasemode", "MIN", x, y, w, h)
    bx = b["box"]
    bx.update({
        "annotation": "Dynamic Phase: F1 stays a zero-latency Linkwitz-Riley split, F2 and F3 become linear-phase FIR splits "
                      "(phase-coherent mids and highs, no bass pre-ringing). Adds 128 samples of latency at 44.1/48 kHz "
                      "(about 2.7 ms), reported to Live. Off (MIN) is the all-IIR minimum-phase tree with zero latency. "
                      "Linked across instances in the same Rack.",
        "annotation_name": "Phase Mode",
        "parameter_enable": 1,
        "texton": "DYN",
        "varname": "Phase Mode",
    })
    bx["saved_attribute_attributes"]["valueof"] = {
        "parameter_annotation_name": "Phase Mode",
        "parameter_enum": ["Min", "Dynamic"],
        "parameter_initial": [0],
        "parameter_initial_enable": 1,
        "parameter_longname": "Phase Mode",
        "parameter_mmax": 1,
        "parameter_shortname": "Phase",
        "parameter_type": 2,
    }
    # a native toggle: grey text off, orange fill on
    sc.theme(b, textcolor="live_control_fg", activetextcolor="live_control_fg", bordercolor="live_control_bg")
    return b


def make_link_menu(x, y, w=46.0, h=15.0, hidden=1):
    box_dict = {
        "activebgcolor": [0.06, 0.08, 0.11, 1.0],
        "annotation": "Crossover link scope: Auto links all instances inside the same parent Audio Effect Rack (supporting nested racks).",
        "annotation_name": "Link Group",
        "bordercolor": [0.22, 0.28, 0.35, 1.0],
        "fontface": 1,
        "fontsize": 8.5,
        "id": "obj-ctrl-linkgroup",
        "maxclass": "live.menu",
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "patching_rect": [360.0, 80.0, float(w), float(h)],
        "presentation": 0 if hidden else 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {
            "valueof": {
                "parameter_enum": ["Auto", "Grp A", "Grp B", "Grp C", "Grp D", "Off"],
                "parameter_initial": [0],
                "parameter_initial_enable": 1,
                "parameter_longname": "Link Group",
                "parameter_mmax": 5,
                "parameter_shortname": "Link",
                "parameter_type": 2,
            }
        },
        "textcolor": [0.55, 0.90, 1.0, 1.0],
        "varname": "Link Group",
    }
    if hidden:
        box_dict["hidden"] = 1
    return {"box": box_dict}


def make_bandmode_menu(x, y, w=62.0, h=15.0, hidden=1):
    box_dict = {
        "activebgcolor": [0.06, 0.08, 0.11, 1.0],
        "annotation": "Selects which band(s) this Rack chain outputs. Auto Chain solos the band matching the chain index.",
        "annotation_name": "Band Mode",
        "bordercolor": [0.22, 0.28, 0.35, 1.0],
        "fontface": 1,
        "fontsize": 8.5,
        "id": "obj-ctrl-bandmode",
        "maxclass": "live.menu",
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "patching_rect": [480.0, 80.0, float(w), float(h)],
        "presentation": 0 if hidden else 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {
            "valueof": {
                "parameter_enum": ["Auto Chain", "Band 1", "Band 2", "Band 3", "Band 4", "Multi"],
                "parameter_initial": [0],
                "parameter_initial_enable": 1,
                "parameter_longname": "Band Mode",
                "parameter_mmax": 5,
                "parameter_shortname": "Band",
                "parameter_type": 2,
            }
        },
        "textcolor": [0.88, 0.94, 1.0, 1.0],
        "varname": "Band Mode",
    }
    if hidden:
        box_dict["hidden"] = 1
    return {"box": box_dict}


def newobj(obj_id, text, x, y, w=100.0, h=20.0, numinlets=1, numoutlets=1, outlettype=None):
    return {
        "box": {
            "fontname": "Arial",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "newobj",
            "numinlets": numinlets,
            "numoutlets": numoutlets,
            "outlettype": outlettype if outlettype is not None else ([""] * numoutlets),
            "patching_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
        }
    }


def msgbox(obj_id, text, x, y, w=110.0, h=20.0):
    return {
        "box": {
            "fontname": "Arial",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "message",
            "numinlets": 2,
            "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
        }
    }


def line(src, src_out, dst, dst_in=0):
    return {
        "patchline": {
            "destination": [dst, dst_in],
            "source": [src, src_out],
        }
    }


def gendsp_json(gen_code):
    """The gen patch (in 1 / in 2 -> codebox -> out 1 / out 2) as .gendsp JSON text. The deferred DSP (src/mbsplit_dsp.js)
    writes it to /tmp/mbsplit_core_<hash>.gendsp and creates `gen~ @gen <file>` (AGENTS.md 1d; same as build_reverbplus.py)."""
    gen_code = minify_gen(gen_code)
    def bx(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {"id": i, "maxclass": cls, "numinlets": ni, "numoutlets": no, "outlettype": [""] * no,
               "patching_rect": [float(x), float(y), 200.0, 22.0]}
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}
    patch = {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "dsp.gen",
        "rect": [50.0, 50.0, 600.0, 450.0],
        "boxes": [
            bx("obj-in1", "in 1", 20, 20, 0, 1), bx("obj-in2", "in 2", 120, 20, 0, 1),
            bx("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
            bx("obj-out1", "out 1", 20, 400, 1, 0), bx("obj-out2", "out 2", 120, 400, 1, 0),
        ],
        "lines": [
            {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-code", 0]}},
            {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-code", 1]}},
            {"patchline": {"source": ["obj-code", 0], "destination": ["obj-out1", 0]}},
            {"patchline": {"source": ["obj-code", 1], "destination": ["obj-out2", 0]}},
        ],
    }}
    return json.dumps(patch)


def build_patcher():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    theme_js = sc.read(THEME_PATH)
    dsp_js = sc.read(DSP_PATH)
    gen_text = gendsp_json(gen_code)
    gen_vars = (f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\n"
                f"var GEN_DSP_HASH = \"{hashlib.sha1(gen_text.encode()).hexdigest()[:12]}\";\n")
    combined_js = (config_js.rstrip() + "\n\n" + theme_js.rstrip() + "\n\n" + gen_vars + "\n" + dsp_js.rstrip()
                   + "\n\n" + ui_js)
    viz_rect = [8.0, 20.0, 252.0, 102.0]

    p_bands, parts_bands = sc.make_section("bands", 4, 4, 260, 120, "Bands")
    p_xo, parts_xo = sc.make_section("xo", 4, 128, 260, 37, "Crossover")

    ui_widgets = [
        make_slope_tab(8.0, 145.0, 50.0, 15.0),
        make_phase_button(61.0, 145.0, 26.0, 15.0),
        sc.make_theme_comment("obj-lbl-f1", "F1", 91.0, 145.0, 11.0),
        make_xover_numbox("f1", 105.0, 145.0, 41.0, 15.0),
        sc.make_theme_comment("obj-lbl-f2", "F2", 147.0, 145.0, 11.0),
        make_xover_numbox("f2", 161.0, 145.0, 41.0, 15.0),
        sc.make_theme_comment("obj-lbl-f3", "F3", 203.0, 145.0, 11.0),
        make_xover_numbox("f3", 217.0, 145.0, 41.0, 15.0),
        # Automatable Live parameters synced with v8ui controls (non-overlapping / hidden in presentation)
        make_gain_numbox(320.0, 240.0, 56.0, 15.0),
        make_link_menu(390.0, 240.0, 46.0, 15.0, hidden=1),
        make_bandmode_menu(460.0, 240.0, 65.0, 15.0, hidden=1),
    ] + parts_bands + parts_xo

    # Background panels MUST be at the end of `boxes` with `"background": 1`: section panels, then the body panel last.
    panels = [p_bands, p_xo, sc.make_body_panel(DEVICE_W)]

    boxes = [
        # Audio I/O
        newobj("obj-plugin", "plugin~", 40, 40, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 40, 520, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),

        # Gen DSP core: NOT in the device. The face creates `gen~ @gen <file>` after load (src/mbsplit_dsp.js, AGENTS.md 1d);
        # every gen-bound message goes into the pass-through hub `gate 1 1` (open; data into the right inlet).
        newobj("obj-gen-in", "gate 1 1", 40, 360, 60, 20, numinlets=2, numoutlets=1, outlettype=[""]),

        # Instance-local scope & 8192-sample audio ring buffer (---mbsplitscope @samps 8224)
        newobj("obj-buf-scope", "buffer~ ---mbsplitscope @samps 8224", 340, 420, 225, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 340, 320, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        newobj("obj-thisdevice", "live.thisdevice", 420, 320, 85, 20, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        newobj("obj-freebang", "freebang", 520, 320, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        msgbox("obj-msg-gen-buf", "scope ---mbsplitscope", 340, 360, 130, 20),
        msgbox("obj-msg-ui-buf", "setbuffer ---mbsplitscope", 480, 360, 150, 20),
        msgbox("obj-msg-ui-init", "loadbang", 640, 360, 65, 20),
        msgbox("obj-msg-ui-dsp", "init_dsp", 640, 390, 65, 20),
        msgbox("obj-msg-ui-free", "notifydeleted", 720, 360, 85, 20),

        # Hidden blob parameter for saving full splitter & custom mask state in Live Sets
        {
            "box": {
                "id": "obj-state-pattr",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", ""],
                "patching_rect": [660.0, 120.0, 140.0, 20.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_initial": [3, 120.0, 800.0, 4500.0, 1, 1, 0, 1, 0, 0.0, 1, 0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 1,
                        "parameter_longname": "SplitStateData",
                        "parameter_shortname": "SplitStateData",
                        "parameter_type": 3,
                    }
                },
                "text": "pattr SplitStateData",
                "varname": "SplitStateData",
            }
        },

        # Interactive 8192-Block Spectrogram + Crossover Canvas (v8ui)
        {
            "box": {
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [120.0, 160.0, viz_rect[2], viz_rect[3]],
                "presentation": 1,
                "presentation_rect": viz_rect,
                "textfile": {
                    "autowatch": 1,
                    "embed": 1,
                    "filename": "none",
                    "flags": 0,
                    "text": combined_js,
                },
                "varname": "SplitVisualizer",
            }
        },
    ]

    boxes.extend(ui_widgets)

    boxes.extend([
        # --- MESSAGE ROUTING TO V8UI AND GEN ---
        newobj("obj-prep-f1", "prepend set_f1", 120, 310, 90, 20),
        newobj("obj-prep-f2", "prepend set_f2", 220, 310, 90, 20),
        newobj("obj-prep-f3", "prepend set_f3", 320, 310, 90, 20),
        newobj("obj-prep-slope", "prepend set_slope", 420, 310, 100, 20),
        newobj("obj-prep-phasemode", "prepend set_phasemode", 900, 310, 130, 20),
        newobj("obj-prep-link", "prepend set_linkgroup", 530, 310, 120, 20),
        newobj("obj-prep-bandmode", "prepend set_bandmode", 660, 310, 120, 20),
        newobj("obj-prep-gain", "prepend set_gain", 790, 310, 95, 20),

        # Route v8ui outlet 0 messages to Gen DSP and UI widgets (using `set` to avoid echo loops)
        newobj(
            "obj-route-ui",
            "route ui_f1 ui_f2 ui_f3 ui_slope ui_bandmode ui_linkgroup ui_gain ui_phasemode ui_st_f1 ui_st_f2 ui_st_f3",
            120, 360, 560, 20,
            numinlets=1, numoutlets=12,
            outlettype=[""] * 12,
        ),
        newobj("obj-set-f1", "prepend set", 120, 390, 75, 20),
        newobj("obj-set-f2", "prepend set", 200, 390, 75, 20),
        newobj("obj-set-f3", "prepend set", 280, 390, 75, 20),
        newobj("obj-set-slope", "prepend set", 360, 390, 75, 20),
        newobj("obj-set-bandmode", "prepend set", 440, 390, 75, 20),
        newobj("obj-set-linkgroup", "prepend set", 520, 390, 75, 20),
        newobj("obj-set-gain", "prepend set", 600, 390, 75, 20),
        newobj("obj-set-phasemode", "prepend set", 680, 390, 75, 20),
    ])

    # Background panels MUST be at the end of `boxes` with `"background": 1`
    boxes.extend(panels)

    lines = [
        # Audio signal path: plugin~ -> gen~ -> plugout~ is wired by the face when the deferred gen~ exists (src/mbsplit_dsp.js).
        # Until then there is no cord: the device is silent (a pass-through would make a rack of K chains K times as loud).

        # Loadbang & live.thisdevice initialization
        line("obj-loadbang", 0, "obj-msg-gen-buf", 0),
        line("obj-loadbang", 0, "obj-msg-ui-buf", 0),
        line("obj-loadbang", 0, "obj-msg-ui-init", 0),
        line("obj-thisdevice", 0, "obj-msg-gen-buf", 0),
        line("obj-thisdevice", 0, "obj-msg-ui-buf", 0),
        line("obj-thisdevice", 0, "obj-msg-ui-init", 0),
        line("obj-thisdevice", 0, "obj-msg-ui-dsp", 0),
        line("obj-msg-ui-dsp", 0, "obj-viz", 0),
        line("obj-msg-gen-buf", 0, "obj-gen-in", 1),
        line("obj-msg-ui-buf", 0, "obj-viz", 0),
        line("obj-msg-ui-init", 0, "obj-viz", 0),
        line("obj-freebang", 0, "obj-msg-ui-free", 0),
        line("obj-msg-ui-free", 0, "obj-viz", 0),

        # State pattr binding to v8ui
        line("obj-state-pattr", 1, "obj-viz", 0),

        # UI controls -> v8ui
        line("obj-ctrl-f1", 0, "obj-prep-f1", 0),
        line("obj-prep-f1", 0, "obj-viz", 0),
        line("obj-ctrl-f2", 0, "obj-prep-f2", 0),
        line("obj-prep-f2", 0, "obj-viz", 0),
        line("obj-ctrl-f3", 0, "obj-prep-f3", 0),
        line("obj-prep-f3", 0, "obj-viz", 0),
        line("obj-ctrl-slope", 0, "obj-prep-slope", 0),
        line("obj-prep-slope", 0, "obj-viz", 0),
        line("obj-ctrl-phasemode", 0, "obj-prep-phasemode", 0),
        line("obj-prep-phasemode", 0, "obj-viz", 0),
        line("obj-ctrl-linkgroup", 0, "obj-prep-link", 0),
        line("obj-prep-link", 0, "obj-viz", 0),
        line("obj-ctrl-bandmode", 0, "obj-prep-bandmode", 0),
        line("obj-prep-bandmode", 0, "obj-viz", 0),
        line("obj-ctrl-gain", 0, "obj-prep-gain", 0),
        line("obj-prep-gain", 0, "obj-viz", 0),

        # v8ui outlet 0 -> route ui_* -> controls (`set`) and unmatched DSP messages -> obj-gen
        line("obj-viz", 0, "obj-route-ui", 0),
        line("obj-route-ui", 0, "obj-set-f1", 0),
        line("obj-set-f1", 0, "obj-ctrl-f1", 0),
        line("obj-route-ui", 1, "obj-set-f2", 0),
        line("obj-set-f2", 0, "obj-ctrl-f2", 0),
        line("obj-route-ui", 2, "obj-set-f3", 0),
        line("obj-set-f3", 0, "obj-ctrl-f3", 0),
        line("obj-route-ui", 3, "obj-set-slope", 0),
        line("obj-set-slope", 0, "obj-ctrl-slope", 0),
        line("obj-route-ui", 4, "obj-set-bandmode", 0),
        line("obj-set-bandmode", 0, "obj-ctrl-bandmode", 0),
        line("obj-route-ui", 5, "obj-set-linkgroup", 0),
        line("obj-set-linkgroup", 0, "obj-ctrl-linkgroup", 0),
        line("obj-route-ui", 6, "obj-set-gain", 0),
        line("obj-set-gain", 0, "obj-ctrl-gain", 0),
        line("obj-route-ui", 7, "obj-set-phasemode", 0),
        line("obj-set-phasemode", 0, "obj-ctrl-phasemode", 0),
        # ui_st_fN -> `active 0/1` and `textcolor ...` straight into the crossover sliders (grey out missing splits)
        line("obj-route-ui", 8, "obj-ctrl-f1", 0),
        line("obj-route-ui", 9, "obj-ctrl-f2", 0),
        line("obj-route-ui", 10, "obj-ctrl-f3", 0),
        line("obj-route-ui", 11, "obj-gen-in", 1),
    ]

    names = {"obj-gen-in": "mb_genin", "obj-plugin": "mb_plugin", "obj-plugout": "mb_plugout"}
    for bx in boxes:
        if bx["box"].get("id") in names:
            bx["box"]["varname"] = names[bx["box"]["id"]]

    patcher = {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 0,
                "architecture": "x64",
                "modernui": 1,
            },
            "classnamespace": "box",
            "rect": [100.0, 100.0, DEVICE_W, DEVICE_H],
            "openrect": [0.0, 0.0, DEVICE_W, DEVICE_H],
            "devicewidth": DEVICE_W,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontname": "Arial",
            "gridsize": [8.0, 8.0],
            "boxes": boxes,
            "lines": lines,
            "parameters": {
                "obj-ctrl-f1": ["Crossover 1", "F1 Low", 0],
                "obj-ctrl-f2": ["Crossover 2", "F2 Mid", 0],
                "obj-ctrl-f3": ["Crossover 3", "F3 High", 0],
                "obj-ctrl-slope": ["Slope", "Slope", 0],
                "obj-ctrl-phasemode": ["Phase Mode", "Phase", 0],
                "obj-ctrl-linkgroup": ["Link Group", "Link", 0],
                "obj-ctrl-bandmode": ["Band Mode", "Band", 0],
                "obj-ctrl-gain": ["Chain Gain", "Gain", 0],
                "obj-state-pattr": ["SplitStateData", "SplitStateData", 0],
                "parameterbanks": {},
                "inherited_shortname": 1,
            },
            "dependency_cache": [],
            "autosave": 0,
        }
    }
    return patcher


def write_amxd(patcher_dict, out_path):
    import theme_common as tc
    tc.inject_theme_support(patcher_dict, "multiband_split")
    minify_patcher(patcher_dict)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    dev_w = patcher_dict["patcher"]["devicewidth"]
    payload = (json.dumps(patcher_dict, indent=2) + "\n").encode("utf-8")
    header = (
        b"ampf\x04\x00\x00\x00"
        + b"aaaa"
        + b"meta\x04\x00\x00\x00\x00\x00\x00\x00"
        + b"ptch"
        + struct.pack("<I", len(payload))
    )
    with open(out_path, "wb") as f:
        f.write(header + payload)
    print(f"Built {out_path} ({len(payload)} bytes JSON payload, {int(dev_w)}x{int(DEVICE_H)} px)")


if __name__ == "__main__":
    write_amxd(build_patcher(), OUT_AMXD_PATH)
