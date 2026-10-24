#!/usr/bin/env python3
"""
Build devices/Cepstra.amxd (256 x 169 px) — a true cepstral formant shifter.

Signal path: plugin~ is not connected until the face has loaded. One Task tick after live.thisdevice the
display v8ui writes the gen patch (.gendsp) and creates `gen~`, then wires
cep_plugin -> gen~ -> cep_plugout, with every gen message through the cep_genin hub (`gate 1 1`).
Until that gen exists the device outputs silence.
Face: normal, visible Ableton-native live.* controls on top (y = 5..73) and the dot-matrix cepstrum display
(`v8ui`, x = 6..350, y = 76..164, the only v8ui) under them across the full width:
  - top row: Auto / MIDI toggles, Lock toggle, Gate Mode and Quality `live.tab`
  - dial row: Res, Mid, Side (adjacent), Gate, Mix (right-most)
The Mid/Side Lock follower and the exclusive Auto / MIDI logic live in the display script; they report back through
`route` -> `prepend set` (silent) into the live objects and the gen hub, so nothing feeds back.
"""
import hashlib
import json
import os
import struct

from minify_embed import minify_patcher
from minify_gen import minify_gen

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "cepstra_config.js")
DISPLAY_PATH = os.path.join(ROOT_DIR, "src", "cepstra_display.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "cepstra_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Cepstra.amxd")

DEVICE_W = 256.0
DEVICE_H = 169.0

CYAN = (0.28, 0.84, 0.96)
ORANGE = (1.0, 0.62, 0.20)
BLUE = (0.42, 0.66, 1.0)
CORAL = (0.96, 0.45, 0.45)
AMBER = (0.96, 0.78, 0.30)

# Continuous parameter specs:
# key: (long_name, short_name, lo, hi, initial, unitstyle, gen_message, scale_factor, ui_message, help_text)
# unitstyle: 5=percent, 7=semitones
PARAM_SPECS = {
    "res": (
        "Res", "Res", 0.0, 100.0, 57.0, 5, "res", 0.01, "set_res",
        "Lifter cutoff. Manual: 0.3 ms to 15 ms of quefrency (log). Auto / MIDI: scales the pitch period (0.3x to 1.0x).",
    ),
    "midshift": (
        "Mid Shift", "Mid", -36.0, 36.0, 0.0, 7, "midshift", 1.0, "set_mid",
        "Formant shift of the Mid channel in semitones (-36 to +36). Harmonics stay put.",
    ),
    "sideshift": (
        "Side Shift", "Side", -36.0, 36.0, 0.0, 7, "sideshift", 1.0, "set_side",
        "Formant shift of the Side channel in semitones (-36 to +36).",
    ),
    "mix": (
        "Mix", "Mix", 0.0, 100.0, 100.0, 5, "wet", 0.01, "set_mix",
        "Equal-power dry/wet mix. The dry path is delayed to stay aligned with the wet signal.",
    ),
    "gate": (
        "Gate", "Gate", 0.0, 100.0, 0.0, 5, "gate", 0.01, "set_gate",
        "Gate amount. Spec mode: removes the noise between partials (bins more than 48 dB at 0% down to 8 dB at 100% below the local partial peak) while partials keep their level. Ceps mode: voicing gate that mutes unpitched frames (breaths, hiss, noise); higher settings let only cleaner pitched sound through.",
    ),
}


ROUTE_OF = {"res": "res", "midshift": "mid", "sideshift": "side", "mix": "mix", "gate": "gate"}


def valueof_dict(key):
    long_name, short, lo, hi, initial, unit, _gen, _scale, _ui, _help = PARAM_SPECS[key]
    return {
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



def presentation(x, y, w, h):
    return {
        "patching_rect": [float(x), float(y), float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
    }


def make_dial(key, x, y, w, h, accent):
    """Visible live.dial with name + value (Reciprocator / Percipitator styling)."""
    long_name, _s, _lo, _hi, _i, _u, _g, _sc, _ui, help_text = PARAM_SPECS[key]
    b = {
        "activedialcolor": [accent[0], accent[1], accent[2], 1.0],
        "activeneedlecolor": [accent[0], accent[1], accent[2], 1.0],
        "annotation": help_text,
        "annotation_name": long_name,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.dial",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": valueof_dict(key)},
        "showname": 1,
        "shownumber": 1,
        "textcolor": [0.82, 0.86, 0.90, 1.0],
        "varname": long_name,
    }
    b.update(presentation(x, y, w, h))
    return {"box": b}


def make_bar(key, x, y, w, h, accent):
    """Horizontal value bar: live.numbox appearance 2 with a pre-blended slider fill (Live ignores alpha there)."""
    long_name, _s, _lo, _hi, _i, _u, _g, _sc, _ui, help_text = PARAM_SPECS[key]
    bg = [0.06, 0.075, 0.095, 1.0]
    bar_rgb = [round(bg[i] * 0.62 + accent[i] * 0.38, 4) for i in range(3)] + [1.0]
    b = {
        "activebgcolor": bg,
        "activeslidercolor": bar_rgb,
        "annotation": help_text,
        "annotation_name": long_name,
        "appearance": 2,
        "bordercolor": [0.22, 0.27, 0.33, 1.0],
        "fontface": 1,
        "fontsize": 9.0,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.numbox",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": valueof_dict(key)},
        "textcolor": [accent[0], accent[1], accent[2], 1.0],
        "varname": long_name,
    }
    b.update(presentation(x, y, w, h))
    return {"box": b}


def enum_valueof(long_name, short_name, enums, initial_idx):
    return {
        "parameter_annotation_name": long_name,
        "parameter_enum": enums,
        "parameter_initial": [initial_idx],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": len(enums) - 1,
        "parameter_shortname": short_name,
        "parameter_type": 2,
        "parameter_unitstyle": 9,
    }


def make_tab(obj_id, long_name, short_name, enums, initial_idx, x, y, w, h, help_text, accent, presented=True, pictures=None):
    b = {
        "activebgoncolor": [accent[0], accent[1], accent[2], 1.0],
        "annotation": help_text,
        "annotation_name": long_name,
        "bgcolor": [0.07, 0.09, 0.12, 1.0],
        "bgoncolor": [accent[0] * 0.45, accent[1] * 0.45, accent[2] * 0.45, 1.0],
        "bordercolor": [0.22, 0.28, 0.35, 1.0],
        "fontface": 1,
        "fontsize": 8.5,
        "id": obj_id,
        "maxclass": "live.tab",
        "num_lines_patching": 1,
        "num_lines_presentation": 1,
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": enum_valueof(long_name, short_name, enums, initial_idx)},
        "textcolor": [0.68, 0.76, 0.84, 1.0],
        "textoncolor": [0.04, 0.05, 0.07, 1.0],
        "varname": long_name,
    }
    if pictures:
        b["pictures"] = list(pictures)
        b["usepicture"] = 1
        b["remapsvgcolors"] = 1
    if presented:
        b.update(presentation(x, y, w, h))
    else:
        b["patching_rect"] = [float(x), float(y), float(w), float(h)]
    return {"box": b}


def make_toggle(obj_id, long_name, short_name, enums, x, y, w, h, text, texton, help_text, accent, pictures=None):
    """Visible live.text toggle (Auto, MIDI, Lock). `pictures` = [off.svg, on.svg] from Live's built-in icon set."""
    vo = enum_valueof(long_name, short_name, enums, 0)
    vo.pop("parameter_unitstyle")
    b = {
        "activebgcolor": [0.10, 0.12, 0.15, 1.0],
        "activebgoncolor": [accent[0], accent[1], accent[2], 1.0],
        "activetextcolor": [0.82, 0.86, 0.90, 1.0],
        "activetextoncolor": [0.04, 0.05, 0.07, 1.0],
        "annotation": help_text,
        "annotation_name": long_name,
        "bordercolor": [accent[0], accent[1], accent[2], 1.0],
        "fontface": 1,
        "fontsize": 8.5,
        "id": obj_id,
        "maxclass": "live.text",
        "mode": 1,
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", ""],
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": vo},
        "text": text,
        "texton": texton,
        "varname": long_name,
    }
    if pictures:
        b["pictures"] = list(pictures)
        b["usepicture"] = 1
        b["remapsvgcolors"] = 1
    b.update(presentation(x, y, w, h))
    return {"box": b}


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


def newobj(obj_id, text, x, y, w, numinlets=1, numoutlets=1, outlettype=None):
    return {
        "box": {
            "fontname": "Arial Bold",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "newobj",
            "numinlets": numinlets,
            "numoutlets": numoutlets,
            "outlettype": outlettype if outlettype is not None else [""] * numoutlets,
            "patching_rect": [float(x), float(y), float(w), 20.0],
            "text": text,
        }
    }


def message(obj_id, text, x, y, w):
    b = newobj(obj_id, text, x, y, w)
    b["box"]["maxclass"] = "message"
    b["box"]["numinlets"] = 2
    return b


def line(src, outlet, dst, inlet=0):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}



