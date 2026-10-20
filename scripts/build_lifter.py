#!/usr/bin/env python3
"""
Build devices/Lifter A.amxd, Lifter B.amxd and Lifter C.amxd (stereo audio effects).

Lifter is an EQ for the quefrency axis: STFT -> real cepstrum -> user-drawn lifter
gain curve over log-quefrency -> log-magnitude -> exp, original phase -> overlap-add.
All three variants share the same DSP (src/cepstrum_lib.genexpr + src/lifter_core.genexpr),
the same parameter set and the same v8ui script (src/lifter_ui.js). Only the layout
differs; the v8ui is told its layout with a `layout a|b|c` message at loadbang.

  A  "Canvas"  448 x 169  big curve canvas (316 x 152) + compact value bars on the right.
  B  "Dials"   340 x 169  classic dial row under a smaller cepstrum strip (320 x 82).
  C  "Perform" 340 x 169  XY bell macro pad (206 x 152) + two big dials and a few pills.

Usage: build_lifter.py [--variant a|b|c]   (no argument builds all three)
"""

import argparse
import json
import os
import re
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT_DIR, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT_DIR, "src", "lifter_core.genexpr")
UI_PATH = os.path.join(ROOT_DIR, "src", "lifter_ui.js")
OUT_DIR = os.path.join(ROOT_DIR, "devices")

DEVICE_H = 169.0
LATENCY = 4096

BG_DARK = (0.052, 0.064, 0.082)

VIOLET = (0.74, 0.58, 0.98)
AMBER = (0.98, 0.74, 0.30)
MINT = (0.40, 0.92, 0.72)
CYAN = (0.30, 0.80, 0.96)
SLATE = (0.76, 0.82, 0.90)

# name: (long, short, lo, hi, initial, unitstyle, gen_param, ui_msg, help)
NUM_SPECS = {
    "depth": ("Depth", "Depth", -100.0, 100.0, 100.0, 5, "depthp", "set_depth",
              "Scales the curve in dB. Negative values invert it."),
    "smooth": ("Smooth", "Smooth", 0.0, 100.0, 20.0, 5, "smoothp", "set_smooth",
               "Smooths the lifter's effect across frames (0 to 400 ms)."),
    "mix": ("Mix", "Mix", 0.0, 100.0, 100.0, 5, "wetp", "set_mix",
            "Dry/wet blend. Dry is delayed to match the 4096 sample latency."),
    "out": ("Output", "Output", -24.0, 24.0, 0.0, 4, "outdb", "set_out",
            "Output gain in dB."),
}
SIZE_ENUM = ["512", "1024", "2048", "4096"]
SIZE_INITIAL = 1
HELP_SIZE = "Analysis window in samples. Larger resolves lower pitches; the latency stays 4096 samples."
HELP_TRACK = "Re-centres the curve's quefrency axis on the detected pitch, so pitch-region edits follow the voice."

VARIANTS = {
    "a": {
        "name": "Lifter A",
        "width": 448.0,
        "viz": [10.0, 8.0, 316.0, 152.0],
        "desc": "Canvas layout: large curve canvas with compact value bars",
    },
    "b": {
        "name": "Lifter B",
        "width": 340.0,
        "viz": [10.0, 8.0, 320.0, 82.0],
        "desc": "Dials layout: cepstrum strip above a classic dial row",
    },
    "c": {
        "name": "Lifter C",
        "width": 340.0,
        "viz": [10.0, 8.0, 206.0, 152.0],
        "desc": "Performance layout: XY bell macro pad with two big dials",
    },
}


# Lib functions left out of the embedded gen code. In Max 9.1 the program fails to compile
# ("use of undeclared identifier 'v_40'") when cep_peak and cep_peak_conf (both with a loop
# local `v`) are defined next to the Lifter core, used or not; each compiles on its own.
# lft_pitch in src/lifter_core.genexpr does the same job with its own names.
STRIP_LIB_FUNCS = ()


def strip_lib(lib):
    """Remove STRIP_LIB_FUNCS (with their leading comment lines) from the library text.
    tests/test_lifter.js does the same with the same pattern."""
    for name in STRIP_LIB_FUNCS:
        m = re.search(r"\n(//[^\n]*\n)*" + name + r"\([^\n]*\{\n.*?\n\}\n", lib, re.S)
        if m:
            lib = lib[:m.start()] + "\n" + lib[m.end():]
    return lib


def gen_source():
    with open(LIB_PATH, "r", encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, "r", encoding="utf-8") as f:
        core = f.read()
    return strip_lib(lib) + "\n" + core


def blend_slider_color(accent, alpha=0.38):
    """Live paints activeslidercolor opaque, so pre-blend accent over the dark bg."""
    return [round(accent[i] * alpha + BG_DARK[i] * (1.0 - alpha), 4) for i in range(3)] + [1.0]


