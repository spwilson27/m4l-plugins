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

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "mbsplit_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "mbsplit_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "mbsplit_core.genexpr")
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


def make_slider_numbox(key, x, y, w=54.0, h=15.0, accent_rgb=(0.22, 0.74, 0.97), bipolar=False, hidden=0):
    long_name, _short, _lo, _hi, _init, _unit, _exp, help_text = PARAM_SPECS[key]
    box_dict = {
        "activebgcolor": [BG_DARK[0], BG_DARK[1], BG_DARK[2], 1.0],
        "activeslidercolor": blend_slider_color(accent_rgb),
        "annotation": help_text,
        "annotation_name": long_name,
        "appearance": 3 if bipolar else 2,
        "bordercolor": [0.22, 0.28, 0.35, 1.0],
        "fontface": 1,
        "fontsize": 8.5,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.numbox",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 240.0, float(w), float(h)],
        "presentation": 0 if hidden else 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": valueof_dict(key)},
        "textcolor": [0.92, 0.96, 1.0, 1.0],
        "varname": long_name,
    }
    if hidden:
        box_dict["hidden"] = 1
    return {"box": box_dict}


def make_slope_tab(x, y, w=84.0, h=15.0):
    return {
        "box": {
            "activebgoncolor": [0.20, 0.78, 0.62, 1.0],
            "annotation": "Linkwitz-Riley phase-compensated filter slope (12, 24, or 48 dB/oct). Linked across instances in the same Rack.",
            "annotation_name": "Slope",
            "bgcolor": [0.07, 0.09, 0.12, 1.0],
            "bgoncolor": [0.15, 0.48, 0.40, 1.0],
            "bordercolor": [0.22, 0.28, 0.35, 1.0],
            "fontface": 1,
            "fontsize": 8.5,
            "id": "obj-ctrl-slope",
            "maxclass": "live.tab",
            "num_lines_patching": 1,
            "num_lines_presentation": 1,
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [210.0, 80.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_enum": ["12 dB", "24 dB", "48 dB"],
                    "parameter_initial": [1],
                    "parameter_initial_enable": 1,
                    "parameter_longname": "Slope",
                    "parameter_mmax": 2,
                    "parameter_shortname": "Slope",
                    "parameter_type": 2,
                    "parameter_unitstyle": 9,
                }
            },
            "textcolor": [0.68, 0.76, 0.84, 1.0],
            "textoncolor": [0.98, 1.0, 1.0, 1.0],
            "varname": "Slope",
        }
    }


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


def build_patcher():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    combined_js = config_js + "\n\n" + ui_js
    viz_rect = [6.0, 6.0, 256.0, 136.0]

    ui_widgets = [
        make_slope_tab(6.0, 146.0, 84.0, 15.0),
        make_slider_numbox("f1", 94.0, 146.0, 54.0, 15.0, accent_rgb=(0.22, 0.74, 0.97), hidden=0),
        make_slider_numbox("f2", 151.0, 146.0, 54.0, 15.0, accent_rgb=(0.20, 0.83, 0.60), hidden=0),
        make_slider_numbox("f3", 208.0, 146.0, 54.0, 15.0, accent_rgb=(0.98, 0.75, 0.15), hidden=0),
        # Automatable Live parameters synced with v8ui controls (non-overlapping / hidden in presentation)
        make_slider_numbox("gain", 320.0, 240.0, 56.0, 15.0, accent_rgb=(0.98, 0.75, 0.15), bipolar=False, hidden=1),
        make_link_menu(390.0, 240.0, 46.0, 15.0, hidden=1),
        make_bandmode_menu(460.0, 240.0, 65.0, 15.0, hidden=1),
    ]

    panels = [
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.055, 0.068, 0.088, 1.0],
                "border": 1,
                "bordercolor": [0.16, 0.22, 0.30, 1.0],
                "id": "obj-panel-main",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [3.0, 4.0, 262.0, 161.0],
                "presentation": 1,
                "presentation_rect": [3.0, 4.0, 262.0, 161.0],
                "proportion": 0.5,
                "rounded": 8,
            }
        }
    ]

    boxes = [
        # Audio I/O
        newobj("obj-plugin", "plugin~", 40, 40, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 40, 520, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),

        # Gen DSP Core
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [40.0, 420.0, 260.0, 70.0],
            }
        },

        # Instance-local scope & 8192-sample audio ring buffer (#0-splitscope @samps 8224)
        newobj("obj-buf-scope", "buffer~ #0-splitscope @samps 8224", 340, 420, 225, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 340, 320, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        newobj("obj-thisdevice", "live.thisdevice", 420, 320, 85, 20, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        newobj("obj-freebang", "freebang", 520, 320, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        msgbox("obj-msg-gen-buf", "scope #0-splitscope", 340, 360, 130, 20),
        msgbox("obj-msg-ui-buf", "setbuffer #0-splitscope", 480, 360, 150, 20),
        msgbox("obj-msg-ui-init", "loadbang", 640, 360, 65, 20),
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
                        "parameter_initial": [2, 120.0, 800.0, 4500.0, 1, 1, 0, 1, 0, 0.0, 1],
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
        newobj("obj-prep-link", "prepend set_linkgroup", 530, 310, 120, 20),
        newobj("obj-prep-bandmode", "prepend set_bandmode", 660, 310, 120, 20),
        newobj("obj-prep-gain", "prepend set_gain", 790, 310, 95, 20),

        # Route v8ui outlet 0 messages to Gen DSP and UI widgets (using `set` to avoid echo loops)
        newobj(
            "obj-route-ui",
            "route ui_f1 ui_f2 ui_f3 ui_slope ui_bandmode ui_linkgroup ui_gain",
            120, 360, 370, 20,
            numinlets=1, numoutlets=8,
            outlettype=["", "", "", "", "", "", "", ""],
        ),
        newobj("obj-set-f1", "prepend set", 120, 390, 75, 20),
        newobj("obj-set-f2", "prepend set", 200, 390, 75, 20),
        newobj("obj-set-f3", "prepend set", 280, 390, 75, 20),
        newobj("obj-set-slope", "prepend set", 360, 390, 75, 20),
        newobj("obj-set-bandmode", "prepend set", 440, 390, 75, 20),
        newobj("obj-set-linkgroup", "prepend set", 520, 390, 75, 20),
        newobj("obj-set-gain", "prepend set", 600, 390, 75, 20),
    ])

    # Background panels MUST be at the end of `boxes` with `"background": 1`
    boxes.extend(panels)

    lines = [
        # Audio signal path: plugin~ -> gen.codebox~ -> plugout~
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),

        # Loadbang & live.thisdevice initialization
        line("obj-loadbang", 0, "obj-msg-gen-buf", 0),
        line("obj-loadbang", 0, "obj-msg-ui-buf", 0),
        line("obj-loadbang", 0, "obj-msg-ui-init", 0),
        line("obj-thisdevice", 0, "obj-msg-gen-buf", 0),
        line("obj-thisdevice", 0, "obj-msg-ui-buf", 0),
        line("obj-thisdevice", 0, "obj-msg-ui-init", 0),
        line("obj-msg-gen-buf", 0, "obj-gen", 0),
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
        line("obj-route-ui", 7, "obj-gen", 0),
    ]

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
