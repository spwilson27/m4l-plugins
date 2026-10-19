#!/usr/bin/env python3
"""
Build devices/Percipitator.amxd (380 x 169 px — Concept 3 Horizontal Value-Bar Stack).

16-band scale-quantized wavetable resynthesizer inspired by Woulg's WR-Percipitator:
  - Left Panel (x=6..218, w=212):
    - Title `Percipitator`
    - Full-width Partials Viewer + 12-Note Scale/MIDI Selector (`v8ui`, 204 x 134):
      - Adjustable `G -42dB` Gate pill & draggable Gate threshold line directly inside the Partials Viewer
      - Top-right single-cycle Wave Pill showing the live morphed/warped `Sine -> Triangle -> Saw -> Square` wave
      - Bottom 12-note scale selector strip (also highlights incoming Sidechain MIDI notes in emerald)
  - Right Panel (x=222..374, w=152) — Two Clean Columns of Horizontal Value Bars (Zero Rotary Knobs):
    - Column 1 (`PITCH / ENV`): `Pitch` (-24..+24 st), `Shift` (-2000..+2000 Hz), `Strch` (50..200%),
      `Snap` (0..100%), `Blur` (0..100%), `Decay` (1..1500 ms), `Atk` (0.2..100 ms)
    - Column 2 (`WAVE / TONE`): `Wave` (0..100%, default 0% Sine), `Mode` (Bend/Asym/Sync/Fold scroll),
      `Warp` (0..100%, default 50%), `Sieve` (All/Odd/Even/Sprs/Rise scroll), `Tilt` (-100..+100%),
      `Vol` (-36..+18 dB horizontal slider), `Mix` (0..100% horizontal slider)
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "percipitator_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "percipitator_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "percipitator_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Percipitator.amxd")

DEVICE_W = 408.0
DEVICE_H = 169.0

# Continuous parameter specs:
# key: (long_name, short_name, lo, hi, initial, unitstyle, exponent, gen_param, scale_factor, help_text)
# unitstyle: 0=int, 1=float, 2=time(ms), 3=freq(Hz), 4=dB, 5=percent, 7=semitones
PARAM_SPECS = {
    "pitch": (
        "Pitch", "Pitch", -24.0, 24.0, 0.0, 7, 1.0, "pitch", 1.0,
        "Transposes all resynthesized partials in semitones (-24 to +24 st).",
    ),
    "fshift": (
        "Shift", "Shift", -2000.0, 2000.0, 0.0, 3, 1.0, "fshift", 1.0,
        "Linear frequency shift in Hz (-2000 to +2000 Hz) added to every resynthesized partial.",
    ),
    "stretch": (
        "Stretch", "Stretch", 50.0, 200.0, 100.0, 5, 1.0, "stretch", 0.01,
        "Inharmonic spectral stretch around the center band (50% compressed to 200% stretched bell/metallic).",
    ),
    "snap": (
        "Snap", "Snap", 0.0, 100.0, 100.0, 5, 1.0, "snap", 0.01,
        "How strongly resynthesized partials lock onto the active 12-note scale strip or incoming MIDI chord.",
    ),
    "blur": (
        "Blur", "Blur", 0.0, 100.0, 25.0, 5, 1.0, "blur", 0.01,
        "Smears partial envelopes in time for liquid spectral clouds.",
    ),
    "decay": (
        "Decay", "Decay", 1.0, 1500.0, 120.0, 2, 2.5, "decay", 1.0,
        "Release time of precipitated spectral droplets (1 ms tight plucks to 1500 ms ambient tail).",
    ),
    "attack": (
        "Attack", "Attack", 0.2, 100.0, 2.5, 2, 2.0, "attack", 1.0,
        "Envelope attack time per spectral band.",
    ),
    "wtpos": (
        "WT Pos", "Wave", 0.0, 100.0, 0.0, 5, 1.0, "wtpos", 0.01,
        "Morphs smoothly across the 4 wavetable shapes: Sine (0%) -> Triangle -> Saw -> Square (100%).",
    ),
    "warp": (
        "Warp", "Warp", 0.0, 100.0, 50.0, 5, 1.0, "warp", 0.01,
        "Depth of the selected wavetable phase modifier (Bend, Asym, Sync, Fold).",
    ),
    "tilt": (
        "Tilt", "Tilt", -100.0, 100.0, 0.0, 5, 1.0, "tilt", 0.01,
        "Spectral tilt across the 16 resynthesized partials (-100% dark/warm to +100% bright/crystalline).",
    ),
    "resynthgain": (
        "Partials Vol", "Vol", -36.0, 18.0, 0.0, 4, 1.0, "resynthgain", 1.0,
        "Output level of the resynthesized partials in dB (-36 to +18 dB).",
    ),
    "mix": (
        "Mix", "Mix", 0.0, 100.0, 100.0, 5, 1.0, "wet", 0.01,
        "Equal-power dry/wet mix.",
    ),
}


def valueof_dict(key):
    long_name, short, lo, hi, initial, unit, exponent, _gen, _scale, _help = PARAM_SPECS[key]
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


def make_numbox(key, x, y, w=48.0, h=15.0, color_rgb=(0.45, 0.86, 0.96), appearance=2):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _sc, help_text = PARAM_SPECS[key]
    bg = [0.06, 0.075, 0.095, 1.0]
    # Blend slider fill color with the dark background (38% color + 62% dark bg) so the value text
    # in Ableton Live is always crisp and legible over the fill bar (matching the semi-transparent preview).
    bar_rgb = [
        round(bg[0] * 0.62 + color_rgb[0] * 0.38, 4),
        round(bg[1] * 0.62 + color_rgb[1] * 0.38, 4),
        round(bg[2] * 0.62 + color_rgb[2] * 0.38, 4),
        0.42,
    ]
    return {
        "box": {
            "activebgcolor": bg,
            "activeslidercolor": bar_rgb,
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": int(appearance),
            "bordercolor": [0.22, 0.27, 0.33, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 275.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "textcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "varname": long_name,
        }
    }


def make_enum_numbox(obj_id, long_name, short_name, enums, initial_idx, x, y, w, h, color_rgb, help_text):
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": 0,
            "bordercolor": [0.26, 0.32, 0.40, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "id": obj_id,
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 185.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": long_name,
                    "parameter_enum": enums,
                    "parameter_initial": [initial_idx],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": long_name,
                    "parameter_mmax": len(enums) - 1,
                    "parameter_mmin": 0,
                    "parameter_shortname": short_name,
                    "parameter_type": 2,
                    "parameter_unitstyle": 9,
                }
            },
            "textcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "varname": long_name,
        }
    }


def make_label(obj_id, text, x, y, w, h=13.0, size=8.0, color=(0.58, 0.66, 0.74), bold=True, align=0):
    return {
        "box": {
            "fontface": 1 if bold else 0,
            "fontname": "Arial Bold" if bold else "Arial",
            "fontsize": float(size),
            "id": obj_id,
            "maxclass": "live.comment",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 15.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "textcolor": [color[0], color[1], color[2], 1.0],
            "textjustification": align,
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


def build():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    v8_code = config_js.rstrip() + "\n\n" + ui_js

    viz_rect = [10.0, 26.0, 204.0, 134.0]
    cyan = (0.28, 0.84, 0.96)
    amber = (0.96, 0.66, 0.25)
    emerald = (0.28, 0.88, 0.68)

    ui_boxes = [
        make_label("obj-title", "Percipitator", 10, 7, 110, 15, size=11.0, color=(0.92, 0.96, 1.0)),

        # Column 1 (x=230..308): PITCH / ENV horizontal value bars
        # Pitch & Shift use appearance=3 (Bipolar center-out fill)
        make_label("obj-hdr-c1", "PITCH / ENV", 230, 8, 76, 12, size=7.5, color=cyan),
        make_label("obj-lbl-pitch", "Pitch", 230, 24, 30, 13, color=cyan),
        make_numbox("pitch", 260, 23, 48, 15, color_rgb=cyan, appearance=3),
        make_label("obj-lbl-shift", "Shift", 230, 44, 30, 13, color=cyan),
        make_numbox("fshift", 260, 43, 48, 15, color_rgb=cyan, appearance=3),
        make_label("obj-lbl-str", "Strch", 230, 64, 30, 13, color=cyan),
        make_numbox("stretch", 260, 63, 48, 15, color_rgb=cyan, appearance=2),
        make_label("obj-lbl-snap", "Snap", 230, 84, 30, 13, color=cyan),
        make_numbox("snap", 260, 83, 48, 15, color_rgb=cyan, appearance=2),
        make_label("obj-lbl-blur", "Blur", 230, 104, 30, 13, color=cyan),
        make_numbox("blur", 260, 103, 48, 15, color_rgb=cyan, appearance=2),
        make_label("obj-lbl-dec", "Decay", 230, 124, 30, 13, color=cyan),
        make_numbox("decay", 260, 123, 48, 15, color_rgb=cyan, appearance=2),
        make_label("obj-lbl-atk", "Atk", 230, 144, 30, 13, color=cyan),
        make_numbox("attack", 260, 143, 48, 15, color_rgb=cyan, appearance=2),

        # Column 2 (x=314..392): WAVE / TONE horizontal value bars
        # Warp & Tilt use appearance=3 (Bipolar center-out fill)
        make_label("obj-hdr-c2", "WAVE / TONE", 314, 8, 76, 12, size=7.5, color=amber),
        make_label("obj-lbl-wtpos", "Wave", 314, 24, 30, 13, color=amber),
        make_numbox("wtpos", 344, 23, 48, 15, color_rgb=amber, appearance=2),
        make_label("obj-lbl-wtmode", "Mode", 314, 44, 30, 13, color=amber),
        make_enum_numbox(
            "obj-wt-mode", "WT Mode", "WTMode",
            ["Bend", "Asym", "Sync", "Fold"], 0,
            344, 43, 48, 15, amber,
            "Scroll to select the wavetable phase warp mode: Bend, Asym, Sync, or Fold.",
        ),
        make_label("obj-lbl-warp", "Warp", 314, 64, 30, 13, color=amber),
        make_numbox("warp", 344, 63, 48, 15, color_rgb=amber, appearance=3),
        make_label("obj-lbl-sieve", "Sieve", 314, 84, 30, 13, color=emerald),
        make_enum_numbox(
            "obj-sieve", "Partial Sieve", "Sieve",
            ["All", "Odd", "Even", "Sprs", "Rise"], 0,
            344, 83, 48, 15, emerald,
            "Scroll to filter active partial bands: All, Odd, Even, Sparse, or Rising.",
        ),
        make_label("obj-lbl-tilt", "Tilt", 314, 104, 30, 13, color=emerald),
        make_numbox("tilt", 344, 103, 48, 15, color_rgb=emerald, appearance=3),
        make_label("obj-lbl-vol", "Vol", 314, 124, 30, 13, color=amber),
        make_numbox("resynthgain", 344, 123, 48, 15, color_rgb=amber, appearance=2),
        make_label("obj-lbl-mix", "Mix", 314, 144, 30, 13, color=amber),
        make_numbox("mix", 344, 143, 48, 15, color_rgb=amber, appearance=2),
    ]

    panels = [
        make_panel("obj-panel-left", 6, 5, 212, 159),
        make_panel("obj-panel-right", 222, 5, 180, 159),
    ]

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
                    "parameter_enable": 1,
                    "patching_rect": [20.0, 80.0, viz_rect[2], viz_rect[3]],
                    "presentation": 1,
                    "presentation_rect": [float(v) for v in viz_rect],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_invisible": 1,
                            "parameter_longname": "ScaleMaskData",
                            "parameter_shortname": "ScaleMask",
                            "parameter_type": 3,
                        }
                    },
                    "textfile": {
                        "text": v8_code,
                        "filename": "none",
                        "flags": 0,
                        "embed": 1,
                        "autowatch": 1,
                    },
                    "varname": "ScaleMaskData",
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
                    "varname": "percipitator",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-wt-buf",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["float", "bang"],
                    "patching_rect": [560.0, 220.0, 230.0, 20.0],
                    "text": "buffer~ #0-percipwt @samps 8192",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-scope-buf",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["float", "bang"],
                    "patching_rect": [560.0, 250.0, 220.0, 20.0],
                    "text": "buffer~ #0-percipscope @samps 64",
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
                    "patching_rect": [560.0, 315.0, 60.0, 20.0],
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
                    "patching_rect": [560.0, 345.0, 240.0, 20.0],
                    "text": "setbuffer #0-percipwt #0-percipscope",
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
                    "patching_rect": [560.0, 375.0, 250.0, 20.0],
                    "text": "wt #0-percipwt, scope #0-percipscope",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-prep-wtmode",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [560.0, 410.0, 105.0, 20.0],
                    "text": "prepend wtmode",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-ui-wtmode",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [675.0, 410.0, 115.0, 20.0],
                    "text": "prepend set_wtmode",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-prep-sieve",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [560.0, 440.0, 105.0, 20.0],
                    "text": "prepend sieve",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-ui-sieve",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [675.0, 440.0, 115.0, 20.0],
                    "text": "prepend set_sieve",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-ui-wtpos",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [560.0, 530.0, 110.0, 20.0],
                    "text": "prepend set_wtpos",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-ui-warp",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [560.0, 560.0, 110.0, 20.0],
                    "text": "prepend set_warp",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-ui-tilt",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [560.0, 590.0, 110.0, 20.0],
                    "text": "prepend set_tilt",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-route-viz",
                    "maxclass": "newobj",
                    "numinlets": 5,
                    "numoutlets": 5,
                    "outlettype": ["", "", "", "", ""],
                    "patching_rect": [20.0, 215.0, 190.0, 20.0],
                    "text": "route scalemask gate wtpos warp",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-prep-scalemask",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [215.0, 215.0, 115.0, 20.0],
                    "text": "prepend scalemask",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-prep-gate",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [335.0, 215.0, 90.0, 20.0],
                    "text": "prepend gate",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-set-wtpos",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [435.0, 215.0, 75.0, 20.0],
                    "text": "prepend set",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-set-warp",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [515.0, 215.0, 75.0, 20.0],
                    "text": "prepend set",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-midiin",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": ["int"],
                    "patching_rect": [20.0, 500.0, 48.0, 20.0],
                    "text": "midiin",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-midiparse",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 7,
                    "outlettype": ["", "", "", "int", "int", "", "int"],
                    "patching_rect": [20.0, 528.0, 82.0, 20.0],
                    "text": "midiparse",
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-prep-midi",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [20.0, 556.0, 105.0, 20.0],
                    "text": "prepend midi_in",
                }
            },
        ]
    )

    lines = [
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}},
        {"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}},
        {"patchline": {"source": ["obj-midiin", 0], "destination": ["obj-midiparse", 0]}},
        {"patchline": {"source": ["obj-midiparse", 0], "destination": ["obj-prep-midi", 0]}},
        {"patchline": {"source": ["obj-prep-midi", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-ui-buf", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-gen-buf", 0]}},
        {"patchline": {"source": ["obj-msg-ui-buf", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-msg-gen-buf", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-wt-mode", 0], "destination": ["obj-prep-wtmode", 0]}},
        {"patchline": {"source": ["obj-prep-wtmode", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-wt-mode", 0], "destination": ["obj-ui-wtmode", 0]}},
        {"patchline": {"source": ["obj-ui-wtmode", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-sieve", 0], "destination": ["obj-prep-sieve", 0]}},
        {"patchline": {"source": ["obj-prep-sieve", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-sieve", 0], "destination": ["obj-ui-sieve", 0]}},
        {"patchline": {"source": ["obj-ui-sieve", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-ctrl-wtpos", 0], "destination": ["obj-ui-wtpos", 0]}},
        {"patchline": {"source": ["obj-ui-wtpos", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-ctrl-warp", 0], "destination": ["obj-ui-warp", 0]}},
        {"patchline": {"source": ["obj-ui-warp", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-ctrl-tilt", 0], "destination": ["obj-ui-tilt", 0]}},
        {"patchline": {"source": ["obj-ui-tilt", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-viz", 0], "destination": ["obj-route-viz", 0]}},
        {"patchline": {"source": ["obj-route-viz", 0], "destination": ["obj-prep-scalemask", 0]}},
        {"patchline": {"source": ["obj-prep-scalemask", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-route-viz", 1], "destination": ["obj-prep-gate", 0]}},
        {"patchline": {"source": ["obj-prep-gate", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-route-viz", 2], "destination": ["obj-scale-wtpos", 0]}},
        {"patchline": {"source": ["obj-route-viz", 2], "destination": ["obj-set-wtpos", 0]}},
        {"patchline": {"source": ["obj-set-wtpos", 0], "destination": ["obj-ctrl-wtpos", 0]}},
        {"patchline": {"source": ["obj-route-viz", 3], "destination": ["obj-scale-warp", 0]}},
        {"patchline": {"source": ["obj-route-viz", 3], "destination": ["obj-set-warp", 0]}},
        {"patchline": {"source": ["obj-set-warp", 0], "destination": ["obj-ctrl-warp", 0]}},
    ]

    for i, (key, spec) in enumerate(PARAM_SPECS.items()):
        _long, _short, _lo, _hi, _init, _unit, _exp, gen_param, scale_factor, _help = spec
        ctrl_id = f"obj-ctrl-{key}"
        prep_id = f"obj-prep-{key}"
        row_y = 500.0 + i * 26.0
        if scale_factor != 1.0:
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
                        "patching_rect": [360.0, row_y, 56.0, 20.0],
                        "text": "* 0.01",
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
                    "patching_rect": [424.0, row_y, 120.0, 20.0],
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
            "description": "16-band scale-quantized wavetable resynthesizer",
            "digest": "Sine->Tri->Saw->Square wavetable resynthesis with Sieve, Tilt, Shift & Sidechain MIDI",
            "tags": "spectral resynthesis wavetable vocoder woulg",
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
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)
    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + payload)

    # Remove temporary concept comparison files
    for old_name in (
        "Percipitator 1 - Direct Stage.amxd",
        "Percipitator 2 - Tabbed Deck.amxd",
        "Percipitator 3 - Value Bars.amxd",
    ):
        old_p = os.path.join(os.path.dirname(OUT_AMXD_PATH), old_name)
        if os.path.exists(old_p):
            os.remove(old_p)

    print(f"Built {OUT_AMXD_PATH} [{int(DEVICE_W)}x169 px] ({len(header) + len(payload)} bytes)")


if __name__ == "__main__":
    build()
