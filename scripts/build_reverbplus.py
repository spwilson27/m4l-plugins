#!/usr/bin/env python3
"""
Build Reverb+ (a reverb whose output runs through a Live device chain and back into the tank).

Outputs (devices/):
  Reverb+.amxd        Start device (layout `base`): the reverb engine (6 algorithms) and every control
  Reverb+ <X>.amxd    one Start device per extra layout scripts/reverbplus_layouts/<x>.py (face variants)
  Reverb+ End.amxd    End device (mixes dry / processed wet, closes the outer loop)
  Reverb+.adg         Audio Effect Rack preset [Reverb+] [empty "Reverb+ FX" rack] [Reverb+ End, folded] (also Reverb+ <X>.adg)
Plus the Live test set reverbplus_test.als (tracks "Reverb+ 1..3": rack [Reverb+, Limiter 6 ms,
Reverb+ End], Ableton MCP Bridge on Main) via scripts/make_reverbplus_sets.py.

Usage: build_reverbplus.py [--variant X] [--no-sets] [--out-dir DIR]

A layout module (scripts/reverbplus_layouts/README.md is the contract) presents every parameter and
declares its display v8uis; the build adds the DSP, buffers, the engine v8ui and all wiring. Nothing in
this file, the config or the shared tests needs to change to add a layout.
"""

import argparse
import hashlib
import importlib
import json
import os
import struct
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT_DIR = os.path.join(ROOT, "devices")
LAYOUT_DIR = os.path.join(ROOT, "scripts", "reverbplus_layouts")

DEVICE_H = 169.0
END_W = 124.0
BASE_NAME = "Reverb+"
END_NAME = "Reverb+ End"
RING = 65536
SCOPE_SAMPS = 64
SPEC_SAMPS = 32 + 2 * 4096
IRSPEC_SAMPS = 2 * (32 * 129 * 4 + 140 * 2049 * 4)
IRVIEW_SAMPS = 2048
ESCOPE_SAMPS = 32

ALGOS = ["Plate", "Hall", "Room", "Chamber", "Spring", "Convolution"]  # RP_ALGOS in src/reverbplus_config.js
ONOFF = ["Off", "On"]
CLIPS = ["Soft", "Hard", "Limit"]

