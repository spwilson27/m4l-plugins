#!/usr/bin/env python3
"""
Build Delay+ (Bitwig Delay+ style delay whose feedback loop runs through a Live device chain).

Outputs (devices/):
  Delay+.amxd       Start device: the tank and every control, laid out like Ableton's Echo
                    (scripts/delayplus_layouts/echo.py) around the tape-loop display
                    (src/delayplus_viz_b.js)
  Delay+ End.amxd   End device (closes the loop, mixes dry/wet)
  Delay+.adg        Audio Effect Rack preset: [Delay+] [empty "Delay+ FX" rack] [Delay+ End, folded]
Plus the Live test set delayplus_test.als (tracks "Delay+ 1..3": rack [Delay+, Limiter 6 ms,
Delay+ End], Ableton MCP Bridge on the Main track) via scripts/make_delayplus_sets.py. Three pairs
keep instance isolation covered.

Usage: build_delayplus.py [--no-sets]

A layout module returns the viz rect and presents every parameter in P (see load_layout); the
build adds the DSP, buffers and the shared wiring.
End layout (124 x 169): status v8ui only.
"""

import argparse
import hashlib
import importlib
import json
import os
import struct
import subprocess
import time
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT_DIR = os.path.join(ROOT, "devices")

DEVICE_H = 169.0
START_W = 480.0
END_W = 124.0
RING = 65536
SCOPE_SAMPS = 32 + 3 * 512
SPEC_SAMPS = 32 + 2 * 8192  # Filter Display spectrogram rings, wet + dry (see delayplus_start.genexpr)
ESCOPE_SAMPS = 32

VARIANTS = {
    # The device: Echo-style layout (scripts/delayplus_layouts/echo.py) + the tape-loop display.
    "main": {"name": "Delay+", "viz": "delayplus_viz_b.js", "layout": "echo"},
}
END_NAME = "Delay+ End"

CYAN = (0.30, 0.82, 0.95)
AMBER = (0.97, 0.68, 0.26)
VIOLET = (0.66, 0.55, 0.98)
GREEN = (0.40, 0.88, 0.52)
CORAL = (0.98, 0.42, 0.38)
SLATE = (0.62, 0.68, 0.76)

# Delay sync note values: every straight / triplet / dotted value sorted by length (DP_DIV_NAMES in
# src/delayplus_config.js), the Division dials' enum.
NOTES = ["1/64", "1/32", "1/16", "1/8", "1/4", "1/2", "1", "2", "4"]
DIVS = [n for _, n in sorted((b * m, NOTES[i] + sfx) for i, b in enumerate([1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16])
                             for sfx, m in (("", 1), (" T", 2 / 3), (" D", 1.5)))]
TMODES = ["Time", "Sync", "Pitch", "MIDI"]  # DP_TMODES in src/delayplus_config.js
LFO_DIVS = ["1/32", "1/16", "1/8", "1/4", "1/2", "1", "2", "4", "8"]
LFO_SHAPES = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "Noise"]
ONOFF = ["Off", "On"]

# key: long, short, lo, hi, initial, ptype (0 float, 1 int, 2 enum), unitstyle, exponent,
#      gen param (None = UI only: the face script computes it), scale (/100 before gen), help, enum
# Long names are what Live shows for automation and mapping; they mirror Echo's controls.
def _side(s, name):
    return {
        f"tmode_{s}": (f"{name} Time Mode", f"{name[0]} Time Mode", 0, len(TMODES) - 1, 1, 2, 9, 1.0, None, False,
                       f"How the {name.lower()} delay time is set: milliseconds (Time), a note value times a free "
                       "multiplier (Sync), the period of a note so the echoes ring at that pitch (Pitch), or the pitch "
                       "of the last note received on the MIDI input (MIDI).", TMODES),
        f"note_{s}": (f"{name} Note", f"{name[0]} Note", 0, 127, 57, 1, 8, 1.0, None, False,
                      f"{name} delay time in Pitch mode: one period of this note.", None),
        f"cents_{s}": (f"{name} Fine", f"{name[0]} Fine", -100.0, 100.0, 0.0, 0, 9, 1.0, None, False,
                       f"Fine-tunes the {name.lower()} note in Pitch and MIDI mode, in cents.", None),
        # 0.02..50, exponent 5.67 puts x1 at the middle of the control (DP_MULT_MIN / MAX in the config)
        f"mult_{s}": (f"{name} Multiplier", f"{name[0]} Mult", 0.02, 50.0, 1.0, 0, 9, 5.67, None, False,
                      f"{name} delay time in Sync mode: the note value times this.", None),
        f"time_{s}": (f"{name} Time", f"{name[0]} Time", 1.0, 5000.0, 375.0, 0, 2, 3.0, None, False,
                      f"{name} delay time in Time mode. Never shorter than the chain latency (MIN in the display).", None),
        f"div_{s}": (f"{name} Division", f"{name[0]} Division", 0, len(DIVS) - 1, DIVS.index("1/8"), 2, 9, 1.0,
                     None, False, f"{name} note value in Sync mode (straight, triplet or dotted), times the "
                     "multiplier. Triplet and dotted values can be switched off on the Options page.", DIVS),
        f"offs_{s}": (f"{name} Offset", f"{name[0]} Offset", -33.0, 33.0, 0.0, 0, 5, 1.0, None, False,
                      f"Shortens or lengthens the {name.lower()} delay by a fraction of its time, for swing.", None),
    }


