#!/usr/bin/env python3
"""
Build devices/Quefrency Crush {A,B,C}.amxd — a creative cepstral codec (Max for Live audio effect).

Signal path: plugin~ -> gen.codebox~ (src/cepstrum_lib.genexpr + src/qcrush_core.genexpr: stereo STFT, real
cepstrum, Coeffs / Bits / Scramble / Shift / Glitch / Phase / Lag) -> plugout~. Latency is a constant 4096
samples for every Size (patcher attribute "latency": 4096, the dry path is delayed identically).

Live parameters (12, shared by the three variants): Size, Coeffs, Bits, Scramble, Amount, Shift, Glitch
(Off/Drop/Rpt/Rev/Hold/Frz), Rate (tempo-synced Glitch slot length), Phase (Orig/Robot/Whisp/Min), Lag,
Mix, Output. Amount doubles as the Glitch probability for Drop/Rpt/Rev. Telemetry (cepstral bars, envelopes,
the 24-frame glitch history, clock) goes through buffer~ #0-qcrushscope into the v8ui, which is the same
script in all three variants (src/qcrush_ui.js); only the layout number differs.

  A (520 x 169)  Coefficient canvas hero (284 x 134 v8ui: bars, history strip, lag spread, phase glyph) + a column
                 of eleven value bars. Drag the canvas to set Coeffs.
  B (520 x 169)  Degrade-style: compact view (182 x 134) + dark LCD matrix (1.SIZE / 2.SCRAMBLE / 3.GLITCH /
                 4.PHASE) over five hero dials (Coeffs, Bits, Shift, Mix, Output).
  C (500 x 169)  Performance: Coeffs x Bits crush pad over the bars (208 x 112), a Glitch pad (click cycles the
                 mode) with the Glitch tab, Rate and Phase, and five dials (Shift, Amount, Lag, Mix, Output).

Usage: build_qcrush.py [--variant a|b|c]    (no argument builds all three)
"""

import argparse
import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT_DIR, "src", "cepstrum_lib.genexpr")
GEN_PATH = os.path.join(ROOT_DIR, "src", "qcrush_core.genexpr")
UI_PATH = os.path.join(ROOT_DIR, "src", "qcrush_ui.js")
DEVICES_DIR = os.path.join(ROOT_DIR, "devices")

DEVICE_H = 169.0
LATENCY = 4096

CYAN = (0.30, 0.82, 0.88)
CORAL = (1.0, 0.52, 0.36)
AMBER = (1.0, 0.77, 0.30)
VIOLET = (0.74, 0.56, 1.0)
ICE = (0.62, 0.82, 1.0)
PINK = (1.0, 0.42, 0.62)

SIZE_ENUM = ["512", "1k", "2k", "4k"]
SCR_ENUM = ["Off", "Rev", "Shuf", "Rot"]
GLITCH_ENUM = ["Off", "Drop", "Rpt", "Rev", "Hold", "Frz"]
RATE_ENUM = ["1/32", "1/16", "1/8", "1/4", "1/2", "1 bar"]
PHASE_ENUM = ["Orig", "Robot", "Whisp", "Min"]

# key: (long_name, short_name, lo, hi, initial, ptype, unitstyle, gen_message, scale, ui_message, help)
# ptype 0 = Float, 1 = Int (<= 255 only), unitstyle 0 = Int, 4 = dB, 5 = percent, 7 = semitones
PARAM_SPECS = {
    "coeffs": (
        "Coeffs", "Coeffs", 0.0, 100.0, 100.0, 0, 5, "coeffs", 0.01, "set_coeffs",
        "Keep only the first K cepstral coefficients: 100% keeps all (neutral), lower values smooth the spectral envelope into a vocoder-like low-bitrate sound (2 coefficients at 0%).",
    ),
    "bits": (
        "Bits", "Bits", 1.0, 16.0, 16.0, 1, 0, "qbits", 1.0, "set_bits",
        "Quantize the cepstral coefficients: 16 is off, lower values step the envelope and thin out the harmonic comb.",
    ),
    "samt": (
        "Amount", "Amt", 0.0, 100.0, 50.0, 0, 5, "samt", 0.01, "set_samt",
        "Scramble amount (blend / rotation distance) and, for Glitch Drop/Rpt/Rev, the chance that a Rate slot fires",
    ),
    "lag": (
        "Lag", "Lag", 0.0, 100.0, 0.0, 0, 5, "qlag", 0.01, "set_lag",
        "Delay each cepstral coefficient by its own number of frames (0..12): 0% is none, higher values smear the spectral envelope and the harmonic comb apart in time.",
    ),
    "shift": (
        "Shift", "Shift", -12.0, 12.0, 0.0, 0, 7, "qshift", 1.0, "set_shift",
        "Move the harmonic comb (excitation) up or down in quefrency while the spectral envelope stays put: inharmonic retuning, +12 keeps only the even partials.",
    ),
    "mix": (
        "Mix", "Mix", 0.0, 100.0, 100.0, 0, 5, "wet", 0.01, "set_mix",
        "Dry/wet mix. The dry path is delayed by the same 4096 samples as the wet path.",
    ),
    "out": (
        "Output", "Out", -36.0, 12.0, 0.0, 0, 4, "outdb", 1.0, "set_out",
        "Output gain in dB.",
    ),
}