def num_valueof(key):
    long_name, short, lo, hi, initial, unit, _gen, _ui, _help = NUM_SPECS[key]
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


def enum_valueof(long_name, enum, initial):
    return {
        "parameter_annotation_name": long_name,
        "parameter_enum": enum,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": len(enum) - 1,
        "parameter_shortname": long_name,
        "parameter_type": 2,
        "parameter_unitstyle": 9,
    }


def make_dial(key, x, y, w, h, color):
    long_name, _s, _lo, _hi, _init, _u, _g, _ui, help_txt = NUM_SPECS[key]
    return {"box": {
        "activedialcolor": [color[0], color[1], color[2], 1.0],
        "annotation": help_txt,
        "annotation_name": long_name,
        "id": f"obj-{key}",
        "maxclass": "live.dial",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 300.0 + 24.0 * len(key), float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": num_valueof(key)},
        "textcolor": [0.88, 0.91, 0.96, 1.0],
        "varname": long_name,
    }}


def make_bar(key, x, y, w, h, color, bipolar=False):
    long_name, _s, _lo, _hi, _init, _u, _g, _ui, help_txt = NUM_SPECS[key]
    return {"box": {
        "activebgcolor": [BG_DARK[0], BG_DARK[1], BG_DARK[2], 1.0],
        "activeslidercolor": blend_slider_color(color),
        "annotation": help_txt,
        "annotation_name": long_name,
        "appearance": 3 if bipolar else 2,
        "bordercolor": [0.22, 0.28, 0.36, 1.0],
        "fontface": 1,
        "fontsize": 9.0,
        "id": f"obj-{key}",
        "maxclass": "live.numbox",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 300.0 + 24.0 * len(key), float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": num_valueof(key)},
        "textcolor": [0.94, 0.96, 0.98, 1.0],
        "varname": long_name,
    }}


