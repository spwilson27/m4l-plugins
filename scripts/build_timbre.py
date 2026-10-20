#!/usr/bin/env python3
"""
Build devices/Timbre Follower A.amxd, B.amxd and C.amxd (Max Audio Effect, analysis only, zero latency).

One DSP core (`src/cepstrum_lib.genexpr` + `src/timbre_core.genexpr`), one v8ui script (`src/timbre_ui.js`),
one parameter set; three layouts. The layout letter is prepended to the v8ui script as `TIMBRE_LAYOUT`.

  A  "Fingerprint"  440 x 169  heatmap hero (270 x 110 canvas), value bars on the right, slot strip below
  B  "Utility"      264 x 169  Envelope-Follower style: 184 x 58 trace canvas, Mode tab, four dials, slot rows
  C  "Performance"  412 x 169  one big novelty curve (396 x 80) with a draggable threshold, big Mode and Sens

Audio: plugin~ -> gen.codebox~ -> plugout~ (out1/out2 are in1/in2 untouched). The 0..1 control signal (gen out3)
feeds two mapping slots, each Better Shaper's `p Map` (live.map + live.modulate~ / live.remote~ @normalized 1),
reused through scripts/build_shaper.py.

Usage: python3 scripts/build_timbre.py [--variant a|b|c]     (no argument builds all three)
"""

import argparse
import copy
import json
import os
import struct
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_shaper as shaper  # noqa: E402  (make_slot_map_subpatcher, CLIPPING_PATH)

LIB_PATH = os.path.join(ROOT_DIR, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT_DIR, "src", "timbre_core.genexpr")
UI_PATH = os.path.join(ROOT_DIR, "src", "timbre_ui.js")
DEVICES_DIR = os.path.join(ROOT_DIR, "devices")

DEVICE_H = 169.0
BG_DARK = (0.040, 0.044, 0.072)

AMBER = (1.0, 0.72, 0.22)
CYAN = (0.36, 0.90, 0.95)
VIOLET = (0.66, 0.52, 1.0)
PINK = (0.93, 0.36, 0.72)
SLOT_COLORS = [(0.42, 0.95, 0.68), (1.0, 0.52, 0.48)]
MOD_CYAN = (0.0, 0.78, 0.88)
REMOTE_AMBER = (1.0, 0.678, 0.22)


def blend_slider_color(accent, alpha=0.38):
    return [round(accent[i] * alpha + BG_DARK[i] * (1.0 - alpha), 4) for i in range(3)] + [1.0]


# key: long name, short name, min, max, initial, unit style (0 int, 2 ms, 5 %, 9 enum), exponent, annotation
PARAM_SPECS = {
    "sens": (
        "Sensitivity", "Sens", 0.0, 100.0, 50.0, 5, 1.0,
        "How big a timbre change must be to count. Sets the threshold line on the novelty curve (higher Sens = lower line).",
    ),
    "attack": (
        "Attack", "Attack", 1.0, 500.0, 8.0, 2, 3.0,
        "Env: time for the output to rise to 90 % of a change. Trig: rise time of the fixed pulse.",
    ),
    "release": (
        "Release", "Release", 5.0, 3000.0, 250.0, 2, 3.0,
        "Env: time to fall back to 10 %. Trig: fall time of the fixed pulse.",
    ),
    "focus": (
        "Focus", "Focus", -100.0, 100.0, 0.0, 5, 1.0,
        "Which timbre changes count. Negative: brightness and body (low-order MFCCs). Positive: texture and noisiness (high-order).",
    ),
}
GEN_MESSAGE = {"sens": "sens", "attack": "attack", "release": "release", "focus": "focus", "mode": "mode"}


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


def make_numbox(key, x, y, w, h, accent, bipolar=False, fontsize=8.5):
    long_name, _s, _lo, _hi, _i, _u, _e, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activebgcolor": [0.060, 0.066, 0.100, 1.0],
            "activeslidercolor": blend_slider_color(accent),
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": 3 if bipolar else 2,
            "bordercolor": [0.20, 0.22, 0.34, 1.0],
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 300.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "textcolor": [0.93, 0.95, 1.0, 1.0],
            "varname": long_name,
        }
    }


