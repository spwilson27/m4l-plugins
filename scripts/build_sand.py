#!/usr/bin/env python3
"""
Build devices/Sand.amxd

Compact Single-Column Edition (296 x 169 px):
  - Left Panel (x=6..206):
    - Top header (y=7..22): "SAND" title + Ord (-1..15) and Stg (1..4) numboxes.
    - Graphic HUD Control Strip (y=26..42): Automatable Amount value box (0..140 dB),
      Freq value box (20 Hz..18 kHz), and Out selection box/slider (Off / Hard / Limit).
    - Audio-Reactive XY Scope (x=10, y=46, w=192, h=114): Live stereo grit trace,
      dry ghost silhouette, audio-reactive sand particles, transfer curve inset,
      and dual G/O meters.
  - Right Panel — Single Visual Column (x=210..290):
    - Filt (LP / BP / HP) and Place (Pre / Diff / Post) selector rows at top.
    - Soft (%) and Debrick (%) horizontal value bars in the middle.
    - Mix (%) radial dial at the bottom.
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI_PATH = os.path.join(ROOT_DIR, "src", "sand_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "sand_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Sand.amxd")

DEVICE_W = 296.0
DEVICE_H = 169.0

# Color palette (Obsidian dark chassis + Electric Cyan, Warm Amber, Coral accents)
CYAN = (0.28, 0.84, 0.96)
AMBER = (0.98, 0.70, 0.26)
CORAL = (0.96, 0.48, 0.44)
SLATE = (0.76, 0.82, 0.90)

# Sole radial dial on the right single column:
# name: (long_name, short_name, lo, hi, initial, unitstyle, exponent, gen_param, help_text)
DIAL_SPECS = {
    "mix": (
        "Mix", "Mix", 0.0, 100.0, 50.0, 5, 1.0, "mix",
        "Equal-power dry/wet crossfade.",
    ),
}


def make_dial(name, x, y, w=54.0, h=45.0, color=AMBER):
    long_name, short, lo, hi, initial, unit, exponent, _gen, help_txt = DIAL_SPECS[name]
    valueof = {
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
        valueof["parameter_exponent"] = exponent
    return {
        "box": {
            "activedialcolor": [color[0], color[1], color[2], 1.0],
            "annotation": help_txt,
            "annotation_name": long_name,
            "id": f"obj-dial-{name}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 260.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof},
            "textcolor": [0.88, 0.91, 0.96, 1.0],
            "varname": long_name,
        }
    }


def make_value_bar(obj_id, varname, short, x, y, w, h, lo, hi, initial, unit, annotation, color=AMBER):
    """Horizontal percentage value bar using live.numbox with appearance=2 (Slider display)."""
    return {
        "box": {
            "activebgcolor": [0.052, 0.064, 0.082, 1.0],
            "activeslidercolor": [color[0], color[1], color[2], 1.0],
            "annotation": annotation,
            "annotation_name": varname,
            "appearance": 2,
            "bordercolor": [0.22, 0.28, 0.36, 1.0],
            "id": obj_id,
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 220.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": varname,
                    "parameter_initial": [initial],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": varname,
                    "parameter_mmax": hi,
                    "parameter_mmin": lo,
                    "parameter_shortname": short,
                    "parameter_type": 0,
                    "parameter_unitstyle": unit,
                }
            },
            "textcolor": [0.94, 0.96, 0.98, 1.0],
            "varname": varname,
        }
    }


def make_float_numbox(obj_id, varname, short, x, y, w, h, lo, hi, initial, unit, exponent, annotation, color=AMBER):
    valueof = {
        "parameter_annotation_name": varname,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": varname,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": 0,
        "parameter_unitstyle": unit,
    }
    if exponent != 1.0:
        valueof["parameter_exponent"] = exponent
    return {
        "box": {
            "activebgcolor": [0.052, 0.064, 0.082, 1.0],
            "annotation": annotation,
            "annotation_name": varname,
            "bordercolor": [0.22, 0.28, 0.36, 1.0],
            "id": obj_id,
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 180.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof},
            "textcolor": [color[0], color[1], color[2], 1.0],
            "varname": varname,
        }
    }


def make_enum_numbox(obj_id, varname, short, enum, initial, x, y, w, h, annotation, color=CORAL):
    return {
        "box": {
            "activebgcolor": [0.052, 0.064, 0.082, 1.0],
            "activetricolor2": [color[0], color[1], color[2], 1.0],
            "annotation": annotation,
            "annotation_name": varname,
            "appearance": 1,
            "bordercolor": [0.36, 0.24, 0.26, 1.0],
            "id": obj_id,
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 180.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": varname,
                    "parameter_enum": enum,
                    "parameter_initial": [initial],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": varname,
                    "parameter_mmax": len(enum) - 1,
                    "parameter_shortname": short,
                    "parameter_type": 2,
                    "parameter_unitstyle": 9,
                }
            },
            "textcolor": [color[0], color[1], color[2], 1.0],
            "varname": varname,
        }
    }


def make_tab(obj_id, varname, enum, initial, x, y, w, h, annotation, accent=CYAN, pictures=None):
    box = {
        "activebgcolor": [0.065, 0.078, 0.098, 1.0],
        "activebgoncolor": [accent[0], accent[1], accent[2], 1.0],
        "activetextcolor": [0.76, 0.82, 0.90, 1.0],
        "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
        "annotation": annotation,
        "annotation_name": varname,
        "bordercolor": [0.20, 0.25, 0.32, 1.0],
        "id": obj_id,
        "maxclass": "live.tab",
        "num_lines_patching": 1,
        "num_lines_presentation": 1,
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 200.0, float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {
            "valueof": {
                "parameter_annotation_name": varname,
                "parameter_enum": enum,
                "parameter_initial": [initial],
                "parameter_initial_enable": 1,
                "parameter_linknames": 1,
                "parameter_longname": varname,
                "parameter_mmax": len(enum) - 1,
                "parameter_shortname": varname,
                "parameter_type": 2,
                "parameter_unitstyle": 9,
            }
        },
        "spacing_x": 2.0,
        "varname": varname,
    }
    if pictures:
        box["pictures"] = pictures
        box["remapsvgcolors"] = 1
        box["usepicture"] = 1
        box["usesvgviewbox"] = 1
    return {"box": box}


def make_int(obj_id, varname, short, x, y, w, h, lo, hi, initial, annotation, color=AMBER):
    return {
        "box": {
            "activebgcolor": [0.06, 0.072, 0.092, 1.0],
            "annotation": annotation,
            "annotation_name": varname,
            "bordercolor": [0.22, 0.27, 0.35, 1.0],
            "id": obj_id,
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "int"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 40.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": varname,
                    "parameter_initial": [initial],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": varname,
                    "parameter_mmax": hi,
                    "parameter_mmin": lo,
                    "parameter_shortname": short,
                    "parameter_type": 1,
                    "parameter_unitstyle": 0,
                }
            },
            "textcolor": [color[0], color[1], color[2], 1.0],
            "varname": varname,
        }
    }


def make_label(obj_id, text, x, y, w, h=14.0, size=8.5, color=SLATE, align=0):
    return {
        "box": {
            "fontface": 1,
            "fontname": "Arial Bold",
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


def make_panel(obj_id, x, y, w, h, bg=(0.085, 0.098, 0.12), border=(0.22, 0.26, 0.33), rounded=6):
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


def newobj(obj_id, text, x, y, w):
    return {
        "box": {
            "fontname": "Arial Bold",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "newobj",
            "numinlets": 1,
            "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [float(x), float(y), float(w), 20.0],
            "text": text,
        }
    }


def build():
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    viz_rect = [10.0, 46.0, 192.0, 114.0]

    ui_boxes = [
        # Top Header Row inside Left Panel (y=7..22)
        make_label("obj-title", "SAND", 10, 7, 46, 16, size=11.0, color=(0.96, 0.92, 0.84)),
        make_label("obj-order-lbl", "Ord", 76, 8, 24, 13, size=8.0, color=AMBER),
        make_int("obj-order", "Order", "Order", 100, 7, 36, 15, -1, 15, 1,
                 "Derivative order (-1 integrates, 0 is raw signal, 1..15 stack differentiators).", color=AMBER),
        make_label("obj-stages-lbl", "Stg", 142, 8, 22, 13, size=8.0, color=AMBER),
        make_int("obj-stages", "Stages", "Stages", 166, 7, 36, 15, 1, 4, 1,
                 "Compander stages (1..4).", color=AMBER),

        # Graphic HUD Control Strip (y=26..42): Amount box + Freq box + Out selection box/slider
        make_float_numbox(
            "obj-amount", "Amount", "Amount", 12, 27, 60, 15,
            0.0, 140.0, 18.0, 4, 1.0,
            "Quiet-lift on the derivative (0 to 140 dB). Also draggable vertically in the scope.",
            color=AMBER,
        ),
        make_float_numbox(
            "obj-freq", "Freq", "Freq", 75, 27, 66, 15,
            20.0, 18000.0, 14000.0, 3, 2.0,
            "Filter cutoff frequency (20 Hz to 18 kHz). Also draggable horizontally in the scope.",
            color=CYAN,
        ),
        make_enum_numbox(
            "obj-out", "Out", "Out", ["Off", "Hard", "Limit"], 0,
            144, 27, 56, 15,
            "Final output safety stage: Off (bypass), Hard (clip +-1), Limit (fast limiter).",
            color=CORAL,
        ),

        # Right Single Visual Column (x=210..290)
        make_tab("obj-filt", "Filt", ["LP", "BP", "HP"], 0, 214, 10, 72, 15,
                 "Low-pass, band-pass, or high-pass filter.", accent=CYAN,
                 pictures=["highcut.svg", "bandpass.svg", "lowcut.svg"]),
        make_tab("obj-place", "Place", ["Pre", "Diff", "Post"], 2, 214, 28, 72, 15,
                 "Filter placement: before derivative (Pre), on derivative (Diff), or after compander (Post).", accent=CYAN),

        # Soft & Debrick horizontal value bars (0..100%)
        make_label("obj-soft-lbl", "Soft", 214, 46, 72, 12, size=8.0, color=AMBER),
        make_value_bar(
            "obj-soft", "Soft", "Soft", 214, 59, 72, 15,
            0.0, 100.0, 35.0, 5,
            "Higher is a rounder knee and smoother envelope. Lower is gritty.",
            color=AMBER,
        ),
        make_label("obj-debrick-lbl", "Debrick", 214, 78, 72, 12, size=8.0, color=CORAL),
        make_value_bar(
            "obj-debrick", "Debrick", "Debrick", 214, 91, 72, 15,
            0.0, 100.0, 0.0, 5,
            "Blends back toward a milder curve when the compander has flattened the sound.",
            color=CORAL,
        ),

        # Sole Mix radial dial at bottom of right column
        make_dial("mix", 223, 113, 54, 45, color=AMBER),
    ]

    panels = [
        make_panel("obj-panel-hud", 10, 25, 192, 19, bg=(0.045, 0.055, 0.072), border=(0.18, 0.23, 0.30), rounded=3),
        make_panel("obj-panel-viz", 6, 5, 200, 159, bg=(0.075, 0.086, 0.108), border=(0.24, 0.29, 0.37)),
        make_panel("obj-panel-dials", 210, 5, 80, 159, bg=(0.092, 0.098, 0.118), border=(0.26, 0.30, 0.38)),
    ]

    boxes = [
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
                    "text": ui_js,
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
                "patching_rect": [120.0, 320.0, 420.0, 120.0],
                "varname": "sand",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-wave",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [560.0, 240.0, 180.0, 20.0],
                "text": "buffer~ #0-sandwave 100 2",
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
                "patching_rect": [640.0, 180.0, 180.0, 20.0],
                "text": "wave #0-sandwave",
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
                "patching_rect": [640.0, 210.0, 180.0, 20.0],
                "text": "setbuffer #0-sandwave",
            }
        },
        newobj("obj-prep-order", "prepend dorder", 346.0, 80.0, 90.0),
        newobj("obj-prep-stages", "prepend stages", 450.0, 80.0, 90.0),
        newobj("obj-prep-filt", "prepend ftype", 308.0, 120.0, 80.0),
        newobj("obj-prep-place", "prepend fpos", 422.0, 120.0, 80.0),
        newobj("obj-prep-out", "prepend outmode", 648.0, 120.0, 100.0),
        newobj("obj-prep-amount", "prepend amount", 320.0, 360.0, 100.0),
        newobj("obj-prep-freq", "prepend ffreq", 430.0, 360.0, 100.0),
        newobj("obj-prep-soft", "prepend soft", 540.0, 360.0, 100.0),
        newobj("obj-prep-debrick", "prepend debrick", 650.0, 360.0, 100.0),
        # UI state forwarding so the Transfer Curve & reticles react to every control change
        newobj("obj-ui-order", "prepend set_order", 346.0, 150.0, 105.0),
        newobj("obj-ui-stages", "prepend set_stages", 450.0, 150.0, 110.0),
        newobj("obj-ui-filt", "prepend set_ftype", 308.0, 150.0, 105.0),
        newobj("obj-ui-place", "prepend set_fpos", 422.0, 150.0, 105.0),
        newobj("obj-ui-out", "prepend set_outmode", 648.0, 150.0, 115.0),
        newobj("obj-ui-amount", "prepend set_amount", 560.0, 390.0, 115.0),
        newobj("obj-ui-soft", "prepend set_soft", 560.0, 415.0, 105.0),
        newobj("obj-ui-debrick", "prepend set_debrick", 560.0, 440.0, 115.0),
        newobj("obj-ui-freq", "prepend set_freq", 560.0, 465.0, 105.0),
        newobj("obj-ui-mix", "prepend set_mix", 560.0, 490.0, 105.0),
        # Interactive scope drag routing (amount & freq)
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
                "text": "route amount freq",
            }
        },
        newobj("obj-set-amount", "prepend set", 150.0, 215.0, 75.0),
        newobj("obj-set-freq", "prepend set", 235.0, 215.0, 75.0),
    ]

    boxes.extend(ui_boxes)

    for i, (name, spec) in enumerate(DIAL_SPECS.items()):
        gen_param = spec[7]
        boxes.append({
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": f"obj-prep-{name}",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [760.0 + i * 90.0, 360.0, 100.0, 20.0],
                "text": f"prepend {gen_param}",
            }
        })

    # Background panels MUST be last in boxes and have "background": 1
    boxes.extend(panels)

    def line(src, outlet, dst, inlet=0):
        return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}

    lines = [
        line("obj-plugin", 0, "obj-gen"),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout"),
        line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-genbufs"),
        line("obj-loadbang", 0, "obj-msg-uibufs"),
        line("obj-msg-genbufs", 0, "obj-gen"),
        line("obj-msg-uibufs", 0, "obj-viz"),
        line("obj-order", 0, "obj-prep-order"),
        line("obj-prep-order", 0, "obj-gen"),
        line("obj-order", 0, "obj-ui-order"),
        line("obj-ui-order", 0, "obj-viz"),
        line("obj-stages", 0, "obj-prep-stages"),
        line("obj-prep-stages", 0, "obj-gen"),
        line("obj-stages", 0, "obj-ui-stages"),
        line("obj-ui-stages", 0, "obj-viz"),
        line("obj-filt", 0, "obj-prep-filt"),
        line("obj-prep-filt", 0, "obj-gen"),
        line("obj-filt", 0, "obj-ui-filt"),
        line("obj-ui-filt", 0, "obj-viz"),
        line("obj-place", 0, "obj-prep-place"),
        line("obj-prep-place", 0, "obj-gen"),
        line("obj-place", 0, "obj-ui-place"),
        line("obj-ui-place", 0, "obj-viz"),
        line("obj-out", 0, "obj-prep-out"),
        line("obj-prep-out", 0, "obj-gen"),
        line("obj-out", 0, "obj-ui-out"),
        line("obj-ui-out", 0, "obj-viz"),
        # Amount & Freq HUD value boxes -> gen + viz
        line("obj-amount", 0, "obj-prep-amount"),
        line("obj-prep-amount", 0, "obj-gen"),
        line("obj-amount", 0, "obj-ui-amount"),
        line("obj-ui-amount", 0, "obj-viz"),
        line("obj-freq", 0, "obj-prep-freq"),
        line("obj-prep-freq", 0, "obj-gen"),
        line("obj-freq", 0, "obj-ui-freq"),
        line("obj-ui-freq", 0, "obj-viz"),
        # Soft & Debrick horizontal value bars -> gen + viz
        line("obj-soft", 0, "obj-prep-soft"),
        line("obj-prep-soft", 0, "obj-gen"),
        line("obj-soft", 0, "obj-ui-soft"),
        line("obj-ui-soft", 0, "obj-viz"),
        line("obj-debrick", 0, "obj-prep-debrick"),
        line("obj-prep-debrick", 0, "obj-gen"),
        line("obj-debrick", 0, "obj-ui-debrick"),
        line("obj-ui-debrick", 0, "obj-viz"),
        # Mix dial -> viz telemetry
        line("obj-dial-mix", 0, "obj-ui-mix"),
        line("obj-ui-mix", 0, "obj-viz"),
        # Interactive scope drag -> gen + Amount/Freq value box display
        line("obj-viz", 0, "obj-route-viz"),
        line("obj-route-viz", 0, "obj-prep-amount"),
        line("obj-route-viz", 0, "obj-set-amount"),
        line("obj-set-amount", 0, "obj-amount"),
        line("obj-route-viz", 1, "obj-prep-freq"),
        line("obj-route-viz", 1, "obj-set-freq"),
        line("obj-set-freq", 0, "obj-freq"),
    ]
    for name in DIAL_SPECS:
        lines.append(line(f"obj-dial-{name}", 0, f"obj-prep-{name}"))
        lines.append(line(f"obj-prep-{name}", 0, "obj-gen"))

    parameters = {
        "obj-order": ["Order", "Order", 0],
        "obj-stages": ["Stages", "Stages", 0],
        "obj-amount": ["Amount", "Amount", 0],
        "obj-freq": ["Freq", "Freq", 0],
        "obj-out": ["Out", "Out", 0],
        "obj-filt": ["Filt", "Filt", 0],
        "obj-place": ["Place", "Place", 0],
        "obj-soft": ["Soft", "Soft", 0],
        "obj-debrick": ["Debrick", "Debrick", 0],
    }
    for name, spec in DIAL_SPECS.items():
        parameters[f"obj-dial-{name}"] = [spec[0], spec[1], 0]
    parameters["parameterbanks"] = {
        "0": {
            "index": 0,
            "name": "",
            "parameters": ["Amount", "Freq", "Soft", "Debrick", "Mix", "Order", "Stages", "Out"],
        },
        "1": {
            "index": 1,
            "name": "",
            "parameters": ["Filt", "Place"],
        },
    }
    parameters["inherited_shortname"] = 1

    patcher_doc = {
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
            "boxanimatetime": 500,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": DEVICE_W,
            "description": "Sand differential compander: grit and hidden detail from the signal derivative",
            "digest": "Differential compander for Max for Live",
            "tags": "max for live sand compander texture",
            "style": "",
            "subpatcher_template": "",
            "title": "Sand",
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

    json_bytes = json.dumps(patcher_doc, indent="\t").encode("utf-8") + b"\n"
    header = (
        b"ampf" + struct.pack("<I", 4) +
        b"aaaa" +
        b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) +
        b"ptch" + struct.pack("<I", len(json_bytes))
    )
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)
    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + json_bytes)
    print(f"Built {OUT_AMXD_PATH} [{int(DEVICE_W)}x169 px] ({len(header) + len(json_bytes)} bytes)")


if __name__ == "__main__":
    build()