def v8ui_box(obj_id, rect, code, varname, ignoreclick, numoutlets=1):
    b = {
        "border": 0,
        "filename": "none",
        "id": obj_id,
        "maxclass": "v8ui",
        "numinlets": 1,
        "numoutlets": numoutlets,
        "outlettype": [""] * numoutlets,
        "patching_rect": [20.0, 110.0, rect[2], rect[3]],
        "presentation": 1,
        "presentation_rect": [float(v) for v in rect],
        "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
        "varname": varname,
    }
    if ignoreclick:
        b["ignoreclick"] = 1
    return {"box": b}


def gendsp_json(gen_code):
    """2-in / 2-out gen patch (in -> codebox -> out) as .gendsp JSON. The face writes it to
    /tmp/cepstra_core_<hash>.gendsp and creates `gen~ @gen <file>` after the GUI is up."""
    gen_code = minify_gen(gen_code)
    def bx(i, text, x, y, ni, no, cls="newobj", **kw):
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
            bx("obj-in1", "in 1", 20, 20, 0, 1), bx("obj-in2", "in 2", 120, 20, 0, 1),
            bx("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
            bx("obj-out1", "out 1", 20, 400, 1, 0), bx("obj-out2", "out 2", 120, 400, 1, 0),
        ],
        "lines": [
            {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-code", 0]}},
            {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-code", 1]}},
            {"patchline": {"source": ["obj-code", 0], "destination": ["obj-out1", 0]}},
            {"patchline": {"source": ["obj-code", 1], "destination": ["obj-out2", 0]}},
        ],
    }}
    return json.dumps(patch)