P = {
    **_side("l", "Left"),
    **_side("r", "Right"),
    "link": ("Stereo Link", "Link", 0, 1, 1, 2, 9, 1.0, None, False,
             "Changes to one side's time settings (mode, time, note value, multiplier, note, fine tune) apply to both sides.", ONOFF),
    "specdry": ("Spectrum Dry", "Spectrum Dry", 0, 1, 1, 2, 9, 1.0, None, False,
                "Shows the dry input's spectrum in the Filter Display.", ONOFF),
    "specwet": ("Spectrum Wet", "Spectrum Wet", 0, 1, 1, 2, 9, 1.0, None, False,
                "Shows the delay's spectrum (after the loop filter) in the Filter Display.", ONOFF),
    "divtrip": ("Sync Triplets", "Triplets", 0, 1, 1, 2, 9, 1.0, None, False,
                "Offers triplet note values on the Division dials (Sync mode).", ONOFF),
    "divdot": ("Sync Dotted", "Dotted", 0, 1, 1, 2, 9, 1.0, None, False,
               "Offers dotted note values on the Division dials (Sync mode).", ONOFF),
    "showlat": ("Show Link Latency", "Link Latency", 0, 1, 0, 2, 9, 1.0, None, False,
                "Shows the link status and the latency of the devices between Delay+ and Delay+ End above the display "
                "(otherwise it only appears while Delay+ End is missing).", ONOFF),
    "clipmode": ("Clip Mode", "Clip Mode", 0, 2, 0, 2, 9, 1.0, "clipmode", False,
                 "How the feedback loop is kept below the Clip Level: Soft (smooth knee), Hard (clips) or Limit (a fast limiter, clean below the level).",
                 ["Soft", "Hard", "Limit"]),
    "cliplevel": ("Clip Level", "Clip Level", -18.0, 6.0, 0.0, 0, 4, 1.0, "cliplevel", False,
                  "Ceiling of the feedback loop, where the input and the repeats meet.", None),
    "inputdb": ("Input", "Input", -36.0, 12.0, 0.0, 0, 4, 1.0, "inputdb", False,
                "Gain of the signal going into the delay.", None),
    "clipdry": ("Clip Dry", "Clip Dry", 0, 1, 0, 2, 9, 1.0, "clipdry", False,
                "Soft-clips the signal going into the delay.", ONOFF),
    "fb": ("Feedback", "Feedback", 0.0, 110.0, 50.0, 0, 5, 1.0, "fb", True,
           "How much of the processed echo goes back into the delay. Above 100% the loop saturates softly.", None),
    "inv": ("Feedback Invert", "Feedback Inv", 0, 1, 0, 2, 9, 1.0, "inv", False,
            "Inverts the polarity of the feedback.", ONOFF),
    "filton": ("Filter On", "Filter On", 0, 1, 1, 2, 9, 1.0, "filton", False,
               "Turns the high-pass and low-pass filters in the loop on or off.", ONOFF),
    "hp": ("HP Freq", "HP Freq", 20.0, 20000.0, 50.0, 0, 3, 3.0, "hp", False,
           "High-pass cutoff. Also draggable in the Filter Display.", None),
    "hpres": ("HP Res", "HP Res", 0.0, 1.0, 0.0, 0, 1, 1.0, "hpres", False, "High-pass resonance.", None),
    "lp": ("LP Freq", "LP Freq", 20.0, 20000.0, 5000.0, 0, 3, 3.0, "lp", False,
           "Low-pass cutoff. Also draggable in the Filter Display.", None),
    "lpres": ("LP Res", "LP Res", 0.0, 1.0, 0.0, 0, 1, 1.0, "lpres", False, "Low-pass resonance.", None),
    "filtdisp": ("Filter Display", "Filter Display", 0, 1, 1, 2, 9, 1.0, None, False,
                 "Shows or hides the Filter Display.", ["Hidden", "Shown"]),
    "lfosync": ("Mod Sync", "Mod Sync", 0, 1, 1, 2, 9, 1.0, None, False,
                "LFO rate in Hz, or synced to note values.", ONOFF),
    "lfohz": ("Mod Rate", "Mod Rate", 0.01, 40.0, 0.5, 0, 3, 3.0, None, False, "LFO rate (Sync off).", None),
    "lfodiv": ("Mod Division", "Mod Division", 0, len(LFO_DIVS) - 1, 3, 2, 9, 1.0, None, False,
               "LFO rate in note values (Sync on).", LFO_DIVS),
    "phase": ("Mod Phase", "Mod Phase", 0.0, 360.0, 180.0, 0, 1, 1.0, "phase", False,
              "Phase offset of the right channel's LFO.", None),
    "lfoshape": ("Mod Waveform", "Mod Wave", 0, len(LFO_SHAPES) - 1, 0, 2, 9, 1.0, "lfoshape", False,
                 "LFO waveform.", LFO_SHAPES),
    "x4": ("Mod x4", "Mod x4", 0, 1, 0, 2, 9, 1.0, "x4", False, "Multiplies the delay modulation by 4.", ONOFF),
    "moddelay": ("Mod Delay", "Mod Delay", 0.0, 100.0, 0.0, 0, 5, 1.0, "moddelay", True,
                 "How much the LFO modulates the delay time (up to 8 ms, 32 ms with x4).", None),
    "modfilt": ("Mod Filter", "Mod Filter", 0.0, 100.0, 0.0, 0, 5, 1.0, "modfilt", True,
                "How much the LFO modulates the filter cutoffs (up to +-2 octaves).", None),
    "envmix": ("Env Mix", "Env Mix", 0.0, 100.0, 0.0, 0, 5, 1.0, "envmix", True,
               "Blends the LFO with an envelope follower on the input.", None),
    "gateon": ("Gate On", "Gate On", 0, 1, 0, 2, 9, 1.0, "gateon", False,
               "Only signal above the gate threshold goes into the delay.", ONOFF),
    "gatethr": ("Gate Threshold", "Gate Thr", -60.0, 0.0, 0.0, 0, 4, 1.0, "gatethr", False, "Gate threshold.", None),
    "gaterel": ("Gate Release", "Gate Rel", 1.0, 1000.0, 50.0, 0, 2, 2.0, "gaterel", False, "Gate release time.", None),
    "duckon": ("Ducking On", "Duck On", 0, 1, 0, 2, 9, 1.0, "duckon", False,
               "Turns the echoes down while the input is above the ducking threshold.", ONOFF),
    "duckthr": ("Ducking Threshold", "Duck Thr", -60.0, 0.0, 0.0, 0, 4, 1.0, "duckthr", False,
                "Ducking threshold.", None),
    "duckrel": ("Ducking Release", "Duck Rel", 1.0, 1000.0, 100.0, 0, 2, 2.0, "duckrel", False,
                "How fast the echoes come back after ducking.", None),
    "noiseon": ("Noise On", "Noise On", 0, 1, 0, 2, 9, 1.0, "noiseon", False, "Adds noise inside the feedback loop.", ONOFF),
    "noiseamt": ("Noise Amount", "Noise Amt", 0.0, 100.0, 0.0, 0, 5, 1.0, "noiseamt", True, "Noise level.", None),
    "noisemorph": ("Noise Morph", "Noise Morph", 0.0, 100.0, 0.0, 0, 5, 1.0, "noisemorph", True,
                   "From hiss (0%) to crackle (100%).", None),
    "wobon": ("Wobble On", "Wobble On", 0, 1, 0, 2, 9, 1.0, "wobon", False,
              "Irregular tape-style modulation of the delay time.", ONOFF),
    "wobamt": ("Wobble Amount", "Wobble Amt", 0.0, 100.0, 0.0, 0, 5, 1.0, "wobamt", True, "Wobble depth (up to 3 ms).", None),
    "wobmorph": ("Wobble Morph", "Wobble Morph", 0.0, 100.0, 0.0, 0, 5, 1.0, "wobmorph", True,
                 "From slow wow (0%) to fast flutter (100%).", None),
    "repitch": ("Repitch", "Repitch", 0, 1, 0, 2, 9, 1.0, "repitch", False,
                "On: changing the time bends the pitch like tape. Off: crossfades to the new time.", ONOFF),
    "repsmooth": ("Repitch Smoothing", "Rep Smooth", 10.0, 2000.0, 120.0, 0, 2, 2.0, "repsmooth", False,
                  "With Repitch on, how long the read head takes to glide to a new delay time (time constant).", None),
    "freeze": ("Freeze", "Freeze", 0, 1, 0, 2, 9, 1.0, "freeze", False,
               "Stops input into the delay and loops what is in it at 100% feedback.", ONOFF),
    "width": ("Stereo", "Stereo", 0.0, 200.0, 100.0, 0, 5, 1.0, "width", True,
              "Stereo width of the echoes: 0% mono, above 100% wider.", None),
    "outdb": ("Output", "Output", -36.0, 12.0, 0.0, 0, 4, 1.0, "outdb", False, "Gain of the echoes.", None),
    "chmode": ("Channel Mode", "Channel Mode", 0, 2, 0, 2, 9, 1.0, "chmode", False,
               "Stereo, Ping Pong (echoes bounce between the sides) or Mid/Side (Left = Mid, Right = Side).",
               ["Stereo", "Ping Pong", "Mid/Side"]),
    "diffuse": ("Diffusion", "Diffusion", 0.0, 100.0, 0.0, 0, 5, 1.0, "diffuse", True,
                "Smears each repeat inside the delay loop, so the echoes wash out toward a reverb as they repeat. "
                "The first echo stays clean.", None),
    "dsize": ("Diffusion Size", "Diff Size", 0.0, 100.0, 60.0, 0, 5, 1.0, "dsize", True,
              "How long the Diffusion smear is (up to about 37 ms per repeat). Adds that much to the shortest delay time.", None),
    "wet": ("Dry/Wet", "Dry/Wet", 0.0, 100.0, 50.0, 0, 5, 1.0, "wet", True,
            "Dry/wet balance (equal power: the wet rises all the way to 100%, 50% is -3 dB on both).", None),
}