# key: long, short, lo, hi, initial, ptype (0 float, 1 int, 2 enum), unitstyle, exponent,
#      gen message (None = UI / engine only), divisor (the face divides by it before the gen), help, enum
# Long names are what Live shows for automation and mapping; short names are unique.
P = {
    "algo": ("Algorithm", "Algorithm", 0, 5, 1, 2, 9, 1.0, "algo", 1,
             "Plate, Hall, Room, Chamber, Spring or Convolution (your own impulse response). Only the chosen algorithm "
             "runs; changing it crossfades in about 80 ms.", ALGOS),
    "predelay": ("Pre-Delay", "Pre-Delay", 0.0, 500.0, 20.0, 0, 2, 3.0, "predelay", 1,
                 "Time before the reverb starts. In Convolution it cannot go below the engine's 5 ms latency.", None),
    "size": ("Size", "Size", 0.0, 100.0, 60.0, 0, 5, 1.0, "szp", 100,
             "Scales every delay line (room size; spring length).", None),
    "decay": ("Decay Time", "Decay", 0.1, 60.0, 2.5, 0, 9, 3.0, "dcy", 1,
              "Time for the reverb to fall by 60 dB (RT60) at the middle frequencies.", None),
    "diffusion": ("Diffusion", "Diffusion", 0.0, 100.0, 80.0, 0, 5, 1.0, "diffp", 100,
                  "Density of the echoes (input allpass diffusers; spring dispersion).", None),
    "damp": ("HF Damping", "HF Damp", 1000.0, 20000.0, 7000.0, 0, 3, 3.0, "dampf", 1,
             "Above this frequency the reverb decays faster. In Convolution it is a low-pass on the wet.", None),
    "bassmult": ("Bass Multiplier", "Bass Mult", 0.25, 4.0, 1.2, 0, 9, 2.32, "bassm", 1,
                 "Decay time below the Crossover as a multiple of Decay (Hall, Room, Chamber).", None),
    "xover": ("Crossover", "Crossover", 100.0, 1000.0, 350.0, 0, 3, 2.0, "xoverf", 1,
              "Frequency where the bass decay (Bass Mult) takes over.", None),
    "modrate": ("Mod Rate", "Mod Rate", 0.05, 5.0, 0.6, 0, 9, 3.0, "modrate", 1,
                "Rate of the delay-line modulation that keeps the tail from ringing.", None),
    "moddepth": ("Mod Depth", "Mod Depth", 0.0, 100.0, 25.0, 0, 5, 1.0, "moddepth", 100,
                 "Depth of the delay-line modulation.", None),
    "erlevel": ("Early Level", "Early", -70.0, 6.0, 0.0, 0, 4, 1.0, "erlvl", 1,
                "Level of the early reflections (Hall, Room, Chamber). -70 dB is off.", None),
    "latelevel": ("Late Level", "Late", -70.0, 6.0, 0.0, 0, 4, 1.0, "latelvl", 1,
                  "Level of the reverb tail (the convolution in Convolution). -70 dB is off.", None),
    "lowcut": ("Low Cut", "Low Cut", 20.0, 1000.0, 60.0, 0, 3, 3.0, "lowcut", 1,
               "High-pass on the reverb output.", None),
    "highcut": ("High Cut", "High Cut", 1000.0, 20000.0, 16000.0, 0, 3, 3.0, "highcut", 1,
                "Low-pass on the reverb output.", None),
    "width": ("Width", "Width", 0.0, 150.0, 100.0, 0, 5, 1.0, "widthp", 100,
              "Stereo width of the reverb: 0% mono, above 100% wider.", None),
    "freeze": ("Freeze", "Freeze", 0, 1, 0, 2, 9, 1.0, "freeze", 1,
               "Holds the reverb at its current level forever; new input and the loop return fade out.", ONOFF),
    "loopclip": ("Loop Clip Mode", "Clip Mode", 0, 2, 0, 2, 9, 1.0, "clipmode", 1,
                 "How the loop return is kept below the Clip Level: Soft (smooth knee), Hard (clips) or Limit (a fast limiter).", CLIPS),
    "looplevel": ("Loop Clip Level", "Clip Level", -18.0, 6.0, 0.0, 0, 4, 1.0, "cliplevel", 1,
                  "Ceiling of the loop return, so a gain stage in the chain cannot run away. (The loop time and amount are derived from Algorithm, Size and Decay.)", None),
    "duck": ("Ducking", "Ducking", 0.0, 100.0, 0.0, 0, 5, 1.0, "duckamt", 100,
             "Turns the reverb down (up to 24 dB) while the dry signal is loud.", None),
    "duckrel": ("Duck Release", "Duck Rel", 10.0, 2000.0, 250.0, 0, 2, 3.0, "duckrel", 1,
                "How fast the reverb comes back after ducking.", None),
    "drywet": ("Dry/Wet", "Dry/Wet", 0.0, 100.0, 35.0, 0, 5, 1.0, "wetmix", 100,
               "Dry/wet balance (equal power: the wet rises all the way to 100%).", None),
    "output": ("Output", "Output", -36.0, 12.0, 0.0, 0, 4, 1.0, "outdb", 1, "Gain of the reverb.", None),
    "irstretch": ("IR Stretch", "IR Stretch", 50.0, 200.0, 100.0, 0, 5, 1.0, None, 1,
                  "Convolution: plays the impulse response slower or faster (resamples it).", None),
    "irstart": ("IR Start", "IR Start", 0.0, 50.0, 0.0, 0, 5, 1.0, None, 1,
                "Convolution: cuts this much off the start of the impulse response.", None),
    "irreverse": ("IR Reverse", "IR Reverse", 0, 1, 0, 2, 9, 1.0, None, 1,
                  "Convolution: plays the impulse response backwards.", ONOFF),
    "irdecay": ("IR Decay", "IR Decay", 0.0, 100.0, 100.0, 0, 5, 1.0, None, 1,
                "Convolution: 100% keeps the whole tail, lower values fade it out faster.", None),
    "irfile": ("IR File", "IR File", 0, 0, 0, 4, 9, 1.0, None, 1, "The impulse response file (drop an audio file on the device).", None),
    "input": ("Input", "Input", -36.0, 12.0, 0.0, 0, 4, 1.0, "indb", 1,
              "Level going into the reverb, before Pre-Delay. The dry signal and the chain loop return are not affected.", None),
}
BASE_KEYS = list(P)
# UI-state parameters (saved, not automatable). Layouts add their own through h.register().
UI_STATE = set()


def register(key, long_name, short, lo, hi, initial, ptype=0, unit=9, expo=1.0, help_text="", enum=None):
    """A layout's own hidden UI-state parameter (page, view toggle, ...): saved with the set, not automatable.
    Names must not clash with base parameters (short names are unique in Live)."""
    if key in P:
        raise SystemExit(f"register: {key!r} already exists")
    shorts = {v[1] for v in P.values()}
    if short in shorts:
        raise SystemExit(f"register: short name {short!r} already used")
    P[key] = (long_name, short, lo, hi, initial, ptype, unit, expo, None, 1, help_text, enum)
    UI_STATE.add(key)
    return key


def reset_registry():
    for k in list(P):
        if k not in BASE_KEYS:
            del P[k]
    UI_STATE.clear()