def make_dial(key, x, y, w, h, accent):
    long_name, _s, _lo, _hi, _i, _u, _e, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activedialcolor": [accent[0], accent[1], accent[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 300.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "varname": long_name,
        }
    }


def make_mode_tab(x, y, w, h, rows=1, fontsize=9.0):
    return {
        "box": {
            "activebgcolor": [0.070, 0.078, 0.120, 1.0],
            "activebgoncolor": [AMBER[0], AMBER[1], AMBER[2], 1.0],
            "activetextcolor": [0.85, 0.88, 0.94, 1.0],
            "activetextoncolor": [0.05, 0.05, 0.08, 1.0],
            "annotation": "Env: the output follows how much the timbre is changing. Trig: each peak of change fires one fixed Attack/Release pulse (rhythmic glitch modulation).",
            "annotation_name": "Mode",
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": "obj-ctrl-mode",
            "maxclass": "live.tab",
            "num_lines_patching": rows,
            "num_lines_presentation": rows,
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 300.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": "Mode",
                    "parameter_enum": ["Env", "Trig"],
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": "Mode",
                    "parameter_mmax": 1,
                    "parameter_shortname": "Mode",
                    "parameter_type": 2,
                    "parameter_unitstyle": 9,
                }
            },
            "spacing_x": 3.0,
            "spacing_y": 3.0,
            "varname": "Mode",
        }
    }