# enumerated parameters: key: (long_name, short_name, enum, initial, gen_message, ui_message, help)
ENUM_SPECS = {
    "size": (
        "Size", "Size", SIZE_ENUM, 1, None, "set_size",
        "STFT size: 512, 1024, 2048 or 4096 samples. Larger sizes resolve a finer pitch comb. Latency stays 4096 samples at every size.",
    ),
    "smode": (
        "Scramble", "Scr", SCR_ENUM, 0, "smode", "set_smode",
        "Scramble the envelope coefficients: Reverse flips them, Shuffle uses a seeded permutation that re-rolls on every Glitch slot, Rotate cycles them.",
    ),
    "gmode": (
        "Glitch", "Glitch", GLITCH_ENUM, 0, "gmode", "set_gmode",
        "Cepstral frame glitch, one decision per Rate slot. Drop holds the last received frame and fades it out (packet loss), Rpt loops the last few frames, Rev plays them backwards (Amount is the chance a slot fires). Hold samples the envelope each slot and keeps it while the excitation moves, Frz freezes it. Off follows the input.",
    ),
    "grate": (
        "Rate", "Rate", RATE_ENUM, 1, "grate", "set_grate",
        "Glitch slot length, synced to the Live tempo (and locked to the host position). Hold re-freezes the envelope at this period.",
    ),
    "pmode": (
        "Phase", "Phase", PHASE_ENUM, 0, "pmode", "set_pmode",
        "Phase used to rebuild the crushed spectrum: Orig keeps the input phase, Robot zero phase (single centred pulse per frame), Whisp random phase (noise-like whisper), Min minimum phase (pulse at the frame start).",
    ),
}


def valueof_dict(key):
    long_name, short, lo, hi, initial, ptype, unit, _g, _s, _u, _h = PARAM_SPECS[key]
    return {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": ptype,
        "parameter_unitstyle": unit,
    }


def enum_valueof(key):
    long_name, short, enums, initial, _g, _u, _h = ENUM_SPECS[key]
    return {
        "parameter_annotation_name": long_name,
        "parameter_enum": enums,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": len(enums) - 1,
        "parameter_shortname": short,
        "parameter_type": 2,
        "parameter_unitstyle": 9,
    }


def make_dial(key, x, y, w, h, color):
    long_name, _s, _lo, _hi, _i, _t, _u, _g, _sc, _ui, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activedialcolor": [color[0], color[1], color[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 220.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "varname": long_name,
        }
    }


def make_numbox(key, x, y, w, h, color, appearance=2, fontsize=9.0):
    long_name, _s, _lo, _hi, _i, _t, _u, _g, _sc, _ui, help_text = PARAM_SPECS[key]
    bg = [0.06, 0.075, 0.095, 1.0]
    # Live ignores alpha in activeslidercolor: pre-blend 38% accent + 62% dark background.
    bar = [round(bg[i] * 0.62 + color[i] * 0.38, 4) for i in range(3)] + [1.0]
    return {
        "box": {
            "activebgcolor": bg,
            "activeslidercolor": bar,
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": int(appearance),
            "bordercolor": [0.22, 0.27, 0.33, 1.0],
            "fontface": 1,
            "fontsize": float(fontsize),
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
            "textcolor": [color[0], color[1], color[2], 1.0],
            "varname": long_name,
        }
    }