# Route: face (Lock follower, AUTO/MIDI exclusivity) and display (Res bar drag) -> live objects (silent `set`) + gen
ROUTE_KEYS = ["res", "mid", "side", "resmode", "auto", "midi"]


def build():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(DISPLAY_PATH, "r", encoding="utf-8") as f:
        display_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    gen_text = gendsp_json(gen_code)
    gen_hash = hashlib.sha1(gen_text.encode()).hexdigest()[:12]
    gen_vars = (f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\n"
                f"var GEN_DSP_HASH = \"{gen_hash}\";\n")
    display_code = config_js.rstrip() + "\n\n" + gen_vars + "\n" + display_js

    GREEN = (0.30, 0.86, 0.52)
    NEUTRAL = (0.78, 0.82, 0.88)
    
    boxes = [
        # Display: the only v8ui (interactive cutoff-bar drag); nothing overlaps it.
        v8ui_box("obj-viz-disp", [6.0, 76.0, 244.0, 88.0], display_code, "CepstraDisplay", False, numoutlets=2),
        # Dials (order = existing parameter order: Res, Mid, Mix, Side, Gate); Mid + Side adjacent, Mix at the right edge
        make_dial("res", 6, 26, 46, 46, ORANGE),
        make_dial("midshift", 56, 26, 46, 46, ORANGE),
        make_dial("mix", 204, 26, 46, 46, NEUTRAL),
        make_dial("sideshift", 104, 26, 46, 46, ORANGE),
        make_dial("gate", 154, 26, 46, 46, BLUE),
        make_tab("obj-quality", "Quality", "Quality", ["1k", "2k", "4k"], 1, 204, 6, 46, 16,
                 "FFT size: 1024, 2048 or 4096. Larger sizes resolve finer harmonics but add latency (N + N/8 samples).", NEUTRAL),
        make_tab("obj-gmode", "Gate Mode", "GateMode", ["Spec", "Ceps"], 0, 150, 6, 50, 16,
                 "Gate algorithm: Spec = spectral gate that removes the noise between partials, relative to the local partial peaks; Ceps = voicing gate keyed by the cepstral pitch peak, muting unpitched frames (breaths, hiss, noise) while pitched sound passes.", BLUE,
                 pictures=["Auto_Mute.svg", "release_velocity.svg"]),
        make_toggle("obj-lock", "Lock Mid-Side", "Lock", ["Free", "Lock"], 93, 6, 20, 16, "Lock", "Lock",
                    "Lock Mid and Side: moving one formant shift moves the other by the same amount.", GREEN,
                    pictures=["unlock.svg", "lock.svg"]),
        make_toggle("obj-auto", "Cutoff Auto", "Auto", ["Off", "Auto"], 6, 6, 22, 16, "Auto", "Auto",
                    "AUTO: the lifter cutoff tracks the input pitch period (exclusive with MIDI; both off = Manual).", ORANGE,
                    pictures=["hz.svg", "hz.svg"]),
        make_toggle("obj-midi", "Cutoff MIDI", "MIDI", ["Off", "MIDI"], 30, 6, 22, 16, "MIDI", "MIDI",
                    "MIDI: the lifter cutoff follows the last held MIDI note (exclusive with AUTO; both off = Manual).", ORANGE,
                    pictures=["piano_keys.svg", "piano_keys.svg"]),
        # Cutoff mode parameter (not on the face): AUTO / MIDI toggles map onto it, so existing sets still load
        make_tab("obj-resmode", "Cutoff Mode", "Mode", ["Man", "Auto", "MIDI"], 0, 20, 330, 84, 15,
                 "Lifter cutoff source: Man (Res sets it), Auto (tracks the input pitch period), MIDI (follows the last held note).",
                 ORANGE, presented=False),
    ]
    boxes.extend(
        [
            newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
            newobj("obj-plugout", "plugout~", 20, 460, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
            # Message hub for the deferred gen~ (data into inlet 1; outlet 0 is wired to gen~ after load).
            # plugin~ is left unconnected so the device stays silent until that gen~ is created.
            newobj("obj-gen-in", "gate 1 1", 120, 300, 70, numinlets=2, numoutlets=1, outlettype=[""]),
            newobj("obj-scope-buf", "buffer~ #0-cepscope @samps 272", 560, 250, 220, numoutlets=2, outlettype=["float", "bang"]),
            newobj("obj-loadbang", "loadbang", 560, 315, 60, outlettype=["bang"]),
            message("obj-msg-ui-buf", "setbuffer #0-cepscope", 560, 345, 160),
            message("obj-msg-gen-buf", "scope #0-cepscope", 560, 375, 140),
            newobj("obj-midiin", "midiin", 20, 500, 48, outlettype=["int"]),
            newobj("obj-midiparse", "midiparse", 20, 528, 82, numoutlets=7, outlettype=["", "", "", "int", "int", "", "int"]),
            newobj("obj-midi-unpack", "unpack 0 0", 20, 556, 70, numoutlets=2, outlettype=["int", "int"]),
            newobj("obj-midi-on", "> 0", 100, 584, 36, numinlets=2, outlettype=["int"]),
            newobj("obj-midi-gate", "gate", 20, 612, 40, numinlets=2, outlettype=[""]),
            newobj("obj-prep-midinote", "prepend midinote", 20, 640, 110),
            newobj("obj-prep-midi-ui", "prepend midi_note", 140, 640, 120),
            newobj("obj-route-viz", "route " + " ".join(ROUTE_KEYS), 20, 215, 300, numoutlets=len(ROUTE_KEYS) + 1),
        ]
    )

    lines = [
        # No plugin~ -> plugout~ cord: silence until cepDspLoad wires the gen~.
        line("obj-loadbang", 0, "obj-msg-ui-buf"),
        line("obj-loadbang", 0, "obj-msg-gen-buf"),
        line("obj-msg-ui-buf", 0, "obj-viz-disp"),
        line("obj-msg-gen-buf", 0, "obj-gen-in", 1),
        # Resend outlet (buffer bind + stored parameters) lands on the hub, not on a live.text toggle.
        line("obj-viz-disp", 1, "obj-gen-in", 1),
        # MIDI: the last note-on wins; note-offs close the gate so the last note is kept.
        line("obj-midiin", 0, "obj-midiparse"),
        line("obj-midiparse", 0, "obj-midi-unpack"),
        line("obj-midi-unpack", 1, "obj-midi-on"),
        line("obj-midi-on", 0, "obj-midi-gate", 0),
        line("obj-midi-unpack", 0, "obj-midi-gate", 1),
        line("obj-midi-gate", 0, "obj-prep-midinote"),
        line("obj-midi-gate", 0, "obj-prep-midi-ui"),
        line("obj-prep-midinote", 0, "obj-gen-in", 1),
        line("obj-prep-midi-ui", 0, "obj-viz-disp"),
        # Both v8ui halves report into one router
        line("obj-viz-disp", 0, "obj-route-viz"),
    ]

    def rport(key):
        return ROUTE_KEYS.index(key)

    # resmode: AUTO/MIDI logic (display script) -> route -> silent set of the hidden tab + gen; the tab -> display
    boxes.append(newobj("obj-prep-resmode", "prepend resmode", 560, 410, 110))
    boxes.append(newobj("obj-ui-resmode", "prepend set_mode", 680, 410, 120))
    boxes.append(newobj("obj-set-resmode", "prepend set", 700, 440, 75))
    lines += [
        line("obj-resmode", 0, "obj-prep-resmode"),
        line("obj-prep-resmode", 0, "obj-gen-in", 1),
        line("obj-resmode", 0, "obj-ui-resmode"),
        line("obj-ui-resmode", 0, "obj-viz-disp"),
        line("obj-route-viz", rport("resmode"), "obj-set-resmode"),
        line("obj-set-resmode", 0, "obj-resmode"),
        line("obj-route-viz", rport("resmode"), "obj-prep-resmode"),
        line("obj-route-viz", rport("resmode"), "obj-ui-resmode"),
    ]
    # AUTO / MIDI toggles: live.text -> display script; its exclusivity -> route -> silent set of the other toggle
    for name, y in (("auto", 470), ("midi", 500)):
        boxes.append(newobj(f"obj-ui-{name}", f"prepend set_{name}", 560, y, 120))
        boxes.append(newobj(f"obj-set-{name}", "prepend set", 700, y, 75))
        lines += [
            line(f"obj-{name}", 0, f"obj-ui-{name}"),
            line(f"obj-ui-{name}", 0, "obj-viz-disp"),
            line("obj-route-viz", rport(name), f"obj-set-{name}"),
            line(f"obj-set-{name}", 0, f"obj-{name}"),
        ]
    # Quality -> gen + display
    boxes.append(newobj("obj-prep-quality", "prepend quality", 560, 530, 110))
    boxes.append(newobj("obj-ui-quality", "prepend set_quality", 680, 530, 130))
    lines += [
        line("obj-quality", 0, "obj-prep-quality"),
        line("obj-prep-quality", 0, "obj-gen-in", 1),
        line("obj-quality", 0, "obj-ui-quality"),
        line("obj-ui-quality", 0, "obj-viz-disp"),
    ]
    # Gate Mode -> gen + display
    boxes.append(newobj("obj-prep-gatemode", "prepend gatemode", 560, 590, 110))
    boxes.append(newobj("obj-ui-gmode", "prepend set_gmode", 680, 590, 130))
    lines += [
        line("obj-gmode", 0, "obj-prep-gatemode"),
        line("obj-prep-gatemode", 0, "obj-gen-in", 1),
        line("obj-gmode", 0, "obj-ui-gmode"),
        line("obj-ui-gmode", 0, "obj-viz-disp"),
    ]
    # Lock -> display script (it holds the Mid/Side link logic)
    boxes.append(newobj("obj-ui-lock", "prepend set_lock", 560, 560, 120))
    lines += [line("obj-lock", 0, "obj-ui-lock"), line("obj-ui-lock", 0, "obj-viz-disp")]

    for i, (key, spec) in enumerate(PARAM_SPECS.items()):
        _long, _short, _lo, _hi, _init, _unit, gen_msg, scale_factor, ui_msg, _help = spec
        ctrl_id = f"obj-ctrl-{key}"
        prep_id = f"obj-prep-{key}"
        ui_id = f"obj-ui-{key}"
        row_y = 630.0 + i * 26.0
        if scale_factor != 1.0:
            scale_id = f"obj-scale-{key}"
            boxes.append(newobj(scale_id, "* 0.01", 360, row_y, 56, numinlets=2, outlettype=["float"]))
            lines.append(line(ctrl_id, 0, scale_id))
            src_id = scale_id
        else:
            src_id = ctrl_id
        boxes.append(newobj(prep_id, f"prepend {gen_msg}", 424, row_y, 120))
        lines.append(line(src_id, 0, prep_id))
        lines.append(line(prep_id, 0, "obj-gen-in", 1))
        if key in ("res", "midshift", "sideshift", "gate", "mix"):
            # the display holds the Lock / cutoff-bar state, so it needs these values
            boxes.append(newobj(ui_id, f"prepend {ui_msg}", 550, row_y, 120))
            lines.append(line(ctrl_id, 0, ui_id))
            lines.append(line(ui_id, 0, "obj-viz-disp"))
        route_key = {"res": "res", "midshift": "mid", "sideshift": "side"}.get(key)
        if route_key:
            # face / display drag or Lock follower -> silent `set` of the live object + gen
            set_id = f"obj-set-{key}"
            boxes.append(newobj(set_id, "prepend set", 680, row_y, 75))
            lines.append(line("obj-route-viz", rport(route_key), set_id))
            lines.append(line(set_id, 0, ctrl_id))
            lines.append(line("obj-route-viz", rport(route_key), src_id if scale_factor != 1.0 else prep_id))

    # live.thisdevice ready bang -> init_dsp on the display (deferred gen~, after the face can paint).
    boxes.append(newobj("obj-thisdevice", "live.thisdevice", 420, 200, 100, numinlets=1, numoutlets=2, outlettype=["bang", "int"]))
    boxes.append(message("obj-msg-init-dsp", "init_dsp", 420, 230, 70))
    lines += [
        line("obj-thisdevice", 0, "obj-msg-init-dsp"),
        line("obj-msg-init-dsp", 0, "obj-viz-disp"),
    ]
    for bx in boxes:
        vid = bx["box"].get("id")
        if vid == "obj-gen-in":
            bx["box"]["varname"] = "cep_genin"
        elif vid == "obj-plugin":
            bx["box"]["varname"] = "cep_plugin"
        elif vid == "obj-plugout":
            bx["box"]["varname"] = "cep_plugout"

    # Background panel MUST be last in boxes and have "background": 1

    boxes.append(make_panel("obj-panel-left", 4, 5, 248, 68))
    boxes.append(make_panel("obj-panel-disp", 4, 75, 248, 90, bg=(0.0, 0.0, 0.0), border=(0.24, 0.24, 0.24), rounded=9))

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
            "description": "True cepstral formant shifter with harmonic gate",
            "digest": "Shift vocal formants independently of pitch with STFT cepstral liftering, Mid/Side processing and a harmonic gate",
            "tags": "cepstrum formant shifter spectral vocal",
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
    print(f"Built {OUT_AMXD_PATH} [{int(DEVICE_W)}x169 px] ({len(header) + len(payload)} bytes)")


if __name__ == "__main__":
    build()
