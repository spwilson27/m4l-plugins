#!/usr/bin/env python3
"""
Build script for devices/Better Shaper.amxd
Generates a self-contained Max for Live Audio Effect modulator (.amxd)
combining:
  - src/mseg_editor.js (embedded in a Max 9 v8ui object)
  - 4096-sample audio-rate wavetable lookup (buffer~ + index~)
  - Timeline-aligned Sync mode (plugsync~ 1-PPQ ticks) + Free Hz mode
  - Native Live 12 Shaper 2-Panel Layout (492 x 169 px):
      * Left Panel toggles between MSEG Editor + Grid/Snap view (Image 1) and
        8-Slot Modulation Matrix view (Image 2) via the top-right Multimap button (≡ / —),
        hiding the MSEG editor and Grid/Snap items when in the 8-slot mod view.
      * Right Panel matches the Live 12 Shaper Oscilloscope + Jitter/Smooth/(R)/Ø Phase/Offset
        + [Loop / 1-Shot / Manual] + Rate / Hz-Metronome / Depth layout.
"""

import copy
import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_PATH = os.path.join(ROOT_DIR, "src", "mseg_editor.js")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Better Shaper.amxd")

CLIPPING_PATH = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/Resources/C74/packages/Max for Live/"
    "clippings/Live API Snippets/Device.DeviceParameterMap.maxpat"
)


