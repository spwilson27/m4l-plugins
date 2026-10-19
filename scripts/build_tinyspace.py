#!/usr/bin/env python3
"""
Build devices/Tiny Space.amxd (292 x 169 px)

Audio-effect reverb: a gen.codebox~ 20-line feedback delay network whose
seed (0-1000) scales active delay-line density from 4 to 20 lines and picks
delay times and diffusion, paired with 8 orthogonal room models (COMB, HYBRID,
ROOM, PLATE, TANK, BOX, SPRING, BOUNCE).
Presentation height is fixed at 169 px. The v8ui string field never overlaps a live.* control.
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Tiny Space.amxd")

DEVICE_W = 292.0
DEVICE_H = 169.0

COL_CYAN  = (0.28, 0.80, 0.95)
COL_AMBER = (0.95, 0.62, 0.22)
COL_TEAL  = (0.30, 0.88, 0.68)

# key: (long_name, short_name, lo, hi, initial, unit, exponent, gen_param, is_pct, help_text)
PARAM_SPECS = {
    "size": (
        "Size", "Size", 0.0, 100.0, 45.0, 5, 1.0, "size", True,
        "Scales every delay line. Low is a tight metallic comb; high reaches about 100 ms.",
    ),
    "damp": (
        "Damp", "Damp", 0.0, 100.0, 20.0, 5, 1.0, "damp", True,
        "Lowpass in the feedback loop. 0% stays bright and metallic; higher is darker.",
    ),
    "width": (
        "Width", "Width", 0.0, 100.0, 70.0, 5, 1.0, "width", True,
        "Wet stereo width. 0% is mono, 100% is the full tank image.",
    ),
    "mix": (
        "Mix", "Mix", 0.0, 100.0, 35.0, 5, 1.0, "wet", True,
        "Equal-power dry/wet mix. Dry is the untouched input.",
    ),
    "feedback": (
        "Feedback", "Fbk", 0.0, 100.0, 40.0, 5, 1.0, "fbk", True,
        "Loop gain. High values ring out for tens of seconds without exploding.",
    ),
    "predly": (
        "PreDly", "PreDly", 0.0, 250.0, 0.0, 2, 1.0, "predly", False,
        "Wet-path pre-delay, up to 250 ms.",
    ),
    "mod": (
        "Mod", "Mod", 0.0, 100.0, 15.0, 5, 1.0, "modamt", True,
        "Depth of the per-line delay wobble. Rates come from the seed.",
    ),
    "xfeed": (
        "XFeed", "XFeed", 0.0, 100.0, 25.0, 5, 1.0, "xfeed", True,
        "How much each side's tank feeds the other side.",
    ),
    "hp": (
        "HP", "HP", 20.0, 4000.0, 40.0, 3, 2.0, "hp", False,
        "Highpass into the tank.",
    ),
    "lp": (
        "LP", "LP", 400.0, 18000.0, 14000.0, 3, 2.0, "lp", False,
        "Lowpass into the tank.",
    ),
}


def valueof_for(key):
    long_name, short, lo, hi, initial, unit, exponent, _gen, _pct, _help = PARAM_SPECS[key]
    v = {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": 0,
        "parameter_unitstyle": unit,
    }
    if exponent != 1.0:
        v["parameter_exponent"] = exponent
    return v


def make_dial(key, x, y, w=44.0, h=48.0, color=COL_CYAN):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _pct, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activedialcolor": [color[0], color[1], color[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "id": f"obj-dial-{key}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 220.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_for(key)},
            "varname": long_name,
        }
    }


def make_numbox(key, x, y, w=46.0, h=15.0, color=COL_CYAN):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _pct, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": 0,
            "bordercolor": [0.20, 0.25, 0.31, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "id": f"obj-dial-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 270.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_for(key)},
            "textcolor": [color[0], color[1], color[2], 1.0],
            "varname": long_name,
        }
    }


def make_label(obj_id, text, x, y, w, h=14.0, size=8.5, color=(0.62, 0.70, 0.78), bold=True, align=0):
    return {
        "box": {
            "fontface": 1 if bold else 0,
            "fontname": "Arial Bold" if bold else "Arial",
            "fontsize": float(size),
            "id": obj_id,
            "maxclass": "live.comment",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 20.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "textcolor": [color[0], color[1], color[2], 1.0],
            "textjustification": align,
        }
    }


def make_panel(obj_id, x, y, w, h, bg=(0.09, 0.105, 0.125), border=(0.18, 0.22, 0.27), rounded=4):
    return {
        "box": {
            "angle": 270.0,
            "background": 1,
            "bgcolor": [bg[0], bg[1], bg[2], 1.0],
            "border": 1,
            "bordercolor": [border[0], border[1], border[2], 1.0],
            "id": obj_id,
            "maxclass": "panel",
            "mode": 0,
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 520.0, 80.0, 40.0],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "proportion": 0.5,
            "rounded": rounded,
        }
    }


def make_character_selector(x, y, w=50.0, h=15.0):
    """Single dropdown selection box (`live.menu`) for the 8 room models."""
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": "Selects FDN room model: Comb, Hybrid, Room, Plate, Tank, Box, Spring, or Bounce.",
            "annotation_name": "Character",
            "bordercolor": [0.22, 0.28, 0.36, 1.0],
            "fontface": 1,
            "fontsize": 8.5,
            "id": "obj-char",
            "maxclass": "live.menu",
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [320.0, 18.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": "Character",
                    "parameter_enum": [
                        "COMB", "HYBRID", "ROOM", "PLATE",
                        "TANK", "BOX", "SPRING", "BOUNCE"
                    ],
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": "Character",
                    "parameter_mmax": 7,
                    "parameter_mmin": 0,
                    "parameter_shortname": "Char",
                    "parameter_type": 2,
                    "parameter_unitstyle": 9,
                }
            },
            "textcolor": [COL_AMBER[0], COL_AMBER[1], COL_AMBER[2], 1.0],
            "varname": "Character",
        }
    }


def build_patcher():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    v8_code = config_js.rstrip() + "\n\n" + ui_js

    viz_rect = [70.0, 26.0, 152.0, 74.0]

    # Note: In Max for Live, `parameter_type: 1` (Int) is limited to 256 values (0..255).
    # For integer ranges > 255 (like Seed 0..1000), M4L requires `parameter_type: 0` (Float)
    # with `parameter_unitstyle: 0` (Int display) and `parameter_steps: 1001`.
    ui_boxes = [
        # Left Column: Input Conditioning (x=6..62)
        make_label("obj-lbl-pre", "PreDly", 10, 8, 48, 12, size=8.0, color=COL_TEAL, align=1),
        make_numbox("predly", 10, 22, 48, 15, color=COL_TEAL),
        make_dial("hp", 10, 50, 48, 48, color=COL_CYAN),
        make_dial("lp", 10, 110, 48, 48, color=COL_CYAN),

        # Center Column: Header (Title + Seed + Character selection box) + Screen + 3 Core Tank Dials (x=66..226)
        make_label("obj-title", "tinyspace", 68, 7, 56, 15, size=9.5, color=(0.88, 0.92, 0.96)),
        {
            "box": {
                "activebgcolor": [0.06, 0.075, 0.095, 1.0],
                "annotation": "Picks a deterministic delay-line configuration (0-1000). Lower seeds have fewer delay lines; higher seeds have more.",
                "annotation_name": "Seed",
                "appearance": 0,
                "bordercolor": [0.20, 0.25, 0.31, 1.0],
                "fontface": 1,
                "fontsize": 9.0,
                "id": "obj-seed",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [200.0, 18.0, 42.0, 16.0],
                "presentation": 1,
                "presentation_rect": [126.0, 7.0, 42.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Seed",
                        "parameter_initial": [350.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Seed",
                        "parameter_mmax": 1000.0,
                        "parameter_mmin": 0.0,
                        "parameter_shortname": "Seed",
                        "parameter_steps": 1001,
                        "parameter_type": 0,
                        "parameter_unitstyle": 0,
                    }
                },
                "textcolor": [0.45, 0.86, 0.95, 1.0],
                "varname": "Seed",
            }
        },
        make_character_selector(172, 7, 50, 15),

        make_dial("size",     69,  110, 48, 48, color=COL_CYAN),
        make_dial("feedback", 122, 110, 48, 48, color=COL_CYAN),
        make_dial("xfeed",    175, 110, 48, 48, color=COL_CYAN),

        # Right Column: Loop Tone & Output (x=230..286)
        make_label("obj-lbl-dmp", "Damp", 234, 6, 48, 11, size=7.5, color=COL_AMBER, align=1),
        make_numbox("damp", 234, 18, 48, 14, color=COL_AMBER),
        make_label("obj-lbl-mod", "Mod", 234, 34, 48, 11, size=7.5, color=COL_AMBER, align=1),
        make_numbox("mod", 234, 46, 48, 14, color=COL_AMBER),
        make_dial("width", 234, 64,  48, 45, color=COL_AMBER),
        make_dial("mix",   234, 114, 48, 45, color=COL_CYAN),
    ]

    panels = [
        make_panel("obj-panel-in",    6,   5,   56,  158, bg=(0.10, 0.115, 0.135), border=(0.16, 0.20, 0.24)),
        make_panel("obj-panel-viz",   66,  5,   160, 99,  bg=(0.06, 0.07, 0.085),  border=(0.15, 0.19, 0.23)),
        make_panel("obj-panel-dials", 66,  106, 160, 57,  bg=(0.10, 0.115, 0.135), border=(0.16, 0.20, 0.24)),
        make_panel("obj-panel-out",   230, 5,   56,  158, bg=(0.10, 0.115, 0.135), border=(0.16, 0.20, 0.24)),
    ]

    boxes = [
        *ui_boxes,
        {
            "box": {
                "border": 0,
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [20.0, 80.0, viz_rect[2], viz_rect[3]],
                "presentation": 1,
                "presentation_rect": [float(v) for v in viz_rect],
                "textfile": {
                    "text": v8_code,
                    "filename": "none",
                    "flags": 0,
                    "embed": 1,
                    "autowatch": 1,
                },
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugin",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [20.0, 240.0, 52.0, 20.0],
                "text": "plugin~",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugout",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [20.0, 460.0, 58.0, 20.0],
                "text": "plugout~",
            }
        },
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
                "patching_rect": [120.0, 300.0, 420.0, 140.0],
                "varname": "tinyspace",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-cfg",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [560.0, 240.0, 190.0, 20.0],
                "text": "buffer~ #0-tsconfig @samps 128",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-meters",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [560.0, 270.0, 190.0, 20.0],
                "text": "buffer~ #0-tsmeters @samps 32",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-loadbang",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [560.0, 180.0, 60.0, 20.0],
                "text": "loadbang",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-genbufs",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [640.0, 180.0, 280.0, 20.0],
                "text": "cfg #0-tsconfig, meters #0-tsmeters",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-uibufs",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [640.0, 210.0, 230.0, 20.0],
                "text": "setbuffer #0-tsconfig #0-tsmeters",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-seed",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [200.0, 48.0, 110.0, 20.0],
                "text": "prepend set_seed",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-char",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [320.0, 48.0, 125.0, 20.0],
                "text": "prepend set_character",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-duck-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [400.0, 80.0, 70.0, 20.0],
                "text": "0, 1 160",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-duck-line",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [400.0, 110.0, 40.0, 20.0],
                "text": "line",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-duck",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [460.0, 110.0, 80.0, 20.0],
                "text": "prepend duck",
            }
        },
    ]

    px = 360.0
    for key, spec in PARAM_SPECS.items():
        _long, _short, _lo, _hi, _init, _unit, _exp, gen_param, is_pct, _help = spec
        if is_pct:
            boxes.append({
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": f"obj-scale-{key}",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": ["float"],
                    "patching_rect": [px, 300.0, 48.0, 20.0],
                    "text": "/ 100.",
                }
            })
        boxes.append({
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": f"obj-prep-{key}",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [px, 340.0, 90.0, 20.0],
                "text": f"prepend {gen_param}",
            }
        })
        px += 68.0

    # Panels must be last and flagged background so they sit behind the controls.
    boxes.extend(panels)

    lines = [
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}},
        {"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-genbufs", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-uibufs", 0]}},
        {"patchline": {"source": ["obj-msg-genbufs", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-msg-uibufs", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-seed", 0], "destination": ["obj-prep-seed", 0]}},
        {"patchline": {"source": ["obj-prep-seed", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-char", 0], "destination": ["obj-prep-char", 0]}},
        {"patchline": {"source": ["obj-prep-char", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-viz", 0], "destination": ["obj-duck-msg", 0]}},
        {"patchline": {"source": ["obj-duck-msg", 0], "destination": ["obj-duck-line", 0]}},
        {"patchline": {"source": ["obj-duck-line", 0], "destination": ["obj-prep-duck", 0]}},
        {"patchline": {"source": ["obj-prep-duck", 0], "destination": ["obj-gen", 0]}},
    ]
    for key, spec in PARAM_SPECS.items():
        is_pct = spec[8]
        if is_pct:
            lines.append({"patchline": {"source": [f"obj-dial-{key}", 0], "destination": [f"obj-scale-{key}", 0]}})
            lines.append({"patchline": {"source": [f"obj-scale-{key}", 0], "destination": [f"obj-prep-{key}", 0]}})
        else:
            lines.append({"patchline": {"source": [f"obj-dial-{key}", 0], "destination": [f"obj-prep-{key}", 0]}})
        lines.append({"patchline": {"source": [f"obj-prep-{key}", 0], "destination": ["obj-gen", 0]}})

    parameters = {
        "obj-seed": ["Seed", "Seed", 0],
        "obj-char": ["Character", "Char", 0],
    }
    for key, spec in PARAM_SPECS.items():
        parameters[f"obj-dial-{key}"] = [spec[0], spec[1], 0]
    parameters["parameterbanks"] = {
        "0": {
            "index": 0,
            "name": "",
            "parameters": ["Size", "Damp", "Width", "Mix", "Feedback", "PreDly", "Mod", "XFeed"],
        },
        "1": {
            "index": 1,
            "name": "",
            "parameters": ["HP", "LP", "Seed", "Character"],
        },
    }
    parameters["inherited_shortname"] = 1

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 5,
                "architecture": "x64",
                "modernui": 1,
            },
            "classnamespace": "box",
            "rect": [40.0, 60.0, 1100.0, 640.0],
            "openrect": [0.0, 0.0, float(DEVICE_W), DEVICE_H],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial Bold",
            "gridonopen": 1,
            "gridsize": [8.0, 8.0],
            "gridsnaponopen": 1,
            "objectsnaponopen": 1,
            "statusbarvisible": 2,
            "toolbarvisible": 1,
            "lefttoolbarpinned": 0,
            "toptoolbarpinned": 0,
            "righttoolbarpinned": 0,
            "bottomtoolbarpinned": 0,
            "toolbars_unpinned_last_save": 0,
            "tallnewobj": 0,
            "boxanimatetime": 500,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": float(DEVICE_W),
            "description": "Tiny Space reverb: seed-selected combs through a small room",
            "digest": "Seeded tiny-space reverb for Max for Live",
            "tags": "max for live reverb delay tiny space",
            "style": "",
            "subpatcher_template": "",
            "title": "Tiny Space",
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters,
            "dependency_cache": [],
            "latency": 0,
            "project": {
                "version": 1,
                "creationdate": 3590052786,
                "modificationdate": 3590052786,
                "viewrect": [0.0, 0.0, 300.0, 500.0],
                "autoorganize": 1,
                "hideprojectwindow": 1,
                "showdependencies": 1,
                "autolocalize": 0,
                "contents": {"patchers": {}},
                "layout": {},
                "searchpath": {},
                "detailsvisible": 0,
                "amxdtype": 1633771873,
                "readonly": 0,
                "devpathtype": 0,
                "devpath": ".",
                "sortmode": 0,
                "viewmode": 0,
            },
            "autosave": 0,
        }
    }


def write_amxd(patcher_doc, out_path):
    json_bytes = json.dumps(patcher_doc, indent="\t").encode("utf-8") + b"\n"
    header = (
        b"ampf" + struct.pack("<I", 4) +
        b"aaaa" +
        b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) +
        b"ptch" + struct.pack("<I", len(json_bytes))
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header + json_bytes)
    w = int(patcher_doc["patcher"]["openrect"][2])
    h = int(patcher_doc["patcher"]["openrect"][3])
    print(f"Built {out_path} ({w}x{h} px, {len(header) + len(json_bytes)} bytes)")


def build():
    write_amxd(build_patcher(), OUT_AMXD_PATH)


if __name__ == "__main__":
    build()