def valueof(key):
    long_name, short, lo, hi, init, ptype, unit, expo, _g, _d, help_text, enum = P[key]
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
    units = {"decay": "%.2f s", "bassmult": "x%.2f", "modrate": "%.2f Hz"}
    if key in units:
        v["parameter_unitstyle"] = 9
        v["parameter_units"] = units[key]
    if key in UI_STATE:
        v["parameter_invisible"] = 1
    return v


def theme(box, **attrs):
    """Bind colour attributes to Live theme colours (Max for Live dynamic colours); the static value stays as fallback."""
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
    if color is not None:
        for a in attrs:
            box[a] = rgba(color)
    return box


def _live(key, maxclass, x, y, w, h, hidden=0, **extra):
    long_name = P[key][0]
    box = {
        "annotation": P[key][10], "annotation_name": long_name,
        "fontsize": 9.0, "id": f"obj-ctrl-{key}", "maxclass": maxclass, "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1,
        "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)},
        "varname": long_name,
    }
    box.update(extra)
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def dial(key, x, y, color=None, hidden=0, w=40.0, h=44.0):
    b = _live(key, "live.dial", x, y, w, h, hidden, numinlets=1, numoutlets=2, outlettype=["", "float"])
    _colors(b["box"], color, ["activedialcolor", "activeneedlecolor"])
    return b


def menu(key, x, y, w, h, hidden=0):
    return _live(key, "live.menu", x, y, w, h, hidden, numinlets=1, numoutlets=3, outlettype=["", "", "float"])


def tab(key, x, y, w, h, color=None, rows=1, hidden=0):
    b = _live(key, "live.tab", x, y, w, h, hidden, numinlets=1, numoutlets=3, outlettype=["", "", "float"],
              num_lines_patching=rows, num_lines_presentation=rows)
    _colors(b["box"], color, ["activebgoncolor", "focusbordercolor"])
    return b


def button(key, x, y, w, h, color=None, text="", texton="", hidden=0):
    b = _live(key, "live.text", x, y, w, h, hidden, mode=1, numinlets=1, numoutlets=2, outlettype=["", ""],
              text=text, texton=texton or text)
    _colors(b["box"], color, ["activebgoncolor"])
    return b


def blend(accent, bg=(0.06, 0.07, 0.09), a=0.38):
    """Pre-blended slider fill (Live paints activeslidercolor opaque, AGENTS.md 1.8)."""
    return [accent[i] * a + bg[i] * (1 - a) for i in range(3)] + [1.0]


def numbox(key, x, y, w, h, color=None, appearance=2, hidden=0):
    """live.numbox: appearance 0 box, 1 triangle, 2 slider (value bar), 3 bipolar bar, 4 borderless."""
    b = _live(key, "live.numbox", x, y, w, h, hidden, appearance=appearance, numinlets=1, numoutlets=2,
              outlettype=["", "float"])
    if color is not None:
        b["box"]["activeslidercolor"] = blend(color)
        b["box"]["textcolor"] = rgba(color)
    return b


def irdrop(x, y, w, h, hidden=0, ignoreclick=0, legend="Drop IR"):
    """The IR File parameter: a live.drop in parameter mode (Live saves the path and replays it on load; a
    live.drop only outputs in parameter mode). Exactly one per device (key `irfile`)."""
    box = {
        "annotation": P["irfile"][10], "annotation_name": "IR File", "bordercolor": [0.28, 0.78, 0.94, 0.85],
        "fontsize": 8.0, "id": "obj-ctrl-irfile", "legend": legend, "maxclass": "live.drop", "numinlets": 1,
        "numoutlets": 2, "outlettype": ["", ""], "parameter_enable": 1, "patching_rect": [x + 600.0, y + 300.0, w, h],
        "presentation": 1, "presentation_rect": [x, y, w, h], "textcolor": [0.84, 0.92, 0.98, 1.0],
        "saved_attribute_attributes": {"valueof": {
            "parameter_invisible": 1, "parameter_longname": "IR File", "parameter_modmode": 0,
            "parameter_shortname": "IR File", "parameter_type": 4,
        }},
        "varname": "IR File",
    }
    if ignoreclick:
        box["ignoreclick"] = 1
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def dropany(x, y, w, h):
    """Whole-face file drop target: Max's `dropfile` object, invisible (no border), ignoreclick 1 so every click, drag and
    right click reaches the widgets under it. It only outputs the dropped path (`prepend anydrop` -> the engine, which loads it
    as the IR in Convolution). NOT a parameter: the one parameter live.drop is `IR File`."""
    return {"box": {
        "bgcolor": [0.0, 0.0, 0.0, 0.0], "border": 0, "bordercolor": [0.0, 0.0, 0.0, 0.0], "id": "obj-dropany",
        "ignoreclick": 1, "maxclass": "dropfile", "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""],
        "patching_rect": [1300.0, 300.0, float(w), float(h)], "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)], "varname": "rp_dropany",
    }}


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
    return {"box": box}


