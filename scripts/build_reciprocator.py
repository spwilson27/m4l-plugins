#!/usr/bin/env python3
"""
Build devices/Reciprocator.amxd (plus 3 compact layout variants for comparison).

Supports 3 distinct compact layouts (all 169 px tall, down from 700 px to 372..448 px wide):
  1. "interactive" (416 x 169, default) — Interactive Scope + LCD Strip + 4 Hero Dials (Live 12 Shaper-inspired)
  2. "flow"        (448 x 169)          — 3-Stage Signal-Flow Cards: [1. DETECT] -> [2. 1/ENV] -> [3. OUTPUT]
  3. "pedal"       (372 x 169)          — Ultra-Compact 372px Pedal: Tight Scope + 2x2 Dials + 6-Cell Micro Matrix

Usage:
  python3 scripts/build_reciprocator.py              # builds default ("interactive") + all 3 variant .amxd files
  python3 scripts/build_reciprocator.py interactive  # sets devices/Reciprocator.amxd to Layout A (416 px)
  python3 scripts/build_reciprocator.py flow         # sets devices/Reciprocator.amxd to Layout B (448 px)
  python3 scripts/build_reciprocator.py pedal        # sets devices/Reciprocator.amxd to Layout C (372 px)
"""

import json
import os
import struct
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "reciprocator_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "reciprocator_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "reciprocator_core.genexpr")

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
        "Noise floor threshold in dB. Signals below Gate smoothly mute instead of blowing up.",
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