def make_slot_map_subpatcher(base_template, slot_num):
    """
    Upgrades Cycling '74's official 'p Map' subpatcher with:
      1. Slot-specific ExclusiveArm routing (disarms the other 7 slots when armed).
      2. Dual modulation engines:
         - Modern Modulation (ModMode=0): uses live.modulate~ scaled by Bipolar (0/1) and ModAmount (-100..100%)
         - Legacy Takeover (ModMode=1): uses live.remote~ @normalized 1 scaled by Min (0..100%) and Max (0..100%)
         with ordered release-before-attach handoff when switching modes.
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

    sub["lines"] = [
        l for l in sub["lines"]
        if not (
            l["patchline"]["destination"] == ["obj-5", 1]
            and l["patchline"]["source"][0] in ("obj-27", "obj-15")
        )
    ]

    sub["boxes"].extend([
        {
            "box": {
                "comment": "Modulation Mode (0 = Modern Modulate, 1 = Legacy Remote Takeover)",
                "id": "obj-in-mode",
                "index": 6,
                "maxclass": "inlet",
                "numinlets": 0,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [740.0, 45.0, 30.0, 30.0]
            }
        },
        {
            "box": {
                "comment": "Bipolar Flag (0 = Unipolar 0..Amt, 1 = Bipolar -Amt..+Amt)",
                "id": "obj-in-bipolar",
                "index": 7,
                "maxclass": "inlet",
                "numinlets": 0,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [820.0, 45.0, 30.0, 30.0]
            }
        },
        {
            "box": {
                "comment": "Modulation Amount (-100..100%)",
                "id": "obj-in-amt",
                "index": 8,
                "maxclass": "inlet",
                "numinlets": 0,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [880.0, 45.0, 30.0, 30.0]
            }
        },
        {
            "box": {
                "id": "obj-amt-div",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [880.0, 95.0, 42.0, 22.0],
                "text": "/ 100."
            }
        },
        {
            "box": {
                "id": "obj-amt-neg",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [820.0, 130.0, 42.0, 22.0],
                "text": "* -1."
            }
        },
        {
            "box": {
                "id": "obj-bip-pak",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [820.0, 165.0, 62.0, 22.0],
                "text": "pak -0.5 1."
            }
        },
        {
            "box": {
                "id": "obj-bip-mul",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [820.0, 198.0, 36.0, 22.0],
                "text": "* 1."
            }
        },
        {
            "box": {
                "id": "obj-mod-scale",
                "maxclass": "newobj",
                "numinlets": 6,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [175.0, 300.0, 125.0, 22.0],
                "text": "scale~ 0. 1. -0.5 0.5"
            }
        },
        {
            "box": {
                "id": "obj-modulate",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [175.0, 465.0, 120.0, 22.0],
                "saved_object_attributes": {
                    "_persistence": 1,
                    "smoothing": 1.0
                },
                "text": "live.modulate~"
            }
        },
        {
            "box": {
                "id": "obj-id-reg",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [310.0, 340.0, 68.0, 22.0],
                "text": "zl reg id 0"
            }
        },
        {
            "box": {
                "id": "obj-mode-trig",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["bang", "int"],
                "patching_rect": [740.0, 120.0, 40.0, 22.0],
                "text": "t b i"
            }
        },
        {
            "box": {
                "id": "obj-mode-plus",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [760.0, 165.0, 32.0, 22.0],
                "text": "+ 1"
            }
        },
        {
            "box": {
                "id": "obj-mode-zero",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [710.0, 165.0, 34.0, 22.0],
                "text": "id 0"
            }
        },
        {
            "box": {
                "id": "obj-mode-gate",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [290.0, 385.0, 64.0, 22.0],
                "text": "gate 2 1"
            }
        }
    ])

    sub["lines"].extend([
        {"patchline": {"source": ["obj-7", 0], "destination": ["obj-mod-scale", 0], "order": 1}},
        {"patchline": {"source": ["obj-mod-scale", 0], "destination": ["obj-modulate", 0]}},

        {"patchline": {"source": ["obj-in-amt", 0], "destination": ["obj-amt-div", 0]}},
        {"patchline": {"source": ["obj-amt-div", 0], "destination": ["obj-mod-scale", 4], "order": 0}},
        {"patchline": {"source": ["obj-amt-div", 0], "destination": ["obj-amt-neg", 0], "order": 1}},
        {"patchline": {"source": ["obj-amt-neg", 0], "destination": ["obj-bip-pak", 0]}},
        {"patchline": {"source": ["obj-in-bipolar", 0], "destination": ["obj-bip-pak", 1]}},
        {"patchline": {"source": ["obj-bip-pak", 0], "destination": ["obj-bip-mul", 0]}},
        {"patchline": {"source": ["obj-bip-mul", 0], "destination": ["obj-mod-scale", 3]}},

        {"patchline": {"source": ["obj-27", 1], "destination": ["obj-id-reg", 0]}},

        {"patchline": {"source": ["obj-15", 0], "destination": ["obj-id-reg", 1], "order": 2}},
        {"patchline": {"source": ["obj-15", 0], "destination": ["obj-modulate", 1], "order": 1}},
        {"patchline": {"source": ["obj-15", 0], "destination": ["obj-5", 1], "order": 0}},

        {"patchline": {"source": ["obj-id-reg", 0], "destination": ["obj-mode-gate", 1]}},
        {"patchline": {"source": ["obj-mode-gate", 0], "destination": ["obj-modulate", 1]}},
        {"patchline": {"source": ["obj-mode-gate", 1], "destination": ["obj-5", 1]}},

        {"patchline": {"source": ["obj-in-mode", 0], "destination": ["obj-mode-trig", 0]}},
        {"patchline": {"source": ["obj-mode-trig", 1], "destination": ["obj-mode-plus", 0], "order": 1}},
        {"patchline": {"source": ["obj-mode-trig", 1], "destination": ["obj-mode-zero", 0], "order": 0}},
        {"patchline": {"source": ["obj-mode-plus", 0], "destination": ["obj-mode-gate", 0]}},
        {"patchline": {"source": ["obj-mode-zero", 0], "destination": ["obj-modulate", 1], "order": 1}},
        {"patchline": {"source": ["obj-mode-zero", 0], "destination": ["obj-5", 1], "order": 0}},
        {"patchline": {"source": ["obj-mode-trig", 0], "destination": ["obj-id-reg", 0]}}
    ])

    return sub


def make_slot_vis_subpatcher():
    """
    Computes 'hidden $1' messages for Slots 2..8 based on:
      Inlet 1 ($i1): showPanel (0 = MSEG view, 1 = 8-Slot Mod view)
      Inlet 2 ($i2): mode (0 = Mod, 1 = Remote)
      Inlet 3 ($i3): mapped (0 = Unmapped, 1 = Mapped)
    Outlets:
      Outlet 1: hidden for Map & ModMode buttons (1 - $i1)
      Outlet 2: hidden for Bipolar & ModAmount (1 - ($i1 * (1 - $i2)))
      Outlet 3: hidden for Min & Max (1 - ($i1 * $i2))
      Outlet 4: hidden for Unmap button (1 - ($i1 * $i3))
    """
    return {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 500.0, 320.0],
        "boxes": [
            {"box": {"id": "obj-in1", "index": 1, "maxclass": "inlet", "numinlets": 0, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [30.0, 20.0, 25.0, 25.0]}},
            {"box": {"id": "obj-in2", "index": 2, "maxclass": "inlet", "numinlets": 0, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [90.0, 20.0, 25.0, 25.0]}},
            {"box": {"id": "obj-in3", "index": 3, "maxclass": "inlet", "numinlets": 0, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [150.0, 20.0, 25.0, 25.0]}},
            {"box": {"id": "obj-pak", "maxclass": "newobj", "numinlets": 3, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 65.0, 139.0, 20.0], "text": "pak 0 0 0"}},
            {"box": {"id": "obj-ex1", "maxclass": "newobj", "numinlets": 3, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 110.0, 95.0, 20.0], "text": "expr 1 - $i1"}},
            {"box": {"id": "obj-ex2", "maxclass": "newobj", "numinlets": 3, "numoutlets": 1, "outlettype": [""], "patching_rect": [135.0, 110.0, 155.0, 20.0], "text": "expr 1 - ($i1 * (1 - $i2))"}},
            {"box": {"id": "obj-ex3", "maxclass": "newobj", "numinlets": 3, "numoutlets": 1, "outlettype": [""], "patching_rect": [300.0, 110.0, 125.0, 20.0], "text": "expr 1 - ($i1 * $i2)"}},
            {"box": {"id": "obj-ex4", "maxclass": "newobj", "numinlets": 3, "numoutlets": 1, "outlettype": [""], "patching_rect": [435.0, 110.0, 125.0, 20.0], "text": "expr 1 - ($i1 * $i3)"}},
            {"box": {"id": "obj-m1", "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 145.0, 58.0, 20.0], "text": "hidden $1"}},
            {"box": {"id": "obj-m2", "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [135.0, 145.0, 58.0, 20.0], "text": "hidden $1"}},
            {"box": {"id": "obj-m3", "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [300.0, 145.0, 58.0, 20.0], "text": "hidden $1"}},
            {"box": {"id": "obj-m4", "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [435.0, 145.0, 58.0, 20.0], "text": "hidden $1"}},
            {"box": {"id": "obj-out1", "index": 1, "maxclass": "outlet", "numinlets": 1, "numoutlets": 0, "patching_rect": [30.0, 185.0, 25.0, 25.0]}},
            {"box": {"id": "obj-out2", "index": 2, "maxclass": "outlet", "numinlets": 1, "numoutlets": 0, "patching_rect": [135.0, 185.0, 25.0, 25.0]}},
            {"box": {"id": "obj-out3", "index": 3, "maxclass": "outlet", "numinlets": 1, "numoutlets": 0, "patching_rect": [300.0, 185.0, 25.0, 25.0]}},
            {"box": {"id": "obj-out4", "index": 4, "maxclass": "outlet", "numinlets": 1, "numoutlets": 0, "patching_rect": [435.0, 185.0, 25.0, 25.0]}}
        ],
        "lines": [
            {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-pak", 0]}},
            {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-pak", 1]}},
            {"patchline": {"source": ["obj-in3", 0], "destination": ["obj-pak", 2]}},
            {"patchline": {"source": ["obj-pak", 0], "destination": ["obj-ex1", 0], "order": 3}},
            {"patchline": {"source": ["obj-pak", 0], "destination": ["obj-ex2", 0], "order": 2}},
            {"patchline": {"source": ["obj-pak", 0], "destination": ["obj-ex3", 0], "order": 1}},
            {"patchline": {"source": ["obj-pak", 0], "destination": ["obj-ex4", 0], "order": 0}},
            {"patchline": {"source": ["obj-ex1", 0], "destination": ["obj-m1", 0]}},
            {"patchline": {"source": ["obj-ex2", 0], "destination": ["obj-m2", 0]}},
            {"patchline": {"source": ["obj-ex3", 0], "destination": ["obj-m3", 0]}},
            {"patchline": {"source": ["obj-ex4", 0], "destination": ["obj-m4", 0]}},
            {"patchline": {"source": ["obj-m1", 0], "destination": ["obj-out1", 0]}},
            {"patchline": {"source": ["obj-m2", 0], "destination": ["obj-out2", 0]}},
            {"patchline": {"source": ["obj-m3", 0], "destination": ["obj-out3", 0]}},
            {"patchline": {"source": ["obj-m4", 0], "destination": ["obj-out4", 0]}}
        ]
    }


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

        # --- 2. MSEG Wavetable Buffer (4096 samples) & Keyboard Listener ---
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
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-key",
                "maxclass": "newobj",
                "numinlets": 0,
                "numoutlets": 4,
                "outlettype": ["int", "int", "int", "int"],
                "patching_rect": [115.0, 30.0, 50.0, 20.0],
                "text": "key"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-key-pack",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [115.0, 58.0, 56.0, 20.0],
                "text": "pack 0 0"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-key-prep",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [115.0, 84.0, 70.0, 20.0],
                "text": "prepend key"
            }
        },

        # --- 3. Host Transport & Timeline Sync (plugsync~) ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sync",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 9,
                "outlettype": ["int", "int", "int", "float", "list", "float", "float", "int", "int"],
                "patching_rect": [240.0, 30.0, 140.0, 20.0],
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
                "id": "obj-transport-prep",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [240.0, 90.0, 98.0, 20.0],
                "text": "prepend transport"
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
                "patching_rect": [345.0, 62.0, 60.0, 20.0],
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
                "patching_rect": [345.0, 90.0, 78.0, 20.0],
                "text": "prepend bpm"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-ticks-chg",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "int", "int"],
                "patching_rect": [430.0, 62.0, 60.0, 20.0],
                "text": "change -1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-ticks-prep",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [430.0, 90.0, 78.0, 20.0],
                "text": "prepend ticks"
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
                "patching_rect": [30.0, 230.0, 262.0, 134.0],
                "presentation": 1,
                "presentation_rect": [10.0, 26.0, 262.0, 134.0],
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

        # --- 5. Grid & Snap Live Parameters (Rendered & controlled directly on v8ui toolbar, synced bidirectionally) ---
        {
            "box": {
                "id": "obj-grid-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [45.0, 425.0, 30.0, 18.0],
                "presentation": 0,
                "presentation_rect": [225.0, 141.0, 28.0, 16.0],
                "text": "Grid",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 2
            }
        },
        {
            "box": {
                "activebgcolor": [0.047, 0.067, 0.086, 1.0],
                "activeslidercolor": [1.0, 0.678, 0.22, 1.0],
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
                "presentation": 0,
                "presentation_rect": [254.0, 142.0, 24.0, 15.0],
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
                "textcolor": [1.0, 0.678, 0.22, 1.0],
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
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-grid-set",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [80.0, 400.0, 65.0, 20.0],
                "text": "prepend set"
            }
        },
        {
            "box": {
                "activebgcolor": [0.067, 0.086, 0.11, 1.0],
                "activebgoncolor": [1.0, 0.678, 0.22, 1.0],
                "activetextcolor": [0.75, 0.78, 0.82, 1.0],
                "activetextoncolor": [0.047, 0.067, 0.086, 1.0],
                "annotation": "Enables snapping of MSEG points to the grid (hold Shift while dragging to temporarily invert).",
                "annotation_name": "Snap",
                "id": "obj-snap-btn",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [160.0, 425.0, 44.0, 15.0],
                "presentation": 0,
                "presentation_rect": [282.0, 142.0, 42.0, 15.0],
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
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-snap-set",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [160.0, 400.0, 65.0, 20.0],
                "text": "prepend set"
            }
        },

        # --- 6. Top-Right of Left Panel: Multimap Show/Hide Button (≡ / —) ---
        {
            "box": {
                "activebgcolor": [0.047, 0.067, 0.086, 1.0],
                "activebgoncolor": [0.047, 0.067, 0.086, 1.0],
                "activetextcolor": [1.0, 0.678, 0.22, 1.0],
                "activetextoncolor": [1.0, 0.678, 0.22, 1.0],
                "annotation": "Switches the Left Panel between the MSEG Editor view and the 8-Slot Modulation Matrix view.",
                "annotation_name": "Show/Hide Multimap",
                "bgcolor": [0.047, 0.067, 0.086, 1.0],
                "bgoncolor": [0.047, 0.067, 0.086, 1.0],
                "bordercolor": [1.0, 0.678, 0.22, 1.0],
                "id": "obj-expand-map",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [650.0, 260.0, 15.0, 15.0],
                "pictures": ["multimap-closed-off.svg", "multimap-open-off.svg"],
                "presentation": 1,
                "presentation_rect": [255.0, 8.0, 15.0, 15.0],
                "remapsvgcolors": 1,
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Show/Hide Multimap",
                        "parameter_enum": ["Hide", "Show"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_longname": "ShowModPanel",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Multimap",
                        "parameter_type": 2
                    }
                },
                "text": "Off",
                "texton": "On",
                "usepicture": 1,
                "usesvgviewbox": 1,
                "varname": "ShowModPanel"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-hide-mseg-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [650.0, 285.0, 58.0, 20.0],
                "text": "hidden $1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-expand-inv",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [715.0, 285.0, 30.0, 20.0],
                "text": "!- 1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-hide-hdrs-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [715.0, 312.0, 58.0, 20.0],
                "text": "hidden $1"
            }
        },

        # Bottom Column Headers in 8-Slot Multimap View (Hidden when in MSEG View): Parameter  Mode  — Range —
        {
            "box": {
                "fontsize": 9.5,
                "hidden": 1,
                "id": "obj-hdr-targets",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [750.0, 120.0, 68.0, 18.0],
                "presentation": 1,
                "presentation_rect": [18.0, 143.0, 68.0, 16.0],
                "text": "Parameter",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 1
            }
        },
        {
            "box": {
                "fontsize": 9.5,
                "hidden": 1,
                "id": "obj-hdr-mode",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [840.0, 120.0, 44.0, 18.0],
                "presentation": 1,
                "presentation_rect": [112.0, 143.0, 48.0, 16.0],
                "text": "Mode",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 1
            }
        },
        {
            "box": {
                "fontsize": 9.5,
                "hidden": 1,
                "id": "obj-hdr-range",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [880.0, 120.0, 88.0, 18.0],
                "presentation": 1,
                "presentation_rect": [168.0, 143.0, 88.0, 16.0],
                "text": "—  Range  —",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 1
            }
        },

        # --- 7. Right Panel Controls (Matching Live 12 Native Shaper Layout, x = 282..432) ---
        {
            "box": {
                "bgcolor": [0.047, 0.067, 0.086, 0.0],
                "bordercolor": [0.0, 0.0, 0.0, 0.0],
                "id": "obj-scope",
                "ignoreclick": 1,
                "maxclass": "live.scope~",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [420.0, 450.0, 146.0, 39.0],
                "presentation": 1,
                "presentation_rect": [284.0, 7.0, 146.0, 39.0],
                "range": [-1.05, 1.05],
                "samples": 44100.0
            }
        },
        # LCD Row 1: Jitter 0 %   Smooth 0 %
        {
            "box": {
                "id": "obj-jitter-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [360.0, 320.0, 38.0, 18.0],
                "presentation": 1,
                "presentation_rect": [289.0, 47.0, 35.0, 16.0],
                "text": "Jitter",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.047, 0.067, 0.086, 0.0],
                "activeslidercolor": [1.0, 0.678, 0.22, 1.0],
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
                "presentation_rect": [321.0, 48.0, 34.0, 15.0],
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
                "textcolor": [1.0, 0.678, 0.22, 1.0],
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
                "presentation_rect": [358.0, 47.0, 45.0, 16.0],
                "text": "Smooth",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.047, 0.067, 0.086, 0.0],
                "activeslidercolor": [1.0, 0.678, 0.22, 1.0],
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
                "presentation_rect": [399.0, 48.0, 32.0, 15.0],
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
                "textcolor": [1.0, 0.678, 0.22, 1.0],
                "varname": "Smooth"
            }
        },
        # LCD Row 2: (R)  Ø  0.00 %   Offset  0 %
        {
            "box": {
                "activebgcolor": [0.047, 0.067, 0.086, 1.0],
                "activebgoncolor": [1.0, 0.678, 0.22, 1.0],
                "activetextcolor": [0.576, 0.631, 0.678, 1.0],
                "activetextoncolor": [0.047, 0.067, 0.086, 1.0],
                "annotation": "Retriggers the MSEG phase from 0 immediately.",
                "annotation_name": "Retrigger",
                "appearance": 1,
                "bordercolor": [0.576, 0.631, 0.678, 1.0],
                "id": "obj-retrig",
                "maxclass": "live.text",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [300.0, 170.0, 14.0, 14.0],
                "presentation": 1,
                "presentation_rect": [286.0, 64.0, 14.0, 14.0],
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
                "id": "obj-phase-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [350.0, 150.0, 18.0, 18.0],
                "presentation": 1,
                "presentation_rect": [304.0, 63.0, 18.0, 16.0],
                "text": "Ø",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 1
            }
        },
        {
            "box": {
                "activebgcolor": [0.047, 0.067, 0.086, 0.0],
                "activeslidercolor": [1.0, 0.678, 0.22, 1.0],
                "annotation": "Shifts the phase of the MSEG waveform (or scrubs position directly in Manual mode).",
                "annotation_name": "Phase",
                "appearance": 4,
                "id": "obj-phase",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [350.0, 170.0, 40.0, 15.0],
                "presentation": 1,
                "presentation_rect": [321.0, 64.0, 38.0, 15.0],
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
                "textcolor": [1.0, 0.678, 0.22, 1.0],
                "varname": "Phase"
            }
        },
        {
            "box": {
                "id": "obj-offset-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [600.0, 240.0, 42.0, 18.0],
                "presentation": 1,
                "presentation_rect": [358.0, 63.0, 40.0, 16.0],
                "text": "Offset",
                "textcolor": [0.576, 0.631, 0.678, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.047, 0.067, 0.086, 0.0],
                "activeslidercolor": [1.0, 0.678, 0.22, 1.0],
                "annotation": "Adds a constant vertical offset to the modulation output.",
                "annotation_name": "Offset",
                "appearance": 4,
                "id": "obj-offset",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [600.0, 260.0, 38.0, 15.0],
                "presentation": 1,
                "presentation_rect": [399.0, 64.0, 32.0, 15.0],
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
                "textcolor": [1.0, 0.678, 0.22, 1.0],
                "varname": "Offset"
            }
        },

        # Middle Row: Playback Mode Tabs [ Loop ] [ 1-Shot ] [ Manual ]
        {
            "box": {
                "activebgcolor": [0.067, 0.086, 0.11, 1.0],
                "activebgoncolor": [1.0, 0.678, 0.22, 1.0],
                "activetextcolor": [0.85, 0.88, 0.92, 1.0],
                "activetextoncolor": [0.047, 0.067, 0.086, 1.0],
                "annotation": "Selects MSEG playback mode: Loop (continuous), 1-Shot (single cycle on R trigger), or Manual (scrub via Phase Ø).",
                "annotation_name": "Playback Mode",
                "id": "obj-play-mode",
                "maxclass": "live.tab",
                "num_lines_patching": 1,
                "num_lines_presentation": 1,
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", "float"],
                "parameter_enable": 1,
                "patching_rect": [550.0, 150.0, 144.0, 16.0],
                "presentation": 1,
                "presentation_rect": [287.0, 88.0, 142.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Playback Mode",
                        "parameter_enum": ["Loop", "1-Shot", "Manual"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "PlayMode",
                        "parameter_mmax": 2,
                        "parameter_shortname": "PlayMode",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9
                    }
                },
                "spacing_x": 4.0,
                "varname": "PlayMode"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-playmode",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [550.0, 175.0, 96.0, 20.0],
                "text": "prepend playmode"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-play-map",
                "maxclass": "newobj",
                "numinlets": 4,
                "numoutlets": 4,
                "outlettype": ["bang", "bang", "bang", ""],
                "patching_rect": [450.0, 150.0, 56.0, 20.0],
                "text": "sel 0 1 2"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sel-loop",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [450.0, 175.0, 29.5, 20.0],
                "text": "1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sel-oneshot",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [482.0, 175.0, 29.5, 20.0],
                "text": "2"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sel-manual",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [514.0, 175.0, 29.5, 20.0],
                "text": "0"
            }
        },

        # Bottom Row: Rate Dial + Connecting Tick Line + Stacked Hz / Metronome Buttons + Depth Dial
        {
            "box": {
                "activedialcolor": [0.0, 0.824, 0.91, 1.0],
                "annotation": "Sets the LFO frequency in Hz when in Free (Hz) mode.",
                "annotation_name": "Rate",
                "hidden": 1,
                "id": "obj-rate-hz",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [500.0, 30.0, 44.0, 48.0],
                "presentation": 1,
                "presentation_rect": [289.0, 110.0, 44.0, 48.0],
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
                "activedialcolor": [0.0, 0.824, 0.91, 1.0],
                "annotation": "Sets the tempo-synced LFO rate in beat divisions (aligned to Ableton Live's timeline).",
                "annotation_name": "Synced Rate",
                "hidden": 0,
                "id": "obj-rate-sync",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [550.0, 30.0, 44.0, 48.0],
                "presentation": 1,
                "presentation_rect": [289.0, 110.0, 44.0, 48.0],
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
                "border": 0,
                "id": "obj-rate-line",
                "linecolor": [0.08, 0.10, 0.12, 1.0],
                "maxclass": "live.line",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [595.0, 50.0, 8.0, 4.0],
                "presentation": 1,
                "presentation_rect": [334.0, 136.0, 6.0, 4.0]
            }
        },
        {
            "box": {
                "activebgcolor": [0.067, 0.086, 0.11, 1.0],
                "activebgoncolor": [1.0, 0.678, 0.22, 1.0],
                "annotation": "Switches LFO rate between Free (Hz) and Timeline-Synced (Beat) divisions.",
                "annotation_name": "Rate Mode",
                "id": "obj-rate-mode",
                "maxclass": "live.tab",
                "num_lines_patching": 2,
                "num_lines_presentation": 2,
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", "float"],
                "parameter_enable": 1,
                "patching_rect": [600.0, 30.0, 20.0, 30.0],
                "pictures": ["lfo-free-icon.svg", "lfo-beat-icon.svg"],
                "presentation": 1,
                "presentation_rect": [342.0, 120.0, 20.0, 29.0],
                "remapsvgcolors": 1,
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Rate Mode",
                        "parameter_enum": ["Hz", "Sync"],
                        "parameter_initial": [1],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "RateMode",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Mode",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9
                    }
                },
                "spacing_y": 3.0,
                "usepicture": 1,
                "usesvgviewbox": 1,
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
                "patching_rect": [600.0, 72.0, 30.0, 20.0],
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
                "patching_rect": [500.0, 96.0, 58.0, 20.0],
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
                "patching_rect": [565.0, 96.0, 58.0, 20.0],
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
                "patching_rect": [500.0, 122.0, 82.0, 20.0],
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
                "patching_rect": [585.0, 122.0, 92.0, 20.0],
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
                "patching_rect": [680.0, 122.0, 95.0, 20.0],
                "text": "prepend ratemode"
            }
        },
        {
            "box": {
                "activedialcolor": [0.0, 0.824, 0.91, 1.0],
                "annotation": "Scales the overall amplitude of the MSEG modulation.",
                "annotation_name": "Depth",
                "id": "obj-depth",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [640.0, 30.0, 44.0, 48.0],
                "presentation": 1,
                "presentation_rect": [378.0, 110.0, 44.0, 48.0],
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

        # --- 8. Audio-Rate MSP Signal Chain (with Loop Start/End Phase Windowing & Timeline Sync) ---
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
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-route-loop",
                "maxclass": "newobj",
                "numinlets": 6,
                "numoutlets": 6,
                "outlettype": ["", "", "", "", "", ""],
                "patching_rect": [180.0, 380.0, 240.0, 20.0],
                "text": "route loop syncphase oneshotms grid_sync snap_sync"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-oneshot-pack",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [365.0, 200.0, 62.0, 20.0],
                "text": "pack b 500."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-oneshot-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [365.0, 224.0, 56.0, 20.0],
                "text": "0., 1. $2"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-oneshot-line",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "bang"],
                "patching_rect": [365.0, 248.0, 48.0, 20.0],
                "text": "line~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-play-sel",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [295.0, 242.0, 68.0, 20.0],
                "text": "selector~ 2 1"
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
                "patching_rect": [640.0, 90.0, 38.0, 20.0],
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

        # --- 9. Device-State Click Guard ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-thisdevice",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["bang", "int", "int"],
                "patching_rect": [750.0, 30.0, 78.0, 20.0],
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
                "patching_rect": [780.0, 58.0, 30.0, 20.0],
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
                "patching_rect": [780.0, 84.0, 76.0, 20.0],
                "text": "ignoreclick $1"
            }
        }
    ]

    lines = [
        # Audio pass-through
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-plugout", 1]}},

        # Buffer initialization & Keyboard routing
        {"patchline": {"source": ["obj-loadbuf", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-key", 0], "destination": ["obj-key-pack", 0]}},
        {"patchline": {"source": ["obj-key", 2], "destination": ["obj-key-pack", 1]}},
        {"patchline": {"source": ["obj-key-pack", 0], "destination": ["obj-key-prep", 0]}},
        {"patchline": {"source": ["obj-key-prep", 0], "destination": ["obj-mseg", 0]}},

        # Host Timeline Sync (plugsync~: transport, bpm, 1-PPQ ticks)
        {"patchline": {"source": ["obj-sync", 0], "destination": ["obj-sync-chg", 0]}},
        {"patchline": {"source": ["obj-sync-chg", 0], "destination": ["obj-transport-prep", 0]}},
        {"patchline": {"source": ["obj-transport-prep", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-sync", 5], "destination": ["obj-bpm-chg", 0]}},
        {"patchline": {"source": ["obj-bpm-chg", 0], "destination": ["obj-bpm-prep", 0]}},
        {"patchline": {"source": ["obj-bpm-prep", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-sync", 6], "destination": ["obj-ticks-chg", 0]}},
        {"patchline": {"source": ["obj-ticks-chg", 0], "destination": ["obj-ticks-prep", 0]}},
        {"patchline": {"source": ["obj-ticks-prep", 0], "destination": ["obj-mseg", 0]}},

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

        # Multimap Show/Hide Toggle: hides MSEG + Grid + Snap when open, shows Slots 2..8 + Headers
        {"patchline": {"source": ["obj-expand-map", 0], "destination": ["obj-hide-mseg-msg", 0], "order": 8}},
        {"patchline": {"source": ["obj-expand-map", 0], "destination": ["obj-expand-inv", 0], "order": 7}},
        {"patchline": {"source": ["obj-hide-mseg-msg", 0], "destination": ["obj-mseg", 0], "order": 3}},
        {"patchline": {"source": ["obj-hide-mseg-msg", 0], "destination": ["obj-grid-lbl", 0], "order": 2}},
        {"patchline": {"source": ["obj-hide-mseg-msg", 0], "destination": ["obj-grid", 0], "order": 1}},
        {"patchline": {"source": ["obj-hide-mseg-msg", 0], "destination": ["obj-snap-btn", 0], "order": 0}},
        {"patchline": {"source": ["obj-expand-inv", 0], "destination": ["obj-hide-hdrs-msg", 0]}},
        {"patchline": {"source": ["obj-hide-hdrs-msg", 0], "destination": ["obj-hdr-targets", 0], "order": 2}},
        {"patchline": {"source": ["obj-hide-hdrs-msg", 0], "destination": ["obj-hdr-mode", 0], "order": 1}},
        {"patchline": {"source": ["obj-hide-hdrs-msg", 0], "destination": ["obj-hdr-range", 0], "order": 0}},

        # PlayMode (0=Loop, 1=1-Shot, 2=Manual) routing
        {"patchline": {"source": ["obj-play-mode", 0], "destination": ["obj-prep-playmode", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-playmode", 0], "destination": ["obj-mseg", 0]}},
        {"patchline": {"source": ["obj-play-mode", 0], "destination": ["obj-play-map", 0], "order": 1}},
        {"patchline": {"source": ["obj-play-map", 0], "destination": ["obj-sel-loop", 0]}},
        {"patchline": {"source": ["obj-play-map", 1], "destination": ["obj-sel-oneshot", 0]}},
        {"patchline": {"source": ["obj-play-map", 2], "destination": ["obj-sel-manual", 0]}},
        {"patchline": {"source": ["obj-sel-loop", 0], "destination": ["obj-play-sel", 0]}},
        {"patchline": {"source": ["obj-sel-oneshot", 0], "destination": ["obj-play-sel", 0]}},
        {"patchline": {"source": ["obj-sel-manual", 0], "destination": ["obj-play-sel", 0]}},

        # v8ui outlet 0 (loop start/span, timeline syncphase, oneshotms, grid_sync, snap_sync)
        {"patchline": {"source": ["obj-mseg", 0], "destination": ["obj-route-loop", 0]}},
        {"patchline": {"source": ["obj-route-loop", 0], "destination": ["obj-unpack-loop", 0]}},
        {"patchline": {"source": ["obj-route-loop", 1], "destination": ["obj-phasor", 1]}},
        {"patchline": {"source": ["obj-route-loop", 2], "destination": ["obj-oneshot-pack", 1]}},
        {"patchline": {"source": ["obj-route-loop", 3], "destination": ["obj-grid-set", 0]}},
        {"patchline": {"source": ["obj-grid-set", 0], "destination": ["obj-grid", 0]}},
        {"patchline": {"source": ["obj-route-loop", 4], "destination": ["obj-snap-set", 0]}},
        {"patchline": {"source": ["obj-snap-set", 0], "destination": ["obj-snap-btn", 0]}},
        {"patchline": {"source": ["obj-unpack-loop", 0], "destination": ["obj-loop-add", 1]}},
        {"patchline": {"source": ["obj-unpack-loop", 1], "destination": ["obj-loop-mul", 1]}},

        # v8ui outlet 1 (freq Hz) -> phasor~
        {"patchline": {"source": ["obj-mseg", 1], "destination": ["obj-phasor", 0]}},

        # Retrigger & Phase offset -> Loop Windowing
        {"patchline": {"source": ["obj-retrig", 0], "destination": ["obj-retrig-msg", 0], "order": 1}},
        {"patchline": {"source": ["obj-retrig", 0], "destination": ["obj-oneshot-pack", 0], "order": 0}},
        {"patchline": {"source": ["obj-oneshot-pack", 0], "destination": ["obj-oneshot-msg", 0]}},
        {"patchline": {"source": ["obj-oneshot-msg", 0], "destination": ["obj-oneshot-line", 0]}},
        {"patchline": {"source": ["obj-retrig-msg", 0], "destination": ["obj-phasor", 1]}},
        {"patchline": {"source": ["obj-phasor", 0], "destination": ["obj-play-sel", 1]}},
        {"patchline": {"source": ["obj-oneshot-line", 0], "destination": ["obj-play-sel", 2]}},
        {"patchline": {"source": ["obj-phase", 0], "destination": ["obj-phase-div", 0]}},
        {"patchline": {"source": ["obj-play-sel", 0], "destination": ["obj-phase-add", 0]}},
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
        "obj-offset": ["Offset", "Offset", 0],
        "obj-play-mode": ["PlayMode", "PlayMode", 0],
        "obj-expand-map": ["ShowModPanel", "Multimap", 0]
    }

    # --- Generate 8 Modulation Mapping Slots inside Left Panel (x = 12..255) ---
    # Slot 1 (y = 8) is always visible at the top of the Left Panel.
    # Slots 2..8 (y = 24.5 .. 123.5) are hidden when ShowModPanel == 0 (MSEG View) and visible when ShowModPanel == 1.
    for i in range(8):
        slot_num = i + 1
        row_y = 8.0 + i * 16.5
        patch_y = 160.0 + i * 55.0
        is_slot_1 = (slot_num == 1)

        map_id = f"obj-map-btn-{slot_num}"
        unmap_id = f"obj-unmap-btn-{slot_num}"
        mode_id = f"obj-mod-mode-{slot_num}"
        bip_id = f"obj-bipolar-{slot_num}"
        amt_id = f"obj-mod-amt-{slot_num}"
        min_id = f"obj-min-{slot_num}"
        max_id = f"obj-max-{slot_num}"
        sub_id = f"obj-map-sub-{slot_num}"

        boxes.extend([
            {
                "box": {
                    "activebgcolor": [0.047, 0.067, 0.086, 1.0],
                    "activebgoncolor": [0.047, 0.067, 0.086, 1.0],
                    "activetextcolor": [1.0, 0.678, 0.22, 1.0],
                    "activetextoncolor": [1.0, 0.678, 0.22, 1.0],
                    "annotation": f"Slot {slot_num}: Click Map, then click any Ableton Live parameter to modulate it.",
                    "annotation_name": f"Map {slot_num}",
                    "appearance": 2,
                    "bgcolor": [0.047, 0.067, 0.086, 1.0],
                    "bgoncolor": [0.047, 0.067, 0.086, 1.0],
                    "bordercolor": [1.0, 0.678, 0.22, 1.0],
                    "focusbordercolor": [0.549, 0.549, 0.549, 1.0],
                    "hidden": 0 if is_slot_1 else 1,
                    "id": map_id,
                    "maxclass": "live.text",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", ""],
                    "parameter_enable": 1,
                    "patching_rect": [700.0, patch_y, 76.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [12.0, row_y, 76.0, 15.0],
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
                    "textcolor": [0.85, 0.88, 0.92, 1.0],
                    "textoffcolor": [0.85, 0.88, 0.92, 1.0],
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
                    "presentation_rect": [91.0, row_y, 15.0, 15.0],
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
                    "activebgcolor": [0.0, 0.78, 0.88, 1.0],
                    "activebgoncolor": [0.067, 0.086, 0.11, 1.0],
                    "activetextcolor": [0.047, 0.067, 0.086, 1.0],
                    "activetextoncolor": [1.0, 0.678, 0.22, 1.0],
                    "annotation": f"Slot {slot_num} Mapping Mode: 'Mod' = Modern Relative Modulation (shows ± and %); 'Remote' = Legacy Takeover (shows Min % and Max %).",
                    "annotation_name": f"Modulation Mode {slot_num}",
                    "bordercolor": [0.0, 0.78, 0.88, 1.0],
                    "hidden": 0 if is_slot_1 else 1,
                    "id": mode_id,
                    "maxclass": "live.text",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", ""],
                    "parameter_enable": 1,
                    "patching_rect": [800.0, patch_y, 46.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [112.0, row_y, 46.0, 15.0],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_annotation_name": f"Modulation Mode {slot_num}",
                            "parameter_enum": ["Mod", "Remote"],
                            "parameter_initial": [0],
                            "parameter_initial_enable": 1,
                            "parameter_linknames": 1,
                            "parameter_longname": f"ModMode[{slot_num}]",
                            "parameter_mmax": 1,
                            "parameter_shortname": f"Mode {slot_num}",
                            "parameter_type": 2
                        }
                    },
                    "text": "Mod",
                    "textcolor": [0.047, 0.067, 0.086, 1.0],
                    "textoffcolor": [0.047, 0.067, 0.086, 1.0],
                    "texton": "Remote",
                    "varname": f"ModMode[{slot_num}]"
                }
            },
            # Modern Mod Mode Controls: Square [ ± ] Bipolar toggle + single 50 % ModAmount numbox
            {
                "box": {
                    "activebgcolor": [0.047, 0.067, 0.086, 1.0],
                    "activebgoncolor": [0.047, 0.067, 0.086, 1.0],
                    "activetextcolor": [0.0, 0.78, 0.88, 1.0],
                    "activetextoncolor": [0.0, 0.78, 0.88, 1.0],
                    "annotation": f"Slot {slot_num} Polarity in Mod mode: '+' = Unipolar (0 to Amount); '±' = Bipolar (-Amount to +Amount).",
                    "annotation_name": f"Bipolar {slot_num}",
                    "bordercolor": [0.0, 0.78, 0.88, 1.0],
                    "hidden": 0 if is_slot_1 else 1,
                    "id": bip_id,
                    "maxclass": "live.text",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", ""],
                    "parameter_enable": 1,
                    "patching_rect": [850.0, patch_y, 15.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [163.0, row_y, 15.0, 15.0],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_annotation_name": f"Bipolar {slot_num}",
                            "parameter_enum": ["Uni", "Bip"],
                            "parameter_initial": [1],
                            "parameter_initial_enable": 1,
                            "parameter_linknames": 1,
                            "parameter_longname": f"Bipolar[{slot_num}]",
                            "parameter_mmax": 1,
                            "parameter_shortname": f"Pol {slot_num}",
                            "parameter_type": 2
                        }
                    },
                    "text": "+",
                    "textcolor": [0.0, 0.78, 0.88, 1.0],
                    "textoffcolor": [0.0, 0.78, 0.88, 1.0],
                    "texton": "±",
                    "varname": f"Bipolar[{slot_num}]"
                }
            },
            {
                "box": {
                    "activebgcolor": [0.047, 0.067, 0.086, 0.0],
                    "activeslidercolor": [0.0, 0.78, 0.88, 1.0],
                    "activetricolor2": [0.0, 0.78, 0.88, 1.0],
                    "annotation": f"Modulation depth percentage for Slot {slot_num} in Mod mode (-100% to +100%).",
                    "annotation_name": f"Amount {slot_num}",
                    "appearance": 4,
                    "focusbordercolor": [0.0, 0.78, 0.88, 1.0],
                    "hidden": 0 if is_slot_1 else 1,
                    "id": amt_id,
                    "maxclass": "live.numbox",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", "float"],
                    "parameter_enable": 1,
                    "patching_rect": [870.0, patch_y, 44.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [188.0, row_y, 44.0, 15.0],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_annotation_name": f"Amount {slot_num}",
                            "parameter_initial": [50.0],
                            "parameter_initial_enable": 1,
                            "parameter_linknames": 1,
                            "parameter_longname": f"ModAmount[{slot_num}]",
                            "parameter_mmax": 100.0,
                            "parameter_mmin": -100.0,
                            "parameter_shortname": f"Amt {slot_num}",
                            "parameter_type": 0,
                            "parameter_unitstyle": 5
                        }
                    },
                    "textcolor": [0.0, 0.78, 0.88, 1.0],
                    "varname": f"ModAmount[{slot_num}]"
                }
            },
            # Legacy Takeover (Remote) Mode Controls: Min % + Max %
            {
                "box": {
                    "activebgcolor": [0.047, 0.067, 0.086, 0.0],
                    "activeslidercolor": [1.0, 0.678, 0.22, 1.0],
                    "activetricolor2": [1.0, 0.678, 0.22, 1.0],
                    "annotation": f"Minimum takeover value for Slot {slot_num} in Remote mode.",
                    "annotation_name": f"Min {slot_num}",
                    "appearance": 4,
                    "focusbordercolor": [1.0, 0.678, 0.22, 1.0],
                    "hidden": 1,
                    "id": min_id,
                    "maxclass": "live.numbox",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", "float"],
                    "parameter_enable": 1,
                    "patching_rect": [825.0, patch_y + 22.0, 38.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [163.0, row_y, 38.0, 15.0],
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
                    "textcolor": [1.0, 0.678, 0.22, 1.0],
                    "varname": f"TargetMin[{slot_num}]"
                }
            },
            {
                "box": {
                    "activebgcolor": [0.047, 0.067, 0.086, 0.0],
                    "activeslidercolor": [1.0, 0.678, 0.22, 1.0],
                    "activetricolor2": [1.0, 0.678, 0.22, 1.0],
                    "annotation": f"Maximum takeover value for Slot {slot_num} in Remote mode.",
                    "annotation_name": f"Max {slot_num}",
                    "appearance": 4,
                    "focusbordercolor": [1.0, 0.678, 0.22, 1.0],
                    "hidden": 1,
                    "id": max_id,
                    "maxclass": "live.numbox",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", "float"],
                    "parameter_enable": 1,
                    "patching_rect": [868.0, patch_y + 22.0, 40.0, 15.0],
                    "presentation": 1,
                    "presentation_rect": [205.0, row_y, 40.0, 15.0],
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
                    "textcolor": [1.0, 0.678, 0.22, 1.0],
                    "varname": f"TargetMax[{slot_num}]"
                }
            },
            {
                "box": {
                    "color": [1.0, 0.694118, 0.0, 1.0],
                    "id": sub_id,
                    "maxclass": "newobj",
                    "numinlets": 8,
                    "numoutlets": 2,
                    "outlettype": ["int", "int"],
                    "patcher": make_slot_map_subpatcher(p_map_template, slot_num),
                    "patching_rect": [925.0, patch_y, 150.0, 20.0],
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
            }
        ])

        lines.extend([
            {"patchline": {"source": ["obj-final-clip", 0], "destination": [sub_id, 0], "order": i}},
            {"patchline": {"source": [min_id, 1], "destination": [sub_id, 1]}},
            {"patchline": {"source": [max_id, 1], "destination": [sub_id, 2]}},
            {"patchline": {"source": [unmap_id, 0], "destination": [sub_id, 3]}},
            {"patchline": {"source": [map_id, 0], "destination": [sub_id, 4]}},
            {"patchline": {"source": [mode_id, 0], "destination": [sub_id, 5], "order": 0}},
            {"patchline": {"source": [bip_id, 0], "destination": [sub_id, 6]}},
            {"patchline": {"source": [amt_id, 0], "destination": [sub_id, 7]}},
            {"patchline": {"source": [sub_id, 1], "destination": [map_id, 0]}},
            {"patchline": {"source": ["obj-dev-ig", 0], "destination": [map_id, 0], "order": i * 2}},
            {"patchline": {"source": ["obj-dev-ig", 0], "destination": [unmap_id, 0], "order": i * 2 + 1}}
        ])

        if is_slot_1:
            # Slot 1 is always visible at the top of the Left Panel; only Mod vs Remote toggles its range widgets
            inv_id = "obj-unmap-inv-1"
            hide_id = "obj-unmap-hide-1"
            mode_inv_id = "obj-mode-inv-1"
            hide_rmt_id = "obj-hide-rmt-1"
            hide_mod_id = "obj-hide-mod-1"
            boxes.extend([
                {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": inv_id, "maxclass": "newobj", "numinlets": 2, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [1085.0, patch_y, 30.0, 20.0], "text": "!- 1"}},
                {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": hide_id, "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1120.0, patch_y, 58.0, 20.0], "text": "hidden $1"}},
                {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": mode_inv_id, "maxclass": "newobj", "numinlets": 2, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [1085.0, patch_y + 22.0, 30.0, 20.0], "text": "!- 1"}},
                {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": hide_rmt_id, "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1120.0, patch_y + 22.0, 58.0, 20.0], "text": "hidden $1"}},
                {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": hide_mod_id, "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1185.0, patch_y + 22.0, 58.0, 20.0], "text": "hidden $1"}}
            ])
            lines.extend([
                {"patchline": {"source": [sub_id, 0], "destination": [inv_id, 0]}},
                {"patchline": {"source": [inv_id, 0], "destination": [hide_id, 0]}},
                {"patchline": {"source": [hide_id, 0], "destination": [unmap_id, 0]}},
                {"patchline": {"source": [mode_id, 0], "destination": [hide_mod_id, 0], "order": 1}},
                {"patchline": {"source": [mode_id, 0], "destination": [mode_inv_id, 0], "order": 2}},
                {"patchline": {"source": [mode_inv_id, 0], "destination": [hide_rmt_id, 0]}},
                {"patchline": {"source": [hide_mod_id, 0], "destination": [bip_id, 0], "order": 1}},
                {"patchline": {"source": [hide_mod_id, 0], "destination": [amt_id, 0], "order": 0}},
                {"patchline": {"source": [hide_rmt_id, 0], "destination": [min_id, 0], "order": 1}},
                {"patchline": {"source": [hide_rmt_id, 0], "destination": [max_id, 0], "order": 0}}
            ])
        else:
            # Slots 2..8 visibility gated by both ShowModPanel (obj-expand-map) and ModMode[slot_num]
            vis_id = f"obj-slot-vis-{slot_num}"
            boxes.append({
                "box": {
                    "id": vis_id,
                    "maxclass": "newobj",
                    "numinlets": 3,
                    "numoutlets": 4,
                    "outlettype": ["", "", "", ""],
                    "patcher": make_slot_vis_subpatcher(),
                    "patching_rect": [1085.0, patch_y, 95.0, 20.0],
                    "saved_object_attributes": {"globalpatchername": ""},
                    "text": f"p SlotVis_{slot_num}"
                }
            })
            lines.extend([
                {"patchline": {"source": ["obj-expand-map", 0], "destination": [vis_id, 0], "order": slot_num - 2}},
                {"patchline": {"source": [mode_id, 0], "destination": [vis_id, 1], "order": 1}},
                {"patchline": {"source": [sub_id, 0], "destination": [vis_id, 2]}},
                {"patchline": {"source": [vis_id, 0], "destination": [map_id, 0], "order": 1}},
                {"patchline": {"source": [vis_id, 0], "destination": [mode_id, 0], "order": 0}},
                {"patchline": {"source": [vis_id, 1], "destination": [bip_id, 0], "order": 1}},
                {"patchline": {"source": [vis_id, 1], "destination": [amt_id, 0], "order": 0}},
                {"patchline": {"source": [vis_id, 2], "destination": [min_id, 0], "order": 1}},
                {"patchline": {"source": [vis_id, 2], "destination": [max_id, 0], "order": 0}},
                {"patchline": {"source": [vis_id, 3], "destination": [unmap_id, 0]}}
            ])

        parameters_dict[map_id] = [f"Map[{slot_num}]", f"Map {slot_num}", 0]
        parameters_dict[unmap_id] = [f"Unmap[{slot_num}]", f"Unmap {slot_num}", 0]
        parameters_dict[mode_id] = [f"ModMode[{slot_num}]", f"Mode {slot_num}", 0]
        parameters_dict[bip_id] = [f"Bipolar[{slot_num}]", f"Pol {slot_num}", 0]
        parameters_dict[amt_id] = [f"ModAmount[{slot_num}]", f"Amt {slot_num}", 0]
        parameters_dict[min_id] = [f"TargetMin[{slot_num}]", f"Min {slot_num}", 0]
        parameters_dict[max_id] = [f"TargetMax[{slot_num}]", f"Max {slot_num}", 0]

    # --- 10. Presentation Background Panels (2-Panel Native Shaper Footprint: 436 x 169 px) ---
    boxes.extend([
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.047, 0.067, 0.086, 1.0],
                "border": 1,
                "bordercolor": [0.03, 0.04, 0.05, 1.0],
                "id": "obj-panel-left",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 500.0, 120.0, 40.0],
                "presentation": 1,
                "presentation_rect": [6.0, 5.0, 272.0, 159.0],
                "proportion": 0.5,
                "rounded": 4
            }
        },
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.047, 0.067, 0.086, 1.0],
                "border": 1,
                "bordercolor": [0.03, 0.04, 0.05, 1.0],
                "id": "obj-panel-scope",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [160.0, 500.0, 120.0, 40.0],
                "presentation": 1,
                "presentation_rect": [282.0, 5.0, 150.0, 77.0],
                "proportion": 0.5,
                "rounded": 4
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
            "rect": [60.0, 80.0, 1260.0, 680.0],
            "openrect": [0.0, 0.0, 436.0, 169.0],
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
            "devicewidth": 436.0,
            "description": "Shaper modulator with Bitwig-style MSEG editor and 8-slot modulation matrix",
            "digest": "Bitwig-style MSEG Shaper for Max for Live",
            "tags": "max for live modulator mseg shaper bitwig",
            "style": "",
            "subpatcher_template": "",
            "title": "Better Shaper",
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters_dict,
            "dependency_cache": [
                {
                    "name": "multimap-unmap.svg",
                    "bootpath": "C74:/packages/Max for Live/media",
                    "type": "svg",
                    "implicit": 1
                },
                {
                    "name": "multimap-closed-off.svg",
                    "bootpath": "C74:/packages/Max for Live/media",
                    "type": "svg",
                    "implicit": 1
                },
                {
                    "name": "multimap-open-off.svg",
                    "bootpath": "C74:/packages/Max for Live/media",
                    "type": "svg",
                    "implicit": 1
                },
                {
                    "name": "lfo-free-icon.svg",
                    "bootpath": "C74:/packages/Max for Live/media",
                    "type": "svg",
                    "implicit": 1
                },
                {
                    "name": "lfo-beat-icon.svg",
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

    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import theme_common as tc
    tc.inject_theme_support(patcher_doc, "better_shaper")

    json_bytes = json.dumps(patcher_doc, indent="\t").encode("utf-8") + b"\n"

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
