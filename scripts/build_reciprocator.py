#!/usr/bin/env python3
"""
Build devices/Reciprocator.amxd

Compact 3-Stage Signal-Flow layout (448 x 169 px):
  - Left Panel (x=6..176): Interactive scrolling scope (ENV, OUT, 1/E dB, OPEN/MUTE bar,
    and draggable Gate & Ceiling threshold lines).
  - Stage 1 [1. DETECT] (x=180..272, Cyan card): Attack & Release dials + HP, LP, RMS, Look numboxes.
  - Stage 2 [2. 1 / ENV] (x=276..356, Coral card): Amount dial, Gate dial, and Reverse Gate (`Rev Gate`) button.
  - Stage 3 [3. OUTPUT] (x=360..442, Amber card): Output Mode selector (`Soft` / `Hard` / `Lim`) placed
    above the `Ceiling` dial, followed by the `Mix` dial.
"""

import hashlib
import json
import os
import struct

from minify_embed import minify_patcher
from minify_gen import minify_gen

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "reciprocator_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "reciprocator_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "reciprocator_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Reciprocator.amxd")

DEVICE_W = 448.0
DEVICE_H = 169.0

# Parameter definitions:
# key: (long_name, short_name, lo, hi, initial, unitstyle, exponent, gen_param, is_pct, help_text)
PARAM_SPECS = {
    "amount": (
        "Amount", "Amount", 0.0, 150.0, 100.0, 5, 1.0, "amount", True,
        "Reciprocal exponent (x / env^p). 0% is unity, 100% flattens dynamics to Ceiling, >100% inverts dynamics.",
    ),
    "gate": (
        "Gate", "Gate", -72.0, -6.0, -42.0, 4, 1.0, "gate", False,
        "Noise floor threshold in dB. Signals below Gate smoothly mute (or, when Rev Gate is active, only signals below Gate pass through).",
    ),
    "attack": (
        "Attack", "Attack", 0.05, 250.0, 1.5, 2, 2.5, "attack", False,
        "Envelope detector attack time (0.05 ms audio-rate waveshaping up to 250 ms).",
    ),
    "release": (
        "Release", "Release", 0.5, 1500.0, 60.0, 2, 2.5, "release", False,
        "Envelope detector release time (0.5 ms audio-rate distortion up to 1500 ms sustain).",
    ),
    "mix": (
        "Mix", "Mix", 0.0, 100.0, 100.0, 5, 1.0, "wet", True,
        "Equal-power dry/wet mix (dry path is lookahead-compensated).",
    ),
    "ceiling": (
        "Ceiling", "Ceiling", -18.0, 0.0, -1.0, 4, 1.0, "ceiling", False,
        "Maximum output ceiling level in dB.",
    ),
    "lookahead": (
        "Lookahead", "Look", 0.0, 10.0, 1.5, 2, 1.0, "lookahead", False,
        "Delays the audio signal relative to the detector (0 to 10 ms) to catch fast transients.",
    ),
    "detect": (
        "Detect", "Detect", 0.0, 100.0, 25.0, 5, 1.0, "detect", True,
        "Blends detector between fast dual-mono Peak (0%) and stereo-linked RMS (100%).",
    ),
    "schp": (
        "SC HP", "SC HP", 20.0, 2000.0, 60.0, 3, 2.0, "schp", False,
        "Highpass filter on the envelope detector sidechain.",
    ),
    "sclp": (
        "SC LP", "SC LP", 400.0, 18000.0, 12000.0, 3, 2.0, "sclp", False,
        "Lowpass filter on the envelope detector sidechain.",
    ),
}


def valueof_dict(key):
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


def make_dial(key, x, y, w=48.0, h=46.0, color_rgb=(0.28, 0.82, 0.95)):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _pct, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activedialcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [x, 220.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "varname": long_name,
        }
    }