COL_X = [234.0 + c * 48.0 for c in range(5)]
DIAL_W, DIAL_H = 44.0, 47.0
ROW_Y = [8.0, 60.0, 112.0]


def valueof(key):
    long_name, short, lo, hi, init, ptype, unit, expo, _g, _s, help_text, enum = P[key]
    v = {
        "parameter_annotation_name": long_name,
        "parameter_info": help_text,
        "parameter_initial": [init],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_shortname": short,
        "parameter_type": ptype,
    }
    if enum:
        v["parameter_enum"] = enum
        v["parameter_mmax"] = len(enum) - 1
    else:
        v["parameter_mmin"] = lo
        v["parameter_mmax"] = hi
        v["parameter_unitstyle"] = unit
        if expo != 1.0:
            v["parameter_exponent"] = expo
    if key == "dsize":  # the bar reads "Size 60 %" (it has no label of its own)
        v["parameter_unitstyle"] = 9
        v["parameter_units"] = "Size %.0f %"
    if key.startswith("cents_"):
        v["parameter_units"] = "%+.0f ct"
    if key.startswith("mult_"):
        v["parameter_units"] = "x%.2f"
    if key in ("hpres", "lpres"):  # Echo shows resonance with two decimals
        v["parameter_unitstyle"] = 9
        v["parameter_units"] = "%.2f"
    if key == "phase":
        v["parameter_unitstyle"] = 9
        v["parameter_units"] = "%.0f\u00b0"
    if key in UI_STATE:
        v["parameter_invisible"] = 1  # stored with the set, not automatable
    return v


