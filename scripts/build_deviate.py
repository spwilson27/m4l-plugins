#!/usr/bin/env python3
"""
Build Deviate: a transient-triggered, randomised multi-FX for drum fills, as five face builds sharing one DSP.

Outputs (devices/): `Deviate <Face>.amxd` for every face module in scripts/deviate_faces/*.py (the module's NAME).
Plus the Live test set deviate_test.als (one audio track per built face, MCP Bridge on Main) through scripts/make_deviate_set.py.

Usage: build_deviate.py [face] [--out-dir DIR] [--no-sets] [--dump-params]

A face module (scripts/deviate_faces/README.md is the contract) presents every parameter and declares its display canvases.
The build adds the DSP (deferred gen~), buffers, the engine v8ui (parameter store, MIDI trigger, IR bank, state blob, test hook),
the gen hub and all wiring. The parameter table `P` below is the single source of truth (mirrored by DV_PARAMS in
src/deviate_config.js, checked by tests/test_deviate_dsp.js). ORDER IS FOREVER: append only.
"""

import argparse
import hashlib
import importlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc  # noqa: E402

SRC = os.path.join(ROOT, "src")
OUT_DIR = os.path.join(ROOT, "devices")
FACE_DIR = os.path.join(ROOT, "scripts", "deviate_faces")

DEVICE_H = 169.0
MAX_W = 600.0
LAT_ENV = 256
SCOPE_SAMPS = 1536
CTL_SAMPS = 64
IR_SAMPS = 2500000
SPEC_SAMPS = 2048  # x 5 channels
MAP_SAMPS = 1296  # DV_MAP.SAMPS: the hidden map (Architecture), written by the engine
# Spike S1 (DEVIATE_PLAN.md): may a transparent live.* sit over an ignoreclick canvas (z-order in Live)? Off until proven in Live.
UNDER_CONTROLS = True  # spike S1 passed (README "Spike S1"): the engine brings every live.* to the front, so widgets over an ignoreclick canvas work

ONOFF = ["Off", "On"]
SPLITS = ["Envelope", "Spectral"]
METAS = ["Snap", "Pitch", "Body", "Motion", "Space", "Echo", "Grit", "Ring"]
VALUE_DEFAULTS = [30, 50, 30, 20, 30, 20, 20, 10]
VALUE_HELP = {
    "Snap": "Transient punch: shaper, a click burst and a high-pass on the hit. Higher is snappier. Each hit draws its own value around this one. (Architecture 0; other Architectures give it other effects.)",
    "Pitch": "Pitch of the body, from -12 to +12 semitones. 50 % is no shift. Each hit draws its own value around this one. (Architecture 0; other Architectures give it other effects.)",
    "Body": "Body resonance: a tuned resonator bank, comb and vowel formants on the body of the hit. Each hit draws its own value around this one. (Architecture 0; other Architectures give it other effects.)",
    "Motion": "Movement: phaser and chorus on the hit and its tail. Each hit draws its own value around this one. (Architecture 0; other Architectures give it other effects.)",
    "Space": "Room around the hit: a convolution from a built-in bank of impulse responses and a reverb. Each hit draws its own value around this one. (Architecture 0; other Architectures give it other effects.)",
    "Echo": "Echoes: a feedback delay and a slapback on the tail. Each hit draws its own value around this one. (Architecture 0; other Architectures give it other effects.)",
    "Grit": "Dirt: drive, bit crush, ring modulation and saturation. Each hit draws its own value around this one. (Architecture 0; other Architectures give it other effects.)",
    "Ring": "How long the effects ring after the hit: up to 2.0 seconds (8.0 in the Wonky and Glitch Arch Modes). Each hit draws its own value around this one.",
}
RANGE_HELP = "How far each hit may stray from the %s value, up and down. 0 %% always uses the value; 100 %% can reach the whole range."
LOCK_HELP = "Keeps the %s draw of the last hit: new hits and rerolls no longer change it, and its Value and Range edits are ignored."


def _p(long_name, short, lo, hi, init, ptype, unit, gen, div, help_text, enum=None, expo=1.0):
    return (long_name, short, lo, hi, init, ptype, unit, expo, gen, div, help_text, enum)


# key: (long, short, lo, hi, initial, ptype (0 float, 2 enum), unitstyle, exponent, gen message (None = engine / UI only), divisor
# the patcher divides by before the gen, help sentence, enum)
P = {}
for _i, _n in enumerate(METAS):
    P["v_" + _n.lower()] = _p(_n, _n, 0.0, 100.0, float(VALUE_DEFAULTS[_i]), 0, 5, "dvv%d" % _i, 1, VALUE_HELP[_n])
for _i, _n in enumerate(METAS):
    P["r_" + _n.lower()] = _p(_n + " Range", "R " + _n, 0.0, 100.0, 50.0, 0, 9, "dvr%d" % _i, 1, RANGE_HELP % _n)
P["sens"] = _p("Sensitivity", "Sens", 0.0, 100.0, 50.0, 0, 5, "dvsens", 100,
               "How easily a hit is detected: higher reacts to softer onsets and to less sharp attacks.")
P["thresh"] = _p("Threshold", "Thresh", -60.0, 0.0, -36.0, 0, 4, "dvthr", 1,
                 "Level the audio must exceed to count as a hit. MIDI notes always count as hits.")