def make_label(obj_id, text, x, y, w, h=13.0, size=8.0, color=(0.62, 0.68, 0.80), align=0):
    return {
        "box": {
            "fontface": 1,
            "fontname": "Arial Bold",
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


def line(src, src_out, dst, dst_in=0, order=None):
    pl = {"destination": [dst, dst_in], "source": [src, src_out]}
    if order is not None:
        pl["order"] = order
    return {"patchline": pl}


# ------------------------------------------------------------------------------------------------
# Mapping slot (Better Shaper's pattern: Map / Unmap / Mode / Bipolar + Amount or Min + Max)
# ------------------------------------------------------------------------------------------------
def slot_widths(style):
    if style == "wide":
        return dict(map=80, unmap=14, mode=40, bip=15, amt=46, rng=40)
    if style == "mid":
        return dict(map=68, unmap=14, mode=36, bip=14, amt=40, rng=36)
    return dict(map=62, unmap=14, mode=34, bip=14, amt=36, rng=34)


def slot_span(style):
    w = slot_widths(style)
    return w["map"] + 2 + w["unmap"] + 2 + w["mode"] + 2 + w["rng"] + 2 + w["rng"]


def make_slot(template, slot_num, x, y, style):
    """Returns (boxes, lines, parameters) for mapping slot `slot_num` (1 or 2) with its left edge at x."""
    wd = slot_widths(style)
    accent = SLOT_COLORS[slot_num - 1]
    patch_y = 400.0 + (slot_num - 1) * 60.0
    map_id = f"obj-map-btn-{slot_num}"
    unmap_id = f"obj-unmap-btn-{slot_num}"
    mode_id = f"obj-mod-mode-{slot_num}"
    bip_id = f"obj-bipolar-{slot_num}"
    amt_id = f"obj-mod-amt-{slot_num}"
    min_id = f"obj-min-{slot_num}"
    max_id = f"obj-max-{slot_num}"
    sub_id = f"obj-map-sub-{slot_num}"
    x_map = x
    x_unmap = x_map + wd["map"] + 2
    x_mode = x_unmap + wd["unmap"] + 2
    x_r1 = x_mode + wd["mode"] + 2
    h = 15.0
    base_dark = [0.047, 0.067, 0.086, 1.0]

    boxes = [
        {"box": {
            "activebgcolor": base_dark, "activebgoncolor": base_dark,
            "activetextcolor": [0.90, 0.93, 0.98, 1.0], "activetextoncolor": [accent[0], accent[1], accent[2], 1.0],
            "annotation": f"Slot {slot_num}: click Map, then click any Ableton Live parameter to modulate it with the timbre-change signal.",
            "annotation_name": f"Map {slot_num}",
            "appearance": 2,
            "bgcolor": base_dark, "bgoncolor": base_dark,
            "bordercolor": [accent[0], accent[1], accent[2], 1.0],
            "focusbordercolor": [0.549, 0.549, 0.549, 1.0],
            "fontsize": 8.5,
            "id": map_id, "maxclass": "live.text", "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [700.0, patch_y, float(wd["map"]), h],
            "presentation": 1, "presentation_rect": [float(x_map), float(y), float(wd["map"]), h],
            "saved_attribute_attributes": {"valueof": {
                "parameter_annotation_name": f"Map {slot_num}", "parameter_enum": ["val1", "val2"], "parameter_invisible": 2,
                "parameter_longname": f"Map[{slot_num}]", "parameter_mmax": 1, "parameter_shortname": f"Map {slot_num}",
                "parameter_type": 2}},
            "text": "Map", "textcolor": [0.85, 0.88, 0.92, 1.0], "textoffcolor": [0.85, 0.88, 0.92, 1.0], "texton": "Map",
            "varname": f"Map[{slot_num}]",
        }},
        {"box": {
            "annotation": f"Unmaps Slot {slot_num}.", "annotation_name": f"Unmap {slot_num}", "appearance": 2, "fontsize": 6.0,
            "hidden": 1, "id": unmap_id, "maxclass": "live.text", "mode": 0, "numinlets": 1, "numoutlets": 2,
            "outlettype": ["", ""], "parameter_enable": 1,
            "patching_rect": [780.0, patch_y, float(wd["unmap"]), h],
            "pictures": ["multimap-unmap.svg", "multimap-unmap.svg"],
            "presentation": 1, "presentation_rect": [float(x_unmap), float(y), float(wd["unmap"]), h],
            "remapsvgcolors": 1,
            "saved_attribute_attributes": {"valueof": {
                "parameter_annotation_name": f"Unmap {slot_num}", "parameter_enum": ["val1", "val2"], "parameter_invisible": 2,
                "parameter_longname": f"Unmap[{slot_num}]", "parameter_mmax": 1, "parameter_shortname": f"Unmap {slot_num}",
                "parameter_type": 2}},
            "text": "X", "texton": "x", "usepicture": 1, "usesvgviewbox": 1, "varname": f"Unmap[{slot_num}]",
        }},
        {"box": {
            "activebgcolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0], "activebgoncolor": [0.067, 0.086, 0.11, 1.0],
            "activetextcolor": [0.047, 0.067, 0.086, 1.0], "activetextoncolor": [REMOTE_AMBER[0], REMOTE_AMBER[1], REMOTE_AMBER[2], 1.0],
            "annotation": f"Slot {slot_num} mapping mode: 'Mod' = relative modulation (shows polarity and %); 'Remote' = takeover (shows Min % and Max %).",
            "annotation_name": f"Modulation Mode {slot_num}",
            "bordercolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "fontsize": 8.5,
            "id": mode_id, "maxclass": "live.text", "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""],
            "parameter_enable": 1, "patching_rect": [800.0, patch_y, float(wd["mode"]), h],
            "presentation": 1, "presentation_rect": [float(x_mode), float(y), float(wd["mode"]), h],
            "saved_attribute_attributes": {"valueof": {
                "parameter_annotation_name": f"Modulation Mode {slot_num}", "parameter_enum": ["Mod", "Remote"],
                "parameter_initial": [0], "parameter_initial_enable": 1, "parameter_linknames": 1,
                "parameter_longname": f"ModMode[{slot_num}]", "parameter_mmax": 1, "parameter_shortname": f"Mode {slot_num}",
                "parameter_type": 2}},
            "text": "Mod", "textcolor": [0.047, 0.067, 0.086, 1.0], "textoffcolor": [0.047, 0.067, 0.086, 1.0],
            "texton": "Remote", "varname": f"ModMode[{slot_num}]",
        }},
        {"box": {
            "activebgcolor": base_dark, "activebgoncolor": base_dark,
            "activetextcolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "activetextoncolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "annotation": f"Slot {slot_num} polarity in Mod mode: '+' = unipolar (0 to Amount); '±' = bipolar (-Amount to +Amount).",
            "annotation_name": f"Bipolar {slot_num}",
            "bordercolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "id": bip_id, "maxclass": "live.text", "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""],
            "parameter_enable": 1, "patching_rect": [850.0, patch_y, float(wd["bip"]), h],
            "presentation": 1, "presentation_rect": [float(x_r1), float(y), float(wd["bip"]), h],
            "saved_attribute_attributes": {"valueof": {
                "parameter_annotation_name": f"Bipolar {slot_num}", "parameter_enum": ["Uni", "Bip"],
                "parameter_initial": [1], "parameter_initial_enable": 1, "parameter_linknames": 1,
                "parameter_longname": f"Bipolar[{slot_num}]", "parameter_mmax": 1, "parameter_shortname": f"Pol {slot_num}",
                "parameter_type": 2}},
            "text": "+", "textcolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "textoffcolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0], "texton": "±", "varname": f"Bipolar[{slot_num}]",
        }},
        {"box": {
            "activebgcolor": [0.047, 0.067, 0.086, 0.0],
            "activeslidercolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "activetricolor2": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "annotation": f"Modulation depth for Slot {slot_num} in Mod mode (-100% to +100%).",
            "annotation_name": f"Amount {slot_num}", "appearance": 4,
            "focusbordercolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0],
            "id": amt_id, "maxclass": "live.numbox", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"],
            "parameter_enable": 1, "patching_rect": [870.0, patch_y, float(wd["amt"]), h],
            "presentation": 1,
            "presentation_rect": [float(x_r1 + wd["bip"] + 2), float(y), float(wd["amt"]), h],
            "saved_attribute_attributes": {"valueof": {
                "parameter_annotation_name": f"Amount {slot_num}", "parameter_initial": [50.0], "parameter_initial_enable": 1,
                "parameter_linknames": 1, "parameter_longname": f"ModAmount[{slot_num}]", "parameter_mmax": 100.0,
                "parameter_mmin": -100.0, "parameter_shortname": f"Amt {slot_num}", "parameter_type": 0,
                "parameter_unitstyle": 5}},
            "textcolor": [MOD_CYAN[0], MOD_CYAN[1], MOD_CYAN[2], 1.0], "varname": f"ModAmount[{slot_num}]",
        }},
    ]
    for key, label, pos, longname, init in (
        (min_id, "Min", x_r1, f"TargetMin[{slot_num}]", 0.0),
        (max_id, "Max", x_r1 + wd["rng"] + 2, f"TargetMax[{slot_num}]", 100.0),
    ):
        boxes.append({"box": {
            "activebgcolor": [0.047, 0.067, 0.086, 0.0],
            "activeslidercolor": [REMOTE_AMBER[0], REMOTE_AMBER[1], REMOTE_AMBER[2], 1.0],
            "activetricolor2": [REMOTE_AMBER[0], REMOTE_AMBER[1], REMOTE_AMBER[2], 1.0],
            "annotation": f"{'Minimum' if label == 'Min' else 'Maximum'} takeover value for Slot {slot_num} in Remote mode.",
            "annotation_name": f"{label} {slot_num}", "appearance": 4,
            "focusbordercolor": [REMOTE_AMBER[0], REMOTE_AMBER[1], REMOTE_AMBER[2], 1.0],
            "hidden": 1, "id": key, "maxclass": "live.numbox", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"],
            "parameter_enable": 1, "patching_rect": [825.0 + (45.0 if label == "Max" else 0.0), patch_y + 22.0, float(wd["rng"]), h],
            "presentation": 1, "presentation_rect": [float(pos), float(y), float(wd["rng"]), h],
            "saved_attribute_attributes": {"valueof": {
                "parameter_annotation_name": f"{label} {slot_num}", "parameter_initial": [init], "parameter_initial_enable": 1,
                "parameter_linknames": 1, "parameter_longname": longname, "parameter_mmax": 100.0, "parameter_mmin": 0.0,
                "parameter_shortname": f"{label} {slot_num}", "parameter_type": 0, "parameter_unitstyle": 5}},
            "textcolor": [REMOTE_AMBER[0], REMOTE_AMBER[1], REMOTE_AMBER[2], 1.0], "varname": longname,
        }})

    boxes.append({"box": {
        "color": [1.0, 0.694118, 0.0, 1.0], "id": sub_id, "maxclass": "newobj", "numinlets": 8, "numoutlets": 2,
        "outlettype": ["int", "int"],
        "patcher": shaper.make_slot_map_subpatcher(template, slot_num),
        "patching_rect": [925.0, patch_y, 150.0, 20.0],
        "saved_object_attributes": {"description": "", "digest": "", "editing_bgcolor": [0.560784, 0.560784, 0.560784, 1.0],
                                    "globalpatchername": "", "locked_bgcolor": [0.560784, 0.560784, 0.560784, 1.0], "tags": ""},
        "text": f"p Map_{slot_num}",
    }})

    # Slot visibility helpers (Better Shaper slot-1 pattern): unmap shows only while mapped, Mod vs Remote widgets
    inv_id = f"obj-unmap-inv-{slot_num}"
    hide_id = f"obj-unmap-hide-{slot_num}"
    mode_inv_id = f"obj-mode-inv-{slot_num}"
    hide_rmt_id = f"obj-hide-rmt-{slot_num}"
    hide_mod_id = f"obj-hide-mod-{slot_num}"
    name_route = f"obj-name-route-{slot_num}"
    name_prep = f"obj-name-prep-{slot_num}"
    mapped_prep = f"obj-mapped-prep-{slot_num}"
    ab = "Arial Bold"
    boxes.extend([
        {"box": {"fontname": ab, "fontsize": 10.0, "id": inv_id, "maxclass": "newobj", "numinlets": 2, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [1085.0, patch_y, 30.0, 20.0], "text": "!- 1"}},
        {"box": {"fontname": ab, "fontsize": 10.0, "id": hide_id, "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1120.0, patch_y, 58.0, 20.0], "text": "hidden $1"}},
        {"box": {"fontname": ab, "fontsize": 10.0, "id": mode_inv_id, "maxclass": "newobj", "numinlets": 2, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [1085.0, patch_y + 22.0, 30.0, 20.0], "text": "!- 1"}},
        {"box": {"fontname": ab, "fontsize": 10.0, "id": hide_rmt_id, "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1120.0, patch_y + 22.0, 58.0, 20.0], "text": "hidden $1"}},
        {"box": {"fontname": ab, "fontsize": 10.0, "id": hide_mod_id, "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1185.0, patch_y + 22.0, 58.0, 20.0], "text": "hidden $1"}},
        newobj(name_route, "route text", 1250, patch_y, 70, 20, numinlets=1, numoutlets=2),
        newobj(name_prep, f"prepend slot_name {slot_num}", 1250, patch_y + 22, 130, 20),
        newobj(mapped_prep, f"prepend slot_mapped {slot_num}", 1250, patch_y + 44, 140, 20),
    ])

    i = slot_num - 1
    lines = [
        # control signal (gen out3) and range / mode / button messages into the shared Map subpatcher
        line("obj-gen", 2, sub_id, 0, i),
        line(min_id, 1, sub_id, 1),
        line(max_id, 1, sub_id, 2),
        line(unmap_id, 0, sub_id, 3),
        line(map_id, 0, sub_id, 4),
        line(mode_id, 0, sub_id, 5, 0),
        line(bip_id, 0, sub_id, 6),
        line(amt_id, 0, sub_id, 7),
        line(sub_id, 1, map_id, 0),
        line("obj-dev-ig", 0, map_id, 0, i * 2),
        line("obj-dev-ig", 0, unmap_id, 0, i * 2 + 1),
        line(sub_id, 0, inv_id, 0),
        line(inv_id, 0, hide_id, 0),
        line(hide_id, 0, unmap_id, 0),
        line(mode_id, 0, hide_mod_id, 0, 1),
        line(mode_id, 0, mode_inv_id, 0, 2),
        line(mode_inv_id, 0, hide_rmt_id, 0),
        line(hide_mod_id, 0, bip_id, 0, 1),
        line(hide_mod_id, 0, amt_id, 0, 0),
        line(hide_rmt_id, 0, min_id, 0, 1),
        line(hide_rmt_id, 0, max_id, 0, 0),
        # target name + mapped flag -> v8ui (chips with the mapped parameter name)
        line(sub_id, 1, name_route, 0),
        line(name_route, 0, name_prep, 0),
        line(name_prep, 0, "obj-viz", 0),
        line(sub_id, 0, mapped_prep, 0),
        line(mapped_prep, 0, "obj-viz", 0),
    ]
    params = {
        map_id: [f"Map[{slot_num}]", f"Map {slot_num}", 0],
        unmap_id: [f"Unmap[{slot_num}]", f"Unmap {slot_num}", 0],
        mode_id: [f"ModMode[{slot_num}]", f"Mode {slot_num}", 0],
        bip_id: [f"Bipolar[{slot_num}]", f"Pol {slot_num}", 0],
        amt_id: [f"ModAmount[{slot_num}]", f"Amt {slot_num}", 0],
        min_id: [f"TargetMin[{slot_num}]", f"Min {slot_num}", 0],
        max_id: [f"TargetMax[{slot_num}]", f"Max {slot_num}", 0],
    }
    return boxes, lines, params


# ------------------------------------------------------------------------------------------------
# Variants
# ------------------------------------------------------------------------------------------------
def variant_a():
    w = 440.0
    ctrl = [make_mode_tab(286, 8, 144, 18, rows=1, fontsize=9.0)]
    labels = []
    for i, (key, text, accent, bip) in enumerate((
        ("sens", "Sens", AMBER, False), ("attack", "Attack", CYAN, False),
        ("release", "Release", CYAN, False), ("focus", "Focus", VIOLET, True),
    )):
        y = 33.0 + i * 22.0
        labels.append(make_label(f"obj-lbl-{key}", text, 286, y + 1, 42, 13, size=8.0))
        ctrl.append(make_numbox(key, 330, y, 100, 15, accent, bipolar=bip))
    return dict(
        letter="a", name="Timbre Follower A", width=w, viz=(8.0, 8.0, 270.0, 110.0),
        controls=ctrl + labels, slots=[(8.0, 134.0), (214.0, 134.0)], slot_style="mid",
        panels=[
            ("obj-panel-main", (3.0, 4.0, w - 6.0, 161.0), [0.055, 0.060, 0.092, 1.0], [0.13, 0.15, 0.24, 1.0]),
            ("obj-panel-controls", (282.0, 6.0, 152.0, 114.0), [0.070, 0.076, 0.112, 1.0], [0.14, 0.16, 0.26, 1.0]),
            ("obj-panel-slots", (5.0, 125.0, w - 10.0, 36.0), [0.070, 0.076, 0.112, 1.0], [0.14, 0.16, 0.26, 1.0]),
        ],
    )


def variant_b():
    w = 264.0
    ctrl = [make_mode_tab(198, 8, 58, 58, rows=2, fontsize=9.0)]
    for i, (key, accent) in enumerate((("sens", AMBER), ("attack", CYAN), ("release", CYAN), ("focus", VIOLET))):
        ctrl.append(make_dial(key, 8 + i * 62.0, 70.0, 60.0, 46.0, accent))
    return dict(
        letter="b", name="Timbre Follower B", width=w, viz=(8.0, 8.0, 184.0, 58.0),
        controls=ctrl, slots=[(8.0, 123.0), (8.0, 141.0)], slot_style="wide",
        panels=[
            ("obj-panel-main", (3.0, 4.0, w - 6.0, 161.0), [0.055, 0.060, 0.092, 1.0], [0.13, 0.15, 0.24, 1.0]),
            ("obj-panel-slots", (5.0, 119.0, w - 10.0, 43.0), [0.070, 0.076, 0.112, 1.0], [0.14, 0.16, 0.26, 1.0]),
        ],
    )


def variant_c():
    w = 412.0
    ctrl = [make_mode_tab(8, 94, 100, 34, rows=1, fontsize=11.0)]
    labels = [make_label("obj-lbl-sens", "SENSITIVITY", 116, 93, 100, 11, size=8.0, color=AMBER)]
    ctrl.append(make_numbox("sens", 116, 105, 100, 23, AMBER, fontsize=12.0))
    for i, (key, accent) in enumerate((("attack", CYAN), ("release", CYAN), ("focus", VIOLET))):
        ctrl.append(make_dial(key, 226 + i * 59.0, 92.0, 56.0, 40.0, accent))
    return dict(
        letter="c", name="Timbre Follower C", width=w, viz=(8.0, 8.0, 396.0, 80.0),
        controls=ctrl + labels, slots=[(8.0, 140.0), (204.0, 140.0)], slot_style="narrow",
        panels=[
            ("obj-panel-main", (3.0, 4.0, w - 6.0, 161.0), [0.055, 0.060, 0.092, 1.0], [0.13, 0.15, 0.24, 1.0]),
            ("obj-panel-slots", (5.0, 135.0, w - 10.0, 27.0), [0.070, 0.076, 0.112, 1.0], [0.14, 0.16, 0.26, 1.0]),
        ],
    )


VARIANTS = {"a": variant_a, "b": variant_b, "c": variant_c}


def build_patcher(letter):
    spec = VARIANTS[letter]()
    with open(LIB_PATH, "r", encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, "r", encoding="utf-8") as f:
        core = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    gen_code = lib + "\n" + core
    combined_js = f'var TIMBRE_LAYOUT = "{letter}";\n' + ui_js

    with open(shaper.CLIPPING_PATH, "r", encoding="utf-8") as f:
        clipping = json.load(f)
    template = None
    for b in clipping["patcher"]["boxes"]:
        if b["box"].get("id") == "obj-25" and b["box"].get("text") == "p Map":
            template = b["box"]["patcher"]
    if template is None:
        raise RuntimeError("Could not locate 'p Map' subpatcher in Cycling '74 clipping")

    viz = list(spec["viz"])
    boxes = [
        newobj("obj-plugin", "plugin~", 40, 40, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 40, 560, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 3,
                "outlettype": ["signal", "signal", "signal"],
                "patching_rect": [40.0, 300.0, 260.0, 70.0],
            }
        },
        newobj("obj-buf-scope", "buffer~ #0-timbrescope @samps 2064", 340, 300, 230, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 340, 200, 60, 20, outlettype=["bang"]),
        newobj("obj-thisdevice", "live.thisdevice", 420, 200, 85, 20, numoutlets=3, outlettype=["bang", "int", "int"]),
        newobj("obj-freebang", "freebang", 520, 200, 60, 20, outlettype=["bang"]),
        newobj("obj-dev-inv", "!- 1", 420, 230, 30, 20, numinlets=2, numoutlets=1, outlettype=["int"]),
        msgbox("obj-dev-ig", "ignoreclick $1", 420, 255, 90),
        msgbox("obj-msg-gen-buf", "scope #0-timbrescope", 340, 235, 130),
        msgbox("obj-msg-ui-buf", "setbuffer #0-timbrescope", 340, 260, 150),
        msgbox("obj-msg-ui-init", "loadbang", 500, 260, 65),
        msgbox("obj-msg-ui-free", "notifydeleted", 580, 260, 85),
        # Saved UI state (heatmap view), bound to the v8ui through the pattr's middle outlet
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
                        "parameter_initial": [1, 0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 1,
                        "parameter_longname": "TimbreUiData",
                        "parameter_shortname": "TimbreUiData",
                        "parameter_type": 3,
                    }
                },
                "text": "pattr TimbreUiData",
                "varname": "TimbreUiData",
            }
        },
        {
            "box": {
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [120.0, 400.0, viz[2], viz[3]],
                "presentation": 1,
                "presentation_rect": viz,
                "textfile": {"autowatch": 1, "embed": 1, "filename": "none", "flags": 0, "text": combined_js},
                "varname": "TimbreVisualizer",
            }
        },
    ]
    boxes.extend(spec["controls"])

    # control -> gen / v8ui messages; v8ui -> Sens control
    px = 40.0
    for key in ("sens", "attack", "release", "focus", "mode"):
        boxes.append(newobj(f"obj-prep-gen-{key}", f"prepend {GEN_MESSAGE[key]}", px, 380, 100, 20))
        boxes.append(newobj(f"obj-prep-ui-{key}", f"prepend set_{key}", px, 405, 100, 20))
        px += 108.0
    boxes.append(newobj("obj-route-ui", "route ui_sens", 120, 460, 100, 20, numoutlets=2))

    lines = [
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-gen-buf", 0),
        line("obj-loadbang", 0, "obj-msg-ui-buf", 0),
        line("obj-loadbang", 0, "obj-msg-ui-init", 0),
        line("obj-thisdevice", 0, "obj-msg-gen-buf", 0),
        line("obj-thisdevice", 0, "obj-msg-ui-buf", 0),
        line("obj-thisdevice", 0, "obj-msg-ui-init", 0),
        line("obj-thisdevice", 1, "obj-dev-inv", 0),
        line("obj-dev-inv", 0, "obj-dev-ig", 0),
        line("obj-msg-gen-buf", 0, "obj-gen", 0),
        line("obj-msg-ui-buf", 0, "obj-viz", 0),
        line("obj-msg-ui-init", 0, "obj-viz", 0),
        line("obj-freebang", 0, "obj-msg-ui-free", 0),
        line("obj-msg-ui-free", 0, "obj-viz", 0),
        line("obj-state-pattr", 1, "obj-viz", 0),
        line("obj-viz", 0, "obj-route-ui", 0),
        line("obj-route-ui", 0, "obj-ctrl-sens", 0),
    ]
    for key in ("sens", "attack", "release", "focus", "mode"):
        lines.append(line(f"obj-ctrl-{key}", 0, f"obj-prep-gen-{key}", 0))
        lines.append(line(f"obj-prep-gen-{key}", 0, "obj-gen", 0))
        lines.append(line(f"obj-ctrl-{key}", 0, f"obj-prep-ui-{key}", 0))
        lines.append(line(f"obj-prep-ui-{key}", 0, "obj-viz", 0))

    parameters = {
        "obj-ctrl-sens": ["Sensitivity", "Sens", 0],
        "obj-ctrl-attack": ["Attack", "Attack", 0],
        "obj-ctrl-release": ["Release", "Release", 0],
        "obj-ctrl-focus": ["Focus", "Focus", 0],
        "obj-ctrl-mode": ["Mode", "Mode", 0],
        "obj-state-pattr": ["TimbreUiData", "TimbreUiData", 0],
    }

    for slot_num, (sx, sy) in enumerate(spec["slots"], start=1):
        sb, sl, sp = make_slot(template, slot_num, sx, sy, spec["slot_style"])
        boxes.extend(sb)
        lines.extend(sl)
        parameters.update(sp)

    # Background panels MUST be last in `boxes` with `"background": 1`
    for pid, rect, bg, bd in spec["panels"]:
        boxes.append({
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": bg,
                "border": 1,
                "bordercolor": bd,
                "id": pid,
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 600.0, float(rect[2]), float(rect[3])],
                "presentation": 1,
                "presentation_rect": [float(v) for v in rect],
                "proportion": 0.5,
                "rounded": 6,
            }
        })

    parameters["parameterbanks"] = {}
    parameters["inherited_shortname"] = 1
    patcher = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, spec["width"], DEVICE_H],
            "openrect": [0.0, 0.0, spec["width"], DEVICE_H],
            "devicewidth": spec["width"],
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontname": "Arial",
            "gridsize": [8.0, 8.0],
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters,
            "dependency_cache": [
                {"name": "multimap-unmap.svg", "bootpath": "C74:/packages/Max for Live/media", "type": "svg", "implicit": 1},
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
    return spec, patcher


def write_amxd(patcher_dict, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    payload = (json.dumps(patcher_dict, indent="\t") + "\n").encode("utf-8")
    header = (
        b"ampf\x04\x00\x00\x00"
        + b"aaaa"
        + b"meta\x04\x00\x00\x00\x00\x00\x00\x00"
        + b"ptch"
        + struct.pack("<I", len(payload))
    )
    with open(out_path, "wb") as f:
        f.write(header + payload)


def main():
    ap = argparse.ArgumentParser(description="Build the Timbre Follower devices")
    ap.add_argument("--variant", choices=sorted(VARIANTS), help="build one layout (default: all three)")
    args = ap.parse_args()
    for letter in ([args.variant] if args.variant else sorted(VARIANTS)):
        spec, patcher = build_patcher(letter)
        out = os.path.join(DEVICES_DIR, f"{spec['name']}.amxd")
        write_amxd(patcher, out)
        print(f"Built {out} ({int(spec['width'])}x{int(DEVICE_H)} px)")


if __name__ == "__main__":
    main()