# UI-state parameters (saved, not automatable).
UI_STATE = {"filtdisp", "specdry", "specwet", "showlat", "divtrip", "divdot"}


def theme(box, **attrs):
    """Bind colour attributes to Live theme colours (Max for Live dynamic colours), e.g.
    theme(b, bgcolor="live_lcd_bg"): they follow Live's theme / hue; the static value stays as fallback."""
    b = box["box"] if "box" in box else box
    saa = b.setdefault("saved_attribute_attributes", {})
    for attr, name in attrs.items():
        saa[attr] = {"expression": f"themecolor.{name}"}
    return box


def rgba(c, a=1.0):
    return [c[0], c[1], c[2], a]


def newobj(oid, text, x, y, w=100.0, ins=1, outs=1, outtypes=None):
    return {"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": oid, "maxclass": "newobj",
        "numinlets": ins, "numoutlets": outs, "outlettype": outtypes if outtypes is not None else [""] * outs,
        "patching_rect": [float(x), float(y), float(w), 20.0], "text": text,
    }}


def msgbox(oid, text, x, y, w=160.0):
    return {"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": oid, "maxclass": "message", "numinlets": 2,
        "numoutlets": 1, "outlettype": [""], "patching_rect": [float(x), float(y), float(w), 20.0], "text": text,
    }}


def _colors(box, color, attrs):
    """Set colour attributes only when a colour is given; None keeps Live's theme colours (Echo look)."""
    if color is not None:
        for a in attrs:
            box[a] = rgba(color)
    return box


