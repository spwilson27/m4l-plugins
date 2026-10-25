#!/usr/bin/env python3
"""Amp+: NAM captures with the controls and layout of Ableton's Amp."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT = sc.ROOT_DIR
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(sc.DEVICES_DIR, "Amp+.amxd")
WIDTH = 496.0

NUM = {
    "gain": ("Gain", "Gain", 0, 100, 50, 0, 9),
    "bass": ("Bass", "Bass", 0, 100, 50, 0, 9),
    "mid": ("Mid", "Mid", 0, 100, 50, 0, 9),
    "treble": ("Treble", "Treble", 0, 100, 50, 0, 9),
    "presence": ("Presence", "Presence", 0, 100, 50, 0, 9),
    "volume": ("Volume", "Volume", 0, 100, 80, 0, 9),
    "position": ("Position", "Pos", 0, 100, 0, 0, 9),
}
NUM_HELP = {
    "gain": "Input level into the capture. 50% is the level the model was made for, from -18 dB to +18 dB.",
    "bass": "Low shelf after the capture, 110 Hz, ±12 dB. 50% is flat.",
    "mid": "Mid peak after the capture, 750 Hz, ±12 dB. 50% is flat.",
    "treble": "High shelf after the capture, 2.2 kHz, ±12 dB. 50% is flat.",
    "presence": "Presence shelf after the capture, 4.5 kHz, ±8 dB. 50% is flat.",
    "volume": "Output level. 100% is unity, 0% is silence.",
    "position": "Microphone position. 0% is the center of the cone, 100% is the edge.",
}
ENUM = {
    "amp": ("Amp Type", "Amp", ["Clean", "Boost", "Blues", "Rock", "Lead", "Heavy", "Bass"], 0),
    "cabon": ("Cabinet On", "Cab", ["Off", "On"], 1),
    "cabtype": ("Cabinet", "CabType", ["1x12", "2x12", "4x10", "4x12", "1x15", "8x10"], 1),
    "mic": ("Mic", "Mic", ["Dynamic", "Condenser"], 0),
}
ENUM_HELP = {
    "amp": "Amp type. Each one loads a Neural Amp Modeler capture: Clean Twin Verb, Boost AC15 Top Boost, Blues King Kong 60s, Rock JCM2000 Crunch, Lead Mark IV, Heavy 5150, Bass dUg preamp.",
    "cabon": "Speaker cabinet. Off leaves the capture and the tone stack only.",
    "cabtype": "Cabinet size. Every cabinet is available on every amp.",
    "mic": "Dynamic is darker with a presence bump. Condenser is more open.",
}
# Control key -> gen Param name. Gain stays in front of neural~, not in the gen.
GEN = {
    "bass": "bass",
    "mid": "mid",
    "treble": "treble",
    "presence": "presence",
    "volume": "volume",
    "cabon": "cab",
    "cabtype": "cabtype",
    "mic": "mic",
    "position": "position",
}
DIALS = ["gain", "bass", "mid", "treble", "presence", "volume"]


def make_dial(key, x, y, w, h):
    valueof = sc.num_valueof(NUM[key])
    valueof["parameter_units"] = "%"
    valueof["parameter_unitstyle"] = 9
    return sc.theme({"box": {
        "annotation": NUM_HELP[key], "annotation_name": NUM[key][0],
        "fontface": 0, "fontname": sc.THEME_FONT, "fontsize": sc.THEME_FONT_SIZE,
        "id": f"obj-ctrl-{key}", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 40.0, float(w), float(h)],
        "presentation": 1, "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": valueof},
        "showname": 1, "shownumber": 1, "varname": NUM[key][0],
    }}, textcolor="live_control_fg")


def make_position(x, y, w, h):
    bg = sc.LIVE_THEME["live_control_bg"]
    accent = sc.LIVE_THEME["live_control_selection"]
    bar = [round(bg[i] * 0.62 + accent[i] * 0.38, 4) for i in range(3)] + [1.0]
    box = sc.make_numbox("position", NUM["position"], NUM_HELP["position"], x, y, w, h, accent, appearance=2,
                         fontsize=sc.THEME_FONT_SIZE, unit_text="%")
    bx = box["box"]
    bx["activebgcolor"] = list(bg)
    bx["activeslidercolor"] = bar
    bx["fontname"] = sc.THEME_FONT
    bx["fontface"] = 0
    return sc.theme(box, textcolor="live_lcd_control_fg_alt", bordercolor="live_lcd_frame")


def make_cab_toggle(x, y, w, h):
    t = sc.make_tab("cabon", ENUM["cabon"], ENUM_HELP["cabon"], x, y, w, h, sc.ORANGE)
    b = t["box"]
    for k in ("num_lines_patching", "num_lines_presentation", "bgoncolor", "textoncolor", "textcolor", "activebgcolor",
              "activebgoncolor", "activetextcolor", "activetextoncolor", "bordercolor", "bgcolor", "activeslidercolor"):
        b.pop(k, None)
    b.update({"maxclass": "live.text", "mode": 1, "numoutlets": 2, "outlettype": ["", ""], "text": "Cab", "texton": "Cab",
              "fontface": 0, "fontname": sc.THEME_FONT, "fontsize": sc.THEME_FONT_SIZE})
    return sc.theme(t, bgcolor="live_control_bg", activebgcolor="live_control_bg", bgoncolor="live_control_selection",
                    activebgoncolor="live_control_selection", textcolor="live_control_fg", activetextcolor="live_control_fg",
                    textoncolor="live_lcd_bg", activetextoncolor="live_lcd_bg", bordercolor="live_desktop")


def sig(obj_id, text, x, y, w, nin=1, nout=1):
    return sc.newobj(obj_id, text, x, y, w, numinlets=nin, numoutlets=nout, outlettype=["signal"] * nout)


def face_code():
    return (sc.read(os.path.join(SRC, "ampplus_models.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_theme.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "ampplus_ui.js")))


def build_patcher():
    face = face_code()
    gen = sc.read(os.path.join(SRC, "ampplus_core.genexpr"))
    boxes = []
    lines = []

    p_amp, amp_chrome = sc.make_section("amp", 4, 4, 488, 114, "Amp", title_w=28)
    p_cab, cab_chrome = sc.make_section("cab", 4, 122, 488, 43, "Cabinet", title_w=52)
    boxes += amp_chrome + cab_chrome

    viz = sc.v8ui("obj-viz", face, [8, 20, 116, 70], (20, 80), 2, varname="amp_viz")
    boxes.append(viz)
    boxes.append(sc.make_theme_menu("amp", ENUM["amp"], ENUM_HELP["amp"], 8, 92, 116, 18))

    for i, key in enumerate(DIALS):
        boxes.append(make_dial(key, 136 + i * 58, 28, 52, 78))

    boxes.append(make_cab_toggle(8, 141, 40, 16))
    boxes.append(sc.make_theme_menu("cabtype", ENUM["cabtype"], ENUM_HELP["cabtype"], 52, 141, 92, 16))
    boxes.append(sc.make_theme_tab("mic", ENUM["mic"], ENUM_HELP["mic"], 150, 141, 160, 16))
    boxes.append(sc.make_theme_comment("obj-lbl-position", "Position", 316, 142, 50))
    boxes.append(make_position(368, 141, 116, 16))

    boxes += [
        sc.newobj("obj-plugin", "plugin~", 20, 220, 60, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.newobj("obj-plugout", "plugout~", 20, 560, 70, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sig("obj-half-l", "*~ 0.5", 100, 220, 50, nin=2),
        sig("obj-half-r", "*~ 0.5", 100, 250, 50, nin=2),
        sig("obj-sum", "+~", 170, 230, 40, nin=2),
        sig("obj-drive", "*~", 230, 230, 40, nin=2),
        sc.newobj("obj-gain-scale", "scale 0. 100. -18. 18.", 300, 180, 150, numinlets=5, numoutlets=1, outlettype=["float"]),
        sc.newobj("obj-gain-db", "dbtoa", 470, 180, 50, numoutlets=1, outlettype=["float"]),
        sig("obj-gain-sig", "sig~ 1.", 540, 180, 60),
        sig("obj-gain-slide", "slide~ 960 960", 620, 180, 90, nin=3),
        sc.newobj("obj-neural", "neural~ @quality 1.", 300, 280, 140, numinlets=1, numoutlets=2, outlettype=["signal", ""]),
        sc.gen_box("obj-gen", gen, "amp_gen", x=300, y=360, numinlets=1, numoutlets=2),
        sc.newobj("obj-route-nam", "route loaded error", 480, 280, 130, numoutlets=3),
        sc.newobj("obj-trig-warm", "t b", 640, 260, 40, numoutlets=1, outlettype=["bang"]),
        sc.message("obj-msg-prewarm", "prewarm", 700, 260, 70),
        sc.newobj("obj-ui-ok", "prepend model_ok", 640, 300, 120),
        sc.newobj("obj-ui-err", "prepend model_err", 640, 330, 120),
        sc.newobj("obj-ui-amp", "prepend set_amp", 160, 120, 110),
    ]
    boxes[-8]["box"]["varname"] = "amp_neural"

    lines += [
        sc.line("obj-plugin", 0, "obj-half-l"),
        sc.line("obj-plugin", 1, "obj-half-r"),
        sc.line("obj-half-l", 0, "obj-sum", 0),
        sc.line("obj-half-r", 0, "obj-sum", 1),
        sc.line("obj-sum", 0, "obj-drive", 0),
        sc.line("obj-ctrl-gain", 0, "obj-gain-scale"),
        sc.line("obj-gain-scale", 0, "obj-gain-db"),
        sc.line("obj-gain-db", 0, "obj-gain-sig"),
        sc.line("obj-gain-sig", 0, "obj-gain-slide"),
        sc.line("obj-gain-slide", 0, "obj-drive", 1),
        sc.line("obj-drive", 0, "obj-neural"),
        sc.line("obj-neural", 0, "obj-gen"),
        sc.line("obj-gen", 0, "obj-plugout", 0),
        sc.line("obj-gen", 1, "obj-plugout", 1),
        sc.line("obj-viz", 0, "obj-neural"),
        sc.line("obj-viz", 1, "obj-ctrl-amp"),
        sc.line("obj-ctrl-amp", 0, "obj-ui-amp"),
        sc.line("obj-ui-amp", 0, "obj-viz"),
        sc.line("obj-neural", 1, "obj-route-nam"),
        sc.line("obj-route-nam", 0, "obj-trig-warm"),
        sc.line("obj-trig-warm", 0, "obj-msg-prewarm"),
        sc.line("obj-msg-prewarm", 0, "obj-neural"),
        sc.line("obj-route-nam", 0, "obj-ui-ok"),
        sc.line("obj-ui-ok", 0, "obj-viz"),
        sc.line("obj-route-nam", 1, "obj-ui-err"),
        sc.line("obj-ui-err", 0, "obj-viz"),
    ]

    y = 420.0
    for key, msg in GEN.items():
        prep = f"obj-prep-{key}"
        boxes.append(sc.newobj(prep, f"prepend {msg}", 20, y, 120))
        lines.append(sc.line(f"obj-ctrl-{key}", 0, prep))
        lines.append(sc.line(prep, 0, "obj-gen"))
        y += 24

    boxes += [p_amp, p_cab, sc.make_body_panel(WIDTH)]
    return sc.patcher(
        boxes, lines, WIDTH,
        "Guitar amp made of Neural Amp Modeler captures, with a tone stack and a mic'd cabinet, laid out like Live's Amp.",
        "Amp+: NAM amp captures with Ableton Amp controls",
        "amp guitar nam neural cabinet",
        0,
    )


def main():
    sc.write_amxd(build_patcher(), OUT)


if __name__ == "__main__":
    main()