def v8ui(oid, code, rect, patch_xy, outs, presentation=1):
    box = {
        "border": 0, "filename": "none", "id": oid, "maxclass": "v8ui", "numinlets": 1, "numoutlets": outs,
        "outlettype": [""] * outs, "patching_rect": [patch_xy[0], patch_xy[1], rect[2], rect[3]],
        "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
    }
    if presentation:
        box["presentation"] = 1
        box["presentation_rect"] = [float(v) for v in rect]
    return {"box": box}


def gendsp_json(gen_code):
    """The gen patcher (in 1 / in 2 -> codebox -> out 1 / out 2) as .gendsp JSON text (the deferred
    DSP writes it to a file and creates `gen~ @gen <file>`; same as scripts/build_delayplus.py)."""
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
        "id": oid, "maxclass": "panel", "mode": 0, "numinlets": 1, "numoutlets": 0, "varname": oid,
        "patching_rect": [float(x), 10.0, float(w), float(h)], "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)], "rounded": 6,
    }}


def line(src, so, dst, di):
    return {"patchline": {"source": [src, so], "destination": [dst, di]}}


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
        "digest": description, "tags": "reverb convolution plate hall room chamber spring rack latency", "style": "",
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


# ---- layouts ------------------------------------------------------------------------------------------

def discover_layouts():
    """Layout names found in scripts/reverbplus_layouts (every .py except __init__)."""
    return sorted(f[:-3] for f in os.listdir(LAYOUT_DIR) if f.endswith(".py") and not f.startswith("_"))


def device_name(layout_name, mod=None):
    if mod is not None and getattr(mod, "DEVICE_NAME", None):
        return mod.DEVICE_NAME
    return BASE_NAME if layout_name == "base" else f"{BASE_NAME} {layout_name.upper()}"


def load_layout(name):
    """Import a layout module and run it against this module's helpers. Returns (module, layout dict)."""
    reset_registry()
    mod = importlib.import_module(f"reverbplus_layouts.{name}")
    importlib.reload(mod)
    lay = mod.layout(sys.modules[__name__])
    lay.setdefault("width", 480.0)
    lay.setdefault("controls", [])
    lay.setdefault("panels", [])
    lay.setdefault("extra_boxes", [])
    lay.setdefault("extra_lines", [])
    lay.setdefault("v8uis", [])
    lay.setdefault("off_face", {})
    lay.setdefault("panel_theme", [])
    return mod, lay


def rect_of(b, key="presentation_rect"):
    return b["box"].get(key)