P["chance"] = _p("Chance", "Chance", 0.0, 100.0, 100.0, 0, 5, "dvchance", 1,
                 "Chance that a hit draws new settings. When it does not, the hit plays with the settings of the last draw. The first hit always draws.")
P["mix"] = _p("Dry/Wet", "Mix", 0.0, 100.0, 100.0, 0, 5, "dvwet", 100,
              "Amount of the randomised effects added to the dry signal. 0 % is the untouched, delayed dry signal.")
P["seed"] = _p("Seed", "Seed", 0.0, 1000.0, 0.0, 0, 0, "dvseed", 1,
               "Starting point of the random sequence: the same Seed gives the same draws for the same hits, so a bounce repeats.")
P["drift"] = _p("Drift", "Drift", 0.0, 100.0, 0.0, 0, 5, "dvdrift", 1,
                "How slowly the settings glide to each new draw over the following hits. 0 % jumps at once.")
P["reroll"] = _p("Reroll", "Reroll", 0, 1, 0, 2, 9, "dvreroll", 1,
                 "Draws new settings now, without waiting for a hit. Locked metas keep their value.", ONOFF)
P["split"] = _p("Split Mode", "Split", 0, 1, 0, 2, 9, "dvsplit", 1,
                "Envelope splits each hit into transient, body and tail by time (256 samples latency). Spectral separates them by spectrum (1279 samples latency).", SPLITS)
for _i, _n in enumerate(METAS):
    P["l_" + _n.lower()] = _p(_n + " Lock", "L " + _n, 0, 1, 0, 2, 9, "dvl%d" % _i, 1, LOCK_HELP % _n, ONOFF)
P["midi_in"] = _p("MIDI From", "MIDI In", 0, 1, 0, 2, 9, None, 1,
                  "Where MIDI notes that count as hits come from: a MIDI track or a port. Velocity and pitch are ignored.", ["No Input", "-"])
P["arch"] = _p("Architecture", "Arch", 0.0, 1000.0, 0.0, 0, 9, None, 1,
               "Rebuilds which effects each meta drives, which effects are in play and their ranges. 0 is the original layout; each other number is a different one.")
P["amode"] = _p("Arch Mode", "Mode", 0, 3, 0, 2, 9, None, 1,
                "What kind of architectures Arch builds. Classic is the original family (Arch 0 = the factory layout); Wonky bends and sweeps with tails up to 8 s; Natural tunes and resonates like real drums; Glitch stutters, gates and freezes the spectrum, tails up to 8 s.",
                ["Classic", "Wonky", "Natural", "Glitch"])
UNITS = {"arch": "Arch %.0f"}  # parameter_units of unitstyle-9 parameters other than the Range rows
INVISIBLE = {"split": 1, "midi_in": 2}  # parameter_invisible (1 = stored only, 2 = not stored)
ENGINE_GEN = {"split", "reroll"}  # the engine sends these (split: it sets the latency attribute; reroll: it turns every 1 into a pulse the gen can see)
PARAM_ORDER = list(P)
ASSERT_N = 35
assert len(P) == ASSERT_N, len(P)
assert len({v[1] for v in P.values()}) == len(P) and all(len(v[1]) <= 8 for v in P.values())
assert all(len(v[10]) >= 12 for v in P.values())


def dump_params():
    """The parameter table as JSON-able dicts (tests compare it with DV_PARAMS in src/deviate_config.js)."""
    out = []
    for k, (long_name, short, lo, hi, init, ptype, unit, expo, gen, div, help_text, enum) in P.items():
        out.append({"key": k, "long": long_name, "short": short, "min": lo, "max": hi, "init": init, "type": ptype, "unit": unit,
                    "expo": expo, "gen": gen, "div": div, "help": help_text, "enum": enum, "invisible": INVISIBLE.get(k, 0)})
    return out


# ---- widgets ---------------------------------------------------------------------------------------------------------
COLOR_ATTRS = ("bgcolor", "bordercolor", "activedialcolor", "dialcolor", "textcolor", "activetextcolor", "textoncolor", "activebgcolor",
               "activeslidercolor", "slidercolor", "lcdcolor", "bgoncolor", "activebgoncolor", "linecolor", "tribordercolor",
               "activetricolor2", "tricolor", "activeneedlecolor", "focusbordercolor", "needlecolor")


def rgba(c, a=1.0):
    return [c[0], c[1], c[2], a]


def theme(box, **attrs):
    """Bind colour attributes to Live theme colours (static default-dark value written as the fallback)."""
    return sc.theme(box, **attrs)


def valueof(key):
    long_name, short, lo, hi, init, ptype, unit, expo, _g, _d, help_text, enum = P[key]
    v = {"parameter_annotation_name": long_name, "parameter_info": help_text, "parameter_linknames": 1, "parameter_longname": long_name,
         "parameter_shortname": short, "parameter_type": ptype}
    if key != "midi_in":
        v["parameter_initial"] = [init]
        v["parameter_initial_enable"] = 1
    if enum:
        v["parameter_enum"] = enum
        v["parameter_mmax"] = len(enum) - 1
    else:
        v["parameter_mmin"] = lo
        v["parameter_mmax"] = hi
        v["parameter_unitstyle"] = unit
        if unit == 9:   # custom format: whole percent, so "50 %" fits a 33 px Range box (unitstyle 5 drops the "%" there)
            v["parameter_units"] = UNITS.get(key, "%.0f %")
        if expo != 1.0:
            v["parameter_exponent"] = expo
    if key in INVISIBLE:
        v["parameter_invisible"] = INVISIBLE[key]
    return v