def make_size_tab(x, y, w, h, rows):
    accent = AMBER
    return {"box": {
        "activebgcolor": [0.065, 0.078, 0.098, 1.0],
        "activebgoncolor": [accent[0], accent[1], accent[2], 1.0],
        "activetextcolor": [0.76, 0.82, 0.90, 1.0],
        "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
        "annotation": HELP_SIZE,
        "annotation_name": "Size",
        "bordercolor": [0.20, 0.25, 0.32, 1.0],
        "id": "obj-size",
        "maxclass": "live.tab",
        "num_lines_patching": 1,
        "num_lines_presentation": rows,
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "patching_rect": [20.0, 560.0, float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": enum_valueof("Size", SIZE_ENUM, SIZE_INITIAL)},
        "spacing_x": 2.0,
        "spacing_y": 2.0,
        "varname": "Size",
    }}


def make_track(x, y, w, h):
    c = MINT
    return {"box": {
        "activebgcolor": [0.10, 0.12, 0.15, 1.0],
        "activebgoncolor": [c[0], c[1], c[2], 1.0],
        "activetextcolor": [0.72, 0.76, 0.82, 1.0],
        "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
        "annotation": HELP_TRACK,
        "annotation_name": "Track",
        "bordercolor": [c[0], c[1], c[2], 0.85],
        "fontface": 1,
        "fontsize": 9.0,
        "id": "obj-track",
        "maxclass": "live.text",
        "mode": 1,
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", ""],
        "parameter_enable": 1,
        "patching_rect": [100.0, 560.0, float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": enum_valueof("Track", ["Off", "On"], 0)},
        "text": "Track",
        "texton": "Track",
        "varname": "Track",
    }}


def make_label(obj_id, text, x, y, w, h=11.0, size=8.5, color=SLATE, align=0):
    return {"box": {
        "fontface": 1,
        "fontname": "Arial Bold",
        "fontsize": float(size),
        "id": obj_id,
        "maxclass": "live.comment",
        "numinlets": 1,
        "numoutlets": 0,
        "patching_rect": [float(x), 20.0, float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "text": text,
        "textcolor": [color[0], color[1], color[2], 1.0],
        "textjustification": align,
    }}


def make_panel(obj_id, x, y, w, h, bg=(0.078, 0.090, 0.112), border=(0.22, 0.26, 0.34), rounded=6):
    return {"box": {
        "angle": 270.0,
        "background": 1,
        "bgcolor": [bg[0], bg[1], bg[2], 1.0],
        "border": 1,
        "bordercolor": [border[0], border[1], border[2], 1.0],
        "id": obj_id,
        "maxclass": "panel",
        "mode": 0,
        "numinlets": 1,
        "numoutlets": 0,
        "patching_rect": [float(x), 700.0, 80.0, 40.0],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "proportion": 0.5,
        "rounded": rounded,
    }}


def newobj(obj_id, text, x, y, w, ins=1, outs=1, outtypes=None):
    return {"box": {
        "fontname": "Arial Bold",
        "fontsize": 10.0,
        "id": obj_id,
        "maxclass": "newobj",
        "numinlets": ins,
        "numoutlets": outs,
        "outlettype": outtypes if outtypes is not None else [""] * outs,
        "patching_rect": [float(x), float(y), float(w), 20.0],
        "text": text,
    }}


def msgbox(obj_id, text, x, y, w):
    return {"box": {
        "fontname": "Arial Bold",
        "fontsize": 10.0,
        "id": obj_id,
        "maxclass": "message",
        "numinlets": 2,
        "numoutlets": 1,
        "outlettype": [""],
        "patching_rect": [float(x), float(y), float(w), 20.0],
        "text": text,
    }}


def controls_for(variant):
    """(widget boxes, panel boxes) for one layout."""
    if variant == "a":
        widgets = [
            make_label("obj-lbl-depth", "Depth", 338, 8, 100, color=AMBER),
            make_bar("depth", 338, 19, 100, 15, AMBER, bipolar=True),
            make_label("obj-lbl-smooth", "Smooth", 338, 34, 100, color=VIOLET),
            make_bar("smooth", 338, 45, 100, 15, VIOLET),
            make_label("obj-lbl-mix", "Mix", 338, 60, 100, color=CYAN),
            make_bar("mix", 338, 71, 100, 15, CYAN),
            make_label("obj-lbl-out", "Output", 338, 86, 100, color=SLATE),
            make_bar("out", 338, 97, 100, 15, SLATE, bipolar=True),
            make_size_tab(338, 120, 100, 16, 1),
            make_track(338, 142, 100, 16),
        ]
        panels = [
            make_panel("obj-panel-canvas", 6, 5, 324, 159, bg=(0.040, 0.048, 0.064)),
            make_panel("obj-panel-side", 334, 5, 108, 159),
        ]
    elif variant == "b":
        widgets = [
            make_dial("depth", 12, 104, 58, 56, AMBER),
            make_dial("smooth", 72, 104, 58, 56, VIOLET),
            make_dial("mix", 132, 104, 58, 56, CYAN),
            make_dial("out", 192, 104, 58, 56, SLATE),
            make_size_tab(258, 106, 72, 34, 2),
            make_track(258, 144, 72, 16),
        ]
        panels = [
            make_panel("obj-panel-canvas", 6, 5, 328, 89, bg=(0.040, 0.048, 0.064)),
            make_panel("obj-panel-dials", 6, 98, 328, 66),
        ]
    else:
        widgets = [
            make_dial("depth", 228, 8, 52, 56, AMBER),
            make_dial("mix", 282, 8, 50, 56, CYAN),
            make_label("obj-lbl-smooth", "Smooth", 228, 70, 42, color=VIOLET),
            make_bar("smooth", 270, 69, 62, 15, VIOLET),
            make_label("obj-lbl-out", "Output", 228, 90, 42, color=SLATE),
            make_bar("out", 270, 89, 62, 15, SLATE, bipolar=True),
            make_size_tab(228, 112, 104, 16, 1),
            make_track(228, 134, 104, 16),
        ]
        panels = [
            make_panel("obj-panel-canvas", 6, 5, 214, 159, bg=(0.040, 0.048, 0.064)),
            make_panel("obj-panel-side", 224, 5, 110, 159),
        ]
    return widgets, panels


def build_patcher(variant):
    cfg = VARIANTS[variant]
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    gen_code = gen_source()

    width = cfg["width"]
    viz = cfg["viz"]
    widgets, panels = controls_for(variant)

    boxes = [
        {"box": {
            "border": 0,
            "filename": "none",
            "id": "obj-viz",
            "maxclass": "v8ui",
            "numinlets": 1,
            "numoutlets": 1,
            "outlettype": [""],
            "parameter_enable": 1,
            "patching_rect": [20.0, 80.0, viz[2], viz[3]],
            "presentation": 1,
            "presentation_rect": [float(v) for v in viz],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_invisible": 1,
                    "parameter_longname": "CurveData",
                    "parameter_shortname": "CurveData",
                    "parameter_type": 3,
                }
            },
            "textfile": {"text": ui_js, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
            "varname": "CurveData",
        }},
        newobj("obj-plugin", "plugin~", 20, 240, 52, ins=2, outs=2, outtypes=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, ins=2, outs=0, outtypes=[]),
        {"box": {
            "code": gen_code,
            "fontname": "<Monospaced>",
            "fontsize": 10.0,
            "id": "obj-gen",
            "maxclass": "gen.codebox~",
            "numinlets": 2,
            "numoutlets": 2,
            "outlettype": ["signal", "signal"],
            "patching_rect": [120.0, 320.0, 420.0, 120.0],
            "varname": "lifter",
        }},
        newobj("obj-buf-curve", "buffer~ #0-liftercurve @samps 256", 560, 240, 210, ins=1, outs=2,
               outtypes=["float", "bang"]),
        newobj("obj-buf-scope", "buffer~ #0-lifterscope @samps 512", 560, 270, 210, ins=1, outs=2,
               outtypes=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 180, 60, outtypes=["bang"]),
        msgbox("obj-msg-gen-curve", "lcurve #0-liftercurve", 560, 210, 140),
        msgbox("obj-msg-gen-scope", "lscope #0-lifterscope", 710, 210, 140),
        msgbox("obj-msg-ui-buf", "setbuffer #0-lifterscope #0-liftercurve", 860, 210, 250),
        msgbox("obj-msg-ui-layout", f"layout {variant}", 1120, 210, 80),
    ]

    # prepend objects: control -> gen param, control -> v8ui mirror
    for key, spec in NUM_SPECS.items():
        boxes.append(newobj(f"obj-prep-{key}", f"prepend {spec[6]}", 300, 460 + 22 * len(boxes) % 200, 110))
        boxes.append(newobj(f"obj-ui-{key}", f"prepend {spec[7]}", 430, 460 + 22 * len(boxes) % 200, 120))
    boxes.append(newobj("obj-prep-size", "prepend sizei", 300, 640, 110))
    boxes.append(newobj("obj-ui-size", "prepend set_size", 430, 640, 120))
    boxes.append(newobj("obj-prep-track", "prepend trackp", 300, 670, 110))
    boxes.append(newobj("obj-ui-track", "prepend set_track", 430, 670, 120))

    boxes.extend(widgets)
    boxes.extend(panels)  # panels last, background: 1

    def line(src, outlet, dst, inlet=0):
        return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}

    lines = [
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-gen-curve"),
        line("obj-loadbang", 0, "obj-msg-gen-scope"),
        line("obj-loadbang", 0, "obj-msg-ui-layout"),
        line("obj-loadbang", 0, "obj-msg-ui-buf"),
        line("obj-msg-gen-curve", 0, "obj-gen"),
        line("obj-msg-gen-scope", 0, "obj-gen"),
        line("obj-msg-ui-layout", 0, "obj-viz"),
        line("obj-msg-ui-buf", 0, "obj-viz"),
    ]
    for key in list(NUM_SPECS) + ["size", "track"]:
        lines += [
            line(f"obj-{key}", 0, f"obj-prep-{key}"),
            line(f"obj-prep-{key}", 0, "obj-gen"),
            line(f"obj-{key}", 0, f"obj-ui-{key}"),
            line(f"obj-ui-{key}", 0, "obj-viz"),
        ]

    parameters = {
        "obj-viz": ["CurveData", "CurveData", 0],
        "obj-depth": ["Depth", "Depth", 0],
        "obj-smooth": ["Smooth", "Smooth", 0],
        "obj-mix": ["Mix", "Mix", 0],
        "obj-out": ["Output", "Output", 0],
        "obj-size": ["Size", "Size", 0],
        "obj-track": ["Track", "Track", 0],
        "parameterbanks": {
            "0": {
                "index": 0,
                "name": "",
                "parameters": ["Depth", "Smooth", "Mix", "Output", "Size", "Track"],
            }
        },
        "inherited_shortname": 1,
    }

    patcher_doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 60.0, 1220.0, 760.0],
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
            "lefttoolbarpinned": 0,
            "toptoolbarpinned": 0,
            "righttoolbarpinned": 0,
            "bottomtoolbarpinned": 0,
            "toolbars_unpinned_last_save": 0,
            "tallnewobj": 0,
            "boxanimatetime": 500,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": width,
            "description": "Lifter: an EQ for the cepstrum. " + cfg["desc"],
            "digest": "Cepstral lifter EQ for Max for Live",
            "tags": "max for live lifter cepstrum formant pitch",
            "style": "",
            "subpatcher_template": "",
            "title": cfg["name"],
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters,
            "dependency_cache": [],
            "latency": LATENCY,
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
    return patcher_doc


def build(variant):
    cfg = VARIANTS[variant]
    doc = build_patcher(variant)
    json_bytes = json.dumps(doc, indent="\t").encode("utf-8") + b"\n"
    header = (
        b"ampf" + struct.pack("<I", 4) +
        b"aaaa" +
        b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) +
        b"ptch" + struct.pack("<I", len(json_bytes))
    )
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, cfg["name"] + ".amxd")
    with open(out, "wb") as f:
        f.write(header + json_bytes)
    print(f"Built {out} [{int(cfg['width'])}x169 px] ({len(header) + len(json_bytes)} bytes)")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=sorted(VARIANTS), default=None)
    args = ap.parse_args()
    for v in ([args.variant] if args.variant else sorted(VARIANTS)):
        build(v)


if __name__ == "__main__":
    main()