def make_numbox(key, x, y, w=46.0, h=15.0, color_rgb=(0.45, 0.86, 0.96), borderless=False):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _pct, help_text = PARAM_SPECS[key]
    bg = [0.06, 0.075, 0.095, 0.0 if borderless else 1.0]
    return {
        "box": {
            "activebgcolor": bg,
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": 4 if borderless else 0,
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


def make_softclip_button(x, y, w=56.0, h=15.0):
    return {
        "box": {
            "activebgcolor": [0.10, 0.12, 0.15, 1.0],
            "activebgoncolor": [0.28, 0.82, 0.95, 1.0],
            "activetextcolor": [0.78, 0.82, 0.88, 1.0],
            "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
            "annotation": "When enabled, softly saturates reciprocal peaks into the Ceiling using tanh instead of hard clipping.",
            "annotation_name": "Soft Clip",
            "bordercolor": [0.28, 0.82, 0.95, 1.0],
            "id": "obj-softclip",
            "maxclass": "live.text",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [270.0, 18.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": "Soft Clip",
                    "parameter_enum": ["Hard", "Soft"],
                    "parameter_initial": [1],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": "Soft Clip",
                    "parameter_mmax": 1,
                    "parameter_shortname": "SoftClip",
                    "parameter_type": 2,
                }
            },
            "text": "Hard Clip",
            "texton": "Soft Clip",
            "varname": "Soft Clip",
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


def layout_interactive():
    """
    Variant A: Interactive Scope-First + LCD Strip + 4 Hero Dials (416 x 169 px)
    Inspired by Ableton Live 12's native Shaper:
      - Left Panel (x=6..202): Title + Soft Clip button on top; interactive scope (188x132)
        where you can also drag Gate & Ceiling bars directly.
      - Right Panel (x=208..410):
        - Top dark LCD box (y=10..78) with 6 compact numboxes in a 2-column matrix:
          Gate, Ceiling, SC HP, SC LP, Lookahead, Detect.
        - Bottom 4 Hero Dials (y=98..148): Amount, Attack, Release, Mix.
    """
    dev_w = 416.0
    viz_rect = [10.0, 28.0, 188.0, 132.0]
    cyan = (0.28, 0.84, 0.96)
    amber = (0.96, 0.66, 0.25)
    coral = (0.96, 0.48, 0.48)

    ui_boxes = [
        make_label("obj-title", "Reciprocator", 10, 7, 92, 16, size=11.5, color=(0.92, 0.95, 0.98)),
        make_softclip_button(142, 7, 56, 15),
        # LCD Row 1: Gate & Ceiling (synced with draggable scope bars)
        make_label("obj-lbl-gate", "Gate", 214, 15, 36, 13, size=8.5, color=coral),
        make_numbox("gate", 250, 14, 52, 15, color_rgb=coral),
        make_label("obj-lbl-ceil", "Ceil", 310, 15, 32, 13, size=8.5, color=amber),
        make_numbox("ceiling", 344, 14, 54, 15, color_rgb=amber),
        # LCD Row 2: Sidechain HP & LP
        make_label("obj-lbl-hp", "SC HP", 214, 36, 36, 13, size=8.5, color=cyan),
        make_numbox("schp", 250, 35, 52, 15, color_rgb=cyan),
        make_label("obj-lbl-lp", "SC LP", 310, 36, 34, 13, size=8.5, color=cyan),
        make_numbox("sclp", 344, 35, 54, 15, color_rgb=cyan),
        # LCD Row 3: Lookahead & Detect (Peak/RMS)
        make_label("obj-lbl-look", "Look", 214, 57, 36, 13, size=8.5, color=amber),
        make_numbox("lookahead", 250, 56, 52, 15, color_rgb=amber),
        make_label("obj-lbl-det", "RMS", 310, 57, 32, 13, size=8.5, color=amber),
        make_numbox("detect", 344, 56, 54, 15, color_rgb=amber),
        # Bottom 4 Hero Dials
        make_dial("amount", 210, 102, 48, 48, color_rgb=cyan),
        make_dial("attack", 260, 102, 48, 48, color_rgb=cyan),
        make_dial("release", 310, 102, 48, 48, color_rgb=cyan),
        make_dial("mix", 360, 102, 48, 48, color_rgb=amber),
    ]
    panels = [
        make_panel("obj-panel-lcd", 212, 10, 192, 68, bg=(0.055, 0.068, 0.085), border=(0.18, 0.24, 0.30), rounded=4),
        make_panel("obj-panel-left", 6, 5, 196, 159),
        make_panel("obj-panel-right", 206, 5, 204, 159),
    ]
    return dev_w, viz_rect, ui_boxes, panels


def layout_flow():
    """
    Variant B: 3-Stage Signal-Flow Modules (448 x 169 px)
    Organizes controls left-to-right following the signal path with color-coded module headers:
      - Stage 0: Scope (x=6..176, 162x132 canvas)
      - Stage 1 [DETECT] (x=180..272, Cyan border): Attack & Release dials + HP, LP, Detect numboxes
      - Stage 2 [1 / ENV] (x=276..356, Coral/Cyan border): Big Amount hero dial + Gate dial + Lookahead numbox
      - Stage 3 [OUTPUT] (x=360..442, Amber border): Ceiling & Mix dials + Soft Clip toggle
    """
    dev_w = 448.0
    viz_rect = [10.0, 28.0, 162.0, 132.0]
    cyan = (0.28, 0.84, 0.96)
    amber = (0.96, 0.66, 0.25)
    coral = (0.96, 0.48, 0.48)

    ui_boxes = [
        make_label("obj-title", "Reciprocator", 10, 7, 110, 16, size=11.5, color=(0.92, 0.95, 0.98)),
        # Stage 1: DETECT
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
        # Stage 2: 1 / ENV RECIPROCATE
        make_label("obj-hdr-rec", "2. 1 / ENV", 280, 8, 72, 13, size=8.5, color=coral, align=1),
        make_dial("amount", 290, 26, 52, 50, color_rgb=cyan),
        make_dial("gate", 290, 96, 52, 50, color_rgb=coral),
        # Stage 3: OUTPUT
        make_label("obj-hdr-out", "3. OUTPUT", 364, 8, 74, 13, size=8.5, color=amber, align=1),
        make_dial("ceiling", 376, 26, 50, 48, color_rgb=amber),
        make_softclip_button(372, 82, 58, 16),
        make_dial("mix", 376, 106, 50, 48, color_rgb=amber),
    ]
    panels = [
        make_panel("obj-panel-left", 6, 5, 170, 159),
        make_panel("obj-panel-det", 180, 5, 92, 159, bg=(0.09, 0.11, 0.13), border=(0.20, 0.44, 0.54)),
        make_panel("obj-panel-rec", 276, 5, 80, 159, bg=(0.10, 0.10, 0.13), border=(0.52, 0.28, 0.34)),
        make_panel("obj-panel-out", 360, 5, 82, 159, bg=(0.11, 0.10, 0.12), border=(0.54, 0.38, 0.20)),
    ]
    return dev_w, viz_rect, ui_boxes, panels


def layout_pedal():
    """
    Variant C: Ultra-Compact Pedal (372 x 169 px — nearly half the original 700 px width!)
      - Left Pane (x=6..170): Title + Soft Clip pill + 156x132 interactive scope
      - Center 2x2 Dial Cluster (x=174..272): Amount, Gate, Attack, Release
      - Right Micro Strip (x=276..366): Ceiling, Mix, Lookahead, Detect, SC HP, SC LP
    """
    dev_w = 372.0
    viz_rect = [10.0, 28.0, 156.0, 132.0]
    cyan = (0.28, 0.84, 0.96)
    amber = (0.96, 0.66, 0.25)
    coral = (0.96, 0.48, 0.48)

    ui_boxes = [
        make_label("obj-title", "Reciprocator", 10, 7, 92, 16, size=11.0, color=(0.92, 0.95, 0.98)),
        make_softclip_button(114, 7, 52, 15),
        # 2x2 Primary Dials
        make_dial("amount", 176, 20, 46, 48, color_rgb=cyan),
        make_dial("gate", 224, 20, 46, 48, color_rgb=coral),
        make_dial("attack", 176, 98, 46, 48, color_rgb=cyan),
        make_dial("release", 224, 98, 46, 48, color_rgb=cyan),
        # Right 6-row micro parameter ladder
        make_label("obj-lbl-ceil", "Ceil", 276, 16, 32, 13, size=8.0, color=amber),
        make_numbox("ceiling", 310, 15, 50, 15, color_rgb=amber),
        make_label("obj-lbl-mix", "Mix", 276, 40, 32, 13, size=8.0, color=amber),
        make_numbox("mix", 310, 39, 50, 15, color_rgb=amber),
        make_label("obj-lbl-look", "Look", 276, 64, 32, 13, size=8.0, color=amber),
        make_numbox("lookahead", 310, 63, 50, 15, color_rgb=amber),
        make_label("obj-lbl-det", "RMS", 276, 88, 32, 13, size=8.0, color=cyan),
        make_numbox("detect", 310, 87, 50, 15, color_rgb=cyan),
        make_label("obj-lbl-hp", "HP", 276, 112, 32, 13, size=8.0, color=cyan),
        make_numbox("schp", 310, 111, 50, 15, color_rgb=cyan),
        make_label("obj-lbl-lp", "LP", 276, 136, 32, 13, size=8.0, color=cyan),
        make_numbox("sclp", 310, 135, 50, 15, color_rgb=cyan),
    ]
    panels = [
        make_panel("obj-panel-strip", 274, 10, 90, 149, bg=(0.055, 0.068, 0.085), border=(0.18, 0.24, 0.30), rounded=4),
        make_panel("obj-panel-left", 6, 5, 164, 159),
        make_panel("obj-panel-right", 174, 5, 192, 159),
    ]
    return dev_w, viz_rect, ui_boxes, panels


LAYOUT_BUILDERS = {
    "interactive": layout_interactive,
    "flow": layout_flow,
    "pedal": layout_pedal,
}


def build_variant(variant_name, out_amxd_path):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    v8_code = config_js.rstrip() + "\n\n" + ui_js

    dev_w, viz_rect, ui_boxes, panels = LAYOUT_BUILDERS[variant_name]()

    boxes = list(ui_boxes)
    boxes.extend(
        [
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
                    "varname": "reciprocator",
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
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-prep-softclip",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [270.0, 44.0, 105.0, 20.0],
                    "text": "prepend softclip",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-ui-softclip",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [380.0, 44.0, 120.0, 20.0],
                    "text": "prepend set_softclip",
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
    )

    lines = [
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}},
        {"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-ui-buf", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-gen-buf", 0]}},
        {"patchline": {"source": ["obj-msg-ui-buf", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-msg-gen-buf", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-softclip", 0], "destination": ["obj-prep-softclip", 0]}},
        {"patchline": {"source": ["obj-prep-softclip", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-softclip", 0], "destination": ["obj-ui-softclip", 0]}},
        {"patchline": {"source": ["obj-ui-softclip", 0], "destination": ["obj-viz", 0]}},
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
        lines.append({"patchline": {"source": [prep_id, 0], "destination": ["obj-gen", 0]}})

    # Background panels MUST be last in boxes and have "background": 1
    boxes.extend(panels)

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
            "rect": [100.0, 100.0, dev_w, DEVICE_H],
            "openrect": [0.0, 0.0, dev_w, DEVICE_H],
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
            "devicewidth": dev_w,
            "description": f"Reciprocal envelope follower & audio-rate dynamics processor ({variant_name} layout)",
            "digest": "Multiplies audio by 1/env^amount with smooth gating and lookahead",
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
    os.makedirs(os.path.dirname(out_amxd_path), exist_ok=True)
    with open(out_amxd_path, "wb") as f:
        f.write(header + payload)
    print(f"Built {out_amxd_path} [{variant_name}, {int(dev_w)}x169 px] ({len(header) + len(payload)} bytes)")


def main():
    chosen = sys.argv[1] if len(sys.argv) > 1 else "flow"
    if chosen not in LAYOUT_BUILDERS:
        raise SystemExit(f"Unknown layout {chosen!r}. Choose from: {', '.join(LAYOUT_BUILDERS)}")

    devices_dir = os.path.join(ROOT_DIR, "devices")
    build_variant(chosen, os.path.join(devices_dir, "Reciprocator.amxd"))


if __name__ == "__main__":
    main()