def overlaps(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def validate_layout(name, lay):
    """The layout contract (scripts/reverbplus_layouts/README.md). Returns a list of problems."""
    problems = []
    ids = [b["box"]["id"] for b in lay["controls"] + lay["extra_boxes"] + lay["panels"]] + [u["id"] for u in lay["v8uis"]]
    for i in {i for i in ids if ids.count(i) > 1}:
        problems.append(f"duplicate box id {i}")
    reserved = {"obj-engine", "obj-gen", "obj-gen-in", "obj-plugin", "obj-plugout", "obj-loadbang", "obj-thisdevice"}
    for i in ids:
        if i in reserved or i.startswith(("obj-ui-", "obj-scale-", "obj-prep-", "obj-buf-", "obj-msg-", "obj-route-", "obj-state-")):
            problems.append(f"box id {i} is reserved for the build (use obj-lay-<name>-... for your own boxes)")
    keys = [b["box"]["id"][len("obj-ctrl-"):] for b in lay["controls"] if b["box"]["id"].startswith("obj-ctrl-")]
    missing = sorted(set(P) - set(keys))
    dup = sorted({k for k in keys if keys.count(k) > 1})
    extra = sorted(set(keys) - set(P))
    if missing:
        problems.append(f"parameters not presented: {missing}")
    if dup:
        problems.append(f"parameters presented twice: {dup}")
    if extra:
        problems.append(f"widgets for unknown parameters: {extra}")
    for b in lay["controls"]:
        bx = b["box"]
        k = bx["id"][len("obj-ctrl-"):] if bx["id"].startswith("obj-ctrl-") else None
        if k and bx.get("presentation") != 1 and k not in lay["off_face"]:
            problems.append(f"{k} is off the face but not listed in off_face (with a reason)")
    for k, why in lay["off_face"].items():
        if not why:
            problems.append(f"off_face[{k}] needs a reason")
        if k not in P:
            problems.append(f"off_face lists unknown parameter {k}")
    W = lay["width"]
    pres = [b for b in lay["controls"] + lay["extra_boxes"] + lay["panels"] if b["box"].get("presentation") == 1]
    for b in pres:
        r = rect_of(b)
        if not r or r[0] < -0.01 or r[1] < -0.01 or r[0] + r[2] > W + 0.01 or r[1] + r[3] > DEVICE_H + 0.01:
            problems.append(f"{b['box']['id']} presentation_rect {r} outside {W}x{DEVICE_H}")
    for u in lay["v8uis"]:
        r = u["rect"]
        if u.get("presentation", 1) and (r[0] < 0 or r[1] < 0 or r[0] + r[2] > W + 0.01 or r[1] + r[3] > DEVICE_H + 0.01):
            problems.append(f"v8ui {u['id']} rect {r} outside {W}x{DEVICE_H}")
        files = u.get("files") or ([u["file"]] if "file" in u else [])
        if not files:
            problems.append(f"v8ui {u['id']} has no 'files'")
        for f in files:
            if not os.path.isfile(os.path.join(SRC, f)):
                problems.append(f"v8ui {u['id']}: missing src/{f}")
        for k in u.get("keys", []):
            if k not in P:
                problems.append(f"v8ui {u['id']} subscribes to unknown parameter {k}")
    # rule 4: no live.* over an interactive v8ui (ignoreclick v8uis and live.* in front of them are fine)
    boxes_order = [b["box"]["id"] for b in lay["controls"] + lay["extra_boxes"]]
    for u in lay["v8uis"]:
        if not u.get("presentation", 1) or u.get("hidden"):
            continue
        for b in lay["controls"] + lay["extra_boxes"]:
            bx = b["box"]
            if not str(bx.get("maxclass", "")).startswith("live.") or bx.get("presentation") != 1 or bx.get("hidden"):
                continue
            if overlaps(bx["presentation_rect"], u["rect"]) and not u.get("ignoreclick"):
                problems.append(f"{bx['id']} overlaps interactive v8ui {u['id']} (set ignoreclick on the v8ui to draw under a transparent live.* widget)")
    for p in lay["panels"]:
        if p["box"].get("background") != 1:
            problems.append(f"panel {p['box']['id']} needs background 1")
    # live.* widgets must not overlap each other
    live = [b["box"] for b in pres if str(b["box"].get("maxclass", "")).startswith("live.") and not b["box"].get("hidden")
            and b["box"].get("maxclass") not in ("live.comment", "live.line")]
    for i, a in enumerate(live):
        for c in live[i + 1:]:
            if a["id"] == "obj-ctrl-irfile" or c["id"] == "obj-ctrl-irfile":
                continue
            if overlaps(a["presentation_rect"], c["presentation_rect"]) and a.get("ignoreclick") != 1 and c.get("ignoreclick") != 1:
                problems.append(f"{a['id']} overlaps {c['id']}")
    return problems


def to_gen_hub(ln):
    """A cord into the (deferred) gen's inlet 0 goes into the hub's data inlet instead."""
    pl = ln["patchline"]
    if pl["destination"][0] == "obj-gen":
        assert pl["destination"][1] == 0, "only gen inlet 0 takes messages"
        pl["destination"] = ["obj-gen-in", 1]
    assert pl["source"][0] != "obj-gen", "nothing reads the deferred gen's outlets but plugout~"
    return ln


def named(b, varname):
    b["box"]["varname"] = varname
    return b


def face_script(u):
    """A display v8ui's script: config + prelude + the layout's own files. `device` globals first."""
    files = u.get("files") or [u["file"]]
    parts = [read("reverbplus_config.js").rstrip(), read("reverbplus_face_common.js").rstrip()] + [read(f).rstrip() for f in files]
    return "\n\n".join(parts)


def build_start(layout_name, out_dir=None):
    mod, lay = load_layout(layout_name)
    problems = validate_layout(layout_name, lay)
    if problems:
        raise SystemExit(f"layout {layout_name}: " + "; ".join(problems))
    dev_name = device_name(layout_name, mod)
    # Deferred DSP (AGENTS.md 1d): the Start ships without its gen~; the engine creates it after load
    # from the embedded patch, and re-sends the gen-bound parameters from RP_GEN_PARAMS.
    gen_code = "\n".join(read(f) for f in ("cepstrum_lib.genexpr", "reverbplus_conv.genexpr", "reverbplus_start.genexpr"))
    gen_text = gendsp_json(gen_code)
    gen_params = {k: [P[k][8], P[k][9]] for k in P if P[k][8] is not None}
    engine = (read("reverbplus_config.js").rstrip() + f"\n\nvar RP_ROLE = \"start\";\nvar RP_BUILD = \"{BUILD_STAMP}\";\n"
              + f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\n"
              + f"var GEN_DSP_HASH = \"{hashlib.sha1(gen_text.encode()).hexdigest()[:12]}\";\n"
              + "var RP_DSP_PREFIX = \"reverbplus_start\";\n"
              + f"var RP_GEN_PARAMS = {json.dumps(gen_params)};\n"
              + f"var RP_PANEL_THEME = {json.dumps(lay['panel_theme'])};\n"
              + f"var RP_VARNAMES = {json.dumps({k: P[k][0] for k in P if k != 'irfile'})};\n\n"
              + read("reverbplus_link.js").rstrip() + "\n\n" + read("reverbplus_dsp.js").rstrip() + "\n\n"
              + read("reverbplus_engine.js").rstrip() + "\n\n" + read("reverbplus_panels.js"))
    faces = lay["v8uis"]
    # box order = z-order: the faces sit BEHIND every live.* control, so a transparent live.* (the IR drop, a drag
    # area) may sit over a face that has "ignoreclick" (AGENTS.md rule 4 exception)
    face_boxes = []
    for k, u in enumerate(faces):
        code = face_script(u)
        if u.get("preamble"):
            code = u["preamble"] + "\n" + code
        box = v8ui(u["id"], code, u["rect"], (500.0, 200.0 + 180 * k), u.get("outs", 1), presentation=u.get("presentation", 1))
        if u.get("hidden"):
            box["box"]["hidden"] = 1
        if u.get("ignoreclick"):
            box["box"]["ignoreclick"] = 1
        face_boxes.append(box)
    boxes = [
        named(v8ui("obj-engine", engine, [0.0, 0.0, 64.0, 16.0], (500.0, 20.0), 6, presentation=0), "rp_engine"),
        *face_boxes,
        *lay["controls"],
        named(newobj("obj-plugin", "plugin~", 20, 60, 60, 2, 2, ["signal", "signal"]), "rp_plugin"),
        named(newobj("obj-plugout", "plugout~", 20, 300, 60, 2, 2, ["signal", "signal"]), "rp_plugout"),
        # every gen-bound message goes into this hub (data on its right inlet); the scripted gen~ is
        # connected to its outlet. gate 1 1, not t a: a scripted connect from t a makes no cord.
        named(newobj("obj-gen-in", "gate 1 1", 20, 100, 60, 2, 1), "rp_genin"),
        newobj("obj-buf-xfer", f"buffer~ ---rpxfer @samps {RING} @chans 5", 480, 300, 260, 1, 2, ["float", "bang"]),
        newobj("obj-buf-hdr", "buffer~ ---rphdr @samps 64", 480, 330, 200, 1, 2, ["float", "bang"]),
        newobj("obj-buf-scope", f"buffer~ ---rpscope @samps {SCOPE_SAMPS}", 480, 360, 220, 1, 2, ["float", "bang"]),
        newobj("obj-buf-spec", f"buffer~ ---rpspec @samps {SPEC_SAMPS}", 700, 360, 200, 1, 2, ["float", "bang"]),
        newobj("obj-buf-ir", "buffer~ ---rpir 1000 2", 700, 300, 160, 1, 2, ["float", "bang"]),
        newobj("obj-buf-irspec", f"buffer~ ---rpirspec @samps {IRSPEC_SAMPS}", 700, 330, 260, 1, 2, ["float", "bang"]),
        newobj("obj-buf-irview", f"buffer~ ---rpirview @samps {IRVIEW_SAMPS}", 700, 390, 240, 1, 2, ["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 480, 400, 60, 1, 1, ["bang"]),
        msgbox("obj-msg-gen-bufs", "xfer ---rpxfer, hdr ---rphdr, scope ---rpscope, spec ---rpspec, irs ---rpirspec", 480, 430, 420),
        msgbox("obj-msg-ui-names", "names ---rpxfer ---rphdr ---rpscope ---rpspec ---rpir ---rpirspec ---rpirview", 480, 460, 420),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, 1, 2, ["bang", "int"]),
        msgbox("obj-msg-init", "init_link", 780, 430, 70),
        msgbox("obj-msg-irloaded", "ir_loaded", 700, 420, 70),
        newobj("obj-state-send", "s ---rpstate", 560, 120, 90, 1, 0, []),
        newobj("obj-state-test", "r #0-rptest", 660, 90, 90, 0, 1),
        newobj("obj-state-recv", "r ---rpstate", 560, 90, 90, 0, 1),
        newobj("obj-opendialog", "opendialog sound", 560, 160, 120, 1, 2, ["", "bang"]),
        newobj("obj-prep-browsed", "prepend browsed", 560, 190, 110),
        newobj("obj-prep-dropset", "prepend set", 560, 220, 80),
        newobj("obj-prep-dropfile", "prepend dropfile", 560, 250, 110),
        newobj("obj-route-face", "route param cmd", 560, 280, 110, 1, 3, ["", "", ""]),
        newobj("obj-route-key", "route " + " ".join(k for k in P if k != "irfile"), 560, 310, 600, 1, len(P)),
    ]
    lines = [
        # silent until the deferred gen~ is wired (no plugin~ -> plugout~ cord)
        line("obj-loadbang", 0, "obj-msg-gen-bufs", 0), line("obj-msg-gen-bufs", 0, "obj-gen", 0),
        line("obj-loadbang", 0, "obj-msg-ui-names", 0), line("obj-msg-ui-names", 0, "obj-engine", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0), line("obj-msg-init", 0, "obj-engine", 0),
        # engine outlets: 0 gen hub, 1 state bus, 2 buffer~ ---rpir (`replace <path>`), 3 file dialog, 4 live.drop `set`
        line("obj-engine", 0, "obj-gen", 0),
        line("obj-engine", 1, "obj-state-send", 0),
        line("obj-state-test", 0, "obj-engine", 0),
        line("obj-engine", 2, "obj-buf-ir", 0),
        line("obj-engine", 3, "obj-opendialog", 0),
        line("obj-engine", 4, "obj-prep-dropset", 0),
        line("obj-engine", 5, "obj-route-key", 0),  # `algo <i>`: a drop outside Convolution switches the real Algorithm object
        line("obj-prep-dropset", 0, "obj-ctrl-irfile", 0),
        line("obj-opendialog", 0, "obj-prep-browsed", 0), line("obj-prep-browsed", 0, "obj-engine", 0),
        line("obj-ctrl-irfile", 0, "obj-prep-dropfile", 0), line("obj-prep-dropfile", 0, "obj-engine", 0),
        line("obj-buf-ir", 1, "obj-msg-irloaded", 0), line("obj-msg-irloaded", 0, "obj-engine", 0),
        # faces -> parameters / commands
        line("obj-route-face", 0, "obj-route-key", 0), line("obj-route-face", 1, "obj-engine", 0),
    ]
    face_keys = {u["id"]: set(u.get("keys", ())) for u in faces}
    for u in faces:
        lines.append(line(u["id"], 0, "obj-route-face", 0))
        if u.get("names", True):
            lines.append(line("obj-msg-ui-names", 0, u["id"], 0))
        if u.get("state", True):
            lines.append(line("obj-state-recv", 0, u["id"], 0))
    route_keys = [k for k in P if k != "irfile"]
    for i, k in enumerate(route_keys):
        lines.append(line("obj-route-key", i, f"obj-ctrl-{k}", 0))
    for i, key in enumerate(P):
        if key == "irfile":
            continue
        gen_msg, div = P[key][8], P[key][9]
        y = 500.0 + i * 26.0
        ui_id = f"obj-ui-{key}"
        boxes.append(newobj(ui_id, f"prepend set_{key}", 760, y, 110))
        lines.append(line(f"obj-ctrl-{key}", 0, ui_id, 0))
        lines.append(line(ui_id, 0, "obj-engine", 0))
        for u in faces:
            if key in face_keys[u["id"]]:
                lines.append(line(ui_id, 0, u["id"], 0))
        if gen_msg is None:
            continue
        src = f"obj-ctrl-{key}"
        if div != 1:
            sid = f"obj-scale-{key}"
            boxes.append(newobj(sid, f"/ {float(div)}", 880, y, 50, 2, 1, ["float"]))
            lines.append(line(src, 0, sid, 0))
            src = sid
        pid = f"obj-prep-{key}"
        boxes.append(newobj(pid, f"prepend {gen_msg}", 940, y, 100))
        lines.append(line(src, 0, pid, 0))
        lines.append(line(pid, 0, "obj-gen", 0))
    boxes += lay["extra_boxes"]
    lines += lay["extra_lines"]
    lines = [to_gen_hub(l) for l in lines]
    boxes += lay["panels"]  # background panels last
    doc = patcher(boxes, lines, lay["width"], "Reverb whose output runs through the devices between Reverb+ and Reverb+ End")
    write_amxd(os.path.join(out_dir or OUT_DIR, dev_name + ".amxd"), doc)
    return dev_name


def build_end():
    # Deferred DSP, same as Start: no gen~ in the file and no plugin~ -> plugout~ cord (silence until
    # the face creates gen~). GEN_DSP_TEXT / hash / prefix live in the End v8ui next to the shared loader.
    gen_text = gendsp_json(read("reverbplus_end.genexpr"))
    code = (read("reverbplus_config.js").rstrip() + f"\n\nvar RP_ROLE = \"end\";\nvar RP_BUILD = \"{BUILD_STAMP}\";\n"
            + f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\n"
            + f"var GEN_DSP_HASH = \"{hashlib.sha1(gen_text.encode()).hexdigest()[:12]}\";\n"
            + "var RP_DSP_PREFIX = \"reverbplus_end\";\n"
            + "var RP_GEN_PARAMS = {};\n\n"
            + read("reverbplus_link.js").rstrip() + "\n\n" + read("reverbplus_dsp.js").rstrip() + "\n\n"
            + read("reverbplus_end_ui.js"))
    boxes = [
        v8ui("obj-viz", code, [4.0, 4.0, END_W - 8.0, DEVICE_H - 8.0], (500.0, 20.0), 1),
        named(newobj("obj-plugin", "plugin~", 20, 60, 60, 2, 2, ["signal", "signal"]), "rp_plugin"),
        named(newobj("obj-plugout", "plugout~", 20, 300, 60, 2, 2, ["signal", "signal"]), "rp_plugout"),
        # messages into the right inlet; the scripted gen~ connects to the outlet. gate 1 1, not t a.
        named(newobj("obj-gen-in", "gate 1 1", 20, 100, 60, 2, 1), "rp_genin"),
        # Own buffers: used until the link layer binds gen to the Start's xfer / hdr.
        newobj("obj-buf-xfer", "buffer~ ---rpxferE @samps 64 @chans 5", 480, 300, 240, 1, 2, ["float", "bang"]),
        newobj("obj-buf-hdr", "buffer~ ---rphdrE @samps 64", 480, 330, 200, 1, 2, ["float", "bang"]),
        newobj("obj-buf-scope", f"buffer~ ---rpscopeE @samps {ESCOPE_SAMPS}", 480, 360, 220, 1, 2, ["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 480, 400, 60, 1, 1, ["bang"]),
        msgbox("obj-msg-local", "scope ---rpscopeE, xfer ---rpxferE, hdr ---rphdrE", 480, 430, 320),
        msgbox("obj-msg-ui-names", "names ---rpxferE ---rphdrE ---rpscopeE", 480, 460, 260),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, 1, 2, ["bang", "int"]),
        msgbox("obj-msg-init", "init_link", 780, 430, 70),
        # link layer sends `xfer <name>` / `hdr <name>`; route splits them and the prepends rebuild the gen messages
        newobj("obj-route-bind", "route xfer hdr", 560, 140, 90, 1, 3, ["", "", ""]),
        newobj("obj-prep-xfer", "prepend xfer", 560, 170, 90),
        newobj("obj-prep-hdr", "prepend hdr", 680, 170, 90),
    ]
    lines = [
        # silent until src/reverbplus_dsp.js wires plugin~ -> gen~ -> plugout~
        line("obj-loadbang", 0, "obj-msg-local", 0), line("obj-msg-local", 0, "obj-gen", 0),
        line("obj-loadbang", 0, "obj-msg-ui-names", 0), line("obj-msg-ui-names", 0, "obj-viz", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0), line("obj-msg-init", 0, "obj-viz", 0),
        line("obj-viz", 0, "obj-route-bind", 0),
        line("obj-route-bind", 0, "obj-prep-xfer", 0), line("obj-prep-xfer", 0, "obj-gen", 0),
        line("obj-route-bind", 1, "obj-prep-hdr", 0), line("obj-prep-hdr", 0, "obj-gen", 0),
        line("obj-route-bind", 2, "obj-gen", 0),  # scope (and anything else) already carries its selector
    ]
    lines = [to_gen_hub(l) for l in lines]
    doc = patcher(boxes, lines, END_W, "Mixes the Reverb+ wet after the devices between Reverb+ and Reverb+ End with the dry signal")
    write_amxd(os.path.join(OUT_DIR, END_NAME + ".amxd"), doc)


def build_sets(names, with_test_set):
    gen = os.path.join(ROOT, "scripts", "make_reverbplus_sets.py")
    end = os.path.join(OUT_DIR, END_NAME + ".amxd")
    for name in names:
        start = os.path.join(OUT_DIR, name + ".amxd")
        subprocess.run([sys.executable, gen, "--start", start, "--end", end, "--name", name,
                        "--middle", "fxrack", "--fold-end", "--adg", os.path.join(OUT_DIR, name + ".adg")], check=True)
    if with_test_set:
        start = os.path.join(OUT_DIR, BASE_NAME + ".amxd")
        tracks = []
        for i in range(1, 4):
            tracks += ["--track", f"Reverb+ {i}::{start}"]
        # same rack the shipped Reverb+.adg has (nested empty FX rack, End folded)
        tracks += ["--track", f"Reverb+ Preset::{start}::fxrack::fold"]
        subprocess.run([sys.executable, gen, "--start", start, "--end", end, "--middle", "limiter",
                        "--name", BASE_NAME, "--als", os.path.join(ROOT, "reverbplus_test.als")] + tracks, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default=None, help="build only this layout (a name from scripts/reverbplus_layouts, e.g. a)")
    ap.add_argument("--no-sets", action="store_true")
    ap.add_argument("--out-dir", default=None, help="write the devices here instead of devices/ (tests)")
    args = ap.parse_args()
    global OUT_DIR
    if args.out_dir:
        OUT_DIR = os.path.abspath(args.out_dir)
    avail = discover_layouts()
    if args.variant:
        v = args.variant.lower()
        if v not in avail:
            raise SystemExit(f"no layout {v!r} (found {avail})")
        todo = [v]
    else:
        todo = ["base"]
    names = [build_start(v) for v in todo]
    build_end()
    if not args.no_sets:
        build_sets(names, "base" in todo)


if __name__ == "__main__":
    main()