def make_numbox(key, x, y, w=46.0, h=15.0, color_rgb=(0.45, 0.86, 0.96)):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _pct, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": 0,
            "bordercolor": [0.22, 0.27, 0.33, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [x, 275.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "textcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "varname": long_name,
        }
    }


def make_label(obj_id, text, x, y, w, h=13.0, size=8.5, color=(0.58, 0.66, 0.74), bold=True, align=0):
    return {
        "box": {
            "fontface": 1 if bold else 0,
            "fontname": "Arial Bold" if bold else "Arial",
            "fontsize": float(size),
            "id": obj_id,
            "maxclass": "live.comment",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [x, 15.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "textcolor": [color[0], color[1], color[2], 1.0],
            "textjustification": align,
        }
    }


def make_revgate_button(x, y, w=64.0, h=15.0):
    return {
        "box": {
            "activebgcolor": [0.10, 0.12, 0.15, 1.0],
            "activebgoncolor": [0.96, 0.45, 0.45, 1.0],
            "activetextcolor": [0.82, 0.86, 0.90, 1.0],
            "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
            "annotation": "Reverse Gate: when enabled, mutes signals ABOVE Gate and only allows quiet signals below Gate through.",
            "annotation_name": "Reverse Gate",
            "bordercolor": [0.96, 0.48, 0.48, 1.0],
            "id": "obj-revgate",
            "maxclass": "live.text",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [200.0, 18.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": "Reverse Gate",
                    "parameter_enum": ["Normal", "Reverse"],
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": "Reverse Gate",
                    "parameter_mmax": 1,
                    "parameter_shortname": "RevGate",
                    "parameter_type": 2,
                }
            },
            "text": "Rev Gate",
            "texton": "Rev Gate",
            "varname": "Reverse Gate",
        }
    }


def make_outmode_menu(x, y, w=74.0, h=15.0):
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": "Selects the Ceiling output stage: Soft Clip (tanh), Hard Clip, or fast Peak Limiter.",
            "annotation_name": "Output Mode",
            "bordercolor": [0.38, 0.44, 0.52, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "id": "obj-outmode",
            "maxclass": "live.menu",
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [290.0, 18.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": "Output Mode",
                    "parameter_enum": ["Soft Clip", "Hard Clip", "Limiter"],
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": "Output Mode",
                    "parameter_mmax": 2,
                    "parameter_shortname": "OutMode",
                    "parameter_type": 2,
                }
            },
            "textcolor": [0.96, 0.66, 0.25, 1.0],
            "varname": "Output Mode",
        }
    }


def make_panel(obj_id, x, y, w, h, bg=(0.10, 0.11, 0.13), border=(0.22, 0.26, 0.32), rounded=6):
    return {
        "box": {
            "angle": 270.0,
            "background": 1,
            "bgcolor": [bg[0], bg[1], bg[2], 1.0],
            "border": 1,
            "bordercolor": [border[0], border[1], border[2], 1.0],
            "grad1": [bg[0], bg[1], bg[2], 1.0],
            "grad2": [bg[0] * 0.85, bg[1] * 0.85, bg[2] * 0.85, 1.0],
            "id": obj_id,
            "maxclass": "panel",
            "mode": 0,
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 10.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "proportion": 0.39,
            "rounded": rounded,
        }
    }