def _live(key, maxclass, x, y, w, h, hidden=0, **extra):
    long_name = P[key][0]
    box = {
        "annotation": P[key][10], "annotation_name": long_name, "fontsize": 9.0, "id": f"obj-ctrl-{key}", "maxclass": maxclass,
        "parameter_enable": 1, "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)], "saved_attribute_attributes": {"valueof": valueof(key)},
        "varname": long_name,
    }
    box.update(extra)
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def _colors(box, color, attrs):
    if color is not None:
        for a in attrs:
            box[a] = rgba(color)
    return box


def dial(key, x, y, w=33.0, h=42.0, color=None, hidden=0, shownumber=1, showname=1):
    """live.dial; Live snaps it to about 29..33 x 42 with name and value."""
    b = _live(key, "live.dial", x, y, w, h, hidden, numinlets=1, numoutlets=2, outlettype=["", "float"], showname=showname,
              shownumber=shownumber)
    _colors(b["box"], color, ["activedialcolor", "activeneedlecolor"])
    return b


def numbox(key, x, y, w, h=15.0, color=None, appearance=2, hidden=0):
    """live.numbox: appearance 0 box, 1 triangle, 2 slider (value bar), 3 bipolar bar, 4 borderless."""
    b = _live(key, "live.numbox", x, y, w, h, hidden, appearance=appearance, numinlets=1, numoutlets=2, outlettype=["", "float"])
    if color is not None:
        bg = [0.06, 0.07, 0.09]
        b["box"]["activeslidercolor"] = [color[i] * 0.38 + bg[i] * 0.62 for i in range(3)] + [1.0]  # Live paints it opaque (AGENTS 1.8)
        b["box"]["textcolor"] = rgba(color)
    return b


def toggle(key, x, y, w, h=14.0, text=None, color=None, hidden=0):
    """live.text in Toggle mode (the Lock buttons)."""
    t = text if text is not None else P[key][1]
    b = _live(key, "live.text", x, y, w, h, hidden, mode=1, numinlets=1, numoutlets=2, outlettype=["", ""], text=t, texton=t)
    _colors(b["box"], color, ["activebgoncolor"])
    return b


def button(key, x, y, w, h=15.0, text=None, color=None, hidden=0):
    """live.text in Button mode (mode 0): momentary, 1 while pressed (the Reroll button)."""
    t = text if text is not None else P[key][1]
    b = _live(key, "live.text", x, y, w, h, hidden, mode=0, numinlets=1, numoutlets=2, outlettype=["", ""], text=t, texton=t)
    _colors(b["box"], color, ["activebgoncolor"])
    return b


def menu(key, x, y, w, h=15.0, color=None, hidden=0):
    b = _live(key, "live.menu", x, y, w, h, hidden, numinlets=1, numoutlets=3, outlettype=["", "", "float"])
    _colors(b["box"], color, ["bordercolor"])
    return b


def tab(key, x, y, w, h=15.0, color=None, rows=1, hidden=0):
    b = _live(key, "live.tab", x, y, w, h, hidden, numinlets=1, numoutlets=3, outlettype=["", "", "float"],
              num_lines_patching=rows, num_lines_presentation=rows)
    _colors(b["box"], color, ["activebgoncolor", "focusbordercolor"])
    return b


def park(b):
    """Take a control off the face (presentation 0): it stays a real, automatable parameter. List its key in the layout's off_face."""
    bx = b["box"]
    bx["presentation"] = 0
    bx.pop("presentation_rect", None)
    return b


def label(oid, text, x, y, w, h=12.0, size=9.0, color=None, bold=False, align=0, hidden=0):
    box = {"fontface": 1 if bold else 0, "fontsize": float(size), "id": oid, "maxclass": "live.comment", "numinlets": 1, "numoutlets": 0,
           "patching_rect": [x + 600.0, y + 600.0, w, h], "presentation": 1, "presentation_rect": [float(x), float(y), float(w), float(h)],
           "text": text, "textjustification": align, "varname": oid}
    if color is not None:
        box["textcolor"] = rgba(color)
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def panel(oid, x, y, w, h, bg=(0.085, 0.095, 0.115), border=(0.20, 0.23, 0.28), rounded=6):
    """A background panel (varname = id so the engine can recolour it from panel_theme). Faces list them LAST."""
    return {"box": {
        "angle": 270.0, "background": 1, "bgcolor": rgba(bg), "border": 1, "bordercolor": rgba(border), "id": oid, "maxclass": "panel",
        "mode": 0, "numinlets": 1, "numoutlets": 0, "varname": oid, "patching_rect": [float(x), 10.0, float(w), float(h)],
        "presentation": 1, "presentation_rect": [float(x), float(y), float(w), float(h)], "rounded": rounded,
    }}


def newobj(oid, text, x, y, w=100.0, ins=1, outs=1, outtypes=None):
    return sc.newobj(oid, text, x, y, w, ins, outs, outtypes)


def msgbox(oid, text, x, y, w=160.0):
    return sc.message(oid, text, x, y, w)


def line(src, so, dst, di):
    return sc.line(src, so, dst, di)


def named(b, varname):
    b["box"]["varname"] = varname
    return b


