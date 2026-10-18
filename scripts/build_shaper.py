#!/usr/bin/env python3
"""
Build script for Bitwig Shaper.amxd
Generates a self-contained Max for Live Audio Effect modulator (.amxd)
combining:
  - src/mseg_editor.js (embedded in a Max 9 v8ui object)
  - 4096-sample audio-rate wavetable lookup (buffer~ + index~)
  - Loop Start/End phase windowing, Rate (Hz / Sync), Phase, Retrigger, Jitter, Smooth, Depth, Offset
  - 8-Slot Modulation Matrix (8x live.map + live.remote~ with exclusive arming)
"""

import copy
import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_PATH = os.path.join(ROOT_DIR, "src", "mseg_editor.js")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Bitwig Shaper.amxd")

CLIPPING_PATH = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/Resources/C74/packages/Max for Live/"
    "clippings/Live API Snippets/Device.DeviceParameterMap.maxpat"
)


def make_slot_map_subpatcher(base_template, slot_num):
    """
    Creates an instance of Cycling '74's official 'p Map' subpatcher
    with slot-specific ExclusiveArm routing so arming one Map button
    automatically disarms the other 7 slots.
    """
    sub = copy.deepcopy(base_template)
    for b in sub["boxes"]:
        box = b["box"]
        if box.get("id") == "obj-1" and box.get("text") == "p ExclusiveArm":
            arm_patcher = box["patcher"]
            for ab in arm_patcher["boxes"]:
                abox = ab["box"]
                if abox.get("id") == "obj-46":
                    abox["text"] = f"{slot_num} 0"
                elif abox.get("id") == "obj-47":
                    abox["text"] = f"route {slot_num}"
    return sub