def dial(key, x, y, color=None, hidden=0, w=None, h=None):
    w = DIAL_W if w is None else w
    h = DIAL_H if h is None else h
    long_name = P[key][0]
    box = {
        "annotation": P[key][10], "annotation_name": long_name,
        "fontsize": 9.0, "id": f"obj-ctrl-{key}", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2,
        "outlettype": ["", "float"], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1,
        "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)},
        "varname": long_name,
    }
    _colors(box, color, ["activedialcolor", "activeneedlecolor"])
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def menu(key, x, y, w, h, hidden=0):
    long_name = P[key][0]
    box = {
        "annotation": P[key][10], "annotation_name": long_name, "fontsize": 9.0,
        "id": f"obj-ctrl-{key}", "maxclass": "live.menu", "numinlets": 1, "numoutlets": 3,
        "outlettype": ["", "", "float"], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)}, "varname": long_name,
    }
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def tab(key, x, y, w, h, color=None, rows=1, hidden=0):
    long_name = P[key][0]
    box = {
        "annotation": P[key][10], "annotation_name": long_name, "fontsize": 9.0,
        "id": f"obj-ctrl-{key}", "maxclass": "live.tab",
        "num_lines_patching": rows, "num_lines_presentation": rows, "numinlets": 1, "numoutlets": 3,
        "outlettype": ["", "", "float"], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)}, "varname": long_name,
    }
    _colors(box, color, ["activebgoncolor", "focusbordercolor"])
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def button(key, x, y, w, h, color=None, text="", texton="", hidden=0):
    long_name = P[key][0]
    box = {
        "annotation": P[key][10], "annotation_name": long_name, "fontsize": 9.0,
        "id": f"obj-ctrl-{key}", "maxclass": "live.text", "mode": 1, "numinlets": 1,
        "numoutlets": 2, "outlettype": ["", ""], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)},
        "text": text, "texton": texton or text, "varname": long_name,
    }
    _colors(box, color, ["activebgoncolor"])
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def blend(accent, bg=(0.06, 0.07, 0.09), a=0.38):
    """Pre-blended slider fill (Live paints activeslidercolor opaque, AGENTS.md 1.8)."""
    return [accent[i] * a + bg[i] * (1 - a) for i in range(3)] + [1.0]


def numbox(key, x, y, w, h, color=None, appearance=2, hidden=0):
    """live.numbox: appearance 0 box, 1 triangle, 2 slider (value bar), 3 bipolar bar, 4 borderless."""
    long_name = P[key][0]
    box = {
        "annotation": P[key][10], "annotation_name": long_name, "appearance": appearance,
        "fontsize": 9.0, "id": f"obj-ctrl-{key}", "maxclass": "live.numbox", "numinlets": 1, "numoutlets": 2,
        "outlettype": ["", "float"], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)}, "varname": long_name,
    }
    if color is not None:
        box["activeslidercolor"] = blend(color)
        box["textcolor"] = rgba(color)
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def label(oid, text, x, y, w, h=12.0, size=9.0, color=None, bold=False, align=0, hidden=0):
    box = {
        "fontface": 1 if bold else 0, "fontsize": float(size),
        "id": oid, "maxclass": "live.comment", "numinlets": 1, "numoutlets": 0,
        "patching_rect": [x + 600.0, y + 600.0, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "text": text, "textjustification": align, "varname": oid,
    }
    if color is not None:
        box["textcolor"] = rgba(color)
    if hidden:
        box["hidden"] = 1
        box["varname"] = oid
    return {"box": box}


def v8ui(oid, code, rect, patch_xy, outs):
    return {"box": {
        "border": 0, "filename": "none", "id": oid, "maxclass": "v8ui", "numinlets": 1, "numoutlets": outs,
        "outlettype": [""] * outs, "patching_rect": [patch_xy[0], patch_xy[1], rect[2], rect[3]],
        "presentation": 1, "presentation_rect": [float(v) for v in rect],
        "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
    }}


def gendsp_json(gen_code):
    """The gen patcher (in 1 / in 2 -> codebox -> out 1 / out 2) as .gendsp JSON text (the deferred
    DSP writes it to a file and creates `gen~ @gen <file>`; same as scripts/build_sampler.py)."""
    def b(i, text, x, y, ni, no, cls="newobj", **kw):
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
            b("obj-in1", "in 1", 20, 20, 0, 1), b("obj-in2", "in 2", 120, 20, 0, 1),
            b("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
            b("obj-out1", "out 1", 20, 400, 1, 0), b("obj-out2", "out 2", 120, 400, 1, 0),
        ],
        "lines": [
            {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-code", 0]}},
            {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-code", 1]}},
            {"patchline": {"source": ["obj-code", 0], "destination": ["obj-out1", 0]}},
            {"patchline": {"source": ["obj-code", 1], "destination": ["obj-out2", 0]}},
        ],
    }}
    return json.dumps(patch)


def gen_box(code, outs=2):
    return {"box": {
        "code": code, "fontname": "<Monospaced>", "fontsize": 10.0, "id": "obj-gen", "maxclass": "gen.codebox~",
        "numinlets": 2, "numoutlets": outs, "outlettype": ["signal"] * outs,
        "patching_rect": [20.0, 120.0, 420.0, 160.0],
    }}


def panel(oid, x, y, w, h, bg=(0.085, 0.095, 0.115), border=(0.20, 0.23, 0.28)):
    return {"box": {
        "angle": 270.0, "background": 1, "bgcolor": rgba(bg), "border": 1, "bordercolor": rgba(border),
        "id": oid, "maxclass": "panel", "mode": 0, "numinlets": 1, "numoutlets": 0,
        "patching_rect": [float(x), 10.0, float(w), float(h)], "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)], "rounded": 6,
    }}


def line(src, so, dst, di):
    return {"patchline": {"source": [src, so], "destination": [dst, di]}}


# Stamped into every script (registry entry `build`) so tests can tell a reloaded device apart.
BUILD_STAMP = time.strftime("%Y%m%d-%H%M%S")


def read(name):
    with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
        return f.read()


def patcher(boxes, lines, width, description):
    return {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "box", "rect": [100.0, 100.0, 1200.0, 700.0],
        "openrect": [0.0, 0.0, width, DEVICE_H], "bglocked": 0, "openinpresentation": 1,
        "default_fontsize": 10.0, "default_fontface": 0, "default_fontname": "Arial Bold",
        "gridonopen": 1, "gridsize": [8.0, 8.0], "gridsnaponopen": 1, "objectsnaponopen": 1,
        "statusbarvisible": 2, "toolbarvisible": 1, "boxanimatetime": 200, "enablehscroll": 1,
        "enablevscroll": 1, "devicewidth": width, "description": description,
        "digest": description, "tags": "delay echo feedback rack latency", "style": "",
        "subpatcher_template": "", "assistshowspatchername": 0,
        "boxes": boxes, "lines": lines, "parameters": {}, "dependency_cache": [], "autosave": 0,
    }}