# ---- faces -----------------------------------------------------------------------------------------------------------

def read(name):
    with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
        return f.read()


def discover_faces():
    """Face module names found in scripts/deviate_faces (every .py except _*.py)."""
    return sorted(f[:-3] for f in os.listdir(FACE_DIR) if f.endswith(".py") and not f.startswith("_"))


def load_face(name):
    sys.path.insert(0, os.path.dirname(FACE_DIR))
    mod = importlib.import_module(f"deviate_faces.{name}")
    importlib.reload(mod)
    lay = mod.layout(sys.modules[__name__])
    lay.setdefault("width", 480.0)
    for k in ("controls", "panels", "extra_boxes", "extra_lines", "canvases", "panel_theme"):
        lay.setdefault(k, [])
    lay.setdefault("off_face", {})
    lay.setdefault("theme", "own")
    return mod, lay


def device_name(mod):
    return f"Deviate {mod.NAME}"


def overlaps(a, b):
    return a[0] < b[0] + b[2] - 0.01 and b[0] < a[0] + a[2] - 0.01 and a[1] < b[1] + b[3] - 0.01 and b[1] < a[1] + a[3] - 0.01


def validate_layout(name, lay):
    """The face contract (scripts/deviate_faces/README.md). Returns a list of problems."""
    problems = []
    W = lay["width"]
    if not (0 < W <= MAX_W):
        problems.append(f"width {W} not in 0..{MAX_W}")
    ids = [b["box"]["id"] for b in lay["controls"] + lay["extra_boxes"] + lay["panels"]] + [c["id"] for c in lay["canvases"]]
    for i in {i for i in ids if ids.count(i) > 1}:
        problems.append(f"duplicate box id {i}")
    reserved = {"obj-engine", "obj-gen", "obj-gen-in", "obj-plugin", "obj-plugout", "obj-loadbang", "obj-thisdevice", "obj-panel-body"}
    for b in lay["extra_boxes"] + [{"box": {"id": c["id"]}} for c in lay["canvases"]]:
        i = b["box"]["id"]
        if i in reserved or i.startswith(("obj-ui-", "obj-scale-", "obj-prep-", "obj-buf-", "obj-msg-", "obj-route-", "obj-state-", "obj-hub-")):
            problems.append(f"box id {i} is reserved for the build (use obj-lay-<name>-...)")
        if not i.startswith("obj-lay-"):
            problems.append(f"box id {i} must start with obj-lay-")
    keys = [b["box"]["id"][len("obj-ctrl-"):] for b in lay["controls"] if b["box"]["id"].startswith("obj-ctrl-")]
    missing = sorted(set(P) - set(keys))
    dup = sorted({k for k in keys if keys.count(k) > 1})
    extra = sorted(set(keys) - set(P))
    if missing:
        problems.append(f"parameters not presented (place them or list them in off_face): {missing}")
    if dup:
        problems.append(f"parameters presented twice: {dup}")
    if extra:
        problems.append(f"widgets for unknown parameters: {extra}")
    for b in lay["controls"]:
        bx = b["box"]
        k = bx["id"][len("obj-ctrl-"):] if bx["id"].startswith("obj-ctrl-") else None
        if k and bx.get("presentation") != 1 and k not in lay["off_face"]:
            problems.append(f"{k} is off the face but not listed in off_face (with a reason)")
        if k and k in lay["off_face"] and bx.get("presentation") == 1 and not bx.get("hidden"):
            problems.append(f"{k} is in off_face but has a visible presentation widget")
    for k, why in lay["off_face"].items():
        if not why:
            problems.append(f"off_face[{k}] needs a reason")
        if k not in P:
            problems.append(f"off_face lists unknown parameter {k}")
    must_show = {f"v_{m.lower()}" for m in METAS} | {f"r_{m.lower()}" for m in METAS} | {"reroll", "mix", "chance", "sens"}
    for k in sorted(must_show & set(lay["off_face"])):
        problems.append(f"{k} must be on the face (Values, Ranges, Reroll, Mix, Chance, Sens are never off_face)")
    pres = [b for b in lay["controls"] + lay["extra_boxes"] + lay["panels"] if b["box"].get("presentation") == 1]
    for b in pres:
        r = b["box"].get("presentation_rect")
        if not r or r[0] < -0.01 or r[1] < -0.01 or r[0] + r[2] > W + 0.01 or r[1] + r[3] > DEVICE_H + 0.01:
            problems.append(f"{b['box']['id']} presentation_rect {r} outside {W}x{DEVICE_H}")
    for c in lay["canvases"]:
        r = c["rect"]
        if c.get("presentation", 1) and (r[0] < 0 or r[1] < 0 or r[0] + r[2] > W + 0.01 or r[1] + r[3] > DEVICE_H + 0.01):
            problems.append(f"canvas {c['id']} rect {r} outside {W}x{DEVICE_H}")
        files = c.get("files") or []
        if not files:
            problems.append(f"canvas {c['id']} has no 'files'")
        for f in files:
            if not os.path.isfile(os.path.join(SRC, f)):
                problems.append(f"canvas {c['id']}: missing src/{f}")
        for k in c.get("keys", []):
            if k not in P:
                problems.append(f"canvas {c['id']} subscribes to unknown parameter {k}")
        if c.get("role", "display") not in ("display", "hit"):
            problems.append(f"canvas {c['id']}: role must be 'display' or 'hit'")
    # rule 4: no live.* over an interactive canvas. An ignoreclick canvas may sit under live.* widgets (UNDER_CONTROLS, spike S1: Live puts
    # v8uis in front of widgets, the engine's dvFrontControls() brings every live.* back to the front).
    live_boxes = [b["box"] for b in lay["controls"] + lay["extra_boxes"]
                  if str(b["box"].get("maxclass", "")).startswith("live.") and b["box"].get("presentation") == 1 and not b["box"].get("hidden")
                  and b["box"].get("maxclass") not in ("live.comment", "live.line")]
    for c in lay["canvases"]:
        if not c.get("presentation", 1) or c.get("hidden"):
            continue
        for bx in live_boxes:
            if overlaps(bx["presentation_rect"], c["rect"]):
                if not c.get("ignoreclick"):
                    problems.append(f"{bx['id']} overlaps interactive canvas {c['id']} (give the canvas ignoreclick or move the widget)")
                elif not UNDER_CONTROLS:
                    problems.append(f"{bx['id']} overlaps canvas {c['id']}: widgets over a canvas are disabled (UNDER_CONTROLS)")
    ids_order = [b["box"]["id"] for b in lay["panels"]]
    for p in lay["panels"]:
        if p["box"].get("background") != 1:
            problems.append(f"panel {p['box']['id']} needs background 1")
    if "obj-panel-body" in ids_order and ids_order[-1] != "obj-panel-body":
        problems.append("the body panel obj-panel-body must be the LAST panel")
    # live.* widgets must not overlap each other
    for i, a in enumerate(live_boxes):
        for c in live_boxes[i + 1:]:
            if overlaps(a["presentation_rect"], c["presentation_rect"]) and a.get("ignoreclick") != 1 and c.get("ignoreclick") != 1:
                problems.append(f"{a['id']} overlaps {c['id']}")
    if lay["theme"] == "ableton":
        for bx in [b["box"] for b in lay["controls"]]:
            saa = bx.get("saved_attribute_attributes", {})
            for attr in COLOR_ATTRS:
                v = bx.get(attr)
                if v is None:
                    continue
                if isinstance(v, list) and len(v) == 4 and v[3] == 0:
                    continue  # fully transparent
                if not (isinstance(saa.get(attr), dict) and "expression" in saa[attr]):
                    problems.append(f"{bx['id']}: ableton-themed face has a static {attr} (bind it with h.theme / no colour attributes)")
    if lay["theme"] not in ("own", "ableton"):
        problems.append(f"theme must be 'own' or 'ableton', got {lay['theme']!r}")
    return problems