def gendsp_json(gen_code):
    """2-in / 2-out .gendsp wrapper around codebox. The face writes it to
    /tmp/reciprocator_core_<hash>.gendsp and creates `gen~ @gen <file>` after the GUI loads."""
    gen_code = minify_gen(gen_code)
    def bx(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {
            "id": i,
            "maxclass": cls,
            "numinlets": ni,
            "numoutlets": no,
            "outlettype": [""] * no,
            "patching_rect": [float(x), float(y), 200.0, 22.0],
        }
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}

    patch = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "dsp.gen",
            "rect": [50.0, 50.0, 600.0, 450.0],
            "boxes": [
                bx("obj-in1", "in 1", 20, 20, 0, 1),
                bx("obj-in2", "in 2", 120, 20, 0, 1),
                bx("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
                bx("obj-out1", "out 1", 20, 400, 1, 0),
                bx("obj-out2", "out 2", 120, 400, 1, 0),
            ],
            "lines": [
                {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-code", 0]}},
                {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-code", 1]}},
                {"patchline": {"source": ["obj-code", 0], "destination": ["obj-out1", 0]}},
                {"patchline": {"source": ["obj-code", 1], "destination": ["obj-out2", 0]}},
            ],
        }
    }
    return json.dumps(patch)


def build():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    gen_text = gendsp_json(gen_code)
    gen_hash = hashlib.sha1(gen_text.encode("utf-8")).hexdigest()[:12]
    gen_vars = f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\nvar GEN_DSP_HASH = \"{gen_hash}\";\n"
    v8_code = config_js.rstrip() + "\n\n" + gen_vars + "\n" + ui_js

    viz_rect = [10.0, 28.0, 162.0, 132.0]
    cyan = (0.28, 0.84, 0.96)
    amber = (0.96, 0.66, 0.25)
    coral = (0.96, 0.48, 0.48)

    boxes = [
        make_label("obj-title", "Reciprocator", 10, 7, 110, 16, size=11.5, color=(0.92, 0.95, 0.98)),
        # Stage 1: 1. DETECT (x=180..272)
        make_label("obj-hdr-det", "1. DETECT", 184, 8, 84, 13, size=8.5, color=cyan, align=1),
        make_dial("attack", 182, 26, 44, 46, color_rgb=cyan),
        make_dial("release", 226, 26, 44, 46, color_rgb=cyan),
        make_label("obj-lbl-hp", "HP", 184, 82, 26, 13, size=8.0, color=cyan),
        make_numbox("schp", 212, 81, 54, 15, color_rgb=cyan),
        make_label("obj-lbl-lp", "LP", 184, 102, 26, 13, size=8.0, color=cyan),
        make_numbox("sclp", 212, 101, 54, 15, color_rgb=cyan),
        make_label("obj-lbl-rms", "RMS", 184, 122, 28, 13, size=8.0, color=cyan),
        make_numbox("detect", 212, 121, 54, 15, color_rgb=cyan),
        make_label("obj-lbl-look", "Look", 184, 142, 30, 13, size=8.0, color=cyan),
        make_numbox("lookahead", 212, 141, 54, 15, color_rgb=cyan),
        # Stage 2: 2. 1 / ENV (x=276..356) — Amount, Gate, and Reverse Gate button
        make_label("obj-hdr-rec", "2. 1 / ENV", 280, 8, 72, 13, size=8.5, color=coral, align=1),
        make_dial("amount", 292, 24, 48, 46, color_rgb=cyan),
        make_dial("gate", 292, 78, 48, 46, color_rgb=coral),
        make_revgate_button(284, 136, 64, 16),
        # Stage 3: 3. OUTPUT (x=360..442) — [Soft Clip | Hard Clip | Limiter] selection box ABOVE Ceiling dial, then Mix dial
        make_label("obj-hdr-out", "3. OUTPUT", 364, 8, 74, 13, size=8.5, color=amber, align=1),
        make_outmode_menu(364, 25, 74, 15),
        make_dial("ceiling", 376, 48, 50, 46, color_rgb=amber),
        make_dial("mix", 376, 104, 50, 46, color_rgb=amber),
        # Scope & core objects
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
                "varname": "rcp_plugin",
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
                "varname": "rcp_plugout",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-gen-in",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [120.0, 300.0, 70.0, 20.0],
                "text": "gate 1 1",
                "varname": "rcp_genin",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-scope",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [560.0, 240.0, 210.0, 20.0],
                "text": "buffer~ #0-recipscope @samps 32",
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
                "patching_rect": [560.0, 300.0, 60.0, 20.0],
                "text": "loadbang",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-ui-buf",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [560.0, 330.0, 180.0, 20.0],
                "text": "setbuffer #0-recipscope",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-gen-buf",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [560.0, 360.0, 180.0, 20.0],
                "text": "scope #0-recipscope",
                "varname": "rcp_scopebind",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-thisdevice",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["bang", "int"],
                "patching_rect": [760.0, 300.0, 100.0, 20.0],
                "text": "live.thisdevice",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-ui-dsp",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [760.0, 330.0, 70.0, 20.0],
                "text": "init_dsp",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-outmode",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [270.0, 44.0, 110.0, 20.0],
                "text": "prepend outmode",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-ui-outmode",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [390.0, 44.0, 125.0, 20.0],
                "text": "prepend set_outmode",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-revgate",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [270.0, 70.0, 110.0, 20.0],
                "text": "prepend revgate",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-ui-revgate",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [390.0, 70.0, 125.0, 20.0],
                "text": "prepend set_revgate",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-ui-gate",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [560.0, 390.0, 105.0, 20.0],
                "text": "prepend set_gate",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-ui-ceiling",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [560.0, 420.0, 115.0, 20.0],
                "text": "prepend set_ceiling",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-ui-amount",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [560.0, 450.0, 115.0, 20.0],
                "text": "prepend set_amount",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-route-viz",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 3,
                "outlettype": ["", "", ""],
                "patching_rect": [20.0, 215.0, 120.0, 20.0],
                "text": "route gate ceiling",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-set-gate",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [150.0, 215.0, 75.0, 20.0],
                "text": "prepend set",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-set-ceil",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [235.0, 215.0, 75.0, 20.0],
                "text": "prepend set",
            }
        },
    ]

    lines = [
        # plugin~ stays unconnected until the face creates gen~ and wires
        # rcp_plugin -> gen -> rcp_plugout. No dry bypass: output is silence while DSP loads.
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-ui-buf", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-gen-buf", 0]}},
        {"patchline": {"source": ["obj-msg-ui-buf", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-msg-gen-buf", 0], "destination": ["obj-gen-in", 1]}},
        {"patchline": {"source": ["obj-thisdevice", 0], "destination": ["obj-msg-ui-dsp", 0]}},
        {"patchline": {"source": ["obj-msg-ui-dsp", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-outmode", 0], "destination": ["obj-prep-outmode", 0]}},
        {"patchline": {"source": ["obj-prep-outmode", 0], "destination": ["obj-gen-in", 1]}},
        {"patchline": {"source": ["obj-outmode", 0], "destination": ["obj-ui-outmode", 0]}},
        {"patchline": {"source": ["obj-ui-outmode", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-revgate", 0], "destination": ["obj-prep-revgate", 0]}},
        {"patchline": {"source": ["obj-prep-revgate", 0], "destination": ["obj-gen-in", 1]}},
        {"patchline": {"source": ["obj-revgate", 0], "destination": ["obj-ui-revgate", 0]}},
        {"patchline": {"source": ["obj-ui-revgate", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-ctrl-gate", 0], "destination": ["obj-ui-gate", 0]}},
        {"patchline": {"source": ["obj-ui-gate", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-ctrl-ceiling", 0], "destination": ["obj-ui-ceiling", 0]}},
        {"patchline": {"source": ["obj-ui-ceiling", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-ctrl-amount", 0], "destination": ["obj-ui-amount", 0]}},
        {"patchline": {"source": ["obj-ui-amount", 0], "destination": ["obj-viz", 0]}},
        # Dragging Gate or Ceiling inside the scope updates gen + sets the Gate/Ceiling widget
        {"patchline": {"source": ["obj-viz", 0], "destination": ["obj-route-viz", 0]}},
        {"patchline": {"source": ["obj-route-viz", 0], "destination": ["obj-prep-gate", 0]}},
        {"patchline": {"source": ["obj-route-viz", 0], "destination": ["obj-set-gate", 0]}},
        {"patchline": {"source": ["obj-set-gate", 0], "destination": ["obj-ctrl-gate", 0]}},
        {"patchline": {"source": ["obj-route-viz", 1], "destination": ["obj-prep-ceiling", 0]}},
        {"patchline": {"source": ["obj-route-viz", 1], "destination": ["obj-set-ceil", 0]}},
        {"patchline": {"source": ["obj-set-ceil", 0], "destination": ["obj-ctrl-ceiling", 0]}},
        # Unmatched viz messages (scope bind, revgate value) go to the gen hub's data inlet.
        {"patchline": {"source": ["obj-route-viz", 2], "destination": ["obj-gen-in", 1]}},
    ]

    for i, (key, spec) in enumerate(PARAM_SPECS.items()):
        _long, _short, _lo, _hi, _init, _unit, _exp, gen_param, is_pct, _help = spec
        ctrl_id = f"obj-ctrl-{key}"
        prep_id = f"obj-prep-{key}"
        row_y = 500.0 + i * 26.0
        if is_pct:
            scale_id = f"obj-scale-{key}"
            boxes.append(
                {
                    "box": {
                        "fontname": "Arial Bold",
                        "fontsize": 10.0,
                        "id": scale_id,
                        "maxclass": "newobj",
                        "numinlets": 2,
                        "numoutlets": 1,
                        "outlettype": ["float"],
                        "patching_rect": [360.0, row_y, 52.0, 20.0],
                        "text": "/ 100.",
                    }
                }
            )
            lines.append({"patchline": {"source": [ctrl_id, 0], "destination": [scale_id, 0]}})
            src_id = scale_id
        else:
            src_id = ctrl_id
        boxes.append(
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": prep_id,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [424.0, row_y, 110.0, 20.0],
                    "text": f"prepend {gen_param}",
                }
            }
        )
        lines.append({"patchline": {"source": [src_id, 0], "destination": [prep_id, 0]}})
        lines.append({"patchline": {"source": [prep_id, 0], "destination": ["obj-gen-in", 1]}})

    # Background panels MUST be last in boxes and have "background": 1
    boxes.extend(
        [
            make_panel("obj-panel-left", 6, 5, 170, 159),
            make_panel("obj-panel-det", 180, 5, 92, 159, bg=(0.09, 0.11, 0.13), border=(0.20, 0.44, 0.54)),
            make_panel("obj-panel-rec", 276, 5, 80, 159, bg=(0.10, 0.10, 0.13), border=(0.52, 0.28, 0.34)),
            make_panel("obj-panel-out", 360, 5, 82, 159, bg=(0.11, 0.10, 0.12), border=(0.54, 0.38, 0.20)),
        ]
    )

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
            "boxanimatetime": 200,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": DEVICE_W,
            "description": "Reciprocal envelope follower & audio-rate dynamics processor",
            "digest": "Multiplies audio by 1/env^amount with normal/reverse gating and Soft/Hard/Limiter ceiling",
            "tags": "dynamics compressor sustainer waveshaper distortion",
            "style": "",
            "subpatcher_template": "",
            "assistshowspatchername": 0,
            "boxes": boxes,
            "lines": lines,
            "parameters": {},
            "dependency_cache": [],
            "autosave": 0,
        }
    }

    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import theme_common as tc
    tc.inject_theme_support(patcher, "reciprocator")

    minify_patcher(patcher)
    payload = (json.dumps(patcher, indent="\t") + "\n").encode("utf-8")
    header = (
        b"ampf"
        + struct.pack("<I", 4)
        + b"aaaa"
        + b"meta"
        + struct.pack("<I", 4)
        + struct.pack("<I", 0)
        + b"ptch"
        + struct.pack("<I", len(payload))
    )
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)
    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + payload)
    print(f"Built {OUT_AMXD_PATH} [448x169 px] ({len(header) + len(payload)} bytes)")


if __name__ == "__main__":
    build()