def write_amxd(path, doc):
    payload = (json.dumps(doc, indent="\t") + "\n").encode("utf-8")
    header = (b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4)
              + struct.pack("<I", 0) + b"ptch" + struct.pack("<I", len(payload)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(header + payload)
    print(f"Built {path} ({len(header) + len(payload)} bytes)")


def load_layout(name):
    mod = importlib.import_module(f"delayplus_layouts.{name}")
    lay = mod.layout(sys.modules[__name__])
    lay.setdefault("width", START_W)
    lay.setdefault("panels", [])
    lay.setdefault("extra_boxes", [])
    lay.setdefault("extra_lines", [])
    keys = [b["box"]["id"][len("obj-ctrl-"):] for b in lay["controls"] if b["box"]["id"].startswith("obj-ctrl-")]
    missing = sorted(set(P) - set(keys))
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if missing or dup:
        raise SystemExit(f"layout {name}: missing {missing} duplicated {dup}")
    return lay


def named(b, varname):
    b["box"]["varname"] = varname
    return b


def to_gen_hub(ln):
    """A cord into the (deferred) gen's inlet 0 goes into the hub's data inlet instead."""
    pl = ln["patchline"]
    if pl["destination"][0] == "obj-gen":
        assert pl["destination"][1] == 0, "only gen inlet 0 takes messages"
        pl["destination"] = ["obj-gen-in", 1]
    assert pl["source"][0] != "obj-gen", "nothing reads the deferred gen's outlets but plugout~"
    return ln


def build_start(variant, out_dir=None):
    cfg = VARIANTS[variant]
    lay = load_layout(cfg.get("layout", "echo"))
    # Deferred DSP (AGENTS.md 1d): the Start ships without its gen~; the face creates it after load
    # from the embedded patch, and re-sends the gen-bound parameters from DP_GEN_PARAMS.
    gen_text = gendsp_json(read("delayplus_start.genexpr"))
    gen_params = {k: [P[k][8], bool(P[k][9])] for k in P if P[k][8] is not None}
    code = (read("delayplus_config.js").rstrip() + f"\n\nvar DP_ROLE = \"start\";\nvar DP_BUILD = \"{BUILD_STAMP}\";\n"
            + f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\n"
            + f"var GEN_DSP_HASH = \"{hashlib.sha1(gen_text.encode()).hexdigest()[:12]}\";\n"
            + "var DP_DSP_PREFIX = \"delayplus_start\";\n"
            + f"var DP_GEN_PARAMS = {json.dumps(gen_params)};\n\n"
            + read("delayplus_link.js").rstrip() + "\n\n" + read("delayplus_ui.js").rstrip() + "\n\n"
            + read(cfg["viz"]).rstrip() + "\n\n" + read("delayplus_dsp.js"))
    boxes = [
        v8ui("obj-viz", code, lay["viz_rect"], (500.0, 20.0), 4),
        *lay["controls"],
        named(newobj("obj-plugin", "plugin~", 20, 60, 60, 2, 2, ["signal", "signal"]), "dp_plugin"),
        named(newobj("obj-plugout", "plugout~", 20, 300, 60, 2, 2, ["signal", "signal"]), "dp_plugout"),
        # every gen-bound message goes into this hub (data on its right inlet); the scripted gen~ is
        # connected to its outlet. gate 1 1, not t a: a scripted connect from t a makes no cord.
        named(newobj("obj-gen-in", "gate 1 1", 20, 100, 60, 2, 1), "dp_genin"),
        newobj("obj-buf-xfer", f"buffer~ ---dpxfer @samps {RING} @chans 5", 480, 300, 260, 1, 2, ["float", "bang"]),
        newobj("obj-buf-hdr", "buffer~ ---dphdr @samps 64", 480, 330, 200, 1, 2, ["float", "bang"]),
        newobj("obj-buf-scope", f"buffer~ ---dpscope @samps {SCOPE_SAMPS}", 480, 360, 220, 1, 2, ["float", "bang"]),
        newobj("obj-buf-spec", f"buffer~ ---dpspec @samps {SPEC_SAMPS}", 700, 360, 200, 1, 2, ["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 480, 400, 60, 1, 1, ["bang"]),
        msgbox("obj-msg-gen-bufs", "xfer ---dpxfer, hdr ---dphdr, scope ---dpscope, spec ---dpspec", 480, 430, 360),
        msgbox("obj-msg-ui-names", "names ---dpxfer ---dphdr ---dpscope ---dpspec", 480, 460, 300),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, 1, 2, ["bang", "int"]),
        msgbox("obj-msg-init", "init_link", 780, 430, 70),
    ]
    # Extra displays declared by the layout (filter display, LFO display, ...): their own script, the
    # set_<key> messages of the parameters they show, and the telemetry buffer names.
    for k, ex in enumerate(lay.get("v8uis", [])):
        code_ex = "\n\n".join([read("delayplus_config.js").rstrip()] + [read(f).rstrip() for f in ex.get("pre", [])]
                                + [read(ex["file"])])
        if ex.get("icon"):  # icon buttons: which icon this instance draws
            code_ex = f'var DP_ICON = "{ex["icon"]}";\n' + code_ex
        box = v8ui(ex["id"], code_ex, ex["rect"], (500.0, 200.0 + 180 * k), ex.get("outs", 1))
        if ex.get("hidden"):
            box["box"]["hidden"] = 1
        boxes.append(box)
    lines = [
        # Silence until the face wires plugin~ -> gen~ -> plugout~ (no dry cord during deferral).
        line("obj-loadbang", 0, "obj-msg-gen-bufs", 0), line("obj-msg-gen-bufs", 0, "obj-gen", 0),
        line("obj-loadbang", 0, "obj-msg-ui-names", 0), line("obj-msg-ui-names", 0, "obj-viz", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0), line("obj-msg-init", 0, "obj-viz", 0),
        line("obj-viz", 0, "obj-gen", 0),
    ]
    for ex in lay.get("v8uis", []):
        if ex.get("names"):
            lines.append(line("obj-msg-ui-names", 0, ex["id"], 0))
    for i, key in enumerate(P):
        gen_param, scale = P[key][8], P[key][9]
        y = 500.0 + i * 26.0
        ui_id = f"obj-ui-{key}"
        boxes.append(newobj(ui_id, f"prepend set_{key}", 760, y, 110))
        lines.append(line(f"obj-ctrl-{key}", 0, ui_id, 0))
        lines.append(line(ui_id, 0, "obj-viz", 0))
        for ex in lay.get("v8uis", []):
            if key in ex.get("keys", ()):
                lines.append(line(ui_id, 0, ex["id"], 0))
        if gen_param is None:
            continue
        src = f"obj-ctrl-{key}"
        if scale:
            sid = f"obj-scale-{key}"
            boxes.append(newobj(sid, "/ 100.", 880, y, 50, 2, 1, ["float"]))
            lines.append(line(src, 0, sid, 0))
            src = sid
        pid = f"obj-prep-{key}"
        boxes.append(newobj(pid, f"prepend {gen_param}", 940, y, 100))
        lines.append(line(src, 0, pid, 0))
        lines.append(line(pid, 0, "obj-gen", 0))
    boxes += lay["extra_boxes"]
    lines += lay["extra_lines"]
    lines = [to_gen_hub(l) for l in lines]
    boxes += lay["panels"]  # background panels last
    doc = patcher(boxes, lines, lay["width"], "Delay whose feedback loop runs through the devices between Delay+ and Delay+ End")
    write_amxd(os.path.join(out_dir or OUT_DIR, cfg["name"] + ".amxd"), doc)


def build_end():
    # Same deferred load as Start (src/delayplus_dsp.js): no gen~ in the file, no dry cord, silence
    # until the face wires plugin~ -> gen~ -> plugout~. Local buffer binds and the link layer's
    # xfer / hdr messages go through the hub's data inlet.
    gen_text = gendsp_json(read("delayplus_end.genexpr"))
    code = (read("delayplus_config.js").rstrip() + f"\n\nvar DP_ROLE = \"end\";\nvar DP_BUILD = \"{BUILD_STAMP}\";\n"
            + f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\n"
            + f"var GEN_DSP_HASH = \"{hashlib.sha1(gen_text.encode()).hexdigest()[:12]}\";\n"
            + "var DP_DSP_PREFIX = \"delayplus_end\";\n"
            + "var DP_GEN_PARAMS = {};\n\n"
            + read("delayplus_link.js").rstrip() + "\n\n" + read("delayplus_end_ui.js").rstrip() + "\n\n"
            + read("delayplus_dsp.js"))
    boxes = [
        v8ui("obj-viz", code, [4.0, 4.0, END_W - 8.0, DEVICE_H - 8.0], (500.0, 20.0), 1),
        named(newobj("obj-plugin", "plugin~", 20, 60, 60, 2, 2, ["signal", "signal"]), "dp_plugin"),
        named(newobj("obj-plugout", "plugout~", 20, 300, 60, 2, 2, ["signal", "signal"]), "dp_plugout"),
        named(newobj("obj-gen-in", "gate 1 1", 20, 100, 60, 2, 1), "dp_genin"),
        # Own buffers: used until the link layer binds gen to the Start's xfer / hdr.
        newobj("obj-buf-xfer", "buffer~ ---dpxferE @samps 64 @chans 5", 480, 300, 240, 1, 2, ["float", "bang"]),
        newobj("obj-buf-hdr", "buffer~ ---dphdrE @samps 64", 480, 330, 200, 1, 2, ["float", "bang"]),
        newobj("obj-buf-scope", f"buffer~ ---dpscopeE @samps {ESCOPE_SAMPS}", 480, 360, 220, 1, 2, ["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 480, 400, 60, 1, 1, ["bang"]),
        msgbox("obj-msg-local", "scope ---dpscopeE, xfer ---dpxferE, hdr ---dphdrE", 480, 430, 340),
        msgbox("obj-msg-ui-names", "names ---dpxferE ---dphdrE ---dpscopeE", 480, 460, 260),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, 1, 2, ["bang", "int"]),
        msgbox("obj-msg-init", "init_link", 780, 430, 70),
        # viz sends `xfer <name>` / `hdr <name>` (and `scope <name>` on resend). route strips the
        # selector; the prepends put it back on the way into the hub. Unmatched (scope) passes through.
        newobj("obj-route-bind", "route xfer hdr", 200, 160, 90, 1, 3),
        newobj("obj-prep-xfer", "prepend xfer", 200, 190, 90),
        newobj("obj-prep-hdr", "prepend hdr", 200, 220, 90),
    ]
    lines = [
        line("obj-loadbang", 0, "obj-msg-local", 0), line("obj-msg-local", 0, "obj-gen", 0),
        line("obj-loadbang", 0, "obj-msg-ui-names", 0), line("obj-msg-ui-names", 0, "obj-viz", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0), line("obj-msg-init", 0, "obj-viz", 0),
        line("obj-viz", 0, "obj-route-bind", 0),
        line("obj-route-bind", 0, "obj-prep-xfer", 0), line("obj-prep-xfer", 0, "obj-gen", 0),
        line("obj-route-bind", 1, "obj-prep-hdr", 0), line("obj-prep-hdr", 0, "obj-gen", 0),
        line("obj-route-bind", 2, "obj-gen", 0),
    ]
    lines = [to_gen_hub(l) for l in lines]
    doc = patcher(boxes, lines, END_W, "Closes the Delay+ feedback loop and mixes dry/wet")
    write_amxd(os.path.join(OUT_DIR, END_NAME + ".amxd"), doc)


def build_sets(variants):
    gen = os.path.join(ROOT, "scripts", "make_delayplus_sets.py")
    end = os.path.join(OUT_DIR, END_NAME + ".amxd")
    for v in variants:
        name = VARIANTS[v]["name"]
        start = os.path.join(OUT_DIR, name + ".amxd")
        subprocess.run([sys.executable, gen, "--start", start, "--end", end, "--name", "Delay+",
                        "--middle", "fxrack", "--fold-end", "--adg", os.path.join(OUT_DIR, name + ".adg")], check=True)
    start = os.path.join(OUT_DIR, VARIANTS["main"]["name"] + ".amxd")
    tracks = []
    for i in range(1, 4):
        tracks += ["--track", f"Delay+ {i}::{start}"]
    # same rack the shipped Delay+.adg has (nested empty FX rack, End folded): Live loads the .adg's rack from this
    tracks += ["--track", f"Delay+ Preset::{start}::fxrack::fold"]
    subprocess.run([sys.executable, gen, "--start", start, "--end", end, "--middle", "limiter",
                    "--name", "Delay+", "--als", os.path.join(ROOT, "delayplus_test.als")] + tracks, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=sorted(VARIANTS), default=None)
    ap.add_argument("--no-sets", action="store_true")
    args = ap.parse_args()
    variants = [args.variant] if args.variant else sorted(VARIANTS)
    variants = [v for v in variants if os.path.isfile(os.path.join(SRC, VARIANTS[v]["viz"])) and os.path.isfile(
        os.path.join(ROOT, "scripts", "delayplus_layouts", VARIANTS[v].get("layout", "echo") + ".py"))]
    for v in variants:
        build_start(v)
    build_end()
    if not args.no_sets:
        build_sets(variants)



if __name__ == "__main__":
    main()