# ---- gen -------------------------------------------------------------------------------------------------------------

HIDDEN_CACHE = os.path.join(ROOT, "build_cache", "deviate_hidden.genexpr")


def hidden_gen_text():
    """dv_hidden(mE, mT, hv): the GenExpr function generated from DV_HIDDEN (src/deviate_config.js). Needs node; the result is cached in
    build_cache/ (copied to the VM by the sync) so the VM, which has no node, can still build the gen text for the audio tests."""
    try:
        text = subprocess.check_output(["node", "-e", "process.stdout.write(require('./src/deviate_config.js').dvHiddenGen())"], cwd=ROOT, text=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        if os.path.isfile(HIDDEN_CACHE):
            with open(HIDDEN_CACHE, "r", encoding="utf-8") as f:
                return f.read()
        raise SystemExit("node is not available and build_cache/deviate_hidden.genexpr does not exist (run the build on the host first)")
    os.makedirs(os.path.dirname(HIDDEN_CACHE), exist_ok=True)
    with open(HIDDEN_CACHE, "w", encoding="utf-8") as f:
        f.write(text)
    return text


def pick_functions(text, names):
    """The named top-level GenExpr functions of `text` (with the comment lines right above each), in the order given."""
    lines = text.split("\n")
    out = []
    for n in names:
        start = next((k for k, ln in enumerate(lines) if ln.startswith(n + "(") and ln.rstrip().endswith("{")), None)
        if start is None:
            raise SystemExit(f"function {n} not found")
        top = start
        while top > 0 and lines[top - 1].startswith("//"):
            top -= 1
        end = start
        while lines[end] != "}":
            end += 1
        out.append("\n".join(lines[top:end + 1]))
    return "\n\n".join(out)


def _core_text():
    core = read("deviate_core.genexpr")
    lines = core.split("\n")
    marks = [i for i, ln in enumerate(lines) if ln.strip() == "//@hidden"]
    if len(marks) != 1:
        raise SystemExit("src/deviate_core.genexpr must contain exactly one line `//@hidden`")
    lines[marks[0]] = hidden_gen_text()
    return "\n".join(lines)


def gen_code():
    """fft_init (twiddle table of the convolver) + deviate_conv + deviate_fx + deviate_core, the core's `//@hidden` line replaced by the
    generated dv_hidden function. The main gen has 4 inputs (in1/in2 the audio, in3/in4 the Spectral stage's transient signal) and 2 outputs."""
    parts = [pick_functions(read("cepstrum_lib.genexpr"), ["fft_init"]), read("deviate_conv.genexpr"), read("deviate_fx.genexpr"), _core_text()]
    return "\n".join(p.rstrip() + "\n" for p in parts)


def gendsp_json(code, nin, nout):
    """A gen patcher (in 1..nin -> codebox -> out 1..nout) as .gendsp JSON text (sc.gendsp_json only has 2 inputs)."""
    code = sc.minify_gen(code)

    def b(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {"id": i, "maxclass": cls, "numinlets": ni, "numoutlets": no, "outlettype": [""] * no,
               "patching_rect": [float(x), float(y), 200.0, 22.0]}
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}

    boxes = [b(f"obj-in{k + 1}", f"in {k + 1}", 20 + 100 * k, 20, 0, 1) for k in range(nin)]
    boxes.append(b("obj-code", "", 20, 60, nin, nout, cls="codebox", code=code, fontname="<Monospaced>", fontsize=12.0))
    boxes += [b(f"obj-out{k + 1}", f"out {k + 1}", 20 + 100 * k, 400, 1, 0) for k in range(nout)]
    lines = [{"patchline": {"source": [f"obj-in{k + 1}", 0], "destination": ["obj-code", k]}} for k in range(nin)]
    lines += [{"patchline": {"source": ["obj-code", k], "destination": [f"obj-out{k + 1}", 0]}} for k in range(nout)]
    return json.dumps({"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "dsp.gen", "rect": [50.0, 50.0, 600.0, 450.0], "boxes": boxes, "lines": lines}})


SPEC_LIB = ["fft_init", "fft_run", "stft_win"]
SPEC_SS = ["ss_in", "ss_frame", "ss_mid", "ss_apply", "ss_ola", "ss_out"]


def spec_code():
    """The Spectral split stage: the FFT / STFT helpers it uses + src/deviate_spec.genexpr (a separate gen~, hot-loaded into a shell)."""
    parts = [pick_functions(read("cepstrum_lib.genexpr"), SPEC_LIB), pick_functions(read("spectral_split_lib.genexpr"), SPEC_SS),
             read("deviate_spec.genexpr")]
    return "\n".join(p.rstrip() + "\n" for p in parts)


STUB_CODE = "out1 = in1 * 0;\nout2 = in2 * 0;\n"


def spec_header():
    """GEN_SPEC_TEXT / GEN_SPEC_HASH (the real stage) and GEN_SPEC_STUB / GEN_SPEC_STUB_HASH (the shell's initial silent gen), 2 in / 2 out each."""
    text = gendsp_json(spec_code(), 2, 2)
    stub = gendsp_json(STUB_CODE, 2, 2)
    h = hashlib.sha1(text.encode()).hexdigest()[:12]
    hs = hashlib.sha1(stub.encode()).hexdigest()[:12]
    return (f"var GEN_SPEC_TEXT = {json.dumps(text)};\nvar GEN_SPEC_HASH = \"{h}\";\n"
            f"var GEN_SPEC_STUB = {json.dumps(stub)};\nvar GEN_SPEC_STUB_HASH = \"{hs}\";\n")


def gen_header():
    """The engine script's first lines: GEN_DSP_TEXT / GEN_DSP_HASH (theme_common.wrap_v8ui_code expects exactly this shape)."""
    text = gendsp_json(gen_code(), 4, 2)
    h = hashlib.sha1(text.encode()).hexdigest()[:12]
    return f"var GEN_DSP_TEXT = {json.dumps(text)};\nvar GEN_DSP_HASH = \"{h}\";\n", h


# ---- device ----------------------------------------------------------------------------------------------------------

def v8ui_box(oid, code, rect, patch_xy, outs, presentation=1, varname=None):
    b = sc.v8ui(oid, code, rect, patch_xy, outs, varname)
    if not presentation:
        del b["box"]["presentation"]
        del b["box"]["presentation_rect"]
    return b


def canvas_script(face_name, mod, lay, c):
    """A canvas script: constants, config (+ spectral_theme for ableton faces), the prelude, then the canvas's own files."""
    head = (f"var DV_FACE = {json.dumps(mod.NAME)};\nvar DV_ROLE = {json.dumps(c.get('role', 'display'))};\n"
            f"var DV_THEMED = {'true' if lay['theme'] == 'ableton' else 'false'};\n"
            f"var DV_CANVAS_ID = {json.dumps(c['id'])};\n")
    parts = [head, read("deviate_config.js").rstrip()]
    if lay["theme"] == "ableton":
        parts.append(read("spectral_theme.js").rstrip())
    parts.append(read("deviate_face_common.js").rstrip())
    parts += [read(f).rstrip() for f in c["files"]]
    return "\n\n".join(parts) + "\n"


def engine_script(mod, lay, gen_hdr):
    gen_params = {k: [P[k][8], P[k][9]] for k in P if P[k][8] is not None and k not in ENGINE_GEN}
    consts = (f"var DV_FACE = {json.dumps(mod.NAME)};\nvar DV_ROLE = \"engine\";\nvar DV_PREFIX = \"deviate\";\n"
              f"var DV_GEN_PARAMS = {json.dumps(gen_params)};\n"
              f"var DV_PANEL_THEME = {json.dumps(lay['panel_theme'])};\n"
              f"var DV_VARNAMES = {json.dumps({k: P[k][0] for k in P})};\n"
              f"var DV_SPEC_STAGE = true;\n" + spec_header())
    return (gen_hdr + consts + read("deviate_config.js").rstrip() + "\n\n" + read("deviate_ir.js").rstrip() + "\n\n"
            + read("deviate_dsp.js").rstrip() + "\n\n" + read("deviate_engine.js").rstrip() + "\n")


def build_device(face, out_dir=None):
    mod, lay = load_face(face)
    problems = validate_layout(face, lay)
    if problems:
        raise SystemExit(f"face {face}: " + "; ".join(problems))
    dev_name = device_name(mod)
    gen_hdr, gen_hash = gen_header()
    keys_by_canvas = {c["id"]: set(c.get("keys", ())) for c in lay["canvases"]}

    canvas_boxes = []
    for k, c in enumerate(lay["canvases"]):
        b = v8ui_box(c["id"], canvas_script(face, mod, lay, c), c["rect"], (500.0, 200.0 + 180 * k), c.get("outs", 1),
                     presentation=c.get("presentation", 1))
        if c.get("hidden"):
            b["box"]["hidden"] = 1
        if c.get("ignoreclick"):
            b["box"]["ignoreclick"] = 1
        canvas_boxes.append(b)

    engine = v8ui_box("obj-engine", engine_script(mod, lay, gen_hdr), [0.0, 0.0, 64.0, 16.0], (500.0, 20.0), 4, presentation=0,
                      varname="DeviateEngine")
    e = engine["box"]
    # The state blob lives on the (non-presentation) engine v8ui. Spike S1 must prove it persists in Live; fallback = a 1x1 ignoreclick
    # presentation v8ui carrying it.
    e["parameter_enable"] = 1
    e["saved_attribute_attributes"] = {"valueof": {
        "parameter_initial": [1, 0, 0, 0] + [0] * 16, "parameter_initial_enable": 1, "parameter_invisible": 1,
        "parameter_longname": "DeviateStateData", "parameter_shortname": "DeviateState", "parameter_type": 3}}

    route_keys = list(P)
    boxes = [
        engine,
        *canvas_boxes,
        *lay["controls"],
        named(newobj("obj-plugin", "plugin~", 20, 60, 60, 2, 2, ["signal", "signal"]), "dv_plugin"),
        named(newobj("obj-plugout", "plugout~", 20, 300, 60, 2, 0, []), "dv_plugout"),
        # every gen-bound message goes into this hub (data on its right inlet); the scripted gen~ connects to its outlet.
        # gate 1 1, not t a: a scripted connect from t a silently makes no cord.
        named(newobj("obj-gen-in", "gate 1 1", 20, 100, 60, 2, 1), "dv_genin"),
        # the Spectral stage's own hub (its gen~ shell takes only the `scope` binding): the engine sends it as `specmsg scope <name>`
        named(newobj("obj-spec-in", "gate 1 1", 160, 100, 60, 2, 1), "dv_specin"),
        newobj("obj-route-spec", "route specmsg", 20, 70, 100, 1, 2, ["", ""]),
        newobj("obj-buf-scope", f"buffer~ ---deviatescope @samps {SCOPE_SAMPS}", 480, 300, 260, 1, 2, ["float", "bang"]),
        newobj("obj-buf-ctl", f"buffer~ ---deviatectl @samps {CTL_SAMPS}", 480, 330, 240, 1, 2, ["float", "bang"]),
        newobj("obj-buf-ir", f"buffer~ ---deviateir @samps {IR_SAMPS}", 480, 360, 260, 1, 2, ["float", "bang"]),
        newobj("obj-buf-spec", f"buffer~ ---deviatespec @samps {SPEC_SAMPS} @chans 5", 480, 390, 280, 1, 2, ["float", "bang"]),
        newobj("obj-buf-map", f"buffer~ ---deviatemap @samps {MAP_SAMPS}", 760, 390, 240, 1, 2, ["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 480, 420, 60, 1, 1, ["bang"]),
        # per-instance names: v8ui script strings are NOT expanded, so the patcher passes the `---` names in (Glitch pattern)
        msgbox("obj-msg-names", "names ---deviatescope ---deviatectl ---deviateir ---deviatespec ---deviatetest ---dvstate ---deviatemap", 480, 450, 480),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, 1, 2, ["bang", "int"]),
        msgbox("obj-msg-init", "init_dsp", 780, 430, 70),
        newobj("obj-state-send", "s ---dvstate", 560, 120, 90, 1, 0, []),
        newobj("obj-state-recv", "r ---dvstate", 560, 90, 90, 0, 1),
        newobj("obj-state-test", "r ---deviatetest", 660, 90, 120, 0, 1),
        newobj("obj-route-face", "route param cmd", 560, 280, 110, 1, 3, ["", "", ""]),
        newobj("obj-route-key", "route " + " ".join(route_keys), 560, 310, 600, 1, len(route_keys) + 1),
        newobj("obj-midiin", "midiin", 900, 160, 50, 1, 1),
        newobj("obj-midiparse", "midiparse", 900, 190, 70, 1, 8),
        newobj("obj-stripnote", "stripnote", 900, 220, 70, 2, 2),
        newobj("obj-prep-midinote", "prepend midi_note", 900, 250, 110),
        msgbox("obj-msg-settype", "settype $1", 1040, 220, 80),
        newobj("obj-sync", "plugsync~", 740, 40, 80, 1, 9, ["int", "int", "int", "float", "list", "float", "float", "int", "int"]),
        newobj("obj-play-chg", "change 0", 740, 70, 60, 1, 3, ["", "int", "int"]),
        newobj("obj-prep-play", "prepend dvplay", 740, 100, 100),
    ]
    lines = [
        # silent until the deferred gen~ is wired (no plugin~ -> plugout~ cord)
        line("obj-loadbang", 0, "obj-msg-names", 0), line("obj-msg-names", 0, "obj-engine", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0), line("obj-msg-init", 0, "obj-engine", 0),
        # engine outlets: 0 gen hub, 1 state bus, 2 MIDI From menu (_parameter_range / setsymbol), 3 `<key> <value>` -> the real objects
        line("obj-engine", 0, "obj-route-spec", 0), line("obj-route-spec", 1, "obj-gen", 0),
        line("obj-route-spec", 0, "obj-spec-in", 1), line("obj-engine", 1, "obj-state-send", 0),
        line("obj-engine", 2, "obj-ctrl-midi_in", 0), line("obj-engine", 3, "obj-route-key", 0),
        line("obj-state-test", 0, "obj-engine", 0),
        line("obj-midiin", 0, "obj-midiparse", 0), line("obj-midiparse", 0, "obj-stripnote", 0),
        line("obj-stripnote", 0, "obj-prep-midinote", 0), line("obj-prep-midinote", 0, "obj-engine", 0),
        line("obj-ctrl-midi_in", 0, "obj-msg-settype", 0), line("obj-msg-settype", 0, "obj-engine", 0),
        line("obj-sync", 0, "obj-play-chg", 0), line("obj-play-chg", 0, "obj-prep-play", 0), line("obj-prep-play", 0, "obj-gen", 0),
        # canvases -> parameters / commands
        line("obj-route-face", 0, "obj-route-key", 0), line("obj-route-face", 1, "obj-engine", 0),
    ]
    for c in lay["canvases"]:
        lines.append(line(c["id"], 0, "obj-route-face", 0))
        lines.append(line("obj-msg-names", 0, c["id"], 0))
        lines.append(line("obj-state-recv", 0, c["id"], 0))
    for i, k in enumerate(route_keys):
        lines.append(line("obj-route-key", i, f"obj-ctrl-{k}", 0))
    for i, key in enumerate(P):
        gen_msg, div = P[key][8], P[key][9]
        y = 500.0 + i * 26.0
        ui_id = f"obj-ui-{key}"
        boxes.append(newobj(ui_id, f"prepend set_{key}", 760, y, 110))
        lines.append(line(f"obj-ctrl-{key}", 0, ui_id, 0))
        lines.append(line(ui_id, 0, "obj-engine", 0))
        for cid, ks in keys_by_canvas.items():
            if key in ks:
                lines.append(line(ui_id, 0, cid, 0))
        if gen_msg is None or key in ENGINE_GEN:
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
    sc.to_gen_hub(lines, hub_id="obj-gen-in", gen_id="obj-gen")
    boxes += lay["panels"]  # background panels last (the body panel the very last)
    doc = sc.patcher(boxes, lines, lay["width"], "Transient-triggered, randomised multi-effect for drum fills: every hit draws its own settings.",
                     "Deviate", "drums random effect transient fills", LAT_ENV)
    out = os.path.join(out_dir or OUT_DIR, dev_name + ".amxd")
    sc.write_amxd(doc, out)
    return dev_name, gen_hash


def ir_cache(sr=48000):
    """build_cache/deviate_ir_<sr>.wav: the IR bank spectra the engine builds at run time, for the audio tests (the VM has no node)."""
    out = os.path.join(ROOT, "build_cache", f"deviate_ir_{sr}.wav")
    srcs = [os.path.join(SRC, f) for f in ("deviate_ir.js", "deviate_config.js")] + [os.path.join(ROOT, "scripts", "make_deviate_ir_cache.js")]
    if os.path.isfile(out) and os.path.getmtime(out) >= max(os.path.getmtime(s) for s in srcs):
        return out
    try:
        subprocess.run(["node", srcs[2], str(sr), out], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("note: node is not available, build_cache/deviate_ir_%d.wav was not refreshed" % sr)
    return out


def build_sets(out_dir=None):
    gen = os.path.join(ROOT, "scripts", "make_deviate_set.py")
    if not os.path.isfile(gen):
        return
    subprocess.run([sys.executable, gen, "--devices-dir", out_dir or OUT_DIR, "--out", os.path.join(ROOT, "deviate_test.als")], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("face", nargs="?", default=None, help="build only this face module (default: every face in scripts/deviate_faces)")
    ap.add_argument("--no-sets", action="store_true")
    ap.add_argument("--out-dir", default=None, help="write the devices here instead of devices/ (tests)")
    ap.add_argument("--dump-params", action="store_true", help="print the parameter table as JSON and exit")
    args = ap.parse_args()
    if args.dump_params:
        json.dump(dump_params(), sys.stdout, indent=1)
        print()
        return
    global OUT_DIR
    if args.out_dir:
        OUT_DIR = os.path.abspath(args.out_dir)
    avail = discover_faces()
    if args.face:
        f = args.face.lower()
        if f not in avail:
            raise SystemExit(f"no face {f!r} (found {avail})")
        todo = [f]
    else:
        todo = avail
    hashes = {}
    for f in todo:
        name, h = build_device(f)
        hashes[name] = h
    if len(set(hashes.values())) > 1:
        raise SystemExit(f"GEN_DSP_HASH differs between builds: {hashes}")
    ir_cache()
    if not args.no_sets and not args.face:
        build_sets()


if __name__ == "__main__":
    main()
