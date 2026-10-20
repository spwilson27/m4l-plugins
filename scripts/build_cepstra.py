#!/usr/bin/env python3
"""
Build devices/Cepstra.amxd (520 x 169 px) — a true cepstral formant shifter.

Signal path: plugin~ -> gen.codebox~ (STFT overlap-add, own radix-2 FFT, Mid/Side cepstral lifter) -> plugout~.
The whole face is ONE v8ui (`obj-viz`, 520 x 169): header pills + title tab, five flat glyph knobs
(Res, Mid, Mix, Side, Gate), Mid/Side padlock, Formant / Harmonic dot sliders, Quality selector and the
dot-matrix cepstrum display with a draggable lifter-cutoff bar.
Every parameter is still a real live.* object (kept OFF the presentation face) so it automates, saves and maps.
v8ui drag -> `route` -> `prepend set` -> live object (silent, no echo) + gen;
live automation -> `prepend set_x` -> v8ui redraw.
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "cepstra_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "cepstra_ui.js")
DISPLAY_PATH = os.path.join(ROOT_DIR, "src", "cepstra_display.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "cepstra_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Cepstra.amxd")

DEVICE_W = 520.0
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
        "Harmonic gate: removes the noise between partials (threshold 0 to +30 dB above the envelope) while partials keep the formant envelope.",
    ),
    "fmtlevel": (
        "Formant", "Formant", 0.0, 200.0, 100.0, 5, "fmtlevel", 0.01, "set_fmt",
        "Level of the formant (envelope) layer, 0 to 200%.",
    ),
    "harmlevel": (
        "Harmonic", "Harmonic", 0.0, 200.0, 100.0, 5, "harmlevel", 0.01, "set_harm",
        "Level of the harmonic (fine structure) layer, 0 to 200%.",
    ),
}


ROUTE_KEYS = ["res", "mid", "side", "mix", "gate", "fmt", "harm", "quality", "resmode", "lock"]
ROUTE_OF = {"res": "res", "midshift": "mid", "sideshift": "side", "mix": "mix", "gate": "gate", "fmtlevel": "fmt", "harmlevel": "harm"}


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



ZERO = [0.0, 0.0, 0.0, 0.0]


def zero_colors(keys):
    return {k: list(ZERO) for k in keys}


# Every colour attribute each transparent maxclass has (all set to alpha 0 so nothing draws)
DIAL_COLORS = ["activedialcolor", "activeneedlecolor", "dialcolor", "needlecolor", "textcolor", "tricolor",
               "tribordercolor", "panelcolor", "bordercolor", "bgcolor", "focusbordercolor"]
SLIDER_COLORS = ["activeslidercolor", "slidercolor", "bgcolor", "activebgcolor", "bordercolor", "textcolor",
                 "tricolor", "tribordercolor", "focusbordercolor", "activetricolor"]
TAB_COLORS = ["activebgcolor", "activebgoncolor", "bgcolor", "bgoncolor", "bordercolor", "textcolor", "textoncolor",
              "activetextcolor", "activetextoncolor", "focusbordercolor"]
TEXT_COLORS = TAB_COLORS


def presentation(x, y, w, h):
    return {
        "patching_rect": [float(x), float(y), float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
    }


def make_t_dial(key, x, y, w, h):
    """Fully transparent live.dial: native drag, shift-fine, double-click reset, automation, mapping."""
    long_name, _s, _lo, _hi, _i, _u, _g, _sc, _ui, help_text = PARAM_SPECS[key]
    b = {
        "annotation": help_text,
        "annotation_name": long_name,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.dial",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": valueof_dict(key)},
        "showname": 0,
        "shownumber": 0,
        "varname": long_name,
    }
    b.update(zero_colors(DIAL_COLORS))
    b.update(presentation(x, y, w, h))
    return {"box": b}


def make_t_slider(key, x, y, w, h):
    """Fully transparent horizontal live.slider (Formant / Harmonic dot bars)."""
    long_name, _s, _lo, _hi, _i, _u, _g, _sc, _ui, help_text = PARAM_SPECS[key]
    b = {
        "annotation": help_text,
        "annotation_name": long_name,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.slider",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "orientation": 0,
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": valueof_dict(key)},
        "showname": 0,
        "shownumber": 0,
        "varname": long_name,
    }
    b.update(zero_colors(SLIDER_COLORS))
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


def make_t_tab(obj_id, long_name, short_name, enums, initial_idx, x, y, w, h, help_text, presented=True):
    b = {
        "annotation": help_text,
        "annotation_name": long_name,
        "id": obj_id,
        "maxclass": "live.tab",
        "num_lines_patching": 1,
        "num_lines_presentation": 1,
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": enum_valueof(long_name, short_name, enums, initial_idx)},
        "varname": long_name,
    }
    b.update(zero_colors(TAB_COLORS))
    if presented:
        b.update(presentation(x, y, w, h))
    else:
        b["patching_rect"] = [float(x), float(y), float(w), float(h)]
    return {"box": b}


def make_t_toggle(obj_id, long_name, short_name, enums, x, y, w, h, help_text):
    """Fully transparent live.text toggle (Lock, AUTO and MIDI pills)."""
    vo = enum_valueof(long_name, short_name, enums, 0)
    vo.pop("parameter_unitstyle")
    b = {
        "annotation": help_text,
        "annotation_name": long_name,
        "id": obj_id,
        "maxclass": "live.text",
        "mode": 1,
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", ""],
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": vo},
        "text": "",
        "texton": "",
        "varname": long_name,
    }
    b.update(zero_colors(TEXT_COLORS))
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



def v8ui_box(obj_id, rect, code, varname, ignoreclick):
    b = {
        "border": 0,
        "filename": "none",
        "id": obj_id,
        "maxclass": "v8ui",
        "numinlets": 1,
        "numoutlets": 1,
        "outlettype": [""],
        "patching_rect": [20.0, 80.0 if obj_id == "obj-viz" else 110.0, rect[2], rect[3]],
        "presentation": 1,
        "presentation_rect": [float(v) for v in rect],
        "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
        "varname": varname,
    }
    if ignoreclick:
        b["ignoreclick"] = 1
    return {"box": b}


# Route: face (Lock follower, AUTO/MIDI exclusivity) and display (Res bar drag) -> live objects (silent `set`) + gen
ROUTE_KEYS = ["res", "mid", "side", "resmode", "auto", "midi"]


def build():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        face_js = f.read()
    with open(DISPLAY_PATH, "r", encoding="utf-8") as f:
        display_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    face_code = config_js.rstrip() + "\n\n" + face_js
    display_code = config_js.rstrip() + "\n\n" + display_js

    FACE_W = 290.0
    knob_cx = [35 + 54 * i for i in range(5)]

    boxes = [
        # Face: draws only (ignoreclick). The transparent live.* widgets below sit in FRONT of it.
        v8ui_box("obj-viz", [0.0, 0.0, FACE_W, DEVICE_H], face_code, "CepstraFace", True),
        # Display: interactive (cutoff-bar drag). No live.* widget overlaps it.
        v8ui_box("obj-viz-disp", [FACE_W, 0.0, DEVICE_W - FACE_W, DEVICE_H], display_code, "CepstraDisplay", False),
        # Transparent control widgets (presentation, after the v8ui in z-order)
        make_t_dial("res", knob_cx[0] - 20, 30, 40, 40),
        make_t_dial("midshift", knob_cx[1] - 20, 30, 40, 40),
        make_t_dial("mix", knob_cx[2] - 20, 30, 40, 40),
        make_t_dial("sideshift", knob_cx[3] - 20, 30, 40, 40),
        make_t_dial("gate", knob_cx[4] - 20, 30, 40, 40),
        make_t_slider("fmtlevel", 62, 114, 160, 12),
        make_t_slider("harmlevel", 62, 130, 160, 12),
        make_t_tab("obj-quality", "Quality", "Quality", ["1k", "2k", "4k"], 1, 62, 146, 108, 14,
                   "FFT size: 1024, 2048 or 4096. Larger sizes resolve finer harmonics but add latency (N + N/8 samples)."),
        make_t_toggle("obj-lock", "Lock Mid-Side", "Lock", ["Free", "Lock"], knob_cx[2] - 10, 90, 20, 20,
                      "Lock Mid and Side: moving one formant shift moves the other by the same amount."),
        make_t_toggle("obj-auto", "Cutoff Auto", "Auto", ["Off", "Auto"], 10, 6, 52, 16,
                      "AUTO: the lifter cutoff tracks the input pitch period (exclusive with MIDI; both off = Manual)."),
        make_t_toggle("obj-midi", "Cutoff MIDI", "MIDI", ["Off", "MIDI"], 222, 6, 52, 16,
                      "MIDI: the lifter cutoff follows the last held MIDI note (exclusive with AUTO; both off = Manual)."),
        # Cutoff mode parameter kept (not on the face) so existing sets and automation of it still load
        make_t_tab("obj-resmode", "Cutoff Mode", "Mode", ["Man", "Auto", "MIDI"], 0, 20, 330, 84, 15,
                   "Lifter cutoff source: Man (Res sets it), Auto (tracks the input pitch period), MIDI (follows the last held note).",
                   presented=False),
    ]
    boxes.extend(
        [
            newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
            newobj("obj-plugout", "plugout~", 20, 460, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
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
                    "varname": "cepstra",
                }
            },
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
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-ui-buf"),
        line("obj-loadbang", 0, "obj-msg-gen-buf"),
        line("obj-msg-ui-buf", 0, "obj-viz-disp"),
        line("obj-msg-gen-buf", 0, "obj-gen"),
        # MIDI: the last note-on wins; note-offs close the gate so the last note is kept.
        line("obj-midiin", 0, "obj-midiparse"),
        line("obj-midiparse", 0, "obj-midi-unpack"),
        line("obj-midi-unpack", 1, "obj-midi-on"),
        line("obj-midi-on", 0, "obj-midi-gate", 0),
        line("obj-midi-unpack", 0, "obj-midi-gate", 1),
        line("obj-midi-gate", 0, "obj-prep-midinote"),
        line("obj-midi-gate", 0, "obj-prep-midi-ui"),
        line("obj-prep-midinote", 0, "obj-gen"),
        line("obj-prep-midi-ui", 0, "obj-viz-disp"),
        # Both v8ui halves report into one router
        line("obj-viz", 0, "obj-route-viz"),
        line("obj-viz-disp", 0, "obj-route-viz"),
    ]

    def rport(key):
        return ROUTE_KEYS.index(key)

    # resmode: face (AUTO/MIDI toggles) -> route -> silent set of the hidden tab + gen; the tab -> face + display
    boxes.append(newobj("obj-prep-resmode", "prepend resmode", 560, 410, 110))
    boxes.append(newobj("obj-ui-resmode", "prepend set_mode", 680, 410, 120))
    boxes.append(newobj("obj-set-resmode", "prepend set", 700, 440, 75))
    lines += [
        line("obj-resmode", 0, "obj-prep-resmode"),
        line("obj-prep-resmode", 0, "obj-gen"),
        line("obj-resmode", 0, "obj-ui-resmode"),
        line("obj-ui-resmode", 0, "obj-viz"),
        line("obj-ui-resmode", 0, "obj-viz-disp"),
        line("obj-route-viz", rport("resmode"), "obj-set-resmode"),
        line("obj-set-resmode", 0, "obj-resmode"),
        line("obj-route-viz", rport("resmode"), "obj-prep-resmode"),
        line("obj-route-viz", rport("resmode"), "obj-ui-resmode"),
    ]
    # AUTO / MIDI toggles: live.text -> face; face -> route -> silent set of the other toggle
    for name, y in (("auto", 470), ("midi", 500)):
        boxes.append(newobj(f"obj-ui-{name}", f"prepend set_{name}", 560, y, 120))
        boxes.append(newobj(f"obj-set-{name}", "prepend set", 700, y, 75))
        lines += [
            line(f"obj-{name}", 0, f"obj-ui-{name}"),
            line(f"obj-ui-{name}", 0, "obj-viz"),
            line("obj-route-viz", rport(name), f"obj-set-{name}"),
            line(f"obj-set-{name}", 0, f"obj-{name}"),
        ]
    # Quality -> gen + face + display
    boxes.append(newobj("obj-prep-quality", "prepend quality", 560, 530, 110))
    boxes.append(newobj("obj-ui-quality", "prepend set_quality", 680, 530, 130))
    lines += [
        line("obj-quality", 0, "obj-prep-quality"),
        line("obj-prep-quality", 0, "obj-gen"),
        line("obj-quality", 0, "obj-ui-quality"),
        line("obj-ui-quality", 0, "obj-viz"),
        line("obj-ui-quality", 0, "obj-viz-disp"),
    ]
    # Lock -> face (the face holds the Mid/Side link logic)
    boxes.append(newobj("obj-ui-lock", "prepend set_lock", 560, 560, 120))
    lines += [line("obj-lock", 0, "obj-ui-lock"), line("obj-ui-lock", 0, "obj-viz")]

    for i, (key, spec) in enumerate(PARAM_SPECS.items()):
        _long, _short, _lo, _hi, _init, _unit, gen_msg, scale_factor, ui_msg, _help = spec
        ctrl_id = f"obj-ctrl-{key}"
        prep_id = f"obj-prep-{key}"
        ui_id = f"obj-ui-{key}"
        row_y = 600.0 + i * 26.0
        if scale_factor != 1.0:
            scale_id = f"obj-scale-{key}"
            boxes.append(newobj(scale_id, "* 0.01", 360, row_y, 56, numinlets=2, outlettype=["float"]))
            lines.append(line(ctrl_id, 0, scale_id))
            src_id = scale_id
        else:
            src_id = ctrl_id
        boxes.append(newobj(prep_id, f"prepend {gen_msg}", 424, row_y, 120))
        boxes.append(newobj(ui_id, f"prepend {ui_msg}", 550, row_y, 120))
        lines.append(line(src_id, 0, prep_id))
        lines.append(line(prep_id, 0, "obj-gen"))
        lines.append(line(ctrl_id, 0, ui_id))
        lines.append(line(ui_id, 0, "obj-viz"))
        if key == "res":
            lines.append(line(ui_id, 0, "obj-viz-disp"))
        route_key = {"res": "res", "midshift": "mid", "sideshift": "side"}.get(key)
        if route_key:
            # face / display drag or Lock follower -> silent `set` of the live object + gen
            set_id = f"obj-set-{key}"
            boxes.append(newobj(set_id, "prepend set", 680, row_y, 75))
            lines.append(line("obj-route-viz", rport(route_key), set_id))
            lines.append(line(set_id, 0, ctrl_id))
            lines.append(line("obj-route-viz", rport(route_key), src_id if scale_factor != 1.0 else prep_id))
            if key == "res":
                lines.append(line("obj-route-viz", rport("res"), ui_id))  # face glyph follows a display drag

    # Background panel MUST be last in boxes and have "background": 1

    boxes.append(make_panel("obj-panel", 0, 0, DEVICE_W, DEVICE_H, bg=(0.0, 0.0, 0.0), border=(0.24, 0.24, 0.24), rounded=9))

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