def make_tab(key, x, y, w, h, color, rows=1, fontsize=8.5):
    long_name, _s, enums, _i, _g, _u, help_text = ENUM_SPECS[key]
    return {
        "box": {
            "activebgoncolor": [color[0], color[1], color[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "bgcolor": [0.07, 0.09, 0.12, 1.0],
            "bgoncolor": [color[0] * 0.45, color[1] * 0.45, color[2] * 0.45, 1.0],
            "bordercolor": [0.22, 0.28, 0.35, 1.0],
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.tab",
            "num_lines_patching": int(rows),
            "num_lines_presentation": int(rows),
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 160.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": enum_valueof(key)},
            "textcolor": [0.68, 0.76, 0.84, 1.0],
            "textoncolor": [0.98, 1.0, 1.0, 1.0],
            "varname": long_name,
        }
    }


def make_menu(key, x, y, w, h, color, fontsize=8.5):
    long_name, _s, _enums, _i, _g, _u, help_text = ENUM_SPECS[key]
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "bordercolor": [color[0], color[1], color[2], 0.8],
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.menu",
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 190.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": enum_valueof(key)},
            "textcolor": [color[0], color[1], color[2], 1.0],
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


# ----- the three layouts: (width, ui widgets, v8ui rect, panels, route targets) -----

def layout_a():
    W = 520.0
    viz = [10.0, 26.0, 284.0, 134.0]
    ui = [
        make_label("obj-title", "Quefrency Crush", 10, 7, 150, 15, size=11.0, color=(0.92, 0.96, 1.0)),
        make_tab("size", 202, 8, 92, 15, CYAN),
    ]
    x_lbl, x_bar, w_bar = 310.0, 356.0, 152.0
    pitch = 14.0
    y0 = 8.0

    def row(i):
        return y0 + i * pitch

    rows = [
        ("coeffs", "Coeffs", CORAL, "bar"),
        ("bits", "Bits", CORAL, "bar"),
        ("shift", "Shift", AMBER, "bipolar"),
        ("smode", "Scramble", VIOLET, "tab"),
        ("samt", "Amount", VIOLET, "bar"),
        ("gmode", "Glitch", ICE, "tab"),
        ("grate", "Rate", ICE, "menu"),
        ("pmode", "Phase", CYAN, "tab"),
        ("lag", "Lag", CYAN, "bar"),
        ("mix", "Mix", CYAN, "bar"),
        ("out", "Output", CYAN, "bar"),
    ]
    for i, (key, text, color, kind) in enumerate(rows):
        y = row(i)
        ui.append(make_label(f"obj-lbl-{key}", text, x_lbl, y, 44, 13, size=8.0, color=color))
        if kind == "bar":
            ui.append(make_numbox(key, x_bar, y, w_bar, 13, color, 2, 8.5))
        elif kind == "bipolar":
            ui.append(make_numbox(key, x_bar, y, w_bar, 13, color, 3, 8.5))
        elif kind == "tab":
            ui.append(make_tab(key, x_bar, y, w_bar, 13, color, fontsize=8.0))
        else:
            ui.append(make_menu(key, x_bar, y, w_bar, 13, color, 8.0))
    panels = [
        make_panel("obj-panel-left", 6, 5, 292, 159, border=(0.20, 0.25, 0.32)),
        make_panel("obj-panel-right", 302, 5, 212, 159, border=(0.30, 0.22, 0.28)),
    ]
    return W, ui, viz, panels, ["coeffs"]


def layout_b():
    W = 520.0
    viz = [10.0, 26.0, 182.0, 134.0]
    ui = [make_label("obj-title", "Quefrency Crush", 10, 7, 150, 15, size=11.0, color=(0.92, 0.96, 1.0))]
    cols = [(208.0, "1. SIZE", CYAN), (284.0, "2. SCRAMBLE", VIOLET), (360.0, "3. GLITCH", ICE), (436.0, "4. PHASE", CYAN)]
    for x, text, color in cols:
        ui.append(make_label(f"obj-hdr-{text[0]}", text, x, 9, 72, 12, size=8.0, color=color))
    ui.append(make_tab("size", 208, 24, 72, 34, CYAN, rows=2))
    ui.append(make_label("obj-lbl-lat", "4096 smp latency", 208, 62, 72, 12, size=7.0, color=(0.52, 0.60, 0.70), bold=False))
    ui.append(make_tab("smode", 284, 24, 72, 34, VIOLET, rows=2))
    ui.append(make_label("obj-lbl-samt", "Amt", 284, 63, 24, 12, size=8.0, color=VIOLET))
    ui.append(make_numbox("samt", 308, 62, 48, 15, VIOLET, 2))
    ui.append(make_tab("gmode", 360, 24, 72, 34, ICE, rows=3, fontsize=8.0))
    ui.append(make_label("obj-lbl-grate", "Rate", 360, 63, 24, 12, size=8.0, color=ICE))
    ui.append(make_menu("grate", 384, 62, 48, 15, ICE))
    ui.append(make_tab("pmode", 436, 24, 72, 34, CYAN, rows=2, fontsize=8.0))
    ui.append(make_label("obj-lbl-lag", "Lag", 436, 63, 24, 12, size=8.0, color=CYAN))
    ui.append(make_numbox("lag", 460, 62, 48, 15, CYAN, 2))
    dials = [("coeffs", CORAL), ("bits", CORAL), ("shift", AMBER), ("mix", CYAN), ("out", CYAN)]
    # five hero dials; Amt, Rate and Lag live in the LCD above
    for i, (key, color) in enumerate(dials):
        ui.append(make_dial(key, 207 + i * 61.0, 104, 58, 52, color))
    panels = [
        make_panel("obj-panel-lcd", 204, 7, 308, 90, bg=(0.045, 0.06, 0.08), border=(0.27, 0.34, 0.42), rounded=5),
        make_panel("obj-panel-left", 6, 5, 190, 159, border=(0.20, 0.25, 0.32)),
        make_panel("obj-panel-right", 200, 5, 314, 159, border=(0.30, 0.22, 0.28)),
    ]
    return W, ui, viz, panels, []


def layout_c():
    W = 500.0
    viz = [10.0, 26.0, 208.0, 112.0]
    ui = [
        make_label("obj-title", "Quefrency Crush", 10, 7, 126, 15, size=11.0, color=(0.92, 0.96, 1.0)),
        make_tab("size", 140, 8, 78, 15, CYAN),
        make_numbox("coeffs", 10, 142, 102, 15, CORAL, 2),
        make_numbox("bits", 116, 142, 102, 15, CORAL, 2),
        make_tab("gmode", 231, 62, 102, 28, ICE, rows=2, fontsize=8.0),
        make_label("obj-lbl-grate", "Rate", 231, 96, 26, 13, size=8.0, color=ICE),
        make_menu("grate", 259, 95, 74, 15, ICE),
        make_label("obj-lbl-pmode", "PHASE", 231, 115, 102, 11, size=7.5, color=CYAN),
        make_tab("pmode", 231, 127, 102, 30, CYAN, rows=2, fontsize=8.0),
        make_dial("shift", 348, 10, 46, 62, AMBER),
        make_dial("samt", 396, 10, 46, 62, VIOLET),
        make_dial("lag", 444, 10, 46, 62, CYAN),
        make_dial("mix", 348, 82, 46, 62, CYAN),
        make_dial("out", 396, 82, 46, 62, CYAN),
        make_label("obj-lbl-smode", "SCRAMBLE", 444, 92, 46, 11, size=7.0, color=VIOLET),
        make_tab("smode", 444, 106, 46, 34, VIOLET, rows=2, fontsize=7.5),
    ]
    panels = [
        make_panel("obj-panel-left", 6, 5, 216, 159, border=(0.20, 0.25, 0.32)),
        make_panel("obj-panel-mid", 226, 5, 112, 159, border=(0.35, 0.50, 0.62)),
        make_panel("obj-panel-right", 342, 5, 152, 159, border=(0.30, 0.22, 0.28)),
    ]
    return W, ui, viz, panels, ["coeffs", "bits"]


LAYOUTS = {"a": (layout_a, 0), "b": (layout_b, 1), "c": (layout_c, 2)}
OUT_NAMES = {"a": "Quefrency Crush A.amxd", "b": "Quefrency Crush B.amxd", "c": "Quefrency Crush C.amxd"}


def build_patcher(variant):
    maker, layout_index = LAYOUTS[variant]
    width, ui_boxes, viz_rect, panels, route_keys = maker()
    with open(LIB_PATH, "r", encoding="utf-8") as f:
        lib_code = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        core_code = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    gen_code = lib_code + "\n" + core_code
    v8_code = f"var QC_LAYOUT_DEFAULT = {layout_index};\n" + ui_js
    face_code = "var QC_LAYOUT_DEFAULT = 3;\n" + ui_js

    present_keys = {b["box"]["id"][len("obj-ctrl-"):] for b in ui_boxes if b["box"]["id"].startswith("obj-ctrl-")}

    boxes = list(ui_boxes)
    boxes.append(
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
                "textfile": {"text": v8_code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
                "varname": "QCrushView",
            }
        }
    )
    if variant == "c":
        # Glitch pad face (mode name + frame history, click cycles the mode). It sits above the Glitch tab, not under it.
        boxes.append(
            {
                "box": {
                    "border": 0,
                    "filename": "none",
                    "id": "obj-glitch-face",
                    "maxclass": "v8ui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [20.0, 400.0, 102.0, 50.0],
                    "presentation": 1,
                    "presentation_rect": [231.0, 9.0, 102.0, 50.0],
                    "textfile": {"text": face_code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
                    "varname": "QCrushGlitchFace",
                }
            }
        )
    boxes.extend(
        [
            newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
            newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
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
                    "varname": "qcrush",
                }
            },
            newobj("obj-scope-buf", "buffer~ #0-qcrushscope @samps 320", 560, 250, 240, numoutlets=2, outlettype=["float", "bang"]),
            newobj("obj-loadbang", "loadbang", 560, 285, 60, outlettype=["bang"]),
            message("obj-msg-ui-buf", "setbuffer #0-qcrushscope", 560, 315, 170),
            message("obj-msg-gen-buf", "scope #0-qcrushscope", 560, 345, 150),
            message("obj-msg-layout", f"set_layout {layout_index}", 560, 375, 100),
            newobj("obj-sync", "plugsync~", 740, 40, 80, numoutlets=9,
                   outlettype=["int", "int", "int", "float", "list", "float", "float", "int", "int"]),
            newobj("obj-bpm-chg", "change 0.", 740, 70, 60, numoutlets=3, outlettype=["", "int", "int"]),
            newobj("obj-bpm-prep", "prepend bpm", 740, 100, 90),
            newobj("obj-ppq-chg", "change -1.", 840, 70, 66, numoutlets=3, outlettype=["", "int", "int"]),
            newobj("obj-ppq-prep", "prepend ppq", 840, 100, 90),
            newobj("obj-size-expr", "expr 512 * pow(2\\, $f1)", 740, 150, 150, outlettype=["float"]),
        ]
    )
    lines = [
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-ui-buf"),
        line("obj-loadbang", 0, "obj-msg-gen-buf"),
        line("obj-loadbang", 0, "obj-msg-layout"),
        line("obj-msg-ui-buf", 0, "obj-viz"),
        line("obj-msg-gen-buf", 0, "obj-gen"),
        line("obj-msg-layout", 0, "obj-viz"),
        line("obj-sync", 5, "obj-bpm-chg"),
        line("obj-bpm-chg", 0, "obj-bpm-prep"),
        line("obj-bpm-prep", 0, "obj-gen"),
        line("obj-sync", 6, "obj-ppq-chg"),
        line("obj-ppq-chg", 0, "obj-ppq-prep"),
        line("obj-ppq-prep", 0, "obj-gen"),
    ]

    row = 0
    for key, spec in PARAM_SPECS.items():
        _l, _s, _lo, _hi, _i, _t, _u, gen_msg, scale, ui_msg, _h = spec
        ctrl = f"obj-ctrl-{key}"
        prep = f"obj-prep-{key}"
        uip = f"obj-ui-{key}"
        y = 560.0 + row * 26.0
        row += 1
        src = ctrl
        if abs(scale - 1.0) > 1e-9:
            scale_id = f"obj-scale-{key}"
            boxes.append(newobj(scale_id, f"* {scale}", 360, y, 56, numinlets=2, outlettype=["float"]))
            lines.append(line(ctrl, 0, scale_id))
            src = scale_id
        boxes.append(newobj(prep, f"prepend {gen_msg}", 424, y, 110))
        boxes.append(newobj(uip, f"prepend {ui_msg}", 540, y, 120))
        lines.append(line(src, 0, prep))
        lines.append(line(prep, 0, "obj-gen"))
        lines.append(line(ctrl, 0, uip))
        lines.append(line(uip, 0, "obj-viz"))
    for key, spec in ENUM_SPECS.items():
        _l, _s, _enums, _i, gen_msg, ui_msg, _h = spec
        ctrl = f"obj-ctrl-{key}"
        uip = f"obj-ui-{key}"
        y = 560.0 + row * 26.0
        row += 1
        boxes.append(newobj(uip, f"prepend {ui_msg}", 540, y, 120))
        lines.append(line(ctrl, 0, uip))
        lines.append(line(uip, 0, "obj-viz"))
        if key == "size":
            lines.append(line(ctrl, 0, "obj-size-expr"))
            boxes.append(newobj("obj-prep-size", "prepend fftn", 424, y, 110))
            lines.append(line("obj-size-expr", 0, "obj-prep-size"))
            lines.append(line("obj-prep-size", 0, "obj-gen"))
        else:
            prep = f"obj-prep-{key}"
            boxes.append(newobj(prep, f"prepend {gen_msg}", 424, y, 110))
            lines.append(line(ctrl, 0, prep))
            lines.append(line(prep, 0, "obj-gen"))
    if variant == "c":
        boxes.append(newobj("obj-route-face", "route gmode", 20, 640, 90, numoutlets=2))
        boxes.append(message("obj-msg-face-layout", "set_layout 3", 560, 405, 100))
        lines += [
            line("obj-loadbang", 0, "obj-msg-face-layout"),
            line("obj-msg-face-layout", 0, "obj-glitch-face"),
            line("obj-msg-ui-buf", 0, "obj-glitch-face"),
            line("obj-ui-gmode", 0, "obj-glitch-face"),
            line("obj-ui-grate", 0, "obj-glitch-face"),
            line("obj-ui-samt", 0, "obj-glitch-face"),
            line("obj-glitch-face", 0, "obj-route-face"),
            line("obj-route-face", 0, "obj-ctrl-gmode"),
        ]

    # Messages from the view (dragging the canvas / pad) set the value boxes, which then drive gen as usual.
    if route_keys:
        boxes.append(newobj("obj-route-viz", "route " + " ".join(route_keys), 20, 560, 150, numoutlets=len(route_keys) + 1))
        lines.append(line("obj-viz", 0, "obj-route-viz"))
        for i, key in enumerate(route_keys):
            lines.append(line("obj-route-viz", i, f"obj-ctrl-{key}"))

    # Background panels MUST be last in boxes with "background": 1
    boxes.extend(panels)

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, width, DEVICE_H],
            "openrect": [0.0, 0.0, width, DEVICE_H],
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
            "devicewidth": width,
            "latency": LATENCY,
            "description": "Creative cepstral codec: truncate, quantize, scramble, shift, glitch and re-phase the real cepstrum",
            "digest": "Crush the cepstrum: Coeffs, Bits, Scramble, Shift, a tempo-synced Glitch (Drop, Repeat, Reverse, Hold, Freeze), Phase modes and per-coefficient Lag",
            "tags": "cepstrum codec glitch vocoder spectral",
            "style": "",
            "subpatcher_template": "",
            "boxes": boxes,
            "lines": lines,
            "parameters": {},
            "dependency_cache": [],
            "autosave": 0,
        }
    }


def write_amxd(patcher, out_path):
    payload = (json.dumps(patcher, indent="\t") + "\n").encode("utf-8")
    header = (
        b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0)
        + b"ptch" + struct.pack("<I", len(payload))
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header + payload)
    w = int(patcher["patcher"]["openrect"][2])
    print(f"Built {out_path} [{w}x169 px] ({len(header) + len(payload)} bytes)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=sorted(LAYOUTS), help="build only this variant (default: all three)")
    args = ap.parse_args()
    for v in ([args.variant] if args.variant else sorted(LAYOUTS)):
        write_amxd(build_patcher(v), os.path.join(DEVICES_DIR, OUT_NAMES[v]))


if __name__ == "__main__":
    main()