def build():
    with open(JS_PATH, "r", encoding="utf-8") as f:
        v8ui_code = f.read()

    with open(CLIPPING_PATH, "r", encoding="utf-8") as f:
        clipping_data = json.load(f)

    p_map_template = None
    for b in clipping_data["patcher"]["boxes"]:
        if b["box"].get("id") == "obj-25" and b["box"].get("text") == "p Map":
            p_map_template = b["box"]["patcher"]
            break
    if p_map_template is None:
        raise RuntimeError("Could not locate 'p Map' subpatcher in Cycling '74 clipping")

    boxes = [
        # --- 1. Audio Pass-Through (Max Audio Effect Modulator) ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugin",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [30.0, 30.0, 52.0, 20.0],
                "text": "plugin~"
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
                "patching_rect": [30.0, 80.0, 58.0, 20.0],
                "text": "plugout~"
            }
        },

        # --- 2. MSEG Wavetable Buffer (4096 samples) ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-buf",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [30.0, 140.0, 175.0, 20.0],
                "text": "buffer~ #0-mseg @samps 4096"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-loadbuf",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 175.0, 175.0, 20.0],
                "text": "loadmess setbuffer #0-mseg"
            }
        },

        # --- 3. Host Transport & Tempo Sync (plugsync~) ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sync",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 9,
                "outlettype": ["int", "int", "int", "float", "list", "float", "float", "int", "int"],
                "patching_rect": [240.0, 30.0, 120.0, 20.0],
                "text": "plugsync~"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sync-chg",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "int", "int"],
                "patching_rect": [240.0, 62.0, 50.0, 20.0],
                "text": "change"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sync-sel",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["bang", ""],
                "patching_rect": [240.0, 90.0, 36.0, 20.0],
                "text": "sel 1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-bpm-chg",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "int", "int"],
                "patching_rect": [315.0, 62.0, 60.0, 20.0],
                "text": "change 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-bpm-prep",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [315.0, 90.0, 78.0, 20.0],
                "text": "prepend bpm"
            }
        },

        # --- 4. Bitwig MSEG Editor Canvas (v8ui) ---
        {
            "box": {
                "border": 0,
                "filename": "none",
                "id": "obj-mseg",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [30.0, 230.0, 320.0, 134.0],
                "presentation": 1,
                "presentation_rect": [10.0, 27.0, 320.0, 134.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_invisible": 1,
                        "parameter_longname": "ShapeData",
                        "parameter_shortname": "ShapeData",
                        "parameter_type": 3
                    }
                },
                "textfile": {
                    "text": v8ui_code,
                    "filename": "none",
                    "flags": 0,
                    "embed": 1,
                    "autowatch": 1
                },
                "varname": "ShapeData"
            }
        },

        # --- 5. Left Editor Header Controls: Title, Hints, Grid, Snap ---
        {
            "box": {
                "fontface": 1,
                "fontsize": 10.0,
                "id": "obj-title-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 380.0, 80.0, 18.0],
                "presentation": 1,
                "presentation_rect": [10.0, 8.0, 75.0, 18.0],
                "text": "MSEG Editor",
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "fontsize": 8.5,
                "id": "obj-hint-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 400.0, 145.0, 18.0],
                "presentation": 1,
                "presentation_rect": [84.0, 9.0, 140.0, 16.0],
                "text": "Click:Add • Dbl:Del • Alt:Crv",
                "textcolor": [0.55, 0.58, 0.62, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "id": "obj-grid-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [45.0, 425.0, 30.0, 18.0],
                "presentation": 1,
                "presentation_rect": [226.0, 8.0, 28.0, 18.0],
                "text": "Grid",
                "textcolor": [0.65, 0.68, 0.72, 1.0],
                "textjustification": 2
            }
        },
        {
            "box": {
                "activebgcolor": [0.086, 0.102, 0.122, 1.0],
                "activeslidercolor": [1.0, 0.709804, 0.196078, 1.0],
                "annotation": "Sets the horizontal grid subdivisions of the MSEG editor.",
                "annotation_name": "Grid",
                "appearance": 4,
                "id": "obj-grid",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [80.0, 425.0, 32.0, 15.0],
                "presentation": 1,
                "presentation_rect": [255.0, 9.0, 26.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Grid",
                        "parameter_initial": [8],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Grid",
                        "parameter_mmax": 16.0,
                        "parameter_mmin": 1.0,
                        "parameter_shortname": "Grid",
                        "parameter_type": 1,
                        "parameter_unitstyle": 0
                    }
                },
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "varname": "Grid"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-grid-prep",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [80.0, 450.0, 68.0, 20.0],
                "text": "prepend grid"
            }
        },
        {
            "box": {
                "activebgcolor": [0.15, 0.17, 0.2, 1.0],
                "activebgoncolor": [1.0, 0.694, 0.18, 1.0],
                "activetextcolor": [0.75, 0.78, 0.82, 1.0],
                "activetextoncolor": [0.08, 0.1, 0.12, 1.0],
                "annotation": "Enables snapping of MSEG points to the grid (hold Shift while dragging to temporarily invert).",
                "annotation_name": "Snap",
                "id": "obj-snap-btn",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [160.0, 425.0, 44.0, 15.0],
                "presentation": 1,
                "presentation_rect": [285.0, 9.0, 45.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Snap",
                        "parameter_enum": ["Off", "On"],
                        "parameter_initial": [1],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Snap",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Snap",
                        "parameter_type": 2
                    }
                },
                "text": "Snap",
                "texton": "Snap",
                "varname": "Snap"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-snap-prep",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [160.0, 450.0, 72.0, 20.0],
                "text": "prepend snap"
            }
        },

        # --- 6. Center Panel Controls: Scope, Jitter, Smooth, Rate (Hz/Sync), Depth, Phase, Retrig, Offset ---
        {
            "box": {
                "bgcolor": [0.067, 0.078, 0.094, 1.0],
                "id": "obj-scope",
                "maxclass": "live.scope~",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [420.0, 450.0, 146.0, 50.0],
                "presentation": 1,
                "presentation_rect": [340.0, 8.0, 146.0, 46.0],
                "range": [-1.05, 1.05],
                "samples": 44100.0
            }
        },
        {
            "box": {
                "id": "obj-jitter-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [360.0, 320.0, 38.0, 18.0],
                "presentation": 1,
                "presentation_rect": [342.0, 54.0, 35.0, 18.0],
                "text": "Jitter",
                "textcolor": [0.65, 0.68, 0.72, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.067, 0.078, 0.094, 0.0],
                "activeslidercolor": [1.0, 0.709804, 0.196078, 1.0],
                "annotation": "Adds random jitter to the modulation output.",
                "annotation_name": "Jitter",
                "appearance": 4,
                "id": "obj-jitter",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [400.0, 320.0, 38.0, 15.0],
                "presentation": 1,
                "presentation_rect": [374.0, 55.0, 36.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Jitter",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Jitter",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": 0.0,
                        "parameter_shortname": "Jitter",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "varname": "Jitter"
            }
        },
        {
            "box": {
                "id": "obj-smooth-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [450.0, 320.0, 48.0, 18.0],
                "presentation": 1,
                "presentation_rect": [412.0, 54.0, 45.0, 18.0],
                "text": "Smooth",
                "textcolor": [0.65, 0.68, 0.72, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.067, 0.078, 0.094, 0.0],
                "activeslidercolor": [1.0, 0.709804, 0.196078, 1.0],
                "annotation": "Smooths sharp transitions in the modulation output.",
                "annotation_name": "Smooth",
                "appearance": 4,
                "id": "obj-smooth",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [500.0, 320.0, 38.0, 15.0],
                "presentation": 1,
                "presentation_rect": [453.0, 55.0, 34.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Smooth",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Smooth",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": 0.0,
                        "parameter_shortname": "Smooth",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "varname": "Smooth"
            }
        },
        {
            "box": {
                "activedialcolor": [0.317647, 0.768627, 0.921569, 1.0],
                "annotation": "Sets the LFO frequency in Hz when in Free (Hz) mode.",
                "annotation_name": "Rate",
                "id": "obj-rate-hz",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [420.0, 30.0, 44.0, 48.0],
                "presentation": 1,
                "presentation_rect": [344.0, 78.0, 44.0, 48.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Rate",
                        "parameter_exponent": 3.0,
                        "parameter_initial": [1.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Rate",
                        "parameter_mmax": 40.0,
                        "parameter_mmin": 0.01,
                        "parameter_shortname": "Rate",
                        "parameter_type": 0,
                        "parameter_unitstyle": 3
                    }
                },
                "varname": "Rate"
            }
        },
        {
            "box": {
                "activedialcolor": [0.317647, 0.768627, 0.921569, 1.0],
                "annotation": "Sets the tempo-synced LFO rate in beat divisions.",
                "annotation_name": "Synced Rate",
                "hidden": 1,
                "id": "obj-rate-sync",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [475.0, 30.0, 44.0, 48.0],
                "presentation": 1,
                "presentation_rect": [344.0, 78.0, 44.0, 48.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Synced Rate",
                        "parameter_enum": [
                            "1/64", "1/32", "1/16T", "1/16", "1/16D",
                            "1/8T", "1/8", "1/8D", "1/4T", "1/4", "1/4D",
                            "1/2", "1 Bar", "2 Bars", "4 Bars", "8 Bars"
                        ],
                        "parameter_initial": [9],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "SyncRate",
                        "parameter_mmax": 15,
                        "parameter_shortname": "Rate",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9
                    }
                },
                "varname": "SyncRate"
            }
        },
        {
            "box": {
                "activebgoncolor": [1.0, 0.694, 0.18, 1.0],
                "annotation": "Switches LFO rate between Free (Hz) and Tempo-Synced beat divisions.",
                "annotation_name": "Rate Mode",
                "id": "obj-rate-mode",
                "maxclass": "live.tab",
                "num_lines_patching": 2,
                "num_lines_presentation": 2,
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", "float"],
                "parameter_enable": 1,
                "patching_rect": [535.0, 30.0, 28.0, 34.0],
                "presentation": 1,
                "presentation_rect": [396.0, 88.0, 28.0, 32.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Rate Mode",
                        "parameter_enum": ["Hz", "Sync"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "RateMode",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Mode",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9
                    }
                },
                "varname": "RateMode"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-mode-inv",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [535.0, 72.0, 30.0, 20.0],
                "text": "!- 1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-hide-hz",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [420.0, 96.0, 58.0, 20.0],
                "text": "hidden $1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-hide-sync",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [485.0, 96.0, 58.0, 20.0],
                "text": "hidden $1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-ratehz",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [420.0, 122.0, 82.0, 20.0],
                "text": "prepend ratehz"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-ratesync",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [510.0, 122.0, 92.0, 20.0],
                "text": "prepend ratesync"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-ratemode",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [610.0, 122.0, 95.0, 20.0],
                "text": "prepend ratemode"
            }
        },
        {
            "box": {
                "activedialcolor": [0.317647, 0.768627, 0.921569, 1.0],
                "annotation": "Scales the overall amplitude of the MSEG modulation.",
                "annotation_name": "Depth",
                "id": "obj-depth",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [620.0, 30.0, 44.0, 48.0],
                "presentation": 1,
                "presentation_rect": [432.0, 78.0, 44.0, 48.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Depth",
                        "parameter_initial": [100.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Depth",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": -100.0,
                        "parameter_shortname": "Depth",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "varname": "Depth"
            }
        },
        {
            "box": {
                "id": "obj-phase-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [350.0, 150.0, 42.0, 18.0],
                "presentation": 1,
                "presentation_rect": [344.0, 128.0, 42.0, 18.0],
                "text": "Phase",
                "textjustification": 1
            }
        },
        {
            "box": {
                "annotation": "Shifts the phase of the MSEG waveform.",
                "annotation_name": "Phase",
                "id": "obj-phase",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [350.0, 170.0, 44.0, 15.0],
                "presentation": 1,
                "presentation_rect": [344.0, 144.0, 44.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Phase",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Phase",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": 0.0,
                        "parameter_shortname": "Phase",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "varname": "Phase"
            }
        },
        {
            "box": {
                "activebgoncolor": [1.0, 0.694, 0.18, 1.0],
                "annotation": "Retriggers the MSEG phase from 0 immediately.",
                "annotation_name": "Retrigger",
                "id": "obj-retrig",
                "maxclass": "live.text",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [300.0, 170.0, 22.0, 15.0],
                "presentation": 1,
                "presentation_rect": [399.0, 144.0, 20.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Retrigger",
                        "parameter_enum": ["val1", "val2"],
                        "parameter_invisible": 2,
                        "parameter_longname": "Retrigger",
                        "parameter_mmax": 1,
                        "parameter_shortname": "R",
                        "parameter_type": 2
                    }
                },
                "text": "R",
                "texton": "R",
                "varname": "Retrigger"
            }
        },
        {
            "box": {
                "id": "obj-offset-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [600.0, 240.0, 44.0, 18.0],
                "presentation": 1,
                "presentation_rect": [432.0, 128.0, 44.0, 18.0],
                "text": "Offset",
                "textjustification": 1
            }
        },
        {
            "box": {
                "annotation": "Adds a constant vertical offset to the modulation output.",
                "annotation_name": "Offset",
                "id": "obj-offset",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [600.0, 260.0, 44.0, 15.0],
                "presentation": 1,
                "presentation_rect": [432.0, 144.0, 44.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Offset",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Offset",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": -100.0,
                        "parameter_shortname": "Offset",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "varname": "Offset"
            }
        },

        # --- 7. Audio-Rate MSP Signal Chain (with Loop Start/End Phase Windowing) ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-retrig-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [300.0, 200.0, 29.5, 20.0],
                "text": "0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-phasor",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 230.0, 62.0, 20.0],
                "text": "phasor~ 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-phase-div",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [350.0, 200.0, 38.0, 20.0],
                "text": "/ 100."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-phase-add",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 255.0, 38.0, 20.0],
                "text": "+~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-phase-wrap",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 280.0, 74.0, 20.0],
                "text": "pong~ 1 0. 1."
            }
        },
        # Loop Start / Span routing from v8ui outlet 0
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-route-loop",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [180.0, 380.0, 64.0, 20.0],
                "text": "route loop"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-unpack-loop",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "float"],
                "patching_rect": [180.0, 405.0, 72.0, 20.0],
                "text": "unpack 0. 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-loop-mul",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 304.0, 38.0, 20.0],
                "text": "*~ 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-loop-add",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 326.0, 38.0, 20.0],
                "text": "+~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-snap-phase",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [195.0, 175.0, 74.0, 20.0],
                "text": "snapshot~ 25"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-phase",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [195.0, 200.0, 94.0, 20.0],
                "text": "prepend setphase"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-idx-mul",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 348.0, 52.0, 20.0],
                "text": "*~ 4095."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-index",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 372.0, 92.0, 20.0],
                "text": "index~ #0-mseg"
            }
        },

        # Jitter & Smooth DSP
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-rand",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [360.0, 348.0, 54.0, 20.0],
                "text": "rand~ 45."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-jit-div",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [420.0, 348.0, 44.0, 20.0],
                "text": "/ 300."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-jit-mul",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [360.0, 375.0, 36.0, 20.0],
                "text": "*~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-jit-add",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 398.0, 38.0, 20.0],
                "text": "+~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-smooth-scale",
                "maxclass": "newobj",
                "numinlets": 6,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [500.0, 348.0, 128.0, 20.0],
                "text": "scale 0. 100. 0. 12000. 2.5"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-smooth-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [500.0, 375.0, 72.0, 20.0],
                "text": "ramp $1 $1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-rampsmooth",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 425.0, 95.0, 20.0],
                "text": "rampsmooth~ 0 0"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-depth-div",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [620.0, 90.0, 38.0, 20.0],
                "text": "/ 100."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-depth-mul",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 452.0, 38.0, 20.0],
                "text": "*~ 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-offset-div",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [600.0, 285.0, 38.0, 20.0],
                "text": "/ 100."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-offset-add",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 478.0, 38.0, 20.0],
                "text": "+~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-final-clip",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 505.0, 58.0, 20.0],
                "text": "clip~ 0. 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-scope-scale",
                "maxclass": "newobj",
                "numinlets": 6,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [420.0, 420.0, 98.0, 20.0],
                "text": "scale~ 0. 1. -0.85 0.85"
            }
        },

        # --- 8. Device-State Click Guard + 8-Slot Modulation Matrix Headers ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-thisdevice",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["bang", "int", "int"],
                "patching_rect": [700.0, 30.0, 78.0, 20.0],
                "text": "live.thisdevice"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-dev-inv",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [730.0, 58.0, 30.0, 20.0],
                "text": "!- 1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-dev-ig",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [730.0, 84.0, 76.0, 20.0],
                "text": "ignoreclick $1"
            }
        },
        {
            "box": {
                "fontface": 1,
                "fontsize": 9.5,
                "id": "obj-hdr-targets",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [700.0, 120.0, 95.0, 18.0],
                "presentation": 1,
                "presentation_rect": [496.0, 6.0, 92.0, 16.0],
                "text": "8-Slot Modulation",
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "fontsize": 9.0,
                "id": "obj-hdr-min",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [800.0, 120.0, 32.0, 18.0],
                "presentation": 1,
                "presentation_rect": [590.0, 6.0, 34.0, 16.0],
                "text": "Min",
                "textcolor": [0.65, 0.68, 0.72, 1.0],
                "textjustification": 1
            }
        },
        {
            "box": {
                "fontsize": 9.0,
                "id": "obj-hdr-max",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [840.0, 120.0, 32.0, 18.0],
                "presentation": 1,
                "presentation_rect": [626.0, 6.0, 34.0, 16.0],
                "text": "Max",
                "textcolor": [0.65, 0.68, 0.72, 1.0],
                "textjustification": 1
            }
        }
    ]

    lines = [
        # Audio pass-through
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-plugout", 1]}},

        # Buffer initialization
        {"patchline": {"source": ["obj-loadbuf", 0], "destination": ["obj-mseg", 0]}},

        # Host sync (plugsync~)
        {"patchline": {"source": ["obj-sync", 0], "destination": ["obj-sync-chg", 0]}},
        {"patchline": {"source": ["obj-sync-chg", 0], "destination": ["obj-sync-sel", 0]}},
        {"patchline": {"source": ["obj-sync-sel", 0], "destination": ["obj-retrig-msg", 0]}},
        {"patchline": {"source": ["obj-sync", 5], "destination": ["obj-bpm-chg", 0]}},
        {"patchline": {"source": ["obj-bpm-chg", 0], "destination": ["obj-bpm-prep", 0]}},
        {"patchline": {"source": ["obj-bpm-prep", 0], "destination": ["obj-mseg", 0]}},

        # Grid & Snap -> v8ui
        {"patchline": {"source": ["obj-grid", 0], "destination": ["obj-grid-prep", 0]}},
        {"patchline": {"source": ["obj-grid-prep", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-snap-btn", 0], "destination": ["obj-snap-prep", 0]}},
        {"patchline": {"source": ["obj-snap-prep", 0], "destination": ["obj-mseg", 0]}},

        # Rate & Mode -> v8ui & dial visibility
        {"patchline": {"source": ["obj-rate-hz", 0], "destination": ["obj-prep-ratehz", 0]}},
        {"patchline": {"source": ["obj-prep-ratehz", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-rate-sync", 0], "destination": ["obj-prep-ratesync", 0]}},
        {"patchline": {"source": ["obj-prep-ratesync", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-rate-mode", 0], "destination": ["obj-prep-ratemode", 0], "order": 0}},
        {"patchline": {"source": ["obj-rate-mode", 0], "destination": ["obj-hide-hz", 0], "order": 2}},
        {"patchline": {"source": ["obj-rate-mode", 0], "destination": ["obj-mode-inv", 0], "order": 1}},
        {"patchline": {"source": ["obj-mode-inv", 0], "destination": ["obj-hide-sync", 0]}},
        {"patchline": {"source": ["obj-hide-hz", 0], "destination": ["obj-rate-hz", 0]}},
        {"patchline": {"source": ["obj-hide-sync", 0], "destination": ["obj-rate-sync", 0]}},
        {"patchline": {"source": ["obj-prep-ratemode", 0], "destination": ["obj-mseg", 0]}},

        # v8ui outlet 0 (loop start & span) -> phase windowing
        {"patchline": {"source": ["obj-mseg", 0], "destination": ["obj-route-loop", 0]}},
        {"patchline": {"source": ["obj-route-loop", 0], "destination": ["obj-unpack-loop", 0]}},
        {"patchline": {"source": ["obj-unpack-loop", 0], "destination": ["obj-loop-add", 1]}},
        {"patchline": {"source": ["obj-unpack-loop", 1], "destination": ["obj-loop-mul", 1]}},

        # v8ui outlet 1 (freq Hz) -> phasor~
        {"patchline": {"source": ["obj-mseg", 1], "destination": ["obj-phasor", 0]}},

        # Retrigger & Phase offset -> Loop Windowing
        {"patchline": {"source": ["obj-retrig", 0], "destination": ["obj-retrig-msg", 0]}},
        {"patchline": {"source": ["obj-retrig-msg", 0], "destination": ["obj-phasor", 1]}},
        {"patchline": {"source": ["obj-phase", 0], "destination": ["obj-phase-div", 0]}},
        {"patchline": {"source": ["obj-phasor", 0], "destination": ["obj-phase-add", 0]}},
        {"patchline": {"source": ["obj-phase-div", 0], "destination": ["obj-phase-add", 1]}},
        {"patchline": {"source": ["obj-phase-add", 0], "destination": ["obj-phase-wrap", 0]}},
        {"patchline": {"source": ["obj-phase-wrap", 0], "destination": ["obj-loop-mul", 0]}},
        {"patchline": {"source": ["obj-loop-mul", 0], "destination": ["obj-loop-add", 0]}},

        # Windowed phase -> Playhead snapshot & Buffer index~ lookup
        {"patchline": {"source": ["obj-loop-add", 0], "destination": ["obj-snap-phase", 0], "order": 1}},
        {"patchline": {"source": ["obj-snap-phase", 0], "destination": ["obj-prep-phase", 0]}},
        {"patchline": {"source": ["obj-prep-phase", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-loop-add", 0], "destination": ["obj-idx-mul", 0], "order": 0}},
        {"patchline": {"source": ["obj-idx-mul", 0], "destination": ["obj-index", 0]}},

        # Jitter, Smooth, Depth, Offset
        {"patchline": {"source": ["obj-jitter", 0], "destination": ["obj-jit-div", 0]}},
        {"patchline": {"source": ["obj-rand", 0], "destination": ["obj-jit-mul", 0]}},
        {"patchline": {"source": ["obj-jit-div", 0], "destination": ["obj-jit-mul", 1]}},
        {"patchline": {"source": ["obj-index", 0], "destination": ["obj-jit-add", 0]}},
        {"patchline": {"source": ["obj-jit-mul", 0], "destination": ["obj-jit-add", 1]}},
        {"patchline": {"source": ["obj-smooth", 0], "destination": ["obj-smooth-scale", 0]}},
        {"patchline": {"source": ["obj-smooth-scale", 0], "destination": ["obj-smooth-msg", 0]}},
        {"patchline": {"source": ["obj-smooth-msg", 0], "destination": ["obj-rampsmooth", 0]}},
        {"patchline": {"source": ["obj-jit-add", 0], "destination": ["obj-rampsmooth", 0]}},
        {"patchline": {"source": ["obj-depth", 0], "destination": ["obj-depth-div", 0]}},
        {"patchline": {"source": ["obj-rampsmooth", 0], "destination": ["obj-depth-mul", 0]}},
        {"patchline": {"source": ["obj-depth-div", 0], "destination": ["obj-depth-mul", 1]}},
        {"patchline": {"source": ["obj-offset", 0], "destination": ["obj-offset-div", 0]}},
        {"patchline": {"source": ["obj-depth-mul", 0], "destination": ["obj-offset-add", 0]}},
        {"patchline": {"source": ["obj-offset-div", 0], "destination": ["obj-offset-add", 1]}},
        {"patchline": {"source": ["obj-offset-add", 0], "destination": ["obj-final-clip", 0]}},

        # Final signal -> Scope
        {"patchline": {"source": ["obj-final-clip", 0], "destination": ["obj-scope-scale", 0], "order": 8}},
        {"patchline": {"source": ["obj-scope-scale", 0], "destination": ["obj-scope", 0]}},

        # Device state -> ignoreclick
        {"patchline": {"source": ["obj-thisdevice", 1], "destination": ["obj-dev-inv", 0]}},
        {"patchline": {"source": ["obj-dev-inv", 0], "destination": ["obj-dev-ig", 0]}}
    ]

    parameters_dict = {
        "obj-mseg": ["ShapeData", "ShapeData", 0],
        "obj-grid": ["Grid", "Grid", 0],
        "obj-snap-btn": ["Snap", "Snap", 0],
        "obj-jitter": ["Jitter", "Jitter", 0],
        "obj-smooth": ["Smooth", "Smooth", 0],
        "obj-rate-hz": ["Rate", "Rate", 0],
        "obj-rate-sync": ["SyncRate", "Rate", 0],
        "obj-rate-mode": ["RateMode", "Mode", 0],
        "obj-depth": ["Depth", "Depth", 0],
        "obj-phase": ["Phase", "Phase", 0],
        "obj-retrig": ["Retrigger", "R", 0],
        "obj-offset": ["Offset", "Offset", 0]
    }

    # --- Generate 8 Modulation Mapping Slots ---
    for i in range(8):
        slot_num = i + 1
        row_y = 22.0 + i * 17.0
        patch_y = 160.0 + i * 50.0

        map_id = f"obj-map-btn-{slot_num}"
        unmap_id = f"obj-unmap-btn-{slot_num}"
        min_id = f"obj-min-{slot_num}"
        max_id = f"obj-max-{slot_num}"
        sub_id = f"obj-map-sub-{slot_num}"
        inv_id = f"obj-unmap-inv-{slot_num}"
        hide_id = f"obj-unmap-hide-{slot_num}"

        boxes.extend([
            {
                "box": {
                    "activebgcolor": [0.086, 0.102, 0.122, 1.0],
                    "activebgoncolor": [0.086, 0.102, 0.122, 1.0],
                    "activetextcolor": [1.0, 0.709804, 0.196078, 1.0],
                    "activetextoncolor": [1.0, 0.709804, 0.196078, 1.0],
                    "annotation": f"Slot {slot_num}: Click Map, then click any Ableton Live parameter to modulate it.",
                    "annotation_name": f"Map {slot_num}",
                    "appearance": 2,
                    "bgcolor": [0.086, 0.102, 0.122, 1.0],
                    "bgoncolor": [0.086, 0.102, 0.122, 1.0],
                    "bordercolor": [1.0, 0.709804, 0.196078, 1.0],
                    "focusbordercolor": [0.549, 0.549, 0.549, 1.0],
                    "id": map_id,
                    "maxclass": "live.text",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", ""],
                    "parameter_enable": 1,
                    "patching_rect": [700.0, patch_y, 74.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [496.0, row_y, 74.0, 15.0],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_annotation_name": f"Map {slot_num}",
                            "parameter_enum": ["val1", "val2"],
                            "parameter_invisible": 2,
                            "parameter_longname": f"Map[{slot_num}]",
                            "parameter_mmax": 1,
                            "parameter_shortname": f"Map {slot_num}",
                            "parameter_type": 2
                        }
                    },
                    "text": "Map",
                    "textcolor": [0.65, 0.65, 0.65, 1.0],
                    "textoffcolor": [0.65, 0.65, 0.65, 1.0],
                    "texton": "Map",
                    "varname": f"Map[{slot_num}]"
                }
            },
            {
                "box": {
                    "annotation": f"Unmaps Slot {slot_num}.",
                    "annotation_name": f"Unmap {slot_num}",
                    "appearance": 2,
                    "fontsize": 6.0,
                    "hidden": 1,
                    "id": unmap_id,
                    "maxclass": "live.text",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", ""],
                    "parameter_enable": 1,
                    "patching_rect": [780.0, patch_y, 15.0, 15.0],
                    "pictures": ["multimap-unmap.svg", "multimap-unmap.svg"],
                    "presentation": 1,
                    "presentation_rect": [572.0, row_y, 15.0, 15.0],
                    "remapsvgcolors": 1,
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_annotation_name": f"Unmap {slot_num}",
                            "parameter_enum": ["val1", "val2"],
                            "parameter_invisible": 2,
                            "parameter_longname": f"Unmap[{slot_num}]",
                            "parameter_mmax": 1,
                            "parameter_shortname": f"Unmap {slot_num}",
                            "parameter_type": 2
                        }
                    },
                    "text": "X",
                    "texton": "x",
                    "usepicture": 1,
                    "usesvgviewbox": 1,
                    "varname": f"Unmap[{slot_num}]"
                }
            },
            {
                "box": {
                    "activebgcolor": [0.086, 0.102, 0.122, 1.0],
                    "activeslidercolor": [1.0, 0.709804, 0.196078, 1.0],
                    "activetricolor2": [1.0, 0.709804, 0.196078, 1.0],
                    "annotation": f"Minimum modulation output for Slot {slot_num}.",
                    "annotation_name": f"Min {slot_num}",
                    "appearance": 4,
                    "focusbordercolor": [1.0, 0.709804, 0.196078, 1.0],
                    "id": min_id,
                    "maxclass": "live.numbox",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", "float"],
                    "parameter_enable": 1,
                    "patching_rect": [805.0, patch_y, 34.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [590.0, row_y, 34.0, 15.0],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_annotation_name": f"Min {slot_num}",
                            "parameter_initial": [0.0],
                            "parameter_initial_enable": 1,
                            "parameter_linknames": 1,
                            "parameter_longname": f"TargetMin[{slot_num}]",
                            "parameter_mmax": 100.0,
                            "parameter_mmin": 0.0,
                            "parameter_shortname": f"Min {slot_num}",
                            "parameter_type": 0,
                            "parameter_unitstyle": 5
                        }
                    },
                    "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                    "varname": f"TargetMin[{slot_num}]"
                }
            },
            {
                "box": {
                    "activebgcolor": [0.086, 0.102, 0.122, 1.0],
                    "activeslidercolor": [1.0, 0.709804, 0.196078, 1.0],
                    "activetricolor2": [1.0, 0.709804, 0.196078, 1.0],
                    "annotation": f"Maximum modulation output for Slot {slot_num}.",
                    "annotation_name": f"Max {slot_num}",
                    "appearance": 4,
                    "focusbordercolor": [1.0, 0.709804, 0.196078, 1.0],
                    "id": max_id,
                    "maxclass": "live.numbox",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", "float"],
                    "parameter_enable": 1,
                    "patching_rect": [845.0, patch_y, 34.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [626.0, row_y, 34.0, 15.0],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_annotation_name": f"Max {slot_num}",
                            "parameter_initial": [100.0],
                            "parameter_initial_enable": 1,
                            "parameter_linknames": 1,
                            "parameter_longname": f"TargetMax[{slot_num}]",
                            "parameter_mmax": 100.0,
                            "parameter_mmin": 0.0,
                            "parameter_shortname": f"Max {slot_num}",
                            "parameter_type": 0,
                            "parameter_unitstyle": 5
                        }
                    },
                    "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                    "varname": f"TargetMax[{slot_num}]"
                }
            },
            {
                "box": {
                    "color": [1.0, 0.694118, 0.0, 1.0],
                    "id": sub_id,
                    "maxclass": "newobj",
                    "numinlets": 5,
                    "numoutlets": 2,
                    "outlettype": ["int", "int"],
                    "patcher": make_slot_map_subpatcher(p_map_template, slot_num),
                    "patching_rect": [900.0, patch_y, 120.0, 20.0],
                    "saved_object_attributes": {
                        "description": "",
                        "digest": "",
                        "editing_bgcolor": [0.560784, 0.560784, 0.560784, 1.0],
                        "globalpatchername": "",
                        "locked_bgcolor": [0.560784, 0.560784, 0.560784, 1.0],
                        "tags": ""
                    },
                    "text": f"p Map_{slot_num}"
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": inv_id,
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": ["int"],
                    "patching_rect": [1030.0, patch_y, 30.0, 20.0],
                    "text": "!- 1"
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": hide_id,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [1065.0, patch_y, 58.0, 20.0],
                    "text": "hidden $1"
                }
            }
        ])

        lines.extend([
            {"patchline": {"source": ["obj-final-clip", 0], "destination": [sub_id, 0], "order": i}},
            {"patchline": {"source": [min_id, 1], "destination": [sub_id, 1]}},
            {"patchline": {"source": [max_id, 1], "destination": [sub_id, 2]}},
            {"patchline": {"source": [unmap_id, 0], "destination": [sub_id, 3]}},
            {"patchline": {"source": [map_id, 0], "destination": [sub_id, 4]}},
            {"patchline": {"source": [sub_id, 0], "destination": [inv_id, 0]}},
            {"patchline": {"source": [inv_id, 0], "destination": [hide_id, 0]}},
            {"patchline": {"source": [hide_id, 0], "destination": [unmap_id, 0]}},
            {"patchline": {"source": [sub_id, 1], "destination": [map_id, 0]}},
            {"patchline": {"source": ["obj-dev-ig", 0], "destination": [map_id, 0], "order": i * 2}},
            {"patchline": {"source": ["obj-dev-ig", 0], "destination": [unmap_id, 0], "order": i * 2 + 1}}
        ])

        parameters_dict[map_id] = [f"Map[{slot_num}]", f"Map {slot_num}", 0]
        parameters_dict[unmap_id] = [f"Unmap[{slot_num}]", f"Unmap {slot_num}", 0]
        parameters_dict[min_id] = [f"TargetMin[{slot_num}]", f"Min {slot_num}", 0]
        parameters_dict[max_id] = [f"TargetMax[{slot_num}]", f"Max {slot_num}", 0]

    # --- 9. Presentation Background Panels ---
    boxes.extend([
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.125, 0.145, 0.17, 1.0],
                "border": 1,
                "bordercolor": [0.06, 0.07, 0.08, 1.0],
                "id": "obj-panel-left",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 500.0, 120.0, 40.0],
                "presentation": 1,
                "presentation_rect": [6.0, 5.0, 328.0, 159.0],
                "proportion": 0.5,
                "rounded": 6
            }
        },
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.067, 0.078, 0.094, 1.0],
                "border": 1,
                "bordercolor": [0.04, 0.05, 0.06, 1.0],
                "id": "obj-panel-scope",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [160.0, 500.0, 120.0, 40.0],
                "presentation": 1,
                "presentation_rect": [338.0, 5.0, 150.0, 68.0],
                "proportion": 0.5,
                "rounded": 6
            }
        },
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.125, 0.145, 0.17, 1.0],
                "border": 1,
                "bordercolor": [0.06, 0.07, 0.08, 1.0],
                "id": "obj-panel-multimap",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [290.0, 500.0, 120.0, 40.0],
                "presentation": 1,
                "presentation_rect": [492.0, 5.0, 172.0, 159.0],
                "proportion": 0.5,
                "rounded": 6
            }
        }
    ])

    parameters_dict["parameterbanks"] = {
        "0": {
            "index": 0,
            "name": "",
            "parameters": [
                "Rate", "SyncRate", "RateMode", "Depth",
                "Phase", "Offset", "Jitter", "Smooth"
            ]
        }
    }
    parameters_dict["inherited_shortname"] = 1

    patcher_doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 5,
                "architecture": "x64",
                "modernui": 1
            },
            "classnamespace": "box",
            "rect": [60.0, 80.0, 1180.0, 680.0],
            "openrect": [0.0, 0.0, 670.0, 169.0],
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
            "devicewidth": 670.0,
            "description": "Shaper modulator with Bitwig-style MSEG editor and 8-slot modulation matrix",
            "digest": "Bitwig-style MSEG Shaper for Max for Live",
            "tags": "max for live modulator mseg shaper bitwig",
            "style": "",
            "subpatcher_template": "",
            "title": "Bitwig Shaper",
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters_dict,
            "dependency_cache": [
                {
                    "name": "multimap-unmap.svg",
                    "bootpath": "C74:/packages/Max for Live/media",
                    "type": "svg",
                    "implicit": 1
                }
            ],
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
                "contents": {
                    "patchers": {}
                },
                "layout": {},
                "searchpath": {},
                "detailsvisible": 0,
                "amxdtype": 1633771873,
                "readonly": 0,
                "devpathtype": 0,
                "devpath": ".",
                "sortmode": 0,
                "viewmode": 0
            },
            "autosave": 0
        }
    }

    json_bytes = json.dumps(patcher_doc, indent="\t").encode("utf-8") + b"\n"

    # Binary .amxd header for Max Audio Effect ('aaaa' = 0x61616161 = 1633771873)
    header = (
        b"ampf" + struct.pack("<I", 4) +
        b"aaaa" +
        b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) +
        b"ptch" + struct.pack("<I", len(json_bytes))
    )

    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + json_bytes)

    print(f"Built {OUT_AMXD_PATH} ({len(header) + len(json_bytes)} bytes)")


if __name__ == "__main__":
    build()
